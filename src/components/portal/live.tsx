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
 * Display-only toggle pill mirroring the reference tracker: slides and
 * glows while the window is active.
 */
export function TogglePill({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`relative inline-block h-[18px] w-[34px] shrink-0 rounded-full border align-middle transition-colors ${
        on
          ? "tgl-on border-[var(--rc-accent)] bg-[color-mix(in_srgb,var(--rc-accent)_22%,transparent)]"
          : "border-[var(--rc-border)] bg-[var(--rc-surface)]"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all ${
          on ? "left-[18px] bg-[var(--rc-accent)]" : "left-[2px] bg-[var(--rc-text-dim)]"
        }`}
      />
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
