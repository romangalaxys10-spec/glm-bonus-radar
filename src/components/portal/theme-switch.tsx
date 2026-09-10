"use client";

import { useSyncExternalStore } from "react";
import { MODES, PALETTES, MODE_STORAGE_KEY, PALETTE_STORAGE_KEY } from "@/lib/theme";

/* ------------------------------------------------------------------ */
/* Theme store: localStorage is the source of truth, read through      */
/* useSyncExternalStore. DOM classes are applied pre-paint by the boot */
/* script in layout.tsx and re-applied here on user interaction.       */
/* ------------------------------------------------------------------ */

const themeListeners = new Set<() => void>();

function applyFromStore() {
  const palette = localStorage.getItem(PALETTE_STORAGE_KEY) || "brook";
  const mode = localStorage.getItem(MODE_STORAGE_KEY) || "system";
  const dark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.palette = palette;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

function subscribeTheme(onChange: () => void): () => void {
  themeListeners.add(onChange);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    const mode = localStorage.getItem(MODE_STORAGE_KEY);
    if (!mode || mode === "system") applyFromStore();
    onChange();
  };
  mq.addEventListener("change", onSystemChange);
  const onStorage = () => onChange(); // cross-tab sync
  window.addEventListener("storage", onStorage);
  return () => {
    themeListeners.delete(onChange);
    mq.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getPalette(): string {
  try {
    return localStorage.getItem(PALETTE_STORAGE_KEY) || "brook";
  } catch {
    return "brook";
  }
}

function getMode(): string {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) || "system";
  } catch {
    return "system";
  }
}

export function ThemeSwitch() {
  const palette = useSyncExternalStore(subscribeTheme, getPalette, () => "brook");
  const mode = useSyncExternalStore(subscribeTheme, getMode, () => "system");

  const pickPalette = (p: string) => {
    localStorage.setItem(PALETTE_STORAGE_KEY, p);
    applyFromStore();
    themeListeners.forEach((l) => l());
  };

  const pickMode = (m: string) => {
    localStorage.setItem(MODE_STORAGE_KEY, m);
    applyFromStore();
    themeListeners.forEach((l) => l());
  };

  return (
    <div
      className="flex items-center gap-3 font-mono text-[11px] text-[var(--rc-text-dim)]"
      aria-label="Theme picker"
    >
      <div className="flex items-center gap-1.5" role="group" aria-label="Palette">
        {PALETTES.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.label}
            aria-label={`${p.label} palette`}
            aria-pressed={palette === p.id}
            onClick={() => pickPalette(p.id)}
            className="h-[14px] w-[14px] rounded-full border border-[var(--rc-border)] transition-transform hover:scale-125 aria-pressed:scale-110 aria-pressed:border-[var(--rc-bright)]"
            style={{ background: p.dot }}
          />
        ))}
      </div>
      <div
        className="flex overflow-hidden rounded-md border border-[var(--rc-border)]"
        role="group"
        aria-label="Color mode"
      >
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            title={m}
            aria-label={`${m} mode`}
            aria-pressed={mode === m}
            onClick={() => pickMode(m)}
            className="flex h-6 w-7 items-center justify-center border-r border-[var(--rc-border)] last:border-r-0 transition-colors hover:text-[var(--rc-bright)] aria-pressed:bg-[color-mix(in_srgb,var(--rc-accent)_14%,transparent)] aria-pressed:text-[var(--rc-accent)]"
          >
            {m === "light" && <SunIcon />}
            {m === "system" && <SystemIcon />}
            {m === "dark" && <MoonIcon />}
          </button>
        ))}
      </div>
    </div>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
