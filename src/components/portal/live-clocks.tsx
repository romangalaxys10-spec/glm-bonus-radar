"use client";

import { useNow } from "./live";
import { formatSgtNow, localUtcOffsetLabel } from "@/lib/windows";

/** Hero clock strip: viewer local time vs schedule time (SGT). */
export function LiveClocks() {
  const now = useNow();

  return (
    <div className="mt-7 flex flex-wrap gap-3" aria-label="Current time">
      <Clock
        label="your local time"
        value={now == null ? "—" : new Date(now).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
        sub={now == null ? "" : localUtcOffsetLabel()}
        pulse
      />
      <Clock label="schedule time" value={now == null ? "—" : formatSgtNow(now)} sub="Asia/Singapore · UTC+8" />
    </div>
  );
}

function Clock({ label, value, sub, pulse }: { label: string; value: string; sub: string; pulse?: boolean }) {
  return (
    <div className="card-surface flex items-center gap-3 rounded-lg px-4 py-2.5">
      {pulse && (
        <span aria-hidden className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--rc-accent)] opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--rc-accent)]" />
        </span>
      )}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--rc-text-dim)]">{label}</p>
        <p className="font-mono text-base font-bold text-[var(--rc-bright)] tnum">
          {value} <span className="text-[11px] font-normal text-[var(--rc-text-dim)]">{sub}</span>
        </p>
      </div>
    </div>
  );
}
