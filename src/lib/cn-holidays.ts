/**
 * China public-holiday calendar + ops-impact logic for the GLM Bonus Radar.
 *
 * z.ai (Zhipu AI) is a Beijing-based company, so during China's public
 * holidays their non-critical operations (support response times, pricing /
 * plan updates, new releases, docs refreshes) typically slow down, while
 * core API infrastructure stays on-call. This module powers the "China ops
 * calendar" block and the Prometheus gauges in /api/metrics.
 *
 * Date sources:
 *  - 2026: official State Council notice 国务院办公厅《关于2026年部分节假日安排的通知》
 *    (verified 2026-10-01 against multiple published summaries: Mid-Autumn
 *    Sep 25–27; National Day Golden Week Oct 1–7 with make-up workdays
 *    Sep 20 + Oct 10; Labour Day May 1–5 with make-up May 9; Spring Festival
 *    Feb 15–23 with make-ups Feb 14 + Feb 28; Qingming Apr 4–6).
 *  - 2027: expected patterns (provisional:true) until the official notice,
 *    which the State Council usually publishes in November of the prior year.
 *
 * All dates are calendar dates in China Standard Time (UTC+8, no DST) — the
 * same fixed offset the portal already uses for Asia/Singapore.
 */

export type CnHoliday = {
  id: string;
  /** English display name */
  name: string;
  /** Chinese display name */
  nameCn: string;
  /** First holiday day, ISO "YYYY-MM-DD" (CST) */
  start: string;
  /** Last holiday day, ISO "YYYY-MM-DD" (CST), inclusive */
  end: string;
  /** ISO dates that ARE working days despite being weekends (调休补班) */
  makeup?: string[];
  /** true = expected pattern, official notice not yet published */
  provisional?: boolean;
  /** one-line ops expectation for this specific holiday */
  note?: string;
};

export const CN_HOLIDAYS: CnHoliday[] = [
  {
    id: "new-year-2026",
    name: "New Year's Day",
    nameCn: "元旦",
    start: "2026-01-01",
    end: "2026-01-03",
    note: "Three-day long weekend; support usually reduced on Jan 1 only.",
  },
  {
    id: "spring-festival-2026",
    name: "Spring Festival",
    nameCn: "春节",
    start: "2026-02-15",
    end: "2026-02-23",
    makeup: ["2026-02-14", "2026-02-28"],
    note: "The longest shutdown of the year — most teams away, expect multi-day support delays and a release freeze.",
  },
  {
    id: "qingming-2026",
    name: "Qingming Festival",
    nameCn: "清明节",
    start: "2026-04-04",
    end: "2026-04-06",
  },
  {
    id: "labour-day-2026",
    name: "Labour Day",
    nameCn: "劳动节",
    start: "2026-05-01",
    end: "2026-05-05",
    makeup: ["2026-05-09"],
    note: "Five-day travel peak; skeleton crews on support, releases paused.",
  },
  {
    id: "dragon-boat-2026",
    name: "Dragon Boat Festival",
    nameCn: "端午节",
    start: "2026-06-19",
    end: "2026-06-21",
  },
  {
    id: "mid-autumn-2026",
    name: "Mid-Autumn Festival",
    nameCn: "中秋节",
    start: "2026-09-25",
    end: "2026-09-27",
  },
  {
    id: "national-day-2026",
    name: "National Day Golden Week",
    nameCn: "国庆节",
    start: "2026-10-01",
    end: "2026-10-07",
    makeup: ["2026-09-20", "2026-10-10"],
    note: "The other full-week shutdown: support and non-critical releases wind down; API infra stays on-call.",
  },
  {
    id: "new-year-2027",
    name: "New Year's Day",
    nameCn: "元旦",
    start: "2027-01-01",
    end: "2027-01-03",
    provisional: true,
  },
  {
    id: "spring-festival-2027",
    name: "Spring Festival",
    nameCn: "春节",
    start: "2027-02-04",
    end: "2027-02-12",
    provisional: true,
    note: "Chinese New Year falls on Feb 6, 2027 — expect the year's longest shutdown around it.",
  },
  {
    id: "qingming-2027",
    name: "Qingming Festival",
    nameCn: "清明节",
    start: "2027-04-03",
    end: "2027-04-05",
    provisional: true,
  },
  {
    id: "labour-day-2027",
    name: "Labour Day",
    nameCn: "劳动节",
    start: "2027-05-01",
    end: "2027-05-05",
    provisional: true,
  },
  {
    id: "national-day-2027",
    name: "National Day Golden Week",
    nameCn: "国庆节",
    start: "2027-10-01",
    end: "2027-10-07",
    provisional: true,
  },
];

/** Fixed CST offset — China has no DST. */
const CN_OFFSET_MIN = 480;

/** Epoch ms of local midnight (00:00 CST) for an ISO "YYYY-MM-DD" date. */
export function cnMidnightMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - CN_OFFSET_MIN * 60_000;
}

/** Epoch ms of local midnight on the day AFTER the holiday ends = normal ops resume. */
export function holidayResumeMs(h: CnHoliday): number {
  return cnMidnightMs(h.end) + 86_400_000;
}

export function holidayStartMs(h: CnHoliday): number {
  return cnMidnightMs(h.start);
}

export function isMakeupWorkday(h: CnHoliday, ms: number): boolean {
  if (!h.makeup) return false;
  const day = Math.floor((ms + CN_OFFSET_MIN * 60_000) / 86_400_000);
  return h.makeup.some((iso) => Math.floor((cnMidnightMs(iso) + CN_OFFSET_MIN * 60_000) / 86_400_000) === day);
}

/** "Oct 1" / "Feb 15" style short label (CST). */
export function cnShortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${CN_MONTHS[m - 1]} ${d}`;
}

/** ISO date string (CST calendar day) for an epoch ms. */
export function cnIsoDate(ms: number): string {
  return new Date(ms + CN_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

const CN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Inclusive range label: "Oct 1 → Oct 7" (adds the year when it differs from the start year). */
export function cnRangeLabel(h: CnHoliday): string {
  const [sy] = h.start.split("-").map(Number);
  const [ey] = h.end.split("-").map(Number);
  const endLabel = ey !== sy ? `${cnShortDate(h.end)} ${ey}` : cnShortDate(h.end);
  return `${cnShortDate(h.start)} → ${endLabel}`;
}

export type ChinaOpsState = {
  /** holiday in progress right now (null when operations are normal) */
  active: CnHoliday | null;
  /** next upcoming holiday (null when none left in the dataset) */
  next: CnHoliday | null;
  /** next 4 upcoming holidays, soonest first (excludes any active one) */
  upcoming: CnHoliday[];
  /** epoch ms when the active holiday ends and normal ops resume */
  resumeMs: number | null;
};

export function getChinaOps(nowMs: number): ChinaOpsState {
  const sorted = [...CN_HOLIDAYS].sort((a, b) => holidayStartMs(a) - holidayStartMs(b));
  let active: CnHoliday | null = null;
  const upcoming: CnHoliday[] = [];
  for (const h of sorted) {
    const s = holidayStartMs(h);
    const e = holidayResumeMs(h);
    if (nowMs >= s && nowMs < e) {
      active = h;
    } else if (nowMs < s) {
      upcoming.push(h);
    }
  }
  return {
    active,
    next: upcoming[0] ?? null,
    upcoming: upcoming.slice(0, 4),
    resumeMs: active ? holidayResumeMs(active) : null,
  };
}

/** Compact countdown: "6d 14h 22m" / "14h 22m 05s". */
export function compactCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m ${String(s).padStart(2, "0")}s`;
}
