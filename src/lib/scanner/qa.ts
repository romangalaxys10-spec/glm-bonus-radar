/**
 * zScanner — QA Audit (URL reliability & robustness scanner).
 *
 * Methodology adapted from fable (romangalaxys10-spec/fable, MIT): phase
 * structured checks (health → links → robustness), a 404-baseline so
 * soft-404 sites don't produce false "dead link" positives, stable finding
 * UIDs (sha1(id|evidence)[:12], fable secmonitor style), and the
 * ok / needs-review / blocked verdict model from its harness gate.
 *
 * Parsing stays dependency-free: linear-time bounded regexes over a 2 MB
 * capped body (deploy-reliability policy, no ReDoS path).
 */

import { guardedGet, plausibleTarget, ScanError } from "./fetcher";
import { type Finding, type Inconclusive, type UrlScanReport, scoreFindings, stableUid } from "./types";
import { dedupeFindings, tag, verificationBlock } from "./verify";

const MAX_LINK_PROBES = 12;
const PROBE_CAP = 8_192;

export async function runQaScan(
  rawUrl: string,
  progress: (i: number, f: number, note?: string) => void = () => {}
): Promise<UrlScanReport> {
  const started = Date.now();
  const target = plausibleTarget(rawUrl);
  if (!target) throw new ScanError("bad-url", "Give a public URL like example.com.");

  const findings: Finding[] = [];
  const inconclusive: Inconclusive[] = [];
  progress(0, 0.35, "resolving & fetching");

  const page = await guardedGet(target, { bodyCap: 2_000_000 });
  const html = page.body;
  const finalOrigin = new URL(page.finalUrl).origin;
  const https = page.finalUrl.startsWith("https://");
  progress(0, 1);

  /* ---------- P0: basic health ---------- */

  if (page.status >= 200 && page.status < 400) {
    findings.push({ id: "qa-status", severity: "pass", title: `Serves 2xx/3xx (HTTP ${page.status})`, detail: `${page.finalUrl}${page.hops ? ` · ${page.hops} redirect(s)` : ""}` });
  } else if (page.status >= 500) {
    findings.push({ id: "qa-status", severity: "critical", title: `Server error (HTTP ${page.status})`, detail: "A 5xx home page means the service is failing for every visitor and crawler right now.", fix: "Restore availability before any other QA work." });
  } else {
    findings.push({ id: "qa-status", severity: "high", title: `Client error (HTTP ${page.status})`, detail: "The page answers with a 4xx — users and crawlers hit a wall.", fix: "Fix the routing/permission problem." });
  }

  if (page.ttfbMs) {
    if (page.ttfbMs >= 2000)
      findings.push({ id: "qa-ttfb", severity: "medium", title: `Slow response (${page.ttfbMs} ms TTFB)`, detail: "Multi-second time-to-first-byte reads as flaky to users and monitoring.", fix: "Cache at the edge; profile origin latency." });
    else if (page.ttfbMs >= 800)
      findings.push({ id: "qa-ttfb", severity: "low", title: `Elevated TTFB (${page.ttfbMs} ms)`, detail: "Response start above ~0.8 s; fine for a blog, risky for interactive flows." });
    else findings.push({ id: "qa-ttfb", severity: "pass", title: `Responsive origin (${page.ttfbMs} ms TTFB)`, detail: "" });
  }

  if (!/<!doctype\s+html/i.test(html.slice(0, 512)))
    findings.push({ id: "qa-doctype", severity: "low", title: "No HTML doctype", detail: "Without <!doctype html> browsers fall back to quirks mode and render inconsistently.", fix: 'Start the document with <!doctype html>.' });
  else findings.push({ id: "qa-doctype", severity: "pass", title: "Doctype declared", detail: "" });

  const charset = /<meta\b[^>]{0,400}charset\s*=\s*["']?([\w-]{3,20})/i.exec(html)?.[1] ?? (/charset=([\w-]{3,20})/i.exec(page.headers["content-type"] ?? "")?.[1] ?? null);
  if (charset)
    findings.push({ id: "qa-charset", severity: "pass", title: `Charset declared (${charset.toLowerCase()})`, detail: "Encoding is explicit — no mojibake roulette." });
  else
    findings.push({ id: "qa-charset", severity: "low", title: "No charset declaration", detail: "Without an explicit encoding, multi-language text can render garbled.", fix: 'Add <meta charset="utf-8">.' });

  if (!/<html\b[^>]{0,400}\blang\s*=/i.test(html))
    findings.push({ id: "qa-lang", severity: "low", title: "No lang attribute", detail: "Screen readers and translation tools need <html lang> to pick the right voice.", fix: '<html lang="en">' });
  else findings.push({ id: "qa-lang", severity: "pass", title: "Language declared", detail: "" });

  const hasFaviconTag = /<link\b[^>]{0,400}rel\s*=\s*["'][^"']*icon[^"']*["'][^>]{0,400}>/i.test(html);
  findings.push(
    hasFaviconTag
      ? { id: "qa-favicon", severity: "pass", title: "Favicon declared", detail: "" }
      : { id: "qa-favicon", severity: "info", title: "No favicon link tag", detail: "Browsers will still try /favicon.ico; a declared icon keeps tabs/bookmarks recognizable." }
  );

  /* ---------- 404 baseline (fable: soft-404 aware probing) ---------- */

  progress(1, 0.2, "probing links");
  let soft404 = false;
  try {
    const probePath = `/zscan-probe-${Math.random().toString(36).slice(2, 10)}`;
    const probe = await guardedGet(`${finalOrigin}${probePath}`, { bodyCap: PROBE_CAP });
    if (probe.status >= 200 && probe.status < 300) {
      soft404 = true;
      findings.push({ id: "qa-soft404", severity: "low", title: "Missing pages answer 200", detail: `A random path (${probePath}) returned HTTP ${probe.status} — the site has no real 404, which hides broken links from tools and users.`, fix: "Return 404 for unknown routes." });
    }
  } catch {
    // baseline probe failure must not fail the scan
  }
  progress(1, 0.45, "checking internal links");

  /* ---------- P1: internal links ---------- */

  const hrefs = [...html.matchAll(/<a\b[^>]{0,400}?href\s*=\s*["']([^"'#\s]{1,300})["']/gi)]
    .map((m) => m[1])
    .filter((h) => {
      try {
        const u = new URL(h, page.finalUrl);
        return u.origin === finalOrigin && /^https?:$/.test(u.protocol);
      } catch {
        return false;
      }
    });
  const unique = [...new Set(hrefs)].slice(0, MAX_LINK_PROBES);

  if (unique.length) {
    const results = await Promise.all(
      unique.map(async (h) => {
        try {
          const abs = new URL(h, page.finalUrl).toString();
          const r = await guardedGet(abs, { bodyCap: PROBE_CAP });
          return { href: h, status: r.status };
        } catch {
          return { href: h, status: -1 };
        }
      })
    );
    const dead = results.filter((r) => r.status >= 500);
    const missing = soft404 ? [] : results.filter((r) => r.status === 404 || r.status === 410);
    const broken = [...dead, ...missing];
    if (broken.length) {
      const ev = broken.slice(0, 3).map((b) => `${b.href} → ${b.status === -1 ? "unreachable" : b.status}`).join("; ");
      const f: Finding = {
        id: "qa-dead-links",
        severity: dead.length ? "medium" : "low",
        title: `${broken.length} broken internal link(s) of ${results.length} checked`,
        detail: "Dead links waste crawl budget, leak PageRank and read as neglect to users.",
        fix: "Fix or 301 the dead URLs.",
        evidence: ev,
      };
      findings.push({ ...f, evidence: `${f.evidence} · uid ${stableUid(f.id, ev)}` });
    } else {
      findings.push({ id: "qa-dead-links", severity: "pass", title: `Internal links healthy (${results.length} checked)`, detail: "No 4xx/5xx among sampled internal links." });
    }
  } else {
    findings.push({ id: "qa-dead-links", severity: "info", title: "No internal links to check", detail: "The page links nowhere internally — QA sampled nothing." });
  }
  progress(1, 1);

  /* ---------- P2: robustness ---------- */

  progress(2, 0.3, "robustness checks");
  if (https) {
    const mixed = /(?:src|href)\s*=\s*["']http:\/\/(?!localhost)/i.exec(html);
    if (mixed)
      findings.push({ id: "qa-mixed", severity: "medium", title: "Insecure http:// references", detail: "An HTTPS page loading http:// assets breaks the lock icon and can be rewritten in transit.", evidence: mixed[0].slice(0, 80), fix: "Serve every asset over https://." });
  }

  const trace = /(?:Traceback \(most recent call last\)|at .+ \(?.+:\d+:\d+\)?|Exception in thread|ORA-\d{5}|SQLSTATE\[\w+\])/i.exec(html);
  if (trace)
    findings.push({ id: "qa-stack-leak", severity: "medium", title: "Stack-trace-like content served", detail: "The page body contains what looks like a stack trace or DB error code — internal detail disclosure helps attackers and looks broken to users.", evidence: trace[0].slice(0, 120), fix: "Return generic error pages; log details server-side only." });

  const deprecated = (html.match(/<(?:marquee|center|font|frame|frameset|big|blink)\b/gi) ?? []).length;
  if (deprecated)
    findings.push({ id: "qa-deprecated", severity: "info", title: `${deprecated} deprecated tag(s)`, detail: "Legacy presentational tags (marquee/center/font/frame…) render inconsistently and block modern parsing.", fix: "Replace with CSS equivalents." });

  const inlineHandlers = (html.match(/\son(?:click|load|error|mouseover|submit)\s*=\s*["']/gi) ?? []).length;
  if (inlineHandlers >= 10)
    findings.push({ id: "qa-inline-handlers", severity: "info", title: `${inlineHandlers} inline event handlers`, detail: "Heavy inline JS wiring resists CSP hardening and complicates maintenance.", fix: "Move handlers into external scripts." });

  if (page.truncated)
    inconclusive.push({ id: "qa-body-truncated", what: "Full-document checks", why: "Body exceeded the 2 MB scan cap; later content was not inspected." });

  progress(2, 0.8, "scoring");

  tag(findings, "presence", (f) =>
    f.severity !== "pass" && /qa-dead-links|qa-soft404/.test(f.id) ? "confirmed" : undefined
  ); // dead links were actively probed — the rest reflects the observed response

  /* ---------- verdict (fable harness model) ---------- */

  const dedup = dedupeFindings(findings);
  const critical = dedup.findings.filter((f) => f.severity === "critical").length;
  const high = dedup.findings.filter((f) => f.severity === "high").length;
  const medium = dedup.findings.filter((f) => f.severity === "medium").length;
  const verdict: "ok" | "needs-review" | "blocked" = critical ? "blocked" : high + medium >= 1 ? "needs-review" : "ok";
  const passFindings = dedup.findings.filter((f) => f.severity === "pass");
  const summary =
    verdict === "blocked"
      ? "Critical reliability failure detected — treat as an outage, not a QA note."
      : verdict === "needs-review"
        ? `${medium} medium and ${high} high issue(s) worth a review pass; nothing site-down.`
        : "Basic health, links and robustness checks all came back clean.";

  const { score, grade } = scoreFindings(dedup.findings);
  return {
    scanner: "qa",
    target,
    finalUrl: page.finalUrl,
    durationMs: Date.now() - started,
    cached: false,
    scannedAt: new Date().toISOString(),
    score,
    grade,
    verdict,
    summary,
    positives: passFindings.slice(0, 6).map((f) => f.title),
    findings: dedup.findings,
    inconclusive: inconclusive.length ? inconclusive : undefined,
    verification: verificationBlock(dedup.findings, dedup.deduped, { tokenUsed: false }),
  };
}
