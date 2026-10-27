"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * Color-mode toggle — flips the whole portal between the dark
 * design (default) and the white-paper light mode (Task 55). Writes
 * br-mode for the boot script; applies the class directly so the change
 * is instant with no reload. The <html> class IS the store: components
 * subscribe via a portal event, so several toggles stay in sync.
 */

type Mode = "light" | "dark";
const MODE_KEY = "br-mode";
const MODE_EVENT = "br-mode-change";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(MODE_EVENT, onChange);
  return () => window.removeEventListener(MODE_EVENT, onChange);
}

function getSnapshot(): Mode {
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function getServerSnapshot(): Mode {
  return "dark"; // boot default — matches SSR; reconciled right after hydration
}

function applyMode(next: Mode): void {
  const el = document.documentElement;
  el.classList.remove("light", "dark");
  el.classList.add(next);
  el.style.colorScheme = next;
}

export function ModeToggle({ className = "" }: { className?: string }) {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const current = getSnapshot();
    const next: Mode = current === "dark" ? "light" : "dark";
    applyMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* storage unavailable — mode still applies for the session */
    }
    window.dispatchEvent(new Event(MODE_EVENT));
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mode === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
      aria-pressed={mode === "light"}
      title={mode === "dark" ? "Light theme" : "Dark theme"}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hair/10 bg-hair/[0.04] text-dim transition-colors hover:border-hair/25 hover:text-bright active:scale-95 ${className}`}
    >
      {mode === "light" ? (
        <Moon className="h-[15px] w-[15px]" strokeWidth={1.75} />
      ) : (
        <Sun className="h-[15px] w-[15px]" strokeWidth={1.75} />
      )}
    </button>
  );
}
