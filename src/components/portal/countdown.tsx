"use client";

/**
 * Segmented countdown timer — a real "time left until" display, not prose.
 *
 * Presentational only: parents compute `msLeft` from the shared useNow() clock
 * store, so one 1s subscription drives every timer on the page. Digits use
 * tabular numerals (tnum) inside min-width boxes so the layout never jitters
 * as seconds tick. role="timer" keeps screen readers calm (implicit live=off).
 */

export type CountdownSize = "sm" | "lg";

const DIGIT_CLS: Record<CountdownSize, string> = {
  sm: "text-[15px] leading-5",
  lg: "text-[26px] leading-8",
};
const BOX_CLS: Record<CountdownSize, string> = {
  sm: "min-w-[36px] rounded-md px-1.5 pb-1 pt-0.5",
  lg: "min-w-[56px] rounded-lg px-2 pb-1.5 pt-1",
};
const COLON_CLS: Record<CountdownSize, string> = {
  sm: "px-0.5 text-[15px] leading-5",
  lg: "px-1 text-[26px] leading-8",
};

function Segment({
  value,
  label,
  size,
  accent,
}: {
  value: string;
  label: string;
  size: CountdownSize;
  accent: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center border bg-[color-mix(in_srgb,var(--rc-surface)_62%,var(--rc-bg))] ${BOX_CLS[size]}`}
      style={{
        borderColor: accent
          ? "color-mix(in srgb, var(--rc-accent) 45%, var(--rc-border))"
          : "var(--rc-border)",
      }}
    >
      <span
        className={`font-mono font-bold tnum ${DIGIT_CLS[size]}`}
        style={{ color: accent ? "var(--rc-accent)" : "var(--rc-bright)" }}
      >
        {value}
      </span>
      <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[var(--rc-tone3)]">
        {label}
      </span>
    </div>
  );
}

export function CountdownTimer({
  msLeft,
  size = "sm",
  accent = false,
  className = "",
}: {
  /** Milliseconds remaining; null = clock not hydrated yet (placeholder). */
  msLeft: number | null;
  size?: CountdownSize;
  /** Accent styling — use while the window is open. */
  accent?: boolean;
  className?: string;
}) {
  const totalSec = msLeft == null ? null : Math.floor(Math.max(0, msLeft) / 1000);

  const segs: Array<{ value: string; label: string }> = [];
  if (totalSec != null) {
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    if (d > 0) segs.push({ value: pad(d), label: "days" });
    segs.push({ value: pad(h), label: "hrs" });
    segs.push({ value: pad(m), label: "min" });
    segs.push({ value: pad(s), label: "sec" });
  }

  const aria =
    totalSec == null
      ? "Time left: syncing"
      : totalSec <= 0
        ? "Time left: starting now"
        : `Time left: ${Math.floor(totalSec / 86400)}d ${Math.floor((totalSec % 86400) / 3600)}h ${Math.floor((totalSec % 3600) / 60)}m ${totalSec % 60}s`;

  return (
    <div
      role="timer"
      aria-label={aria}
      className={`inline-flex items-start ${className}`}
    >
      {totalSec == null
        ? ["hrs", "min", "sec"].map((label) => (
            <div key={label} className="flex items-start">
              {label !== "hrs" && (
                <span aria-hidden className={`font-mono font-bold text-[var(--rc-tone3)] ${COLON_CLS[size]}`}>
                  :
                </span>
              )}
              <div
                className={`flex flex-col items-center border border-[var(--rc-border)] bg-[color-mix(in_srgb,var(--rc-surface)_62%,var(--rc-bg))] ${BOX_CLS[size]}`}
              >
                <span className={`font-mono font-bold tnum text-[var(--rc-text-dim)] ${DIGIT_CLS[size]}`}>––</span>
                <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[var(--rc-tone3)]">{label}</span>
              </div>
            </div>
          ))
        : segs.map((seg, i) => (
            <div key={seg.label} className="flex items-start">
              {i > 0 && (
                <span
                  aria-hidden
                  className={`font-mono font-bold text-[var(--rc-tone3)] ${COLON_CLS[size]}`}
                >
                  :
                </span>
              )}
              <Segment value={seg.value} label={seg.label} size={size} accent={accent} />
            </div>
          ))}
    </div>
  );
}
