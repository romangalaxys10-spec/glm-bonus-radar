"use client";

import { useEffect, useState } from "react";

/**
 * "Install app" badge for mobile (and desktop) visitors.
 *
 * - Chromium: captures `beforeinstallprompt` and triggers the native install
 *   dialog on click. Registers the service worker that makes this installable.
 * - iOS Safari: never fires beforeinstallprompt — shows an "Add to Home
 *   Screen" badge with a short hand instructions popover instead.
 * - Hidden when already running standalone, or for 14 days after a dismissal
 *   (localStorage `br-pwa-dismissed-v1`).
 */

const DISMISS_KEY = "br-pwa-dismissed-v1";
const DISMISS_MS = 14 * 24 * 3600 * 1000;

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [chatChrome, setChatChrome] = useState(false);

  /* Z-Assist owns the bottom-right corner — while its chat panel or the
     teaser bubble is up, this badge steps aside instead of stacking over it. */
  useEffect(() => {
    const onChrome = (e: Event) => {
      const d = (e as CustomEvent<{ open?: boolean; teaser?: boolean }>).detail;
      setChatChrome(Boolean(d?.open || d?.teaser));
    };
    window.addEventListener("zassist:chrome", onChrome);
    return () => window.removeEventListener("zassist:chrome", onChrome);
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setShowHelp(false);
      setInstalled(true);
      window.setTimeout(() => setInstalled(false), 6000);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);

    // Decide visibility after mount (kept out of the effect body for the
    // react-compiler set-state rule; also sidesteps hydration races).
    const timer = window.setTimeout(() => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (standalone) return;
      let dismissedAt = 0;
      try {
        dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0) || 0;
      } catch {
        /* private mode */
      }
      if (Date.now() - dismissedAt < DISMISS_MS) return;
      const ua = navigator.userAgent;
      const ios = /iphone|ipad|ipod/i.test(ua);
      // iPadOS 13+ masquerades as Mac — catch it via touch + no beforeinstallprompt.
      const ipadOs =
        /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1 && !("onbeforeinstallprompt" in window);
      if (ios || ipadOs) {
        setIsIos(true);
        setVisible(true);
      }
      // Desktop/Android Chromium: the badge appears when beforeinstallprompt fires.
    }, 60);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    setShowHelp(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode */
    }
  };

  const install = async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice.outcome === "accepted") setVisible(false);
      } catch {
        /* user aborted the native dialog */
      }
      return;
    }
    setShowHelp((v) => !v);
  };

  if ((!visible && !installed) || chatChrome) return null;

  return (
    /* Sits in the bottom-right row, just left of the Z-Assist launcher —
       one predictable corner for all floating chrome, no content overlap. */
    <div className="fixed bottom-7 right-[6.5rem] z-[60] max-w-[calc(100vw-8.5rem)] sm:right-[7rem] md:right-[7.25rem]">
      {installed ? (
        <div
          role="status"
          className="card-surface flex items-center gap-2 rounded-full border px-3.5 py-2 font-mono text-xs font-semibold shadow-lg"
        >
          <span aria-hidden className="text-[var(--rc-accent)]">●</span> installed — find Bonus Radar on your home
          screen
        </div>
      ) : (
        <>
          {showHelp && (
            <div
              role="note"
              className="card-surface mb-2 max-w-[260px] rounded-xl border p-3 text-[13px] leading-snug shadow-xl"
            >
              <p className="font-semibold">Add to Home Screen</p>
              <p className="mt-1 text-[var(--rc-text-dim)]">
                Tap the <span className="font-semibold">Share</span> icon{" "}
                <span aria-hidden>⎋ ↑</span> in Safari&apos;s toolbar, scroll, then choose{" "}
                <span className="font-semibold">“Add to Home Screen”</span>.
              </p>
            </div>
          )}
          <div className="card-surface flex items-center gap-2.5 rounded-full border py-1.5 pl-2 pr-1.5 shadow-xl">
            { }
            <img src="/icon-192.png" alt="" aria-hidden className="h-7 w-7 rounded-lg" />
            <button
              type="button"
              onClick={install}
              className="whitespace-nowrap font-mono text-xs font-bold uppercase tracking-wide text-[var(--rc-bright)] transition-colors hover:text-[var(--rc-accent)]"
            >
              {isIos || !deferred ? "add to home screen" : "install app"}
            </button>
            <button
              type="button"
              aria-label="Dismiss install badge"
              onClick={dismiss}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[var(--rc-text-dim)] transition-colors hover:bg-[var(--rc-surface)] hover:text-[var(--rc-bright)]"
            >
              <span aria-hidden>×</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
