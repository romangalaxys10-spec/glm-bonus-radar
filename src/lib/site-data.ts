/**
 * Dynamic site data contract shared by the AI doc-sync job (server) and the
 * portal components (client). The sync job asks the LLM to extract a strict
 * JSON payload from the official z.ai docs; this module validates and
 * normalizes that payload into shapes the UI can render directly.
 */
import type { BonusWindowDef } from "@/lib/windows";

/* ---------------------------- payload types ---------------------------- */

export interface DynamicPricingRow {
  name: string;
  tagline?: string;
  input: string;
  cached: string;
  output: string;
  promo?: boolean;
  featured?: boolean;
  listInput?: string;
  listCached?: string;
  listOutput?: string;
}

export interface DynamicPricing {
  featured: DynamicPricingRow[];
  other: Array<{ name: string; combo: string; output: string }>;
  apiPromoEndMs?: number | null;
  apiPromoEndText?: string | null;
}

export interface DynamicPlan {
  name: string;
  price?: string;
  per?: string;
  credits5h: string;
  creditsWeek: string;
  blurb?: string;
  highlights?: string[];
  featured?: boolean;
}

export interface AnnouncementItem {
  text: string;
  /** Exact official docs page URL this announcement was extracted from. */
  source?: string;
}

export interface SiteDataPayload {
  windows: BonusWindowDef[];
  pricing?: DynamicPricing;
  plans?: DynamicPlan[];
  announcements?: AnnouncementItem[];
}

export interface ChangeLogEntry {
  at: string; // ISO
  summary: string;
  sections: string[];
  trigger: string;
}

export interface SiteDataRecord {
  payload: SiteDataPayload | null;
  changeLog: ChangeLogEntry[];
  updatedAt: string | null;
}

/* --------------------------- LLM raw schema ---------------------------- */
/* What the model is asked to return (snake_case kept out on purpose — the  */
/* prompt mirrors these exact camelCase keys to reduce mapping errors).     */

interface RawWindow {
  id?: unknown;
  vendor?: unknown;
  name?: unknown;
  chip?: unknown;
  description?: unknown;
  kind?: unknown;
  scheduleText?: unknown;
  docsUrl?: unknown;
  colorVar?: unknown;
  rates?: unknown;
  days?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  eventStart?: unknown;
  eventEnd?: unknown;
  eventEndText?: unknown;
}

export interface RawSiteData {
  windows?: RawWindow[];
  pricing?: {
    featured?: unknown;
    other?: unknown;
    apiPromoEnd?: unknown;
    apiPromoEndText?: unknown;
  };
  plans?: unknown;
  announcements?: unknown;
}

/* ------------------------------ helpers -------------------------------- */

const ALLOWED_COLOR_VARS = new Set([
  "--rc-accent",
  "--rc-brand",
  "--rc-tone2",
  "--rc-tone3",
  "--rc-bright",
  "--rc-gone",
]);

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v.trim() : fallback);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const HM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
function toMinutes(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = HM_RE.exec(v.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function toEpochMs(v: unknown): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const ms = Date.parse(v.trim());
  return Number.isFinite(ms) ? ms : null;
}

/** Accepts UTC+8 epochs of the form "2026-09-09T24:00+08:00" — Date.parse treats 24:00 as next day 00:00 in most engines; normalize explicitly. */
function parseSgtEnd(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  const m = /^(.*T)24:00(:00)?(\+08:00)$/.exec(t);
  if (m) {
    const base = Date.parse(`${m[1]}00:00${m[3]}`);
    return Number.isFinite(base) ? base : null;
  }
  return toEpochMs(t);
}

/* ---------------------------- normalization ---------------------------- */

export class SiteDataError extends Error {}

function normalizeWindow(raw: RawWindow, index: number): BonusWindowDef | null {
  const id = str(raw.id).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  const name = str(raw.name);
  if (!id || !name) return null;

  const kind = raw.kind === "recurring" ? "recurring" : raw.kind === "event" ? "event" : null;
  if (!kind) return null;

  const days = Array.isArray(raw.days)
    ? [...new Set(raw.days.map((d) => num(d)).filter((d): d is number => d != null && d >= 0 && d <= 6))].sort()
    : undefined;
  const startMin = toMinutes(raw.startTime);
  const endMin = toMinutes(raw.endTime);
  const hasRecurrence = days != null && days.length > 0 && startMin != null && endMin != null;
  if (kind === "recurring" && !hasRecurrence) return null;

  const eventStartMs = parseSgtEnd(raw.eventStart);
  const eventEndMs = parseSgtEnd(raw.eventEnd);
  if (kind === "event" && !hasRecurrence && eventStartMs == null && eventEndMs == null) return null;

  const colorVar = ALLOWED_COLOR_VARS.has(str(raw.colorVar)) ? str(raw.colorVar) : "--rc-accent";

  const rates = Array.isArray(raw.rates)
    ? raw.rates
        .map((r) => ({ label: str((r as { label?: unknown })?.label), detail: str((r as { detail?: unknown })?.detail) }))
        .filter((r) => r.label && r.detail)
        .slice(0, 6)
    : [];

  return {
    id: (id || `window-${index}`) as BonusWindowDef["id"],
    vendor: str(raw.vendor, "z.ai") || "z.ai",
    name,
    chip: str(raw.chip, id.slice(0, 12)) || id.slice(0, 12),
    description: str(raw.description, name),
    kind,
    scheduleText: str(raw.scheduleText, "see official docs"),
    docsUrl: /^https?:\/\//.test(str(raw.docsUrl)) ? str(raw.docsUrl) : "https://docs.z.ai",
    colorVar,
    rates: rates.length > 0 ? rates : [{ label: name, detail: "see official docs" }],
    days: hasRecurrence ? days : undefined,
    startMin: hasRecurrence ? startMin! : undefined,
    endMin: hasRecurrence ? endMin! : undefined,
    eventStartMs: eventStartMs ?? undefined,
    eventEndMs: eventEndMs ?? undefined,
    eventEndText: str(raw.eventEndText) || undefined,
  };
}

function normalizePricing(raw: RawSiteData["pricing"]): DynamicPricing | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const featured = Array.isArray(raw.featured)
    ? raw.featured
        .map((r) => {
          const row = r as Record<string, unknown>;
          const name = str(row.name);
          if (!name) return null;
          const out: DynamicPricingRow = {
            name,
            tagline: str(row.tagline) || undefined,
            input: str(row.input, "—"),
            cached: str(row.cached, "—"),
            output: str(row.output, "—"),
            promo: row.promo === true,
            featured: row.featured === true,
          };
          if (typeof row.listInput === "string") out.listInput = row.listInput;
          if (typeof row.listCached === "string") out.listCached = row.listCached;
          if (typeof row.listOutput === "string") out.listOutput = row.listOutput;
          return out;
        })
        .filter((r): r is DynamicPricingRow => r != null)
        .slice(0, 4)
    : [];
  const other = Array.isArray(raw.other)
    ? raw.other
        .map((r) => {
          const row = r as Record<string, unknown>;
          const name = str(row.name);
          if (!name) return null;
          return { name, combo: str(row.combo, "—"), output: str(row.output, "—") };
        })
        .filter((r): r is { name: string; combo: string; output: string } => r != null)
        .slice(0, 14)
    : [];
  const apiPromoEndMs = raw.apiPromoEnd == null ? null : parseSgtEnd(raw.apiPromoEnd);
  const out: DynamicPricing = {
    featured,
    other,
    apiPromoEndMs,
    apiPromoEndText: str(raw.apiPromoEndText) || null,
  };
  // Only meaningful if at least one row survived.
  if (featured.length === 0 && other.length === 0) return undefined;
  return out;
}

