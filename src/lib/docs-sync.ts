/**
 * AI doc-sync — the hourly job that keeps GLM Bonus Radar honest.
 *
 * Every run:
 *  1. fetches the SAME official docs.z.ai pages the Z-Assist bot answers from
 *  2. asks the LLM to extract a strict JSON payload (windows / pricing /
 *     plans / announcements) from those docs, given the current payload
 *  3. validates + normalizes the payload (site-data.ts)
 *  4. diffs it against what is stored; only on real changes does it save a
 *     new SiteData row with a fresh updatedAt + changeLog entry
 *
 * The fetched docs are also stored as a snapshot so /api/assist answers from
 * the newest official text — the bot and the page data share one source.
 */
import { db } from "@/lib/db";
import { getZai } from "@/lib/zai";
import { broadcast } from "@/lib/telegram";
import { BONUS_WINDOWS } from "@/lib/windows";
import {
  diffSections,
  normalizeSiteData,
  SiteDataError,
  type AnnouncementItem,
  type RawSiteData,
  type SiteDataPayload,
  type ChangeLogEntry,
} from "@/lib/site-data";
import type { BonusWindowDef } from "@/lib/windows";

export const SITE_DATA_KEY = "site-data";
export const DOCS_SNAPSHOT_KEY = "docs-snapshot";

const SGT = "Asia/Singapore";

/** Same pages the Z-Assist knowledge base is built from — one source of truth. */
export const DOC_SOURCES: Array<{ url: string; label: string; max: number }> = [
  { url: "https://docs.z.ai/devpack/notice/event-glm-5.3-flash.md", label: "flash campaign notice", max: 6000 },
  { url: "https://docs.z.ai/guides/overview/pricing.md", label: "api pricing", max: 9000 },
  { url: "https://docs.z.ai/devpack/overview.md", label: "coding plan overview", max: 12000 },
  { url: "https://docs.z.ai/devpack/notice/usage-revision.md", label: "usage revision", max: 10000 },
  { url: "https://docs.z.ai/devpack/credit-campaign-rules.md", label: "invite campaign rules", max: 8000 },
  { url: "https://docs.z.ai/devpack/faq.md", label: "devpack faq", max: 9000 },
  { url: "https://docs.z.ai/devpack/quick-start.md", label: "coding plan quick start", max: 6000 },
  { url: "https://docs.z.ai/guides/overview/quick-start.md", label: "platform quick start", max: 8000 },
  { url: "https://docs.z.ai/release-notes/new-released.md", label: "release notes", max: 10000 },
];

export interface FetchedDoc {
  url: string;
  label: string;
  md: string;
  ok: boolean;
}

export async function fetchAllDocs(): Promise<{ pages: FetchedDoc[]; fetchedAt: string }> {
  const fetchedAt = new Date().toISOString();
  const pages: FetchedDoc[] = [];
  for (const src of DOC_SOURCES) {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const full = await res.text();
      pages.push({ url: src.url, label: src.label, md: full.slice(0, src.max), ok: true });
    } catch (err) {
      console.error(`[docs-sync] failed to fetch ${src.url}:`, err);
      pages.push({ url: src.url, label: src.label, md: "", ok: false });
    }
  }
  return { pages, fetchedAt };
}

export function docsToPrompt(pages: FetchedDoc[]): string {
  return pages
    .filter((p) => p.ok)
    .map((p) => `===== DOC: ${p.label} (${p.url}) =====\n${p.md}`)
    .join("\n\n");
}

/* ------------------------- LLM extraction ------------------------------ */

