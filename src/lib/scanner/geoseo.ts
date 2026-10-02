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

export async function runGeoSeoScan(rawUrl: string): Promise<UrlScanReport> {
  const started = Date.now();
  const target = plausibleTarget(rawUrl);
  if (!target) throw new ScanError("bad-url", "Give a public URL like example.com.");
  const origin = new URL(target).origin;

  const findings: Finding[] = [];
  const inconclusive: Inconclusive[] = [];

  const page = await guardedGet(target, { bodyCap: 2_000_000 });
  const html = page.body;
  const finalOrigin = new URL(page.finalUrl).origin;

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

  // --- crawl layer: robots.txt / sitemap / llms.txt
  const aux = async (path: string, cap = 262_144) => {
    try {
      return await guardedGet(`${finalOrigin}${path}`, { bodyCap: cap });
    } catch {
      return null;
    }
  };
  const [robots, sitemapDirect, llms] = await Promise.all([aux("/robots.txt"), aux("/sitemap.xml"), aux("/llms.txt")]);

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

  const { score, grade } = scoreFindings(findings);
  return {
    scanner: "geo-seo",
    target,
    finalUrl: page.finalUrl,
    durationMs: Date.now() - started,
    cached: false,
    scannedAt: new Date().toISOString(),
    score,
    grade,
    findings,
    inconclusive: inconclusive.length ? inconclusive : undefined,
  };
}
