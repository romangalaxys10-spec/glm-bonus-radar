"use client";

import { useSyncExternalStore } from "react";

/**
 * Sponsored badge/banner — xshredo AI VPS.
 *
 * Copy is the NLP-polished version of the brief ("Need AI VPS running your
 * agents 24x7 - it doesnt cost that much anymore"). SEO/GEO contract:
 *   - descriptive anchor text + rel="sponsored noopener" (paid-placement
 *     signal Google asks for)
 *   - UTM tags so the advertiser can attribute referrals
 *   - a matching server-rendered JSON-LD Product/Offer block lives in
 *     page.tsx so crawlers and generative engines see it in initial HTML
 *
 * Dismiss state lives in localStorage behind useSyncExternalStore (same
 * pattern as the site's shared clock store): server snapshot is `true`
 * (hidden) so SSR output never mismatches, then hydration reveals it
 * unless the visitor dismissed it. The flag version rolls whenever the
 * copy changes so a refreshed message earns a fresh impression.
 */

const DISMISS_KEY = "aivps-banner:dismissed:v1";
const HREF =
  "https://xshredo.com/ai-vps?utm_source=zhelp.space-z.ai&utm_medium=banner&utm_campaign=ai-vps-badge";

/* ------------------------------------------------------------------ */
/* localStorage dismiss store (external system, React-idiomatic)        */
/* ------------------------------------------------------------------ */

let cachedDismissed: boolean | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Cross-tab sync: dismissing in another tab hides it here too.
  if (typeof window !== "undefined" && listeners.size === 1) {
    window.addEventListener("storage", storageListener);
  }
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined" && listeners.size === 0) {
      window.removeEventListener("storage", storageListener);
    }
  };
}

function storageListener(event: StorageEvent) {
  if (event.key === DISMISS_KEY) {
    cachedDismissed = event.newValue === "1";
    notify();
  }
}

function getSnapshot(): boolean {
  if (cachedDismissed == null) {
    try {
      cachedDismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      cachedDismissed = false; // private mode / storage disabled — show it
    }
  }
  return cachedDismissed;
}

function dismissForever() {
  cachedDismissed = true;
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* non-persistent dismissal is fine */
  }
  notify();
}

/* ------------------------------------------------------------------ */
/* Banner                                                               */
/* ------------------------------------------------------------------ */

export function AiVpsBanner() {
  // Server snapshot `false` (visible): the sponsored copy ships in the SSR
  // HTML for crawlers/generative engines. Dismissed visitors see it flip
  // away right after hydration — useSyncExternalStore handles the
  // server→client snapshot change without a hydration mismatch error.
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, () => false);

  if (dismissed) return null;

  return (
    <aside
      aria-label="Sponsored: AI VPS for always-on agents"
      className="relative mt-4 max-w-2xl overflow-hidden rounded-xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-4 transition-colors hover:border-[color-mix(in_srgb,var(--rc-accent)_40%,var(--rc-border))]"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--rc-accent)]" />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pl-2">
        <div className="min-w-[240px] flex-1">
          <p className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--rc-tone3)]">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--rc-accent)]" />
            sponsored
          </p>
          <p className="mt-1.5 font-display text-[17px] font-semibold leading-snug text-[var(--rc-text)]">
            Need an AI VPS to run your agents 24/7?
          </p>
          <p className="mt-0.5 text-[13px] leading-snug text-[var(--rc-text-dim)]">
            Always-on agent hosting — it doesn&apos;t cost that much anymore.
          </p>
        </div>

        <a
          href={HREF}
          target="_blank"
          rel="sponsored noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--rc-accent)] px-4 py-2 font-mono text-xs font-semibold text-[var(--rc-bg)] transition-colors hover:bg-[var(--rc-bright)]"
        >
          AI VPS plans
          <span aria-hidden>↗</span>
        </a>

        <button
          type="button"
          onClick={dismissForever}
          aria-label="Dismiss sponsor message"
          className="absolute right-2.5 top-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--rc-text-dim)] transition-colors hover:bg-[color-mix(in_srgb,var(--rc-bright)_10%,transparent)] hover:text-[var(--rc-text)]"
        >
          <span aria-hidden className="text-sm leading-none">
            ×
          </span>
        </button>
      </div>
    </aside>
  );
}
