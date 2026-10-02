/**
 * zScanner — GEO/SEO Audit.
 *
 * Classic on-page SEO (ledger research-seo.json: title/description/canonical/
 * viewport/robots/OG/headings/alt/JSON-LD/crawlability) plus the 2026
 * Generative-Engine-Optimization layer (research-geo.json): llms.txt,
 * AI-crawler policy in robots.txt (GPTBot, ClaudeBot, PerplexityBot,
 * Google-Extended, CCBot, …) and citation signals.
 *
 * Parsing is dependency-free by design (deploy-reliability policy): every
 * regex here is linear-time (bounded quantifiers / non-nested classes) and
 * input is capped upstream at 2 MB — no ReDoS path.
 */

import { guardedGet, plausibleTarget, ScanError } from "./fetcher";
import { type Finding, type Inconclusive, type UrlScanReport, scoreFindings } from "./types";
import { dedupeFindings, tag, verificationBlock } from "./verify";

const AI_CRAWLERS: [token: string, label: string][] = [
  ["GPTBot", "OpenAI (ChatGPT)"],
  ["OAI-SearchBot", "OpenAI Search"],
  ["ChatGPT-User", "ChatGPT live fetch"],
  ["ClaudeBot", "Anthropic (Claude)"],
  ["Claude-Web", "Anthropic (legacy)"],
  ["PerplexityBot", "Perplexity"],
  ["Google-Extended", "Google Gemini training"],
  ["Googlebot", "Google Search"],
  ["bingbot", "Bing / Copilot"],
  ["CCBot", "Common Crawl"],
  ["Amazonbot", "Amazon (Alexa)"],
  ["Applebot-Extended", "Apple training"],
  ["Bytespider", "ByteDance"],
  ["meta-externalagent", "Meta AI"],
];

/* ---------- tiny linear-time HTML helpers ---------- */

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
  return out;
}

function firstTag(html: string, re: RegExp): string | null {
  const m = re.exec(html);
  return m ? m[0] : null;
}

function metaContent(html: string, key: "name" | "property", value: string): string | null {
  const tag = firstTag(html, new RegExp(`<meta\\b[^>]{0,400}>`, "gi"));
  // scan all meta tags linearly
  const all = html.match(new RegExp(`<meta\\b[^>]{0,400}>`, "gi")) ?? [];
  void tag;
  for (const t of all) {
    const a = attrs(t);
    if ((a[key] ?? "").toLowerCase() === value.toLowerCase()) return a.content ?? null;
  }
  return null;
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]{0,2000000}?<\/script>/gi, " ")
    .replace(/<style[\s\S]{0,200000}?<\/style>/gi, " ")
    .replace(/<!--[\s\S]{0,20000}?-->/g, " ")
    .replace(/<[^>]{0,300}>/g, " ")
    .replace(/\s+/g, " ");
}

/* ---------- linker-derived helpers (ported scoring concepts, MIT) ----------
 * linker (romangalaxys10-spec/linker) scores pillars and combines them;
 * we keep our severity-deduction headline score and surface the same
 * pillars as an informational breakdown (severities -> pillar points). */

const SEV_PILLAR: Record<string, number> = { critical: 0, high: 15, medium: 45, low: 70, info: 85, pass: 100 };

function pillarScore(ids: string[], findings: Finding[]): number | null {
  const scores: number[] = [];
  for (const id of ids) {
    const f = findings.find((x) => x.id === id);
    if (f) scores.push(SEV_PILLAR[f.severity] ?? 70);
  }
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ---------- robots.txt policy ---------- */

function robotsPolicy(robots: string) {
  const lines = robots.split(/\r?\n/).map((l) => l.trim());
  const blocks: { agents: string[]; disallows: string[]; allows: string[] }[] = [];
  let cur: (typeof blocks)[number] | null = null;
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (!cur || cur.disallows.length || cur.allows.length) {
        cur = { agents: [], disallows: [], allows: [] };
        blocks.push(cur);
      }
      cur.agents.push(value);
    } else if (cur) {
      if (key === "disallow") cur.disallows.push(value);
      else if (key === "allow") cur.allows.push(value);
    }
  }
  const siteBlocked = blocks.some(
    (b) => b.agents.includes("*") && b.disallows.some((d) => d === "/")
  );
  const blocked: string[] = [];
  const allowed: string[] = [];
  for (const [token, label] of AI_CRAWLERS) {
    const own = blocks.filter((b) => b.agents.some((a) => a.toLowerCase() === token.toLowerCase()));
    if (own.length && own.every((b) => b.disallows.some((d) => d === "/"))) blocked.push(`${token} (${label})`);
    else if (!siteBlocked) allowed.push(token);
  }
  const sitemapLine = lines.find((l) => /^sitemap:/i.test(l))?.split(":").slice(1).join(":").trim();
  return { siteBlocked, blocked, allowed, sitemapLine };
}