const SCHEMA_PROMPT = `Extract the CURRENT promotional windows, API pricing and subscription plan data from the official z.ai documentation below.

Return ONLY a JSON object (no markdown fences, no commentary) with EXACTLY this shape:

{
  "windows": [
    {
      "id": "short-slug (keep existing ids when the window already exists)",
      "vendor": "z.ai",
      "name": "human readable window name",
      "chip": "very short label (<=12 chars)",
      "description": "one or two sentences shown on a card",
      "kind": "recurring" | "event",
      "scheduleText": "human readable schedule copied from the docs wording",
      "docsUrl": "the official docs page URL this came from",
      "colorVar": one of "--rc-accent", "--rc-brand", "--rc-tone2", "--rc-tone3", "--rc-bright", "--rc-gone",
      "days": [0..6 where 0=Sunday] or null,
      "startTime": "HH:MM" or null,
      "endTime": "HH:MM" or null,
      "eventStart": "ISO 8601 with +08:00 offset" or null,
      "eventEnd": "ISO 8601 with +08:00 offset" or null,
      "eventEndText": "e.g. 2026-09-21 09:00 SGT" or null,
      "rates": [{ "label": "...", "detail": "..." }]
    }
  ],
  "pricing": {
    "featured": [
      { "name": "model name", "tagline": "short", "input": "$x.xx", "cached": "$x.xx", "output": "$x.xx",
        "promo": true|false, "featured": true|false,
        "listInput": "pre-promo price or omit", "listCached": "or omit", "listOutput": "or omit" }
    ],
    "other": [{ "name": "model name", "combo": "$in / $cached", "output": "$out" }],
    "apiPromoEnd": "ISO 8601 with +08:00 of the end of any API price promo, or null",
    "apiPromoEndText": "e.g. 2026-09-09 24:00 SGT, or null"
  },
  "plans": [
    { "name": "Lite|Pro|Max|...", "price": "from $18 or omit", "per": "/month or omit",
      "credits5h": "2,000", "creditsWeek": "10,000",
      "blurb": "one sentence", "highlights": ["..."], "featured": true|false }
  ],
  "announcements": [{ "text": "YYYY-MM-DD — <model/feature>: <one-line summary> (<=280 chars)", "source": "https://docs.z.ai/... exact page URL this entry came from" }]
}

RULES:
- All times/dates in the docs are Singapore time (UTC+8) unless stated otherwise. Encode eventStart/eventEnd with +08:00.
- A "24:00" end time means midnight of the NEXT day (e.g. 2026-09-09 24:00 SGT = 2026-09-10T00:00:00+08:00).
- Recurring windows need days + startTime + endTime. Bounded promos need eventStart/eventEnd. A window may be both (recurring schedule capped by an event range).
- Overnight windows (e.g. 23:00-09:00): endTime < startTime is allowed and means next-day end.
- ALWAYS include the peak-hours surcharge window with id "peak" whenever the docs mention peak-hour multipliers or off-peak discounts — carry over its current days and start/end times, updating them if the docs changed them.
- LIMITED-TIME API PRICE DISCOUNTS COUNT AS WINDOWS: when the pricing docs show a discounted (strikethrough) price or any "X% off until <date>" API promo that is still in effect, add it as a window (kind "event") with eventEnd set to the promo's end — e.g. id "flash-api-50" for the GLM-5.3-Flash 50% API discount. Include its price rows in "rates" and keep it in "pricing" with list* fields.
- Keep a promo/window that is still running per the docs even if it ends soon (even later today) — set eventEnd to its exact end. Only drop a window when the docs no longer describe it at all.
- PRESERVE the exact "id" of every window that already exists in CURRENT DATA (e.g. "peak", "flash-campaign", "flash-api-50"). Update all other fields freely; ids are join keys and must never drift.
- ANNOUNCEMENTS come first from the "release notes" doc: every <Update label="YYYY-MM-DD" description="..."> entry is a dated release announcement. Format each as "YYYY-MM-DD — <model or feature>: <one-line summary>" (use the exact en-dash + spaces). Order most recent first. Every announcement object MUST set "source" to the exact docs page URL it was extracted from (usually https://docs.z.ai/release-notes/new-released; use the specific notice page URL for announcements taken from other docs). Also surface notable promos/limit changes announced in the other docs as announcements (with their date when known).
- When a release note changes prices, credits, rate limits or adds/removes a model, reflect that in the "pricing" / "plans" / "windows" sections too — the announcements array alone is not enough for data changes.
- Include ONLY what the docs below actually say. Never invent promos, prices or dates.
- Keep ids stable for genuinely new windows: derive a short stable slug from the campaign name (e.g. "glm-5.3-flash-campaign" -> keep consistent across runs).`;

