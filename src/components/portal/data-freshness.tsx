"use client";

import { useSiteDataState } from "@/lib/dynamic-data";

/**
 * The special badge shown after the AI bot updates the page data:
 * "Data has been updated on <date/time> (SGT)" — with a hover tooltip of
 * recent change-log entries. While no AI update has landed yet, a subtle
 * line reports the hourly sync activity instead.
 */

const dtf = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Singapore",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatSgt(iso: string): string {
  return `${dtf.format(new Date(iso))} SGT`;
}

function rel(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - Date.parse(iso));
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function DataFreshnessBadge({ compact = false }: { compact?: boolean }) {
  const { updatedAt, changeLog, lastSync } = useSiteDataState();

  if (updatedAt) {
    const latest = changeLog[0];
    const tip = [
      latest ? `Latest change (${formatSgt(latest.at)}): ${latest.summary} [${latest.sections.join(", ")}]` : null,
      changeLog[1]
        ? `Before (${formatSgt(changeLog[1].at)}): ${changeLog[1].summary}`
        : null,
      lastSync ? `Hourly check: ${rel(lastSync.at, Date.now())} — ${lastSync.status}` : "Checks run hourly",
    ]
      .filter(Boolean)
      .join("\n");

    return (
      <span
        title={tip}
        className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--rc-accent)] bg-[color-mix(in_srgb,var(--rc-accent)_12%,var(--rc-bg))] px-3 py-1 font-mono text-[11px] font-semibold text-[var(--rc-accent)] ${
          compact ? "" : "shadow-sm"
        }`}
      >
        <span aria-hidden className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--rc-accent)] opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--rc-accent)]" />
        </span>
        Data has been updated on {formatSgt(updatedAt)}
      </span>
    );
  }

  if (lastSync) {
    return (
      <span
        title={`The AI doc-sync checks the official z.ai docs hourly.\nLast check ${rel(lastSync.at, Date.now())}: ${lastSync.summary ?? lastSync.status}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--rc-border)] px-3 py-1 font-mono text-[11px] text-[var(--rc-text-dim)]"
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--rc-tone2)]" />
        AI doc-sync live — checked {rel(lastSync.at, Date.now())}, no changes yet
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--rc-border)] px-3 py-1 font-mono text-[11px] text-[var(--rc-text-dim)]">
      <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--rc-tone2)]" />
      AI doc-sync starting…
    </span>
  );
}
