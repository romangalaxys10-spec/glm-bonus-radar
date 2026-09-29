"use client";

import { useMemo } from "react";
import {
  SGT_TZ,
  SGT_TZ_LABEL,
  evaluateAll,
  formatCountdown,
  formatLocalClock,
  formatSgtNow,
  goldenWindow,
  localMidnight,
  localUtcOffsetLabel,
  metricsWindowId,
  segmentsForRange,
  sgtMidnight,
  type BonusWindowDef,
  type TimelineSegment,
  type WindowState,
} from "@/lib/windows";
import { useWindows } from "@/lib/dynamic-data";
import { CountdownTimer } from "./countdown";
import { StatusPill, WindowChip, useNow } from "./live";

/* ------------------------------------------------------------------ */
/* Status cards — one per bonus window, live countdowns                */
/* ------------------------------------------------------------------ */

export function StatusGrid() {
  const now = useNow();
  const windows = useWindows();
  const states = evaluateAll(now ?? 0, windows);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {states.map((s) => (
        <StatusCard key={s.def.id} state={s} now={now} />
      ))}
    </div>
  );
}

function StatusCard({ state, now }: { state: WindowState; now: number | null }) {
  const { def } = state;
  const accent = `var(${def.colorVar})`;

  // What the countdown is counting toward, and the absolute SGT moment it flips.
  const flipMs = state.transitionMs;
  const flipIsEventEnd = flipMs != null && def.eventEndMs != null && flipMs === def.eventEndMs;
  const flipAtText =
    flipMs == null
      ? "—"
      : flipIsEventEnd
        ? def.eventEndText ?? formatSgtNow(flipMs)
        : formatSgtNow(flipMs);

  return (
    <article className="card-surface relative flex flex-col gap-4 overflow-hidden rounded-xl p-5">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: state.active ? accent : "transparent", transition: "background .4s" }}
      />
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--rc-text-dim)]">{def.vendor}</p>
          <h3 className="font-display text-lg font-semibold leading-snug">{def.name}</h3>
        </div>
        <StatusPill on={state.active} label={state.active ? "active now" : "inactive"} />
      </header>

      <p className="text-sm text-[var(--rc-text-dim)]">{def.description}</p>

      <dl className="grid gap-2 text-[13px]">
        <div className="grid grid-cols-[92px_1fr] gap-2">
          <dt className="font-mono text-[10px] uppercase tracking-[0.08em] leading-5 text-[var(--rc-tone3)]">status</dt>
          <dd className="leading-5">
            {now == null ? (
              <span className="text-[var(--rc-text-dim)]">syncing…</span>
            ) : state.ended ? (
              <span className="font-semibold text-[var(--rc-gone)]">event ended</span>
            ) : state.active ? (
              <span className="font-semibold" style={{ color: accent }}>
                active now
              </span>
            ) : (
              <span className="font-semibold text-[var(--rc-text)]">{state.notStarted ? "not started" : "inactive"}</span>
            )}
          </dd>
        </div>
        <div className="grid grid-cols-[92px_1fr] gap-2">
          <dt className="font-mono text-[10px] uppercase tracking-[0.08em] leading-5 text-[var(--rc-tone3)]">schedule</dt>
          <dd className="font-mono text-xs leading-5 text-[var(--rc-text)]">{def.scheduleText}</dd>
        </div>
        <div className="grid grid-cols-[92px_1fr] gap-2">
          <dt className="font-mono text-[10px] uppercase tracking-[0.08em] leading-5 text-[var(--rc-tone3)]">
            {def.kind === "event" ? "event ends" : "window tz"}
          </dt>
          <dd className="font-mono text-xs leading-5 text-[var(--rc-text)]">
            {def.kind === "event" ? def.eventEndText ?? "—" : SGT_TZ_LABEL}
          </dd>
        </div>
      </dl>

      {!state.ended && now != null && (
        <div className="flex items-end justify-between gap-3 border-t border-[var(--rc-border)] pt-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-tone3)]">
              time left until {state.active ? "close" : state.notStarted ? "start" : "open"}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--rc-text-dim)] tnum">{flipAtText}</p>
          </div>
          <CountdownTimer msLeft={flipMs != null ? flipMs - now : null} size="sm" accent={state.active} />
        </div>
      )}

      {state.active && state.progress != null && (
        <div
          role="progressbar"
          aria-label={`${def.name} progress`}
          aria-valuenow={Math.round(state.progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--rc-border)_55%,transparent)]"
        >
          <div
            className="h-full rounded-full transition-[width] duration-1000 ease-linear"
            style={{ width: `${Math.round(state.progress * 100)}%`, background: accent }}
          />
        </div>
      )}

      <ul className="grid gap-1.5 border-t border-[var(--rc-border)] pt-3 text-[13px]">
        {def.rates.map((r) => (
          <li key={r.label} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-semibold text-[var(--rc-bright)]">{r.label}</span>
            <span className="text-[var(--rc-text-dim)]">{r.detail}</span>
          </li>
        ))}
      </ul>

      <a
        href={def.docsUrl}
        target="_blank"
        rel="noopener"
        className="mt-auto inline-flex w-fit items-center gap-1 text-[13px] font-semibold text-[var(--rc-accent)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-bright)]"
      >
        official docs <span aria-hidden>↗</span>
      </a>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Live table (desktop) — compact comparison ledger. The cards above    */