export async function extractSiteDataWithLLM(
  docsPrompt: string,
  currentPayload: SiteDataPayload | null,
): Promise<RawSiteData> {
  const zai = await getZai();
  const currentJson = currentPayload
    ? JSON.stringify(currentPayload, null, 1).slice(0, 8000)
    : "(none — first run)";

  const completion = await zai.chat.completions.create({
    messages: [
      {
        role: "assistant",
        content: `You are a precise data-extraction engine for the GLM Bonus Radar portal. You convert official z.ai documentation into strict JSON. Output JSON only — no prose, no code fences.

${SCHEMA_PROMPT}`,
      },
      {
        role: "user",
        content: `CURRENT DATA (last synced):
${currentJson}

OFFICIAL Z.AI DOCS (fetched ${new Date().toISOString()}):

${docsPrompt}

Return the updated JSON payload now.`,
      },
    ],
    thinking: { type: "disabled" },
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error("Empty extraction response");
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Tolerate a trailing sentence after the JSON object.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) parsed = JSON.parse(cleaned.slice(start, end + 1));
    else throw new Error("Extraction response was not valid JSON");
  }
  return parsed as RawSiteData;
}

/* --------------------- announcement source linking --------------------- */

const RELEASE_NOTES_URL = "https://docs.z.ai/release-notes/new-released";

/**
 * The LLM sometimes omits the per-announcement "source" URL. Attach it
 * deterministically: probe each announcement's most distinctive text
 * segment against the fetched docs; if the probe matches exactly one page,
 * that page is the source. Fallback: a "YYYY-MM-DD — …" entry whose date
 * matches a release-notes <Update label="…"> is linked to the release
 * notes page. Anything still unresolved stays link-free (renders as text).
 */
export function attachAnnouncementSources(
  items: AnnouncementItem[] | undefined,
  pages: FetchedDoc[],
): void {
  if (!items || items.length === 0) return;
  const okPages = pages.filter((p) => p.ok);
  const releasePage = okPages.find((p) => p.url === RELEASE_NOTES_URL);
  const collapse = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

  for (const item of items) {
    if (item.source) continue;
    const probe = item.text
      .split(/[—–]/)
      .map(collapse)
      .filter((s) => s.length >= 12)
      .sort((a, b) => b.length - a.length)[0]
      ?.slice(0, 48);

    let match: FetchedDoc | undefined;
    if (probe) {
      const hits = okPages.filter((p) => collapse(p.md).includes(probe));
      if (hits.length === 1) match = hits[0];
      else if (hits.length > 1)
        match = hits.find((p) => p.url === RELEASE_NOTES_URL) ?? hits[0];
    }
    if (!match && releasePage) {
      const date = /^(\d{4}-\d{2}-\d{2})/.exec(item.text)?.[1];
      if (date && releasePage.md.includes(`label="${date}"`)) match = releasePage;
    }
    if (match) item.source = match.url;
  }
}

/* ------------------------------ storage -------------------------------- */

function synthesizeSummary(changed: string[], next: SiteDataPayload): string {
  const bits: string[] = [];
  if (changed.includes("windows")) {
    const active = next.windows.map((w) => w.name).slice(0, 4).join(", ");
    bits.push(`${next.windows.length} windows (${active})`);
  }
  if (changed.includes("pricing")) {
    const promo = next.pricing?.featured?.find((f) => f.promo);
    bits.push(promo ? `pricing incl. ${promo.name} promo` : "pricing tables");
  }
  if (changed.includes("plans")) bits.push(`${next.plans?.length ?? 0} plan tiers`);
  if (changed.includes("announcements")) bits.push(`${next.announcements?.length ?? 0} announcements`);
  return bits.join(" · ");
}

