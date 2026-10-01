"use client";

import { useMemo, useState } from "react";
import { useSiteDataState } from "@/lib/dynamic-data";
import type { AnnouncementItem } from "@/lib/site-data";
import { announcementKey, useFreshAnnouncements } from "@/lib/use-fresh-announcements";

/**
 * "Latest from z.ai" — renders the announcements the AI doc-sync extracted
 * from the official docs (release notes first). Each entry carries a source
 * link back to the exact docs page it came from.
 *
 * Only the first `max` entries show by default; the rest sit behind a
 * "show N more" expander. When a brand-new announcement lands mid-session
 * (shared hook with the Z-Assist teaser), the strip pulses, shows a NEW
 * chip, auto-expands so nothing hides the news, and the fresh rows flash
 * once — then everything settles back to calm.
 */

const DATE_RE = /^(\d{4}-\d{2}-\d{2})\s+[—–-]\s+(.+)$/;

function parseAnnouncement(a: AnnouncementItem | string): { date: string | null; text: string } {
  // The sync may emit legacy plain strings — never trust a.text to exist.
  const raw = typeof a === "string" ? a : (a?.text ?? "");
  const text = typeof raw === "string" ? raw.trim() : "";
  const m = DATE_RE.exec(text);
  if (!m) return { date: null, text };
  return { date: m[1], text: m[2] };
}

export function AnnouncementsStrip({ max = 3 }: { max?: number }) {
  const { payload } = useSiteDataState();
  const all = payload?.announcements ?? [];
  const { active: pulse, fresh } = useFreshAnnouncements();
  const freshKeys = useMemo(() => new Set(fresh.map(announcementKey)), [fresh]);
  const [expanded, setExpanded] = useState(false);

  // Derived (no effect): a brand-new announcement never hides behind the
  // expander — the strip auto-expands for the duration of the pulse window.
  const autoExpanded = pulse && fresh.length > 0;
  const visible = expanded || autoExpanded ? all : all.slice(0, max);
  if (visible.length === 0) return null;

  return (
    <div
      aria-label="Latest z.ai announcements"
      className={`announce-strip mt-6 max-w-2xl rounded-xl border bg-[var(--rc-surface)] p-4 transition-colors ${
        pulse
          ? "announce-strip--pulse border-[var(--rc-bright)]"
          : "border-[var(--rc-border)]"
      }`}
    >
      <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--rc-text-dim)]">
        <span
          aria-hidden
          className={`inline-block h-1.5 w-1.5 rounded-full ${pulse ? "animate-ping bg-[var(--rc-bright)]" : "bg-[var(--rc-bright)]"}`}
        />
        Latest from z.ai — synced from official docs
        {pulse && (
          <span className="rounded-full bg-[var(--rc-bright)] px-2 py-0.5 text-[10px] font-bold tracking-normal text-[var(--rc-bg)] announce-new-chip">
            NEW
          </span>
        )}
      </p>
      <ul className="mt-3 space-y-2.5">
        {visible.map((a) => {
          const { date, text } = parseAnnouncement(a);
          const key = announcementKey(a);
          const isFresh = freshKeys.has(key);
          const body = (
            <>
              {date ? (
                <span className="mt-px shrink-0 rounded border border-[var(--rc-border)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--rc-accent)]">
                  {date}
                </span>
              ) : (
                <span
                  aria-hidden
                  className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--rc-tone3)]"
                />
              )}
              <span className="text-[var(--rc-text)]">{text}</span>
            </>
          );
          return (
            <li
              key={key}
              className={`flex items-start gap-2.5 rounded-md text-sm leading-snug ${
                isFresh ? "announce-row--fresh -mx-1.5 px-1.5 py-1" : ""
              }`}
            >
              {a.source ? (
                <a
                  href={a.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Source: ${a.source}`}
                  className="flex items-start gap-2.5 decoration-dotted underline-offset-2 hover:underline"
                >
                  {body}
                </a>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
      {all.length > max && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--rc-text-dim)] transition-colors hover:text-[var(--rc-accent)]"
        >
          {expanded ? "show less ↑" : `show ${all.length - max} more ↓`}
        </button>
      )}
    </div>
  );
}
