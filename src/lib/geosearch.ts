/**
 * zSearch — the GEO-first search engine core (server-only).
 *
 * Idea: classic search engines rank by SEO — keywords, backlinks, click-through.
 * zSearch ranks the same live web by GEO (Generative Engine Optimization):
 * how likely each source is to be *cited inside AI-generated answers*.
 *
 * Pipeline per query:
 *   1. live web search  — z-ai-web-dev-sdk `web_search` function (10 organic results)
 *   2. GEO scoring      — one GLM call grades every result on citability /
 *                         structure / freshness / entity clarity and drafts an
 *                         "AI answer preview" with [n] citation markers
 *   3. fallback         — if the model call fails/times out, deterministic
 *                         snippet-signal heuristics keep the engine usable
 *   4. cache            — 15-minute in-memory TTL per normalized query
 *
 * Honesty discipline (portal doctrine): scores are *estimates from public
 * snippets* — the payload carries `mode` ("model" | "signals") so the UI can
 * say exactly how each rating was produced. Nothing is invented about the
 * ranked pages beyond the signals returned by the search function.
 */

import { getZai } from "@/lib/zai";

/* ---------------------------------- types --------------------------------- */

export type GeoDims = {
  citability: number;
  structure: number;
  freshness: number;
  entity: number;
};

export type GeoSearchResult = {
  /** 1-based position in the original (SEO/web) result order. */
  webRank: number;
  /** 1-based position after sorting by GEO score. */
  geoRank: number;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  date: string | null;
  score: number;
  grade: string;
  dims: GeoDims;
  note: string;
  /** True when the AI answer preview cites this source. */
  cited: boolean;
};

export type GeoSearchPayload = {
  query: string;
  /** Draft AI answer with [n] markers — null when scored by signal fallback. */
  answer: string | null;
  /** webRank values cited in the answer preview. */
  citations: number[];
  /** Sorted by geoRank ascending. */
  results: GeoSearchResult[];
  tookMs: number;
  mode: "model" | "signals";
  scoredAt: string;
};

export class GeoSearchError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/* --------------------------------- tuning --------------------------------- */

export const MAX_QUERY = 240;
const MIN_QUERY = 2;
const RESULT_COUNT = 10;
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX = 60;
const MODEL_TIMEOUT_MS = 45_000;

const cache = new Map<string, { at: number; payload: GeoSearchPayload }>();

function normalizeQuery(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY) : "";
}

function cacheKey(query: string): string {
  return query.toLowerCase();
}

function gradeFor(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 82) return "A";
  if (score >= 74) return "B+";
  if (score >= 66) return "B";
  if (score >= 58) return "C+";
  if (score >= 50) return "C";
  return "D";
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));

/* ------------------------------- web search ------------------------------- */

type WebItem = {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  date: string | null;
};

async function searchWeb(query: string): Promise<WebItem[]> {
  const zai = await getZai();
  const raw = (await zai.functions.invoke("web_search", { query, num: RESULT_COUNT })) as unknown;

  if (!Array.isArray(raw)) throw new Error("web_search returned a non-array payload");

  const seen = new Set<string>();
  const items: WebItem[] = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    const url = typeof entry.url === "string" ? entry.url : "";
    const title = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!url || !title) continue;
    let domain = "";
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      continue; // skip malformed URLs
    }
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({
      url,
      domain,
      title,
      snippet: typeof entry.snippet === "string" ? entry.snippet.trim() : "",
      date: typeof entry.date === "string" && entry.date.trim() ? entry.date.trim() : null,
    });
    if (items.length >= RESULT_COUNT) break;
  }

  if (items.length < 2) throw new Error("web_search returned too few usable results");
  return items;
}

/* ------------------------------ model scoring ----------------------------- */

