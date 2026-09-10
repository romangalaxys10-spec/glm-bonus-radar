"use client";

import { useSyncExternalStore } from "react";
import type { BonusWindowDef } from "@/lib/windows";
import { BONUS_WINDOWS } from "@/lib/windows";
import type {
  AnnouncementItem,
  ChangeLogEntry,
  SiteDataPayload,
} from "@/lib/site-data";

/**
 * Client-side mirror of the AI-synced site data.
 *
 * The hourly doc-sync job (server) writes the payload to the DB; this store
 * polls /api/site-data (on first subscribe, then every 5 minutes) and hands
 * the overrides to any component that asks — defaulting to the static data
 * until the first successful sync lands.
 */

/**
 * Stable per-item key so announcement sets can be diffed across polls.
 * Accepts both the current {text, source} shape and legacy plain strings
 * (a stale sync may still emit string[]); a string `s` and an object
 * `{text: s}` without source deliberately produce the SAME key.
 */
export const announcementKey = (a: AnnouncementItem | string): string =>
  typeof a === "string"
    ? JSON.stringify([a, null])
    : JSON.stringify([a?.text, a?.source ?? null]);

const FRESH_MS = 9_000;

export interface SiteDataState {
  loaded: boolean;
  payload: SiteDataPayload | null;
  updatedAt: string | null;
  changeLog: ChangeLogEntry[];
  lastSync: { at: string; status: string; summary: string | null } | null;
  /** Announcements that arrived mid-session (never set on first load). */
  freshAnnouncements: AnnouncementItem[];
}

const EMPTY: SiteDataState = {
  loaded: false,
  payload: null,
  updatedAt: null,
  changeLog: [],
  lastSync: null,
  freshAnnouncements: [],
};

let state: SiteDataState = EMPTY;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;
let freshTimer: ReturnType<typeof setTimeout> | null = null;

/* ------------------- "new since your last visit" -------------------------
 * The announcement keys this browser last saw are persisted locally. On the
 * first load of a session the fetched set is diffed against them, so a
 * returning visitor still gets the NEW badge / launcher dot / tab counter
 * even though the in-memory diff has nothing to compare against. Content-
 * addressed keys make the check immune to reordering and server-side caps.
 * ---------------------------------------------------------------------- */
const SEEN_KEY = "br-anns-seen-v1";

function loadSeenKeys(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveSeenKeys(anns: AnnouncementItem[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(anns.map(announcementKey).slice(-10)));
  } catch {
    /* storage unavailable — badge simply won't persist */
  }
}

/** Tab-title alert: "(2) GLM Bonus Radar …" while fresh news is on screen. */
function applyTitleAlert(count: number) {
  if (typeof document === "undefined") return;
  const base = document.title.replace(/^\(\d+\)\s*/, "");
  document.title = count > 0 ? `(${count}) ${base}` : base;
}

function setState(patch: Partial<SiteDataState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

async function refresh(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/site-data", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as {
        payload: SiteDataPayload | null;
        updatedAt: string | null;
        changeLog: ChangeLogEntry[];
        lastSync: SiteDataState["lastSync"];
      };

      /* News detection — two sources, one rule:
         · mid-session: diff against the previously rendered set;
         · returning visitor: diff against the localStorage seen-set.
         A brand-new session (nothing seen before) never counts as news. */
      const nextAnns = json.payload?.announcements;
      let freshList: AnnouncementItem[] = [];
      if (nextAnns) {
        const refKeys = state.loaded
          ? (state.payload?.announcements ?? []).map(announcementKey)
          : loadSeenKeys();
        if (refKeys.length > 0) {
          const seen = new Set(refKeys);
          freshList = nextAnns.filter((a) => !seen.has(announcementKey(a)));
        }
        saveSeenKeys(nextAnns);
      }
      if (freshTimer != null) {
        clearTimeout(freshTimer);
        freshTimer = null;
      }
      if (freshList.length > 0) {
        freshTimer = setTimeout(() => {
          freshTimer = null;
          setState({ freshAnnouncements: [] });
          applyTitleAlert(0);
        }, FRESH_MS);
      }

      setState({
        loaded: true,
        payload: json.payload,
        updatedAt: json.updatedAt,
        changeLog: Array.isArray(json.changeLog) ? json.changeLog : [],
        lastSync: json.lastSync ?? null,
        freshAnnouncements: freshList,
      });
      applyTitleAlert(freshList.length);
    } catch {
      /* offline / server restarting — keep previous state */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (listeners.size === 1) {
    void refresh();
    timer = setInterval(() => void refresh(), 5 * 60 * 1000);
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    }
  };
}

function onFocus() {
  void refresh();
}

function getSnapshot(): SiteDataState {
  return state;
}

function getServerSnapshot(): SiteDataState {
  return EMPTY;
}

/** Full AI-sync record (payload may be null until the first sync lands). */
export function useSiteDataState(): SiteDataState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Window definitions: AI-synced when available, otherwise the static set. */
export function useWindows(): BonusWindowDef[] {
  const { payload } = useSiteDataState();
  return payload?.windows?.length ? payload.windows : BONUS_WINDOWS;
}

export function usePricingOverride() {
  const { payload } = useSiteDataState();
  return payload?.pricing ?? null;
}

export function usePlansOverride() {
  const { payload } = useSiteDataState();
  return payload?.plans ?? null;
}