/* ---------- main ---------- */

type StageProgress = (stageIndex: number, frac: number, note?: string) => void;

export async function runGeoSeoScan(
  rawUrl: string,
  progress: StageProgress = () => {}
): Promise<UrlScanReport> {
  const started = Date.now();
  const target = plausibleTarget(rawUrl);
  if (!target) throw new ScanError("bad-url", "Give a public URL like example.com.");
  const origin = new URL(target).origin;
  progress(0, 0.35, "resolving & fetching");

  const findings: Finding[] = [];
  const inconclusive: Inconclusive[] = [];

  const page = await guardedGet(target, { bodyCap: 2_000_000 });
  const html = page.body;
  const finalOrigin = new URL(page.finalUrl).origin;
  progress(0, 1);

  // --- page reachability
  if (page.status >= 200 && page.status < 400) {
    findings.push({ id: "geo-status", severity: "pass", title: `Reachable (HTTP ${page.status})`, detail: `${page.finalUrl}${page.hops ? ` · ${page.hops} redirect(s)` : ""}` });
  } else {
    findings.push({
      id: "geo-status",
      severity: "high",
      title: `HTTP ${page.status}`,
      detail: "Search engines and answer engines drop pages that answer with errors.",
      fix: "Resolve the server error before anything else.",
    });
  }

  // --- classic SEO
  const titleTag = /<title[^>]*>([\s\S]{0,500}?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const titleLen = titleTag.length;
  if (!titleTag) {
    findings.push({ id: "seo-title", severity: "high", title: "No <title>", detail: "The document title is the single strongest on-page signal; SERPs and AI answers quote it verbatim.", fix: "Add a 25–65 character title that names the page." });
  } else if (titleLen < 20 || titleLen > 70) {
    findings.push({ id: "seo-title", severity: "low", title: `Title length ${titleLen}`, detail: "Outside the ~25–65 character band titles get truncated (or look thin).", evidence: titleTag.slice(0, 80), fix: "Aim for 25–65 characters." });
  } else {
    findings.push({ id: "seo-title", severity: "pass", title: `Title (${titleLen} chars)`, detail: titleTag.slice(0, 120) });
  }

  const desc = metaContent(html, "name", "description") ?? "";
  if (!desc) {
    findings.push({ id: "seo-desc", severity: "medium", title: "Meta description missing", detail: "Search engines then improvise snippets; generative engines lose a concise claim to cite.", fix: "Add a 60–165 character description." });
  } else if (desc.length < 50 || desc.length > 185) {
    findings.push({ id: "seo-desc", severity: "low", title: `Description length ${desc.length}`, detail: "Outside the ~60–165 band snippets truncate.", evidence: desc.slice(0, 100) });
  } else {
    findings.push({ id: "seo-desc", severity: "pass", title: `Meta description (${desc.length} chars)`, detail: desc.slice(0, 140) });
  }

  const canonical = firstTag(html, /<link\b[^>]{0,400}rel\s*=\s*["']?canonical["']?[^>]{0,400}>/i);
  findings.push(
    canonical
      ? { id: "seo-canonical", severity: "pass", title: "Canonical link present", detail: attrs(canonical).href?.slice(0, 140) ?? "" }
      : { id: "seo-canonical", severity: "low", title: "No canonical URL", detail: "Duplicate/parameterized URLs can split ranking signals.", fix: 'Add <link rel="canonical" href="…">' }
  );

  findings.push(
    /<meta\b[^>]{0,400}name\s*=\s*["']viewport["'][^>]{0,400}>/i.test(html)
      ? { id: "seo-viewport", severity: "pass", title: "Mobile viewport declared", detail: "" }
      : { id: "seo-viewport", severity: "medium", title: "No viewport meta", detail: "Without a viewport the page is not mobile-legible — mobile-first indexing punishes it.", fix: '<meta name="viewport" content="width=device-width, initial-scale=1">' }
  );

  const lang = /<html\b[^>]{0,400}\blang\s*=\s*["']([a-zA-Z-]{2,10})["']/i.exec(html)?.[1];
  findings.push(
    lang
      ? { id: "seo-lang", severity: "pass", title: `Language declared (${lang})`, detail: "" }
      : { id: "seo-lang", severity: "low", title: "No lang attribute on <html>", detail: "Language declaration feeds hreflang-less disambiguation and screen readers.", fix: '<html lang="en">' }
  );

  const robotsMeta = metaContent(html, "name", "robots") ?? "";
  if (/noindex/i.test(robotsMeta)) {
    findings.push({ id: "seo-robots-meta", severity: "high", title: "Page is noindex", detail: `meta robots says "${robotsMeta.slice(0, 60)}" — explicitly excluded from search indexes.` });
  } else {
    findings.push({ id: "seo-robots-meta", severity: "pass", title: "Indexable", detail: "No noindex directive on the page." });
  }

  const og = ["og:title", "og:description", "og:image"].map((p) => [p, metaContent(html, "property", p)] as const);
  const ogMissing = og.filter(([, v]) => !v).map(([p]) => p);
  if (ogMissing.length === 3) {
    findings.push({ id: "seo-og", severity: "medium", title: "No Open Graph tags", detail: "Link previews collapse on every social/chat surface; answer engines use og: data as fallback descriptions.", fix: "Add og:title, og:description, og:image." });
  } else if (ogMissing.length) {
    findings.push({ id: "seo-og", severity: "low", title: `Open Graph incomplete (missing ${ogMissing.join(", ")})`, detail: "Partial previews look broken in chat apps.", fix: "Complete the og: triplet." });
  } else {
    findings.push({ id: "seo-og", severity: "pass", title: "Open Graph complete", detail: "og:title / og:description / og:image all present." });
  }

  const h1s = (html.match(/<h1\b/gi) ?? []).length;
  findings.push(
    h1s === 1
      ? { id: "seo-h1", severity: "pass", title: "Exactly one <h1>", detail: "" }
      : h1s === 0
        ? { id: "seo-h1", severity: "medium", title: "No <h1>", detail: "The main heading anchors topic understanding for crawlers and LLM extractors alike.", fix: "Add one descriptive <h1>." }
        : { id: "seo-h1", severity: "low", title: `${h1s} <h1> elements`, detail: "Multiple h1s blur the topical hierarchy.", fix: "Keep exactly one h1." }
  );

  const imgs = html.match(/<img\b[^>]{0,400}>/gi) ?? [];
  if (imgs.length) {
    const withAlt = imgs.filter((t) => /\balt\s*=\s*(?:"[^"]*"|'[^']*')/i.test(t)).length;
    const pct = Math.round((withAlt / imgs.length) * 100);
    findings.push(
      pct >= 90
        ? { id: "seo-alt", severity: "pass", title: `Image alt coverage ${pct}%`, detail: `${withAlt}/${imgs.length} images describe themselves.` }
        : { id: "seo-alt", severity: pct < 60 ? "medium" : "low", title: `Image alt coverage ${pct}%`, detail: `${imgs.length - withAlt} of ${imgs.length} images have no alt text — invisible to crawlers, screen readers and vision models.`, fix: "Describe every informative image in alt." }
    );
  }

  const ldCount = (html.match(/<script\b[^>]{0,400}type\s*=\s*["']application\/ld\+json["'][^>]{0,400}>/gi) ?? []).length;
  findings.push(
    ldCount
      ? { id: "geo-jsonld", severity: "pass", title: `Structured data: ${ldCount} JSON-LD block(s)`, detail: "Machine-readable entities make the page citable and eligible for rich results." }
      : { id: "geo-jsonld", severity: "medium", title: "No JSON-LD structured data", detail: "schema.org JSON-LD is how answer engines resolve entities (Product, FAQ, Organization…).", fix: "Add JSON-LD for the page's primary entity type." }
  );

  const words = visibleText(html).split(/\s+/).filter((w) => w.length > 1).length;
  findings.push(
    words >= 300
      ? { id: "geo-words", severity: "pass", title: `Substantive text (${words.toLocaleString()} words)`, detail: "Enough prose for extractors to quote." }
      : { id: "geo-words", severity: "low", title: `Thin text (${words} words)`, detail: "Below ~300 visible words there is little for a generative engine to cite.", fix: "Add substantive prose." }
  );

  // --- structure & readability (linker: heading structure + content clarity)
  const h2s = (html.match(/<h2\b/gi) ?? []).length;
  findings.push(
    h2s >= 2
      ? { id: "seo-h2", severity: "pass", title: `Heading structure (${h2s} h2 sections)`, detail: "Subheadings give crawlers and extractors a topical outline." }
      : { id: "seo-h2", severity: "low", title: "Few subheadings", detail: "Fewer than two h2 sections — pages without structure read as walls of text.", fix: "Break the content into h2/h3 sections." }
  );

  const lists = (html.match(/<(?:ul|ol)\b/gi) ?? []).length;
  const tables = (html.match(/<table\b/gi) ?? []).length;
  const bolds = (html.match(/<strong\b/gi) ?? []).length;
  findings.push(
    lists >= 1 || tables >= 1 || bolds >= 3
      ? { id: "geo-airead", severity: "pass", title: "AI-readable formatting", detail: `${lists} list(s), ${tables} table(s), ${bolds} strong tag(s) — extractors can lift facts cleanly.` }
      : { id: "geo-airead", severity: "low", title: "No scannable formatting", detail: "No lists, tables or emphasis — answer engines prefer content chunked into lift-ready units.", fix: "Add lists/tables for comparable facts." }
  );

  const text = visibleText(html);
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const avgSentence = sentences.length ? words / Math.max(1, sentences.length) : words;
  if (avgSentence > 25)
    findings.push({ id: "geo-clarity", severity: "info", title: `Dense sentences (avg ${Math.round(avgSentence)} words)`, detail: "Long sentences lower comprehension scores for humans and models alike.", fix: "Split sentences to 10–25 words." });
  else
    findings.push({ id: "geo-clarity", severity: "pass", title: "Readable sentence length", detail: `Average ${Math.round(avgSentence)} words per sentence.` });

  // --- keyword coverage (linker: scoreKeywordDensity)
  const titleWords = titleTag.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const textLower = text.toLowerCase();
  if (titleWords.length) {
    let hits = 0;
    for (const w of titleWords) {
      const m = textLower.match(new RegExp(escapeRe(w), "g"));
      if (m) hits += m.length;
    }
    const density = (hits / Math.max(1, words)) * 100;
    findings.push(
      density === 0
        ? { id: "seo-keywords", severity: "medium", title: "Title terms absent from body", detail: "The title promises topics the visible text never delivers — topical mismatch.", fix: "Cover the title's subject in the prose." }
        : density < 0.3
          ? { id: "seo-keywords", severity: "low", title: `Keyword density low (${density.toFixed(1)}%)`, detail: "Title terms barely appear in the body; engines see a weak topic match.", fix: "Naturally weave title terms into the copy." }
          : density > 4
            ? { id: "seo-keywords", severity: "low", title: `Keyword density high (${density.toFixed(1)}%)`, detail: "Above ~3–4% reads as stuffing to ranking systems and quality classifiers.", fix: "Diversify vocabulary or trim repetition." }
            : { id: "seo-keywords", severity: "pass", title: `Keyword density ${density.toFixed(1)}%`, detail: "Title terms appear in the body at a natural frequency." }
    );
  }

  // --- links (linker: scoreInternalLinking)
  const hrefs = [...html.matchAll(/<a\b[^>]{0,400}?href\s*=\s*["']([^"'#\s]{1,300})["']/gi)].map((m) => m[1]);
  const originOf = (h: string): string | null => {
    try {
      return new URL(h, page.finalUrl).origin;
    } catch {
      return null;
    }
  };
  const internal = hrefs.filter((h) => originOf(h) === finalOrigin).length;
  const externalHrefs = hrefs.filter((h) => {
    const o = originOf(h);
    return o && o !== finalOrigin;
  });
  findings.push(
    internal >= 3
      ? { id: "seo-links", severity: "pass", title: `Internal links (${internal})`, detail: "Crawl paths and topic clusters are discoverable." }
      : { id: "seo-links", severity: "low", title: `Few internal links (${internal})`, detail: "Under three internal links strands crawlers and dilutes topical clustering.", fix: "Link to related pages you own." }
  );
  if (!externalHrefs.length)
    findings.push({ id: "seo-extlinks", severity: "info", title: "No outbound links", detail: "Zero external citations — GEO scoring favors pages that source their claims.", fix: "Reference 2–5 primary sources." });

  // --- authority signals (linker: scoreAuthoritySignals)
  const hasAuthor = Boolean(metaContent(html, "name", "author")) || /"author"\s*:\s*\{/.test(html) || /rel\s*=\s*["']author["']/i.test(html);
  const hasDate = /datePublished|article:published_time|<time\b[^>]{0,200}datetime\s*=/i.test(html);
  if (hasAuthor && hasDate)
    findings.push({ id: "geo-authority", severity: "pass", title: "Authorship & freshness signals", detail: "Author and publish-date markers let engines attribute and time the content." });
  else if (hasAuthor || hasDate)
    findings.push({ id: "geo-authority", severity: "low", title: hasAuthor ? "Author without a date" : "Date without an author", detail: "Partial E-E-A-T signals — engines weight completeness.", fix: hasAuthor ? "Add article:published_time or <time datetime>." : 'Add a meta name="author" or JSON-LD author.' });
  else
    findings.push({ id: "geo-authority", severity: "low", title: "No author/date signals", detail: "Nothing marks who wrote this or when — both feed authority scoring and citation preference.", fix: "Add an author byline + published date metadata." });

  // --- citation readiness (linker: scoreCitationReadiness)
  const pcts = (text.match(/\d+(?:\.\d+)?%/g) ?? []).length;
  const stats = (text.match(/\$\d+|\d+\s*(?:million|billion|thousand|percent|users|customers|people|units)/gi) ?? []).length;
  const quotes = /["“”]/.test(text);
  const citationScore = (pcts >= 1 ? 1 : 0) + (stats >= 1 ? 1 : 0) + (quotes ? 1 : 0) + (externalHrefs.length >= 2 ? 1 : 0);
  findings.push(
    citationScore >= 2
      ? { id: "geo-citation", severity: "pass", title: "Citation-ready content", detail: `${pcts} percentage(s), ${stats} stat(s), ${quotes ? "quotes, " : ""}${externalHrefs.length} outbound reference(s).` }
      : { id: "geo-citation", severity: "low", title: "Weak citation surface", detail: "Answer engines prefer quotable, numbered claims from pages that show their sources.", fix: "Add 2–3 concrete, sourced facts." }
  );

  // --- entity coverage (linker: scoreEntityCoverage, info-tier)
  const entities = (text.match(/\b(?:inc|corp|ltd|llc|gmbh|university|institute|foundation)\b|\b(?:based in|located in|headquartered)\b/gi) ?? []).length;
  findings.push(
    entities >= 2
      ? { id: "geo-entity", severity: "pass", title: `Entity signals (${entities})`, detail: "Organizations and places are nameable — good for knowledge-graph grounding." }
      : { id: "geo-entity", severity: "info", title: "Few entity mentions", detail: "Naming your organization, location and partners helps engines resolve who/what this page is about." }
  );

  // --- performance (linker: scorePageSpeed + fetcher timing)
  const sizeKB = page.bytes / 1024;
  if (page.truncated || sizeKB > 1024)
    findings.push({ id: "perf-size", severity: "medium", title: `Heavy HTML (${Math.round(sizeKB)} KB${page.truncated ? "+, truncated" : ""})`, detail: "Over 1 MB of HTML is a slow-parse, slow-delivery page; crawlers may time out mid-document.", fix: "Ship under ~300 KB; move data out of the document." });
  else if (sizeKB > 300)
    findings.push({ id: "perf-size", severity: "low", title: `Large HTML (${Math.round(sizeKB)} KB)`, detail: "Above ~300 KB the HTML alone costs a measurable chunk of mobile load time.", fix: "Trim markup; lazy-render below-the-fold sections." });
  else
    findings.push({ id: "perf-size", severity: "pass", title: `Lean HTML (${Math.round(sizeKB)} KB)`, detail: "Document size is in the fast band." });

  if (page.ttfbMs)
    findings.push(
      page.ttfbMs < 800
        ? { id: "perf-ttfb", severity: "pass", title: `Fast TTFB (${page.ttfbMs} ms)`, detail: "Server response starts quickly." }
        : page.ttfbMs < 2000
          ? { id: "perf-ttfb", severity: "low", title: `Slow TTFB (${page.ttfbMs} ms)`, detail: "Above ~0.8 s of server think-time delays every downstream resource.", fix: "Cache aggressively at the edge; profile origin time." }
          : { id: "perf-ttfb", severity: "medium", title: `Very slow TTFB (${page.ttfbMs} ms)`, detail: "Multi-second response start — users and crawlers may abandon the request.", fix: "Add CDN caching / static rendering." }
    );

  if (imgs.length > 15)
    findings.push({ id: "perf-imgs", severity: "medium", title: `${imgs.length} <img> elements`, detail: "Large inline image counts multiply request overhead — and few users scroll to all of them.", fix: "Lazy-load, paginate or sprite galleries." });
  else if (imgs.length > 5)
    findings.push({ id: "perf-imgs", severity: "low", title: `${imgs.length} <img> elements`, detail: "Moderate image load; below-the-fold ones should lazy-load.", fix: 'Add loading="lazy" to non-critical images.' });
  else
    findings.push({ id: "perf-imgs", severity: "pass", title: `${imgs.length} image(s) — light`, detail: "Small request count." });

  if (imgs.length >= 3 && !/loading\s*=\s*["']lazy["']/i.test(html))
    findings.push({ id: "perf-lazy", severity: "low", title: "No lazy-loaded images", detail: 'None of the images use loading="lazy"; offscreen pixels still compete for bandwidth.', fix: 'Add loading="lazy" to below-the-fold images.' });

  const head = (/<head[\s\S]{0,20000}?<\/head>/i.exec(html) ?? [""])[0];
  const headScripts = (head.match(/<script\b[^>]{0,400}\bsrc\s*=\s*["'][^"']+["'][^>]{0,400}>/gi) ?? []).filter((t) => !/\b(?:defer|async)\b/i.test(t));
  if (headScripts.length > 3)
    findings.push({ id: "perf-blocking", severity: "medium", title: `${headScripts.length} render-blocking scripts`, detail: "Synchronous <script src> in <head> stalls first paint until each downloads and executes.", fix: "Add defer/async or move scripts to the end of body." });
  else if (headScripts.length)
    findings.push({ id: "perf-blocking", severity: "low", title: `${headScripts.length} render-blocking script(s)`, detail: "A small blocking chain; defer would shave first-paint time.", fix: "Prefer defer/async." });

  const enc = (page.headers["content-encoding"] ?? "").toLowerCase();
  if (enc)
    findings.push({ id: "perf-compression", severity: "pass", title: `Compressed (${enc})`, detail: "Body ships with wire compression." });
  else if (page.bytes > 51_200)
    findings.push({ id: "perf-compression", severity: "low", title: "Response not compressed", detail: "No content-encoding on a sizeable HTML payload — bytes ship uncompressed.", fix: "Enable gzip/brotli at the edge." });

  // --- crawl layer: robots.txt / sitemap / llms.txt
  progress(1, 0.3, "robots / sitemap / llms.txt");
  const aux = async (path: string, cap = 262_144) => {
    try {
      return await guardedGet(`${finalOrigin}${path}`, { bodyCap: cap });
    } catch {
      return null;
    }
  };
  const [robots, sitemapDirect, llms] = await Promise.all([aux("/robots.txt"), aux("/sitemap.xml"), aux("/llms.txt")]);
  progress(1, 1);

  if (robots && robots.status < 400) {
    const policy = robotsPolicy(robots.body);
    if (policy.siteBlocked) {
      findings.push({ id: "geo-robots", severity: "critical", title: "robots.txt blocks everything", detail: 'A "User-agent: * / Disallow: /" rule keeps out search engines AND every AI crawler — the site is invisible by policy.', fix: "Allow public paths at minimum." });
    } else {
      findings.push({ id: "geo-robots", severity: "pass", title: "robots.txt reachable, site open", detail: `No wildcard block. Explicit AI-crawler rules: ${policy.blocked.length ? policy.blocked.map((b) => b.split(" (")[0]).join(", ") : "none — all known crawlers fall back to the open default."}` });
      if (policy.blocked.length) {
        findings.push({ id: "geo-ai-blocked", severity: "info", title: `${policy.blocked.length} AI crawler(s) explicitly blocked`, detail: policy.blocked.join("; "), fix: "If this is intentional (e.g. training-only blocks), keep search/answer bots allowed separately." });
      }
    }
    if (policy.sitemapLine) findings.push({ id: "seo-sitemap", severity: "pass", title: "Sitemap declared in robots.txt", detail: policy.sitemapLine.slice(0, 140) });
  } else {
    inconclusive.push({ id: "geo-robots-file", what: "robots.txt", why: robots ? `HTTP ${robots.status}` : "unreachable" });
  }

  const sitemapUrl = robots && robots.status < 400 ? null : null; // sitemapLine handled above
  void sitemapUrl;
  if (!findings.some((f) => f.id === "seo-sitemap")) {
    if (sitemapDirect && sitemapDirect.status < 400 && /<urlset|<sitemapindex/i.test(sitemapDirect.body)) {
      const locs = (sitemapDirect.body.match(/<loc>/gi) ?? []).length;
      findings.push({ id: "seo-sitemap", severity: "pass", title: `sitemap.xml live (${locs} URLs)`, detail: "Discovery aid for crawlers that skip robots.txt hints." });
    } else {
      findings.push({ id: "seo-sitemap", severity: "low", title: "No sitemap.xml found", detail: "Crawlers can still find pages via links, but a sitemap speeds up discovery of new URLs.", fix: "Publish /sitemap.xml and reference it from robots.txt." });
    }
  }

  if (llms && llms.status < 400 && llms.body.trim()) {
    findings.push({ id: "geo-llms", severity: "pass", title: "llms.txt present", detail: "The emerging GEO convention for pointing LLMs at curated content.", evidence: llms.body.slice(0, 160) });
  } else {
    findings.push({ id: "geo-llms", severity: "low", title: "No llms.txt (yet)", detail: "An emerging convention (llmstxt.org): a curated markdown index of your site for LLMs. Cheap to add, no downside.", fix: "Publish a short /llms.txt linking your canonical docs/pages." });
  }

  if (!/llms\.txt/i.test(html))
    findings.push({ id: "geo-llms-ref", severity: "info", title: "No llms.txt reference in HTML", detail: "Linking /llms.txt from the page helps AI agents discover it." });

  progress(2, 0.4, "scoring");
  tag(findings, "presence"); // every geoseo finding reflects the fetched response
  const dedup = dedupeFindings(findings);
  const passFindings = dedup.findings.filter((f) => f.severity === "pass");
  const highCount = dedup.findings.filter((f) => f.severity === "critical" || f.severity === "high").length;
  const summary = `${highCount} high-impact issue(s), ${dedup.findings.length - passFindings.length} actionable in total, across on-page SEO, GEO readiness and performance.`;

  const breakdown = [
    { label: "SEO on-page", ids: ["geo-status", "seo-title", "seo-desc", "seo-canonical", "seo-viewport", "seo-lang", "seo-robots-meta", "seo-h1", "seo-h2", "seo-alt", "seo-og", "seo-links", "seo-keywords"] },
    { label: "Content & clarity", ids: ["geo-words", "geo-clarity", "geo-airead"] },
    { label: "GEO readiness", ids: ["geo-jsonld", "geo-robots", "geo-llms", "geo-authority", "geo-citation", "geo-entity", "seo-sitemap"] },
    { label: "Performance", ids: ["perf-size", "perf-ttfb", "perf-imgs", "perf-lazy", "perf-blocking", "perf-compression"] },
  ]
    .map((p) => ({ label: p.label, score: pillarScore(p.ids, dedup.findings) }))
    .filter((p): p is { label: string; score: number } => p.score !== null);

  const { score, grade } = scoreFindings(dedup.findings);
  return {
    scanner: "geo-seo",
    target,
    finalUrl: page.finalUrl,
    durationMs: Date.now() - started,
    cached: false,
    scannedAt: new Date().toISOString(),
    score,
    grade,
    summary,
    breakdown,
    positives: passFindings.slice(0, 6).map((f) => f.title),
    findings: dedup.findings,
    inconclusive: inconclusive.length ? inconclusive : undefined,
    verification: verificationBlock(dedup.findings, dedup.deduped, { tokenUsed: false }),
  };
}
