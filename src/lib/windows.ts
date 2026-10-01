/**
 * Bonus window definitions + live evaluation engine.
 *
 * Every schedule below is expressed in Asia/Singapore time (UTC+8, no DST),
 * exactly as published in the z.ai docs. Because the offset is fixed, all
 * math is done on epoch milliseconds + a constant offset — no Intl calls in
 * hot loops (safe to run every second on the client and on every scrape of
 * /api/metrics).
 */

export const SGT_OFFSET_MIN = 480; // UTC+8
export const SGT_TZ = "Asia/Singapore";
export const SGT_TZ_LABEL = "SGT (UTC+8)";

export type WindowId = "peak" | "flash-campaign" | "flash-api-50";

/** Stable id used in the Prometheus endpoint (kept compatible with the original tracker). */
export const METRICS_WINDOW_ID: Record<WindowId, string> = {
  peak: "peak",
  "flash-campaign": "flash",
  "flash-api-50": "flash-api",
};

/** Safe metrics id for dynamically-synced windows that may not be in the static map. */
export function metricsWindowId(id: string): string {
  return (METRICS_WINDOW_ID as Record<string, string>)[id] ?? id;
}

export interface RateRow {
  label: string;
  detail: string;
}

export interface BonusWindowDef {
  id: WindowId;
  vendor: string;
  name: string;
  /** Short chip label shown in tables/cards. */
  chip: string;
  description: string;
  kind: "recurring" | "event";
  /** Human readable schedule, matching the docs wording. */
  scheduleText: string;
  docsUrl: string;
  /** Color roles (CSS custom properties) used for timeline segments. */
  colorVar: string;
  rates: RateRow[];
  /** Recurring weekly schedule (in SGT). days: 0=Sun … 6=Sat. */
  days?: number[];
  startMin?: number; // inclusive, minutes of day
  endMin?: number; // exclusive, minutes of day (may be < startMin → overnight)
  /** Bounded event range (epoch ms). */
  eventStartMs?: number;
  eventEndMs?: number;
  eventEndText?: string;
}

const hm = (h: number, m: number) => h * 60 + m;