const SCORER_SYSTEM = `You are the scoring engine inside zSearch, a GEO-first search engine (GEO = Generative Engine Optimization — how well content performs inside AI-generated answers, instead of classic blue-link SEO).

For the user's query you receive numbered web results (domain, date, title, snippet). From these visible signals ONLY, estimate how each source would perform inside AI-generated answers:
- citability: quotable definitions, concrete numbers, clear claims an answer engine could cite verbatim.
- structure: answer-first signals in the title/snippet (direct answers, steps, lists, tables, comparisons).
- freshness: recency signals (dates, years) weighted by how much this query needs fresh information.
- entity: unambiguous identity — named product/brand/site, specific niche, clear about-ness.
- score: the weighted blend — citability 35%, structure 25%, freshness 20%, entity 20% — integer 0-100.

Differentiate honestly: do NOT give every result a similar score, and do NOT invent facts about the pages beyond the signals shown. A big generic domain is not automatically high-GEO; a precise, quotable niche page often beats it.

Also write "answer": 60-90 words — the direct answer to the query as an AI answer engine would render it — with [n] markers after the claims you draw from the 2-4 sources you would actually cite (n = that result's number).

Reply with STRICT JSON only — no markdown fences, no commentary:
{"answer":"...","citations":[1,3],"results":[{"n":1,"score":82,"citability":85,"structure":78,"freshness":70,"entity":90,"note":"one line, max 90 chars, why this GEO score"}]}

Every input number 1..N must appear exactly once in results.`;

type ModelVerdict = {
  answer: string | null;
  citations: number[];
  scores: Array<{ score: number; dims: GeoDims; note: string }>;
};

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object found in model reply");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("model scoring timeout")), ms)),
  ]);
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function scoreWithModel(query: string, items: WebItem[]): Promise<ModelVerdict> {
  const listing = items
    .map((it, i) => {
      const head = `[${i + 1}] ${it.domain}${it.date ? ` · dated ${it.date}` : ""}`;
      return `${head}\n${it.title}\n${it.snippet || "(no snippet available)"}`;
    })
    .join("\n\n");

  const zai = await getZai();
  const completion = await withTimeout(
    zai.chat.completions.create({
      messages: [
        { role: "assistant", content: SCORER_SYSTEM },
        { role: "user", content: `Query: "${query}"\n\nResults:\n\n${listing}` },
      ],
      thinking: { type: "disabled" },
    }),
    MODEL_TIMEOUT_MS,
  );

  const text = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("empty model reply");
  const parsed = extractJson(text) as {
    answer?: unknown;
    citations?: unknown;
    results?: unknown;
  };

  if (!Array.isArray(parsed.results)) throw new Error("model reply missing results array");

  // Index the model's scores by result number n (1-based), validating everything.
  const byN = new Map<number, { score: number; dims: GeoDims; note: string }>();
  for (const row of parsed.results as Array<Record<string, unknown>>) {
    const n = num(row.n, NaN);
    if (!Number.isInteger(n) || n < 1 || n > items.length || byN.has(n)) continue;
    const citability = clamp(num(row.citability, 50));
    const structure = clamp(num(row.structure, 50));
    const freshness = clamp(num(row.freshness, 50));
    const entity = clamp(num(row.entity, 50));
    const blended = citability * 0.35 + structure * 0.25 + freshness * 0.2 + entity * 0.2;
    const score = clamp(typeof row.score === "number" && Number.isFinite(row.score) ? row.score : blended);
    const note =
      typeof row.note === "string" && row.note.trim()
        ? row.note.trim().replace(/\s+/g, " ").slice(0, 120)
        : "no note returned";
    byN.set(n, { score, dims: { citability, structure, freshness, entity }, note });
  }

  // Require coverage of at least half the results, else treat as a failed call.
  if (byN.size < Math.ceil(items.length / 2)) {
    throw new Error(`model scored only ${byN.size}/${items.length} results`);
  }

  const scores: ModelVerdict["scores"] = items.map((_, i) => {
    const hit = byN.get(i + 1);
    if (hit) return hit;
    // Sparse coverage: blend the missing one from heuristics but stay in model mode.
    const h = heuristicRow(query, items[i]);
    return { score: h.score, dims: h.dims, note: `${h.note} (model left this one unscored)` };
  });

  const answer =
    typeof parsed.answer === "string" && parsed.answer.trim()
      ? parsed.answer.trim().replace(/\s+/g, " ").slice(0, 900)
      : null;

  const validRanks = new Set(items.map((_, i) => i + 1));
  const citations = Array.isArray(parsed.citations)
    ? Array.from(
        new Set(
          parsed.citations
            .filter((c): c is number => typeof c === "number" && Number.isInteger(c) && validRanks.has(c))
            .slice(0, 4),
        ),
      )
    : [];

  return { answer, citations, scores };
}