export async function getStoredSiteData(): Promise<{
  payload: SiteDataPayload | null;
  changeLog: ChangeLogEntry[];
  updatedAt: string | null;
} | null> {
  const row = await db.siteData.findUnique({ where: { key: SITE_DATA_KEY } });
  if (!row) return null;
  let payload: SiteDataPayload | null = null;
  let changeLog: ChangeLogEntry[] = [];
  try {
    payload = JSON.parse(row.payload) as SiteDataPayload;
  } catch {
    payload = null;
  }
  try {
    changeLog = JSON.parse(row.changeLog) as ChangeLogEntry[];
  } catch {
    changeLog = [];
  }
  return { payload, changeLog, updatedAt: row.updatedAt.toISOString() };
}

export async function getDocsSnapshot(): Promise<{ prompt: string; fetchedAt: string } | null> {
  const row = await db.siteData.findUnique({ where: { key: DOCS_SNAPSHOT_KEY } });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payload) as { prompt: string; fetchedAt: string };
    return parsed;
  } catch {
    return null;
  }
}

export interface SyncResult {
  status: "changed" | "unchanged" | "error";
  summary: string;
  changedSections?: string[];
  updatedAt?: string;
  error?: string;
}

/** The journal keeps 14 days of history — old rows are pruned after each run. */
const JOURNAL_TTL_MS = 14 * 24 * 3600 * 1000;

/**
 * Every run — changed, unchanged or error — lands in the SyncRun journal so
 * the /changelog audit page always shows the freshest check, even when the
 * docs were quiet. Sections (what changed) ride along for changed runs.
 */
async function journalRun(status: string, summary: string, trigger: string, sections: string[] = []): Promise<void> {
  try {
    await db.syncRun.create({
      data: {
        status,
        summary,
        trigger,
        sections: JSON.stringify(sections),
      },
    });
    await db.syncRun.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - JOURNAL_TTL_MS) } },
    });
  } catch {
    /* DB unavailable — nothing more we can do */
  }
}

/**
 * Deterministic safety-net pins, applied to every payload the sync touches.
 *
 * · the peak-hours surcharge is the backbone of this tracker — re-attach the
 *   known definition if the extraction somehow omits it (still documented in
 *   the sources we just fetched);
 * · the Flash API −50% promo is re-attached while live (+24h grace);
 * · the campaign's NIGHTLY 23:00–09:00 recurrence powers the golden-window
 *   insight — the LLM sometimes flattens it into a bare event range, so the
 *   known schedule is grafted back onto the synced event bounds (and the
 *   whole static def returns if the campaign vanished while still live).
 *
 * The SAME transformation runs on the stored payload before diffing —
 * otherwise an LLM that keeps dropping the recurrence would ping-pong
 * "windows changed" into the journal on every single run.
 */
function applyPins(windows: BonusWindowDef[]): { windows: BonusWindowDef[]; pinned: boolean } {
  let pinned = false;
  let out = windows;

  if (!out.some((w) => w.id === "peak" || /peak/i.test(w.name))) {
    out = [BONUS_WINDOWS[0], ...out];
    pinned = true;
  }
  const flashApi = BONUS_WINDOWS.find((w) => w.id === "flash-api-50");
  if (
    flashApi &&
    !out.some((w) => w.id === "flash-api-50") &&
    Date.now() < (flashApi.eventEndMs ?? 0) + 24 * 3600 * 1000
  ) {
    out = [...out, flashApi];
    pinned = true;
  }

  const flashCampaign = BONUS_WINDOWS.find((w) => w.id === "flash-campaign");
  if (flashCampaign) {
    const idx = out.findIndex(
      (w) => /flash/i.test(w.id) && /campaign/i.test(w.id) && w.id !== "flash-api-50",
    );
    if (idx >= 0) {
      const synced = out[idx];
      const hasRecurrence =
        Array.isArray(synced.days) &&
        synced.days.length > 0 &&
        synced.startMin != null &&
        synced.endMin != null;
      if (!hasRecurrence) {
        out = [...out];
        out[idx] = {
          ...flashCampaign,
          eventStartMs: synced.eventStartMs ?? flashCampaign.eventStartMs,
          eventEndMs: synced.eventEndMs ?? flashCampaign.eventEndMs,
          eventEndText: synced.eventEndText ?? flashCampaign.eventEndText,
        };
        pinned = true;
      }
    } else if (Date.now() < (flashCampaign.eventEndMs ?? 0)) {
      out = [...out, flashCampaign];
      pinned = true;
    }
  }

  return { windows: out, pinned };
}