function normalizePlans(raw: unknown): DynamicPlan[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const plans = raw
    .map((r): DynamicPlan | null => {
      const row = r as Record<string, unknown>;
      const name = str(row.name);
      if (!name) return null;
      return {
        name,
        price: str(row.price) || undefined,
        per: str(row.per) || undefined,
        credits5h: str(row.credits5h, "—"),
        creditsWeek: str(row.creditsWeek, "—"),
        blurb: str(row.blurb) || undefined,
        highlights: Array.isArray(row.highlights)
          ? row.highlights.map((h) => str(h)).filter(Boolean).slice(0, 5)
          : undefined,
        featured: row.featured === true,
      };
    })
    .filter((p): p is DynamicPlan => p != null)
    .slice(0, 6);
  return plans.length > 0 ? plans : undefined;
}

function normalizeAnnouncements(raw: unknown): AnnouncementItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw
    .map((a): AnnouncementItem | null => {
      // Accept both the current {text, source} shape and legacy plain strings.
      if (typeof a === "string") {
        const text = a.trim();
        return text.length > 0 && text.length <= 280 ? { text } : null;
      }
      if (!a || typeof a !== "object") return null;
      const row = a as Record<string, unknown>;
      const text = str(row.text);
      if (!text || text.length > 280) return null;
      const source = str(row.source);
      const item: AnnouncementItem = { text };
      if (/^https:\/\/docs\.z\.ai\//.test(source)) item.source = source;
      return item;
    })
    .filter((a): a is AnnouncementItem => a != null)
    .slice(0, 5);
  return list.length > 0 ? list : undefined;
}

/**
 * Validate + convert the raw LLM payload into renderable site data.
 * Throws SiteDataError when no usable windows survive (never store garbage).
 */
export function normalizeSiteData(raw: RawSiteData): SiteDataPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SiteDataError("Payload is not an object");
  }
  const windows = Array.isArray(raw.windows)
    ? (raw.windows
        .map((w, i) => normalizeWindow(w, i))
        .filter((w): w is BonusWindowDef => w != null)
        .slice(0, 8) as BonusWindowDef[])
    : [];
  if (windows.length === 0) {
    throw new SiteDataError("No valid windows in payload");
  }
  return {
    windows,
    pricing: normalizePricing(raw.pricing),
    plans: normalizePlans(raw.plans),
    announcements: normalizeAnnouncements(raw.announcements),
  };
}

/* -------------------------------- diff --------------------------------- */

/** Stable stringify so key order never produces phantom diffs. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, sortValue(v)]),
    );
  }
  return value;
}

/** Names of the top-level sections that differ between two payloads. */
export function diffSections(
  current: SiteDataPayload | null,
  next: SiteDataPayload,
): string[] {
  if (!current) return ["windows", "pricing", "plans", "announcements"];
  const changed: string[] = [];
  if (stableStringify(current.windows) !== stableStringify(next.windows)) changed.push("windows");
  if (stableStringify(current.pricing ?? null) !== stableStringify(next.pricing ?? null))
    changed.push("pricing");
  if (stableStringify(current.plans ?? null) !== stableStringify(next.plans ?? null)) changed.push("plans");
  if (stableStringify(current.announcements ?? null) !== stableStringify(next.announcements ?? null))
    changed.push("announcements");
  return changed;
}
