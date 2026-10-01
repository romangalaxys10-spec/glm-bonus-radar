"use client";

import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ */
/* Shared 1s clock store — React-idiomatic external subscription.      */
/* Server snapshot is null so SSR output stays hydration-safe:         */
/* live values appear right after hydration.                           */
/* ------------------------------------------------------------------ */

const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
/** Cached snapshot — only advances on ticks so getSnapshot stays referentially stable. */
let cachedNow: number | null = null;

function subscribeClock(onChange: () => void): () => void {
  if (cachedNow == null) cachedNow = Date.now();
  clockListeners.add(onChange);
  if (clockTimer == null) {
    clockTimer = setInterval(() => {
      cachedNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    clockListeners.delete(onChange);
    if (clockListeners.size === 0 && clockTimer != null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/** Ticking wall clock (epoch ms). Returns null until mounted. */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribeClock,
    () => cachedNow,
    () => null,
  );
}

/**
 * Display-only status badge: live dot + mono label. Deliberately NOT shaped
 * like a switch — the old sliding toggle looked interactive and visitors
 * kept trying to flip it. The dot glows while the window is active.
 */
export function StatusPill({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 cursor-default select-none items-center gap-1.5 rounded-full border px-2.5 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors ${
        on
          ? "border-[color-mix(in_srgb,var(--rc-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--rc-accent)_10%,transparent)] text-[var(--rc-accent)]"
          : "border-[var(--rc-border)] bg-[var(--rc-surface)] text-[var(--rc-text-dim)]"
      }`}
    >
      <span aria-hidden className="relative flex h-1.5 w-1.5">
        {on && (
          <span className="tgl-on absolute inline-flex h-full w-full rounded-full bg-[var(--rc-accent)] opacity-60" />
        )}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
            on ? "bg-[var(--rc-accent)]" : "bg-[var(--rc-text-dim)]"
          }`}
        />
      </span>
      {label}
    </span>
  );
}

/** Small colored chip used in legends and table rows. */
export function WindowChip({ colorVar, children }: { colorVar: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span
        aria-hidden
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: `var(${colorVar})` }}
      />
      {children}
    </span>
  );
}
