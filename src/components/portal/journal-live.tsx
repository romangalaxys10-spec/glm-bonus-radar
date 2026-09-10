"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the /changelog journal alive: re-renders the server component every
 * minute while the tab is visible, so a check that just ran shows up without
 * a manual reload. Presentational part is static — no per-tick state.
 */
export function JournalLive({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs]);

  return (
    <p className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--rc-text-dim)]">
      <span aria-hidden className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--rc-accent)] opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--rc-accent)]" />
      </span>
      live — this journal refreshes itself every minute
    </p>
  );
}
