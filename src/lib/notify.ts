"use client";

/**
 * Browser notification engine — preferences, permission and fire/dedupe.
 *
 * Categories map 1:1 to the user-facing toggles in the bell panel:
 *  - golden         the golden window opens / closes
 *  - windows        any bonus window opens / closes
 *  - announcements  new AI-synced announcements land
 *
 * Everything is opt-in per category; a Notification is only raised when the
 * browser permission is "granted". Dedupe is content-addressed and persisted
 * in localStorage so the same transition never fires twice, even across
 * reloads within the same event instance.
 */

export type NotifyCategory = "golden" | "windows" | "announcements";

export interface NotifyPrefs {
  golden: boolean;
  windows: boolean;
  announcements: boolean;
}

const PREFS_KEY = "br-notify-prefs-v1";
const FIRED_KEY = "br-notify-fired-v1";
const MAX_FIRED = 80;

const DEFAULT_PREFS: NotifyPrefs = {
  golden: false,
  windows: false,
  announcements: false,
};

/* ------------------------- preferences store ---------------------------- */

let cachedPrefs: NotifyPrefs = { ...DEFAULT_PREFS };
const prefListeners = new Set<() => void>();

function readPrefs(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<NotifyPrefs>;
    return {
      golden: parsed.golden === true,
      windows: parsed.windows === true,
      announcements: parsed.announcements === true,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

if (typeof window !== "undefined") {
  cachedPrefs = readPrefs();
}

export function subscribePrefs(onChange: () => void): () => void {
  prefListeners.add(onChange);
  return () => prefListeners.delete(onChange);
}

export function getPrefsSnapshot(): NotifyPrefs {
  return cachedPrefs;
}

export function setPrefs(next: NotifyPrefs): void {
  cachedPrefs = { ...next };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(cachedPrefs));
  } catch {
    /* storage unavailable — session-only prefs */
  }
  prefListeners.forEach((l) => l());
}

export function anyPrefOn(prefs: NotifyPrefs = cachedPrefs): boolean {
  return prefs.golden || prefs.windows || prefs.announcements;
}

/* ------------------------------ permission ------------------------------ */

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

export function permissionState(): NotificationPermission | "unsupported" {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

/** Requests permission; resolves to the resulting state. Must be called from a user gesture. */
export async function requestPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/* --------------------------- fire + dedupe ------------------------------ */

interface FiredMap {
  [key: string]: number;
}

function loadFired(): FiredMap {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: FiredMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveFired(map: FiredMap) {
  try {
    const entries = Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_FIRED);
    localStorage.setItem(FIRED_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage unavailable — dedupe becomes session-only */
  }
}

/** True (and records) if this exact event key has not been fired before. */
export function markFired(key: string): boolean {
  const map = loadFired();
  if (map[key] != null) return false;
  map[key] = Date.now();
  saveFired(map);
  return true;
}

export interface NotifyPayload {
  category: NotifyCategory;
  title: string;
  body: string;
  /** Content-addressed event key, e.g. `open:flash-campaign:1789839600000`. */
  key: string;
  /** Anchor to scroll to when the notification is clicked. */
  hash?: string;
}

const PREFIX: Record<NotifyCategory, string> = {
  golden: "Golden window",
  windows: "Bonus window",
  announcements: "z.ai announcement",
};

/**
 * Sends a browser notification if allowed, opted-in and not already fired.
 * Returns false when suppressed for any reason.
 */
export function fireNotification(payload: NotifyPayload): boolean {
  if (!notificationsSupported()) return false;
  if (Notification.permission !== "granted") return false;
  if (!markFired(payload.key)) return false;
  try {
    const n = new Notification(`${PREFIX[payload.category]} — ${payload.title}`, {
      body: payload.body,
      tag: payload.key,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    });
    n.onclick = () => {
      window.focus();
      if (payload.hash) window.location.hash = payload.hash;
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}