/* --------------------------- heuristic fallback --------------------------- */

function heuristicRow(query: string, it: WebItem): { score: number; dims: GeoDims; note: string } {
  const terms = Array.from(
    new Set(query.toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length > 2)),
  );
  const hay = `${it.title} ${it.snippet}`.toLowerCase();
  const overlap = terms.length ? terms.filter((t) => hay.includes(t)).length / terms.length : 0;
  const hasNumbers = /\d/.test(it.snippet);
  const listy = /(how to|guide|steps|checklist|best \d|top \d|\bvs\.?\b|compar|tutorial|example)/i.test(
    `${it.title} ${it.snippet}`,
  );
  const freshish = /(20(2[4-9])|latest|new)/i.test(`${it.title} ${it.snippet}`);
  const official = /(official|docs|documentation|developer)/i.test(hay);

  const citability = clamp(30 + overlap * 40 + (hasNumbers ? 14 : 0) + (it.snippet.length > 140 ? 8 : 0));
  const structure = clamp(34 + (listy ? 26 : 0) + (/\d/.test(it.title) ? 10 : 0) + (it.snippet.length > 90 ? 8 : 0));
  const freshness = clamp(28 + (it.date ? 38 : 0) + (freshish ? 20 : 0));
  const entity = clamp(
    38 + (it.title.length >= 15 && it.title.length <= 90 ? 14 : 6) + (overlap > 0.5 ? 16 : 0) + (official ? 10 : 0),
  );
  const score = clamp(citability * 0.35 + structure * 0.25 + freshness * 0.2 + entity * 0.2);
  return {
    score,
    dims: { citability, structure, freshness, entity },
    note: "estimated from snippet signals only — model scorer unavailable",
  };
}

/* -------------------------------- assembler ------------------------------- */

function assemble(
  query: string,
  items: WebItem[],
  model: ModelVerdict | null,
  mode: GeoSearchPayload["mode"],
  t0: number,
): GeoSearchPayload {
  const results: GeoSearchResult[] = items.map((it, i) => {
    const s = model ? model.scores[i] : heuristicRow(query, it);
    return {
      webRank: i + 1,
      geoRank: 0, // filled below
      url: it.url,
      domain: it.domain,
      title: it.title,
      snippet: it.snippet,
      date: it.date,
      score: s.score,
      grade: gradeFor(s.score),
      dims: s.dims,
      note: s.note,
      cited: model ? model.citations.includes(i + 1) : false,
    };
  });

  const byGeo = [...results].sort((a, b) => b.score - a.score || a.webRank - b.webRank);
  byGeo.forEach((r, i) => {
    r.geoRank = i + 1;
  });

  return {
    query,
    answer: model?.answer ?? null,
    citations: model?.citations ?? [],
    results: byGeo,
    tookMs: Date.now() - t0,
    mode,
    scoredAt: new Date().toISOString(),
  };
}

/* --------------------------------- runner --------------------------------- */

export async function runGeoSearch(rawQuery: unknown): Promise<GeoSearchPayload> {
  const query = normalizeQuery(rawQuery);
  if (query.length < MIN_QUERY) {
    throw new GeoSearchError(`Type at least ${MIN_QUERY} characters to search.`, 400);
  }

  const key = cacheKey(query);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload;

  const t0 = Date.now();
  const items = await searchWeb(query);

  let payload: GeoSearchPayload;
  try {
    const model = await scoreWithModel(query, items);
    payload = assemble(query, items, model, "model", t0);
  } catch (err) {
    console.error("[geo-search] model scoring failed — using signal heuristics:", err);
    payload = assemble(query, items, null, "signals", t0);
  }

  cache.set(key, { at: Date.now(), payload });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return payload;
}