export async function runSync(trigger: "boot" | "hourly" | "manual"): Promise<SyncResult> {
  const stamp = () =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: SGT,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());

  try {
    const stored = await getStoredSiteData();
    const { pages, fetchedAt } = await fetchAllDocs();
    const okPages = pages.filter((p) => p.ok);
    if (okPages.length === 0) throw new Error("All doc sources failed to fetch");
    const docsPrompt = docsToPrompt(pages);

    const raw = await extractSiteDataWithLLM(docsPrompt, stored?.payload ?? null);
    const next = normalizeSiteData(raw);
    attachAnnouncementSources(next.announcements, pages);

    const { windows: pinnedWindows, pinned } = applyPins(next.windows);
    next.windows = pinnedWindows;

    // Diff against the stored payload WITH the same pins applied — the stored
    // form is post-pin, so an un-pinned comparison would flag phantom window
    // changes every run (the churn this replaces did exactly that).
    const storedForDiff =
      stored?.payload != null
        ? { ...stored.payload, windows: applyPins(stored.payload.windows).windows }
        : null;
    const changedSections = diffSections(storedForDiff, next);

    // Always refresh the docs snapshot so the bot answers from the latest text.
    await db.siteData.upsert({
      where: { key: DOCS_SNAPSHOT_KEY },
      create: { key: DOCS_SNAPSHOT_KEY, payload: JSON.stringify({ prompt: docsPrompt, fetchedAt }) },
      update: { payload: JSON.stringify({ prompt: docsPrompt, fetchedAt }) },
    });

    if (changedSections.length === 0) {
      const result: SyncResult = {
        status: "unchanged",
        summary: `checked ${okPages.length}/${pages.length} docs — no changes${pinned ? " (pins applied)" : ""}`,
      };
      await journalRun(result.status, result.summary, trigger);
      return result;
    }

    const summary = `${pinned ? "[pinned] " : ""}${synthesizeSummary(changedSections, next)}`;
    const entry: ChangeLogEntry = {
      at: new Date().toISOString(),
      summary: summary || "updated",
      sections: changedSections,
      trigger,
    };
    const changeLog = [entry, ...(stored?.changeLog ?? [])].slice(0, 20);

    await db.siteData.upsert({
      where: { key: SITE_DATA_KEY },
      create: { key: SITE_DATA_KEY, payload: JSON.stringify(next), changeLog: JSON.stringify(changeLog) },
      update: { payload: JSON.stringify(next), changeLog: JSON.stringify(changeLog) },
    });
    await journalRun("changed", `${trigger}: ${summary}`, trigger, changedSections);

    // Push brand-new announcements to Telegram subscribers (fire-and-forget —
    // a telegram outage must never fail the sync).
    if (changedSections.includes("announcements") && next.announcements?.length) {
      const keyOf = (a: AnnouncementItem | string): string =>
        typeof a === "string" ? JSON.stringify([a, null]) : JSON.stringify([a?.text, a?.source ?? null]);
      const known = new Set((stored?.payload?.announcements ?? []).map(keyOf));
      const fresh = next.announcements.filter((a) => !known.has(keyOf(a))).slice(0, 3);
      const lines = (fresh.length > 0 ? fresh : next.announcements.slice(0, 1))
        .map((a) => `- ${typeof a === "string" ? a : a.text}`)
        .join("\n");
      void broadcast(
        "announcements",
        `New on docs.z.ai:\n${lines}\n\nLive radar: the announcements strip has source links.`,
      ).catch(() => {});
    }

    console.log(`[docs-sync] ${stamp()} SGT — updated (${changedSections.join(", ")}): ${summary}`);
    return {
      status: "changed",
      summary,
      changedSections,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isGarbage = err instanceof SiteDataError;
    console.error(`[docs-sync] run failed (${trigger}):`, message);
    const summary = isGarbage ? `extraction rejected: ${message}` : `sync error: ${message}`;
    await journalRun("error", summary, trigger);
    return { status: "error", summary, error: message };
  }
}