/* carry the full detail; this table answers "what's on and when" in    */
/* one glance, so every column is fixed-purpose and nothing squeezes.   */
/* ------------------------------------------------------------------ */

export function LiveTable() {
  const now = useNow();
  const windows = useWindows();
  const states = evaluateAll(now ?? 0, windows);

  const cellBase = "border-b border-[var(--rc-border)] px-3 py-3 align-middle";

  return (
    <div className="table-scroll hidden overflow-x-auto md:block">
      <table className="w-full min-w-[840px] border-collapse text-sm">
        <caption className="sr-only">
          Bonus windows: schedule, live status and countdown to the next change. All schedules evaluated in
          Asia/Singapore time.
        </caption>
        <thead>
          <tr>
            <th className="w-[36%] min-w-[290px] border-b border-[var(--rc-border)] px-3 pb-2.5 pt-2 text-left font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--rc-tone2)]">
              window
            </th>
            <th
              title="Evaluated against Asia/Singapore time (SGT)"
              className="min-w-[210px] border-b border-[var(--rc-border)] px-3 pb-2.5 pt-2 text-left font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--rc-tone2)]"
            >
              schedule
            </th>
            <th className="w-[108px] border-b border-[var(--rc-border)] px-3 pb-2.5 pt-2 text-center font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--rc-tone2)]">
              status
            </th>
            <th className="w-[128px] border-b border-[var(--rc-border)] px-3 pb-2.5 pt-2 text-right font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--rc-tone2)]">
              changes in
            </th>
            <th className="w-[48px] border-b border-[var(--rc-border)] px-3 pb-2.5 pt-2 text-right font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--rc-tone2)]">
              <span className="sr-only">official docs</span>
              <span aria-hidden>docs</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {states.map((s) => (
            <tr
              key={s.def.id}
              className={`group transition-colors hover:bg-[color-mix(in_srgb,var(--rc-bright)_5%,transparent)] ${
                s.active ? "bg-[color-mix(in_srgb,var(--rc-accent)_7%,transparent)]" : ""
              }`}
              style={s.active ? { boxShadow: "inset 3px 0 0 0 var(--rc-accent)" } : undefined}
            >
              {/* Window identity + purpose, stacked — the description gets a
                  real home instead of collapsing into a skinny column. */}
              <td className={cellBase}>
                <WindowChip colorVar={s.def.colorVar}>{metricsWindowId(s.def.id)}</WindowChip>
                <p
                  className="mt-1 max-w-[380px] text-[12.5px] leading-snug text-[var(--rc-text-dim)] line-clamp-2"
                  title={s.def.description}
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-tone3)]">
                    {s.def.vendor}
                  </span>
                  <span aria-hidden className="mx-1.5 text-[var(--rc-border)]">
                    ·
                  </span>
                  {s.def.description}
                </p>
              </td>

              {/* Schedule wraps to two lines max; bounded events get their
                  end date as a quiet sub-line instead of a 9th column. */}
              <td className={`${cellBase} font-mono text-xs leading-5`}>
                {s.def.scheduleText}
                {s.def.eventEndText && (
                  <span className="mt-0.5 block text-[10.5px] text-[var(--rc-tone3)]">
                    ends {s.def.eventEndText}
                  </span>
                )}
              </td>

              <td className={`${cellBase} text-center`}>
                <StatusPill on={s.active} label={s.active ? "active" : "inactive"} />
              </td>

              {/* Countdown + the SGT moment it flips to, so the number has
                  context without consulting another column. */}
              <td className={`${cellBase} text-right`}>
                {now == null ? (
                  <span className="font-mono text-xs tnum">—</span>
                ) : s.ended ? (
                  <span className="font-mono text-xs text-[var(--rc-gone)]">over</span>
                ) : (
                  <>
                    <span className="font-mono text-xs tnum">
                      {formatCountdown((s.transitionMs ?? now) - now)}
                    </span>
                    {s.transitionMs != null && (
                      <span className="mt-0.5 block font-mono text-[10px] text-[var(--rc-text-dim)] tnum">
                        at {formatSgtNow(s.transitionMs)}
                      </span>
                    )}
                  </>
                )}
              </td>

              <td className={`${cellBase} text-right`}>
                <a
                  href={s.def.docsUrl}
                  target="_blank"
                  rel="noopener"
                  aria-label={`Official docs for ${s.def.name}`}
                  title="Official docs"
                  className="inline-flex text-[var(--rc-accent)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-bright)]"
                >
                  ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 24h timeline bars (SGT + viewer local time)                          */
/* ------------------------------------------------------------------ */

export function TimelineSection() {
  const now = useNow();
  const windows = useWindows();

  return (
    <div className="card-surface grid gap-5 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">Next 24 hours, visualised</h3>
        <div className="flex flex-wrap items-center gap-4">
          {windows.map((def) => (
            <WindowChip key={def.id} colorVar={def.colorVar}>
              {metricsWindowId(def.id)}
            </WindowChip>
          ))}
        </div>
      </div>
      <TimeBar now={now} midnightOf={sgtMidnight} label={SGT_TZ_LABEL} windows={windows} />
      <TimeBar now={now} midnightOf={localMidnight} label={`your local time · ${localUtcOffsetLabel()}`} windows={windows} />
      <p className="text-[13px] text-[var(--rc-text-dim)]">
        Bars start at midnight in each timezone. The peak surcharge only runs Mon–Fri; the flash campaign paints the
        whole night. Wherever you are, the night bar is when the stack is deepest.
      </p>
    </div>
  );
}

function TimeBar({
  now,
  midnightOf,
  label,
  windows,
}: {
  now: number | null;
  midnightOf: (ms: number) => number;
  label: string;
  windows: BonusWindowDef[];
}) {
  const DAY = 24 * 3600 * 1000;
  const ready = now != null;
  const barStart = midnightOf(now ?? Date.now());
  // Segments only change when the calendar day or the synced data rolls over — cache them.
  const segs: Record<string, TimelineSegment[]> = useMemo(
    () => (ready ? segmentsForRange(barStart, 24, windows) : {}),
    [ready, barStart, windows],
  );
  const pct = (ms: number) => `${(((ms - barStart) / DAY) * 100).toFixed(2)}%`;
  const nowPct = now == null ? null : Math.min(100, Math.max(0, ((now - barStart) / DAY) * 100));

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between font-mono text-[11px] text-[var(--rc-text-dim)]">
        <span>{label}</span>
        <span className="tnum">
          {now == null ? "syncing…" : `${formatLocalClock(now)} local · ${formatSgtNow(now)}`}
        </span>
      </div>
      <div className="relative h-8 overflow-hidden rounded-lg border border-[var(--rc-border)] bg-[color-mix(in_srgb,var(--rc-surface)_60%,var(--rc-bg))]">
        {[6, 12, 18].map((h) => (
          <div
            key={h}
            aria-hidden
            className="absolute inset-y-0 w-px bg-[color-mix(in_srgb,var(--rc-border)_60%,transparent)]"
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}
        {Object.values(segs)
          .flat()
          .map((seg, i) => (
            <div
              key={`${seg.def.id}-${i}`}
              className="absolute inset-y-0 opacity-55"
              style={{
                left: pct(Math.max(seg.startMs, barStart)),
                width: pct(Math.min(seg.endMs, barStart + DAY)),
                background: `var(${seg.def.colorVar})`,
              }}
              title={`${seg.def.name}: ${new Date(seg.startMs).toLocaleTimeString()} → ${new Date(seg.endMs).toLocaleTimeString()}`}
            />
          ))}
        {nowPct != null && (
          <div
            aria-hidden
            className="absolute inset-y-0 z-10 w-[2px] bg-[var(--rc-bright)]"
            style={{ left: `${nowPct}%` }}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--rc-text-dim)] tnum">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Golden window insight strip                                         */
/* ------------------------------------------------------------------ */

export function GoldenStrip() {
  const now = useNow();
  const windows = useWindows();
  if (now == null) return <div className="card-surface h-[128px] animate-pulse rounded-xl" />;

  const gold = goldenWindow(now, windows);
  const open = gold.status === "open";
  const ended = gold.status === "ended";

  return (
    <aside
      className="relative overflow-hidden rounded-xl border p-5"
      style={{
        borderColor: open ? "var(--rc-accent)" : "var(--rc-border)",
        background: open
          ? "color-mix(in srgb, var(--rc-accent) 10%, var(--rc-bg))"
          : "color-mix(in srgb, var(--rc-surface) 70%, var(--rc-bg))",
      }}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="min-w-[260px] flex-1">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-lg font-semibold">
              {ended ? "Golden window closed" : open ? "Golden window is open right now" : "The golden window"}
            </h3>
            <StatusPill on={open} label={open ? "golden window open" : "golden window closed"} />
          </div>
          <p className="mt-1 max-w-2xl text-sm text-[var(--rc-text-dim)]">
            {ended
              ? "The GLM-5.3-Flash Usage Campaign ended on 2026-09-21. Off-peak credit rates still apply every night and all weekend."
              : open
                ? "Until 09:00 SGT: unlimited GLM-5.3-Flash in ZCode, doubled quota in other agents, and the whole night bills at the 50% off-peak credit rate."
                : "Campaign nights run 23:00–09:00 SGT — unlimited Flash in ZCode plus off-peak credit rates stack all night long."}
          </p>
        </div>
        {!ended && (
          <div className="flex shrink-0 flex-col items-start">
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--rc-tone3)]">
              time left until {open ? "close" : "open"}
            </p>
            <CountdownTimer msLeft={gold.countdownMs} size="lg" accent={open} />
          </div>
        )}
      </div>
    </aside>
  );
}