export const BONUS_WINDOWS: BonusWindowDef[] = [
  {
    id: "peak",
    vendor: "z.ai",
    name: "Peak hours surcharge",
    chip: "peak",
    description:
      "Time-variable rates apply during peak hours. Code off-peak and the same credits last twice as long.",
    kind: "recurring",
    scheduleText: "weekly Mon,Tue,Wed,Thu,Fri 14:00–18:00 Asia/Singapore",
    docsUrl: "https://docs.z.ai/devpack/notice/usage-revision",
    colorVar: "--rc-tone2",
    days: [1, 2, 3, 4, 5],
    startMin: hm(14, 0),
    endMin: hm(18, 0),
    rates: [
      { label: "GLM-5.3", detail: "3× quota at peak · 1× off-peak (legacy plans)" },
      { label: "GLM-5.3-Flash", detail: "1.2× quota at peak · 0.4× off-peak (legacy plans)" },
      { label: "Credit plans", detail: "standard rate at peak · 50% credit rate off-peak" },
    ],
  },
  {
    id: "flash-campaign",
    vendor: "z.ai",
    name: "GLM-5.3-Flash Usage Campaign",
    chip: "flash",
    description:
      "Nightly bonus window for GLM-5.3-Flash: unlimited usage in ZCode and doubled quota in other supported agents.",
    kind: "event",
    scheduleText: "2026-09-03..2026-09-20 daily 23:00–09:00 Asia/Singapore",
    docsUrl: "https://docs.z.ai/devpack/notice/event-glm-5.3-flash",
    colorVar: "--rc-accent",
    days: [0, 1, 2, 3, 4, 5, 6],
    startMin: hm(23, 0),
    endMin: hm(9, 0), // overnight → 09:00 next day
    eventStartMs: Date.parse("2026-09-03T23:00:00+08:00"),
    eventEndMs: Date.parse("2026-09-21T09:00:00+08:00"),
    eventEndText: "2026-09-21 09:00 SGT",
    rates: [
      { label: "Via ZCode", detail: "zero quota — unlimited GLM-5.3-Flash" },
      { label: "Other agents", detail: "2× plan quota for GLM-5.3-Flash" },
      { label: "GLM-5.3", detail: "standard rules apply (not included)" },
    ],
  },
  {
    id: "flash-api-50",
    vendor: "z.ai",
    name: "Flash API −50% promo",
    chip: "flash-api",
    description:
      "Limited-time 50% discount on GLM-5.3-Flash API pricing — the list price is slashed across input, cached input and output tokens.",
    kind: "event",
    scheduleText: "until 2026-09-09 24:00 Asia/Singapore (always on)",
    docsUrl: "https://docs.z.ai/guides/overview/pricing",
    colorVar: "--rc-brand",
    eventStartMs: 0,
    eventEndMs: Date.parse("2026-09-10T00:00:00+08:00"),
    eventEndText: "2026-09-09 24:00 SGT",
    rates: [
      { label: "Input", detail: "$0.15 → $0.075 per 1M tokens" },
      { label: "Cached input", detail: "$0.03 → $0.015 per 1M tokens" },
      { label: "Output", detail: "$0.50 → $0.25 per 1M tokens" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Time helpers (fixed UTC+8 offset — no Intl in hot paths)            */
/* ------------------------------------------------------------------ */

export interface SgtParts {
  /** Epoch day index (1970-01-01 = day 0). */
  dayIndex: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** Minutes since SGT midnight. */
  minutes: number;
}

export function sgtParts(ms: number): SgtParts {
  const totalMin = Math.floor(ms / 60000) + SGT_OFFSET_MIN;
  const dayIndex = Math.floor(totalMin / 1440);
  const weekday = (((dayIndex + 4) % 7) + 7) % 7; // day 0 was a Thursday
  const minutes = (((totalMin % 1440) + 1440) % 1440);
  return { dayIndex, weekday, minutes };
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Wed 18:17 SGT" — mirrors the reference tracker's "local now" column. */
export function formatSgtNow(ms: number): string {
  const { weekday, minutes } = sgtParts(ms);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${WEEKDAY_SHORT[weekday]} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} SGT`;
}

/** Wall-clock time in an arbitrary IANA zone ("HH:MM"). */
export function formatInZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function formatLocalClock(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function localUtcOffsetLabel(): string {
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "−";
  const abs = Math.abs(offsetMin);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/* ------------------------------------------------------------------ */
/* Window evaluation                                                   */
/* ------------------------------------------------------------------ */

export interface WindowState {
  def: BonusWindowDef;
  active: boolean;
  /** Bounded event is over — window will never open again. */
  ended: boolean;
  /** Bounded event has not started yet. */
  notStarted: boolean;
  /** Epoch ms of the next open/close flip (null once an event is over). */
  transitionMs: number | null;
  /** Epoch ms when a bounded event ends (event windows only). */
  endMs: number | null;
  /** 0..1 progress through the currently open window (when active). */
  progress: number | null;
}

function instanceBounds(def: BonusWindowDef, dayIndex: number): { startMs: number; endMs: number } {
  const startMs = (dayIndex * 1440 + def.startMin! - SGT_OFFSET_MIN) * 60000;
  const durationMin = (((def.endMin! - def.startMin!) % 1440) + 1440) % 1440;
  const durationMs = (durationMin === 0 ? 1440 : durationMin) * 60000;
  return { startMs, endMs: startMs + durationMs };
}

function inRecurring(def: BonusWindowDef, ms: number): boolean {
  const { weekday, minutes } = sgtParts(ms);
  if (def.startMin! < def.endMin!) {
    return def.days!.includes(weekday) && minutes >= def.startMin! && minutes < def.endMin!;
  }
  // Overnight window (e.g. 23:00 → 09:00): attribute to the starting day.
  if (minutes >= def.startMin! && def.days!.includes(weekday)) return true;
  if (minutes < def.endMin! && def.days!.includes((weekday + 6) % 7)) return true;
  return false;
}

/** Running instance bounds when `ms` falls inside the recurring window. */
function runningInstance(def: BonusWindowDef, ms: number): { startMs: number; endMs: number } | null {
  if (!inRecurring(def, ms)) return null;
  const { minutes } = sgtParts(ms);
  const today = sgtParts(ms).dayIndex;
  const dayIndex = minutes >= def.startMin! ? today : today - 1;
  return instanceBounds(def, dayIndex);
}

function nextInstanceStart(def: BonusWindowDef, ms: number): number | null {
  const today = sgtParts(ms).dayIndex;
  for (let off = 0; off <= 8; off++) {
    const dayIndex = today + off;
    const weekday = (((dayIndex + 4) % 7) + 7) % 7;
    if (!def.days!.includes(weekday)) continue;
    const { startMs } = instanceBounds(def, dayIndex);
    if (startMs > ms) return startMs;
  }
  return null;
}

function evaluateWindow(def: BonusWindowDef, ms: number): WindowState {
  const state: WindowState = {
    def,
    active: false,
    ended: false,
    notStarted: false,
    transitionMs: null,
    endMs: def.eventEndMs ?? null,
    progress: null,
  };

  // Pure bounded event (no recurring schedule).
  if (def.days == null) {
    if (def.eventStartMs != null && ms < def.eventStartMs) {
      state.notStarted = true;
      state.transitionMs = def.eventStartMs;
      return state;
    }
    if (def.eventEndMs != null && ms >= def.eventEndMs) {
      state.ended = true;
      return state;
    }
    state.active = true;
    state.transitionMs = def.eventEndMs ?? null;
    if (def.eventStartMs != null && def.eventEndMs != null && def.eventEndMs > def.eventStartMs) {
      state.progress = Math.min(1, Math.max(0, (ms - def.eventStartMs) / (def.eventEndMs - def.eventStartMs)));
    }
    return state;
  }

  // Recurring window, optionally capped by a bounded event range.
  if (def.eventEndMs != null && ms >= def.eventEndMs) {
    state.ended = true;
    return state;
  }
  if (def.eventStartMs != null && ms < def.eventStartMs) {
    state.notStarted = true;
    state.transitionMs = def.eventStartMs;
    return state;
  }

  const running = runningInstance(def, ms);
  if (running) {
    state.active = true;
    state.transitionMs = def.eventEndMs != null ? Math.min(running.endMs, def.eventEndMs) : running.endMs;
    state.progress = Math.min(1, Math.max(0, (ms - running.startMs) / (running.endMs - running.startMs)));
    return state;
  }

  const nextStart = nextInstanceStart(def, ms);
  if (nextStart == null) {
    state.ended = true;
    return state;
  }
  if (def.eventEndMs != null && nextStart >= def.eventEndMs) {
    state.ended = true;
    return state;
  }
  state.transitionMs = nextStart;
  return state;
}

export function evaluateAll(ms: number, defs: BonusWindowDef[] = BONUS_WINDOWS): WindowState[] {
  return defs.map((def) => evaluateWindow(def, ms));
}

/* ------------------------------------------------------------------ */
/* Timeline segmentation (for the 24h visualisation)                   */
/* ------------------------------------------------------------------ */

export interface TimelineSegment {
  def: BonusWindowDef;
  startMs: number;
  endMs: number;
}

/**
 * Sample the next `hours` horizon and merge consecutive active stretches.
 * `barStart` is the left edge of the bar (usually midnight in the displayed tz).
 */
export function segmentsForRange(
  barStart: number,
  hours = 24,
  defs: BonusWindowDef[] = BONUS_WINDOWS,
): Record<string, TimelineSegment[]> {
  const step = 10 * 60 * 1000;
  const end = barStart + hours * 3600 * 1000;
  const result: Record<string, TimelineSegment[]> = {};
  for (const def of defs) result[def.id] = [];

  for (const def of defs) {
    const runs = result[def.id];
    let openStart: number | null = null;
    for (let t = barStart; t <= end; t += step) {
      const active = evaluateWindow(def, Math.min(t, end - 1)).active;
      if (active && openStart == null) openStart = t;
      if (!active && openStart != null) {
        runs.push({ def, startMs: openStart, endMs: t });
        openStart = null;
      }
    }
    if (openStart != null) runs.push({ def, startMs: openStart, endMs: end });
  }
  return result;
}

/** Local (browser) midnight for the day containing `ms`. */
export function localMidnight(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** SGT midnight for the SGT-day containing `ms`. */
export function sgtMidnight(ms: number): number {
  return sgtParts(ms).dayIndex * 1440 * 60000 - SGT_OFFSET_MIN * 60000;
}

/* ------------------------------------------------------------------ */
/* Golden-window insight                                               */
/* ------------------------------------------------------------------ */

export interface GoldenWindow {
  status: "open" | "upcoming" | "ended";
  /** Live countdown until the open window closes (open) or it opens (upcoming). */
  countdownMs: number | null;
}

/**
 * The stack window: campaign nights are entirely off-peak, so ZCode users get
 * unlimited Flash *and* the 50% credit rate while it lasts.
 */
/** Match the Flash-campaign def robustly — synced ids may drift across runs. */
export function isGoldenWindowDef(def: BonusWindowDef): boolean {
  return (
    def.id === "flash-campaign" ||
    (/flash/i.test(def.id) && /campaign/i.test(def.id) && def.id !== "flash-api-50")
  );
}

export function goldenWindow(ms: number, defs: BonusWindowDef[] = BONUS_WINDOWS): GoldenWindow {
  // Match the campaign def robustly: exact canonical id first, then a
  // flash+campaign pattern on id/name — synced ids may drift across runs.
  const flashDef =
    defs.find((d) => isGoldenWindowDef(d)) ??
    defs.find((d) => /flash/i.test(d.name) && /campaign/i.test(d.name)) ??
    defs[1] ??
    defs[0];
  if (!flashDef) return { status: "ended", countdownMs: null };
  const flash = evaluateWindow(flashDef, ms);
  if (flash.ended) return { status: "ended", countdownMs: null };
  if (flash.active) return { status: "open", countdownMs: flash.transitionMs != null ? flash.transitionMs - ms : null };
  return { status: "upcoming", countdownMs: flash.transitionMs != null ? flash.transitionMs - ms : null };
}
