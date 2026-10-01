"use client";

/**
 * China ops calendar — when China-based teams (z.ai included) may run with
 * limited operations due to public holidays. Computes the active/upcoming
 * holiday live in the browser (CST, UTC+8 — same fixed offset the rest of
 * the radar uses) with a ticking countdown to normal-operations resume.
 *
 * Hydration-safe AND crawler-honest: the pre-hydration SSR shell only states
 * timeless facts (the full 2026 official schedule, general ops guidance);
 * anything time-dependent (status pill, active/next hero, countdown, upcoming
 * list) appears right after mount, mirroring the live.tsx pattern.
 */

import { useNow } from "@/components/portal/live";
import {
  CN_HOLIDAYS,
  cnIsoDate,
  cnRangeLabel,
  cnShortDate,
  compactCountdown,
  getChinaOps,
  holidayResumeMs,
  holidayStartMs,
  type CnHoliday,
} from "@/lib/cn-holidays";

function OpsPill({ limited }: { limited: boolean }) {
  const label = limited ? "limited operations" : "normal operations";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 cursor-default select-none items-center gap-1.5 rounded-full border px-2.5 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors ${
        limited
          ? "border-[color-mix(in_srgb,var(--rc-tone2)_55%,transparent)] bg-[color-mix(in_srgb,var(--rc-tone2)_14%,transparent)] text-[var(--rc-tone2)]"
          : "border-[var(--rc-border)] bg-[var(--rc-surface)] text-[var(--rc-text-dim)]"
      }`}
    >
      <span aria-hidden className="relative flex h-1.5 w-1.5">
        {limited && <span className="tgl-on absolute inline-flex h-full w-full rounded-full bg-[var(--rc-tone2)] opacity-60" />}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${limited ? "bg-[var(--rc-tone2)]" : "bg-[var(--rc-text-dim)]"}`} />
      </span>
      {label}
    </span>
  );
}

function ProvisionalChip() {
  return (
    <span
      title="Expected pattern — the State Council usually publishes the official schedule in November of the prior year"
      className="inline-flex shrink-0 items-center rounded-full border border-dashed border-[var(--rc-border)] px-2 py-[1px] font-mono text-[10px] text-[var(--rc-text-dim)]"
    >
      expected
    </span>
  );
}

function HolidayRow({ h, highlight }: { h: CnHoliday; highlight?: boolean }) {
  const note = h.note ?? (h.makeup?.length ? `Make-up workdays: ${h.makeup.map(cnShortDate).join(", ")} (normal operations).` : null);
  return (
    <li
      className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 ${
        highlight
          ? "border border-[color-mix(in_srgb,var(--rc-tone2)_45%,transparent)] bg-[color-mix(in_srgb,var(--rc-tone2)_9%,transparent)]"
          : "border border-transparent"
      }`}
    >
      <time dateTime={h.start} className="w-28 shrink-0 font-mono text-xs text-[var(--rc-text)]">
        {cnRangeLabel(h)}
      </time>
      <span className="text-sm font-semibold">
        {h.name} <span className="font-normal text-[var(--rc-text-dim)]">· {h.nameCn}</span>
      </span>
      {h.provisional ? <ProvisionalChip /> : null}
      {note ? <span className="w-full pl-0 text-xs leading-relaxed text-[var(--rc-text-dim)] md:w-auto md:flex-1 md:pl-1">{note}</span> : null}
    </li>
  );
}

/** The 2026 official schedule — timeless, server-rendered for crawlers. */
const OFFICIAL_2026 = CN_HOLIDAYS.filter((h) => !h.provisional && h.start.startsWith("2026"));

export function CnOpsSection() {
  const now = useNow();
  const live = now != null;
  const ops = getChinaOps(now ?? 0);
  const limited = live && Boolean(ops.active);
  const resumeMs = ops.resumeMs;

  return (
    <div className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {live ? (
          <OpsPill limited={limited} />
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-text-dim)]">China public holidays</span>
        )}
        <span className="font-mono text-[11px] text-[var(--rc-text-dim)]">Asia/Shanghai · UTC+8 · no DST</span>
      </div>

      {/* Hero line: live status once mounted; timeless guidance in the SSR shell */}
      <div className="mt-4" aria-live="polite">
        {live && ops.active ? (
          <p className="text-[15px] leading-relaxed">
            <span className="font-semibold">
              {ops.active.name} · {ops.active.nameCn}
            </span>{" "}
            <time dateTime={ops.active.start} className="font-mono text-sm text-[var(--rc-tone2)]">
              {cnRangeLabel(ops.active)}
            </time>{" "}
            — China-based teams, z.ai&apos;s Beijing office included, are likely running with reduced staff: support
            replies and non-critical releases may take longer.{" "}
            {resumeMs && now ? (
              <>
                Normal operations expected{" "}
                <time dateTime={cnIsoDate(resumeMs)} className="font-mono font-semibold text-[var(--rc-text)]">
                  {cnShortDate(cnIsoDate(resumeMs))}
                </time>
                , in <span className="font-mono font-semibold text-[var(--rc-tone2)]">{compactCountdown(resumeMs - now)}</span>.
              </>
            ) : null}
          </p>
        ) : live && ops.next ? (
          <p className="text-[15px] leading-relaxed">
            Operations are normal right now. Next limited-operations window:{" "}
            <span className="font-semibold">
              {ops.next.name} · {ops.next.nameCn}
            </span>{" "}
            <time dateTime={ops.next.start} className="font-mono text-sm text-[var(--rc-accent)]">
              {cnRangeLabel(ops.next)}
            </time>
            {now ? (
              <>
                , in <span className="font-mono font-semibold text-[var(--rc-accent)]">{compactCountdown(holidayStartMs(ops.next) - now)}</span>
              </>
            ) : null}
            .
          </p>
        ) : (
          <p className="text-[15px] leading-relaxed">
            z.ai is built in Beijing, and its teams observe China&apos;s public holidays — during Golden Week, Spring
            Festival and the shorter festivals, support replies and non-critical releases slow down across China-based
            companies while the API itself stays on-call.
          </p>
        )}
      </div>

      {/* Holiday list: upcoming-only once live; full 2026 schedule in the SSR shell */}
      <h3 className="mt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rc-tone3)]">
        {live ? "Upcoming windows of limited operations" : "2026 official schedule (State Council notice)"}
      </h3>
      <ul className="mt-2 grid gap-1">
        {live
          ? ops.upcoming.map((h) => <HolidayRow key={h.id} h={h} />)
          : OFFICIAL_2026.map((h) => <HolidayRow key={h.id} h={h} />)}
      </ul>

      <p className="mt-5 border-t border-[var(--rc-border)] pt-4 text-xs leading-relaxed text-[var(--rc-text-dim)]">
        China has 13 statutory holiday days a year, extended into week-long breaks by swapping weekends — the swapped-in
        Saturday/Sundays are working days with normal operations. 2026 dates follow the official State Council notice;{" "}
        {CN_HOLIDAYS.some((h) => h.provisional) && "later years are the expected pattern until published (usually each November). "}
        API infrastructure stays on-call through every holiday — this affects support, pricing updates and release pace far more than uptime.
      </p>
    </div>
  );
}
