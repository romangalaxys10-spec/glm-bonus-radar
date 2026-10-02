/**
 * zScanner auto-QA auditor (v5) — real-browser end-to-end testing.
 *
 * Doctrine (petrkindlmann/qa-skills, adapted to a deterministic engine):
 *  - discovery questions BEFORE the run (logins, priority flows) and mid-run
 *    questions when the run hits ambiguity (answer mailbox in jobs.ts);
 *  - explicit oracles: every check asserts a specific observable state —
 *    "no error" is never the oracle (agentic-browser-testing §oracle);
 *  - accessibility-first: axe-core injected into the real DOM, WCAG-mapped;
 *  - no waitForTimeout: playwright auto-waiting + networkidle settles;
 *  - time-boxed run budget (work time only — user question time excluded);
 *  - findings carry evidence (URL, selector, count, console line), lead
 *    items are never scored (CF doctrine), creds never leave session memory.
 */

import { guardedGet, ScanError, type FetchedPage } from "./fetcher";
import { analyzeSecurityHeaders } from "./security";
import { axeSource, newQaContext, preflightQaTarget, withQaBrowser, wirePageLogging, type QaPageLog } from "./browser";
import { countStatuses, dedupeFindings, tag, VERIFY_POLICY } from "./verify";
import { scoreFindings, type Finding, type Inconclusive, type ScanLead, type UrlScanReport } from "./types";
import type { JobQuestion, ProgressFn } from "./jobs";

export type QaAnswers = {
  useLogin: boolean;
  username: string;
  password: string;
  /** Optional explicit selectors (advanced): "user=#u pass=#p submit=#s". */
  loginSelectors: string;
  /** Priority flows, one per line: "check: <text>" or "goto: <url>". */
  flows: string;
  notes: string;
};

export type AskFn = (q: JobQuestion) => Promise<{ answerId: string; value: string } | null>;

const WORK_BUDGET_MS = 110_000;
const PAGE_TIMEOUT_MS = 20_000;
const CRAWL_BROWSER_PAGES = 4;
const LINK_PROBE_CAP = 30;
const AXE_PAGES = 3;

type Ctx = {
  target: string;
  allowPrivate: boolean;
  answers: QaAnswers;
  ask: AskFn;
  progress: ProgressFn;
  startedAt: number;
  questionMs: number;
  findings: Finding[];
  leads: ScanLead[];
  inconclusive: Inconclusive[];
  positives: string[];
  metrics: { label: string; value: string }[];
  browsed: { url: string; title: string; status: number }[];
};

function left(ctx: Ctx): number {
  return WORK_BUDGET_MS - (Date.now() - ctx.startedAt - ctx.questionMs);
}

async function timedAsk(ctx: Ctx, q: JobQuestion): Promise<{ answerId: string; value: string } | null> {
  const t0 = Date.now();
  try {
    return await ctx.ask(q);
  } finally {
    ctx.questionMs += Date.now() - t0; // user time — not counted against the budget
  }
}

/** HTTP probe: fetcher guards for public targets, light fetch for operator-local. */
async function probePage(ctx: Ctx, url: string, bodyCap = 300_000): Promise<FetchedPage> {
  if (!ctx.allowPrivate) return guardedGet(url, { bodyCap });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: abort.signal, redirect: "follow", headers: { "user-agent": "zScannerQA/1.0 (+https://zhelp.space-z.ai/scanner)" } });
    const text = (await res.text()).slice(0, bodyCap);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    return { finalUrl: res.url || url, status: res.status, headers, body: text, bytes: text.length, truncated: false, hops: 0, ttfbMs: 0 };
  } catch {
    throw new ScanError("fetch-failure", `Target could not be reached: ${url}`);
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- on-page checks (DOM facts -> findings) ---------------- */

type PageFacts = {
  title: string;
  hasMetaDesc: boolean;
  metaDescLen: number;
  h1Count: number;
  lang: string;
  hasViewport: boolean;
  ogTitle: boolean;
  imgsTotal: number;
  imgsNoAlt: number;
  altExamples: string[];
  mixedContent: string[];
  linkHrefs: string[];
  flowMissing: string[];
};

async function collectFacts(page: import("playwright-core").Page, flows: string[], url: string): Promise<PageFacts> {
  return page.evaluate((flows: string[]) => {
    const abs = (h: string | null) => {
      if (!h) return "";
      try {
        return new URL(h, location.href).toString();
      } catch {
        return "";
      }
    };
    const imgs = [...document.querySelectorAll("img")];
    const noAlt = imgs.filter((i) => !(i.getAttribute("alt") ?? "").trim());
    const mixed = location.protocol === "https:" ? [...document.querySelectorAll('script[src^="http:"], link[href^="http:"], img[src^="http:"], iframe[src^="http:"]')].map((e) => (e as HTMLScriptElement).src || (e as HTMLLinkElement).href).filter(Boolean) : [];
    const flowMissing = flows
      .filter((f) => f.startsWith("check:"))
      .map((f) => f.slice(6).trim())
      .filter((t) => t && !document.body.innerText.toLowerCase().includes(t.toLowerCase()));
    const links = [...document.querySelectorAll("a[href]")]
      .map((a) => abs(a.getAttribute("href")))
      .filter((h) => h && /^https?:/.test(h));
    const metaDesc = document.querySelector('meta[name="description" i]');
    return {
      title: document.title || "",
      hasMetaDesc: !!metaDesc && (metaDesc.getAttribute("content") ?? "").trim().length > 0,
      metaDescLen: (metaDesc?.getAttribute("content") ?? "").trim().length,
      h1Count: document.querySelectorAll("h1").length,
      lang: document.documentElement.getAttribute("lang") ?? "",
      hasViewport: !!document.querySelector('meta[name="viewport" i]'),
      ogTitle: !!document.querySelector('meta[property="og:title" i]'),
      imgsTotal: imgs.length,
      imgsNoAlt: noAlt.length,
      altExamples: noAlt.slice(0, 3).map((i) => (i.getAttribute("src") || "").slice(0, 120)),
      mixedContent: [...new Set(mixed)].slice(0, 5).map((s) => s.slice(0, 160)),
      linkHrefs: [...new Set(links)],
      flowMissing,
    };
  }, flows);
}

function factsToFindings(ctx: Ctx, url: string, f: PageFacts): void {
  const add = (id: string, severity: Finding["severity"], title: string, detail: string, evidence: string, fix?: string) =>
    ctx.findings.push({ id, severity, title, detail, fix, evidence: `${url}\n${evidence}`.slice(0, 400), confidence: "presence" });

  if (!f.title.trim()) add("autoqa-missing-title", "medium", "Page has no <title>", "The document title is empty — it is the first thing users and search engines see in tabs, history and results.", "document.title === \"\"", "Set a unique, descriptive <title> (50–60 chars) per page.");
  if (f.h1Count === 0) add("autoqa-missing-h1", "medium", "Page has no <h1> heading", "Screen readers and crawlers use the H1 as the page's primary topic anchor; without it the document outline starts nowhere.", "h1 count = 0", "Add exactly one <h1> that names the page.");
  if (f.h1Count > 1) add("autoqa-multiple-h1", "low", `Multiple <h1> headings (${f.h1Count})`, "Several H1s dilute the document outline; most pages should have exactly one.", `h1 count = ${f.h1Count}`, "Demote the extra H1s to h2/h3.");
  if (!f.lang) add("autoqa-missing-lang", "medium", "No lang attribute on <html>", "Assistive tech cannot pick the right pronunciation rules; WCAG 3.1.1 requires a programmatic language.", "<html> has no lang", 'Add lang="en" (or the actual language) to the <html> element.');
  if (!f.hasViewport) add("autoqa-missing-viewport", "medium", "No viewport meta tag", "Without the viewport meta tag mobile browsers render at a desktop width and zoom out — the classic non-responsive page.", "meta[name=viewport] missing", 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
  if (!f.hasMetaDesc) add("autoqa-missing-meta-desc", "low", "No meta description", "Search results fall back to random page text when the description is missing.", "meta[name=description] missing/empty", "Write a 120–160 character description summarizing the page.");
  if (f.imgsNoAlt > 0)
    add("autoqa-img-missing-alt", "medium", `${f.imgsNoAlt} image(s) missing alt text`, "Screen-reader users hear the file name instead of the meaning; WCAG 1.1.1 failure. Decorative images still need alt=\"\".", `total imgs ${f.imgsTotal}; examples: ${f.altExamples.join(" | ") || "n/a"}`, "Add meaningful alt attributes (or alt=\"\" for decorative images).");
  if (f.mixedContent.length)
    add("autoqa-mixed-content", "high", "Mixed content: http:// assets on an https page", "Browsers block or downgrade these requests — scripts/styles break, and users see the \"Not secure\" padlock.", f.mixedContent.join("\n"), "Serve every asset over https and add an upgrade-insecure-requests CSP directive.");
  for (const t of f.flowMissing)
    add("autoqa-flow-check", "medium", `Requested check text not found: "${t.slice(0, 60)}"`, "You asked the auditor to verify this text is present on the page — it is not (case-insensitive match of visible text).", `url: ${url}`, "If the text should be there, fix the render; if the flow changed, update the check.");
}

/* ---------------- axe (a11y) ---------------- */

function axeViolationsToFindings(ctx: Ctx, url: string, raw: string): void {
  let parsed: { violations?: { id: string; impact: string | null; title?: string; help?: string; nodes: { target: string[]; failureSummary?: string }[] }[]; passes?: unknown[] } | null = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    ctx.inconclusive.push({ id: "autoqa-axe-parse", what: "accessibility scan", why: "axe returned unparseable output" });
    return;
  }
  const sev: Record<string, Finding["severity"]> = { critical: "critical", serious: "high", moderate: "medium", minor: "low" };
  let count = 0;
  for (const v of parsed?.violations ?? []) {
    if (count >= 20) break;
    const nodes = v.nodes.slice(0, 3);
    const evidence = `${url}\nrule: ${v.id}${v.impact ? ` (${v.impact})` : ""}\ntargets: ${nodes.map((n) => n.target.join(" ")).join(" | ").slice(0, 220)}${nodes[0]?.failureSummary ? `\n${nodes[0].failureSummary.slice(0, 220)}` : ""}`;
    ctx.findings.push({
      id: `autoqa-axe-${v.id}`,
      severity: sev[v.impact ?? ""] ?? "low",
      title: `A11y: ${v.help ?? v.id}`,
      detail: `axe-core rule "${v.id}" (${v.impact ?? "unknown"} impact) failed on ${v.nodes.length} element(s). ${v.help ?? ""}`.trim(),
      fix: "Fix the semantics — use the native element or the correct ARIA state; do not suppress the rule.",
      evidence: evidence.slice(0, 400),
      confidence: "confirmed",
    });
    count += v.nodes.length;
  }
  if (count === 0 && parsed?.violations) ctx.positives.push("axe-core: zero WCAG violations on audited pages");
}

/* ---------------- login flow ---------------- */

async function attemptLogin(
  ctx: Ctx,
  page: import("playwright-core").Page,
  creds: { username: string; password: string; selectors?: string }
): Promise<"success" | "failed" | "uncertain" | "no-form"> {
  const parsed: { user?: string; pass?: string; submit?: string; goto?: string } = {};
  for (const m of (creds.selectors ?? "").matchAll(/(user|pass|submit|goto)\s*[:=]\s*(\S+)/gi)) {
    parsed[m[1].toLowerCase() as "user"] = m[2];
  }
  if (parsed.goto) {
    await page.goto(parsed.goto, { timeout: PAGE_TIMEOUT_MS, waitUntil: "domcontentloaded" }).catch(() => {});
  }
  const form = await page.evaluate(() => {
    const uniq = (el: Element | null): string | null => {
      if (!el) return null;
      if (el.id) return `#${CSS.escape(el.id)}`;
      const name = el.getAttribute("name");
      if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
      return null;
    };
    const forms = [...document.querySelectorAll("form")];
    for (const f of forms) {
      const pw = f.querySelector('input[type="password"]');
      if (!pw) continue;
      const user = f.querySelector('input[type="email"], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[name*="account" i], input[type="text" i]');
      const btn = f.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      return { user: uniq(user as Element), pass: uniq(pw), submit: uniq(btn), goto: null };
    }
    const pw = document.querySelector('input[type="password"]');
    if (pw) return { user: uniq(pw.parentElement?.querySelector("input:not([type=password])") ?? null), pass: uniq(pw), submit: null, goto: null };
    return null;
  });
  if (!form) return "no-form";
  const userSel = parsed.user ?? form.user;
  const passSel = parsed.pass ?? form.pass;
  if (!passSel) return "no-form";
  const beforeUrl = page.url();
  const beforeCookies = (await page.context().cookies()).length;
  try {
    if (userSel && creds.username) await page.fill(userSel, creds.username, { timeout: 5000 });
    await page.fill(passSel, creds.password, { timeout: 5000 });
    if (parsed.submit ?? form.submit) await page.click(parsed.submit ?? form.submit!, { timeout: 5000 });
    else await page.press(passSel, "Enter", { timeout: 5000 });
  } catch {
    return "uncertain";
  }
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800); // settle SPA routing (auto-wait above covers most)
  const after = await page.evaluate(() => {
    const el = document.querySelector('[role="alert"], .error, .alert, [class*="error" i]');
    const selText = el ? (el.textContent ?? "").toLowerCase().slice(0, 160) : "";
    const bodyText = (document.body.innerText ?? "").toLowerCase().slice(0, 3000);
    return {
      url: location.href,
      pwLeft: !!document.querySelector('input[type="password"]'),
      logout: !!document.querySelector('a[href*="logout" i], a[href*="signout" i], [data-logout]'),
      err: selText,
      errishBody:
        /invalid credential|incorrect (username|password)|wrong password|login failed|authentication failed|sign[- ]?in failed|failed to (sign in|log in)/.test(bodyText),
    };
  });
  const errish = /invalid|incorrect|wrong|failed|try again/.test(after.err) || after.errishBody;
  const cookiesNow = (await page.context().cookies()).length;
  if (errish) return "failed";
  if (after.logout) return "success";
  // classic success: the form disappeared AND we navigated somewhere
  if (!after.pwLeft && (after.url !== beforeUrl || cookiesNow > beforeCookies)) return "success";
  // form still visible after submit — never trust a URL change alone
  // (many apps 200 the POST back into the same form); ask the user instead.
  if (after.pwLeft) return "uncertain";
  return after.url !== beforeUrl || cookiesNow > beforeCookies ? "success" : "uncertain";
}

/* ---------------- the scan ---------------- */

export async function runAutoQaScan(
  args: { target: string; answers: QaAnswers; ask: AskFn; allowPrivate: boolean },
  progress: ProgressFn
): Promise<UrlScanReport> {
  const started = Date.now();
  const ctx: Ctx = {
    target: args.target,
    allowPrivate: args.allowPrivate,
    answers: args.answers,
    ask: args.ask,
    progress,
    startedAt: Date.now(),
    questionMs: 0,
    findings: [],
    leads: [],
    inconclusive: [],
    positives: [],
    metrics: [],
    browsed: [],
  };
  const flows = args.answers.flows.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8);
  const gotoFlows = flows.filter((f) => f.startsWith("goto:")).map((f) => f.slice(5).trim()).filter(Boolean).slice(0, 2);

  /* stage 0 — HTTP probe + first browser load */
  progress(0, 0.1, "HTTP probe");
  let probe: FetchedPage | null = null;
  let soft404 = false;
  try {
    probe = await probePage(ctx, ctx.target, 400_000);
    try {
      const bl = await probePage(ctx, `${ctx.allowPrivate ? ctx.target.replace(/\/$/, "") : ctx.target.replace(/\/$/, "")}/zqa-${Math.random().toString(36).slice(2, 8)}`, 2_000);
      soft404 = bl.status === 200;
    } catch {
      /* baseline probe unreachable — the entry probe above is the authority */
    }
  } catch (e) {
    ctx.findings.push({
      id: "autoqa-entry-unreachable",
      severity: "critical",
      title: "Entry URL did not answer the HTTP probe",
      detail: `The auditor could not fetch ${ctx.target}: ${e instanceof Error ? e.message : "unknown error"}. Everything else was skipped.`,
      evidence: ctx.target,
      confidence: "confirmed",
    });
    const { score, grade } = scoreFindings(ctx.findings);
    return assemble(ctx, { score, grade, durationMs: Date.now() - started, aborted: true });
  }
  progress(0, 0.4, "security header baseline");

  /* headers-lite: reuse the security engine's header analysis on the probe */
  const headerResult = analyzeSecurityHeaders(probe.headers, probe.finalUrl, probe.body.slice(0, 20_000), probe.status);
  ctx.findings.push(...headerResult.findings.filter((f) => f.severity !== "pass").slice(0, 8));
  ctx.inconclusive.push(...headerResult.inconclusive.slice(0, 4));
  if (!ctx.findings.length) ctx.positives.push("security response headers");
  progress(0, 0.6, "launching browser");

  const logs: QaPageLog = { consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [], badResponses: [] };
  const browsedFacts: { url: string; facts: PageFacts }[] = [];
  let loginStatus: "skipped" | "success" | "failed" | "uncertain" | "no-form" = args.answers.useLogin ? "uncertain" : "skipped";
  let perf: Record<string, number> = {};
  let mobileOverflow: string[] = [];
  let axeAudited = 0;

  let runAborted = false;
  const outcome = await withQaBrowser(async (browser) => {
    const context = await newQaContext(browser);
    try {
      const page = await context.newPage();
      const pageLog = wirePageLogging(page);
      const merge = (l: QaPageLog) => {
        for (const k of ["consoleErrors", "consoleWarnings", "pageErrors", "failedRequests", "badResponses"] as const) (logs[k] as string[]).push(...l[k]);
      };
      // perf observers before navigation
      await page.addInitScript(() => {
        try {
          (window as unknown as { __lcp: number }).__lcp = 0;
          new PerformanceObserver((l) => {
            const es = l.getEntries();
            if (es.length) (window as unknown as { __lcp: number }).__lcp = es[es.length - 1].startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true } as PerformanceObserverInit);
        } catch {}
      });

      /* first load — the entry oracle */
      let entryOk = false;
      let entryStatus = 0;
      try {
        const resp = await page.goto(ctx.target, { timeout: PAGE_TIMEOUT_MS, waitUntil: "domcontentloaded" });
        entryStatus = resp?.status() ?? 0;
        entryOk = !!resp && resp.status() < 400;
        await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
        merge(pageLog);
        const challenge = /just a moment|attention required|ddos|captcha|verify you are human/i.test(await page.title());
        if (challenge) {
          const a = await timedAsk(ctx, {
            id: "challenge",
            prompt: `The entry page looks like a bot challenge ("${(await page.title()).slice(0, 60)}"). How should the auditor proceed?`,
            kind: "choice",
            hint: "continue: audit whatever is visible\nurl: <challenge-free URL to audit instead>\nskip: end the run here",
            timeoutSec: 240,
          });
          const v = (a?.value ?? "continue").trim().toLowerCase();
          if (v.startsWith("url:")) {
            const alt = v.slice(4).trim();
            if (/^https?:\/\//.test(alt) && (alt.includes(new URL(ctx.target).hostname) || ctx.allowPrivate)) {
              await page.goto(alt, { timeout: PAGE_TIMEOUT_MS, waitUntil: "domcontentloaded" });
              ctx.target = alt;
            }
          } else if (v.startsWith("skip")) {
            ctx.leads.push({ title: "Run ended on a bot challenge", why: "The entry page serves an anti-bot challenge; the audit stopped.", how: "Re-run with a challenge-free URL (a staging host or a test entry point)." });
            progress(1, 1, "challenge — stopping");
            runAborted = true;
            return { aborted: true };
          }
        }
      } catch (e) {
        merge(pageLog);
        ctx.findings.push({
          id: "autoqa-browser-load-failed",
          severity: "critical",
          title: "Browser could not load the page",
          detail: `Navigation failed or timed out after ${PAGE_TIMEOUT_MS / 1000}s: ${e instanceof Error ? e.message.split("\n")[0] : "unknown"}. The HTTP probe succeeded, so this is usually render-blocking JS, huge assets, or a crashed webview.`,
          evidence: ctx.target,
          confidence: "confirmed",
        });
      }
      progress(0, 1, `entry page ${entryOk ? "loaded" : "failed"}`);

      /* stage 1 — crawl & page checks */
      progress(1, 0.05, "collecting links");
      if (entryOk) {
        const facts = await collectFacts(page, flows, page.url());
        browsedFacts.push({ url: page.url(), facts });
        const origin = new URL(page.url()).origin;
        const sameOrigin = facts.linkHrefs.filter((h) => h.startsWith(origin) && !/#/.test(h) && !/\.(png|jpe?g|gif|svg|css|js|ico|zip|pdf|mp4|webm|woff2?)$/i.test(h));
        const candidates = [...new Set(sameOrigin)].filter((h) => h !== page.url()).slice(0, CRAWL_BROWSER_PAGES + gotoFlows.length);
        const toBrowse = [...candidates, ...gotoFlows].slice(0, CRAWL_BROWSER_PAGES + gotoFlows.length);
        let i = 0;
        for (const u of toBrowse) {
          if (left(ctx) < 12_000) {
            ctx.inconclusive.push({ id: "autoqa-crawl-budget", what: "full crawl", why: "run budget reached — remaining pages were probed by HTTP only" });
            break;
          }
          i++;
          progress(1, Math.min(0.95, i / (toBrowse.length + 1)), `browsing ${i}/${toBrowse.length}`);
          try {
            const r = await page.goto(u, { timeout: PAGE_TIMEOUT_MS, waitUntil: "domcontentloaded" });
            await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
            merge(pageLog);
            const ok = !!r && r.status() < 400;
            ctx.browsed.push({ url: u, title: await page.title().catch(() => ""), status: r?.status() ?? 0 });
            if (ok) browsedFacts.push({ url: page.url(), facts: await collectFacts(page, flows, page.url()) });
          } catch (e) {
            ctx.findings.push({
              id: "autoqa-page-load-failed",
              severity: "medium",
              title: `Page failed to load in the browser: ${u.slice(0, 100)}`,
              detail: `Navigation to a linked page failed: ${e instanceof Error ? e.message.split("\n")[0] : "unknown"}.`,
              evidence: u,
              confidence: "confirmed",
            });
          }
        }
        const allLinks = [...new Set(browsedFacts.flatMap((b) => b.facts.linkHrefs))].filter((h) => h.startsWith(origin));
        ctx.metrics.push({ label: "unique same-origin links", value: String(allLinks.length) });

        /* link probing (HTTP, cheap) */
        const probeTargets = allLinks.filter((h) => !browsedFacts.some((b) => b.url === h)).slice(0, LINK_PROBE_CAP);
        let broken = 0;
        let probed = 0;
        const batch = 6;
        for (let b = 0; b < probeTargets.length; b += batch) {
          if (left(ctx) < 10_000) break;
          const slice = probeTargets.slice(b, b + batch);
          probed += slice.length;
          progress(1, Math.min(0.99, (b + batch) / Math.max(probeTargets.length, batch)), `probing links ${Math.min(b + batch, probeTargets.length)}/${probeTargets.length}`);
          const results = await Promise.allSettled(slice.map((u) => probePage(ctx, u, 2_000)));
          results.forEach((r, idx) => {
            const u = slice[idx];
            if (r.status === "fulfilled" && r.value.status >= 400) {
              broken++;
              ctx.findings.push({
                id: "autoqa-broken-link",
                severity: r.value.status >= 500 ? "medium" : "medium",
                title: `Broken link (${r.value.status}): ${u.slice(0, 100)}`,
                detail: `Linked from a crawled page, this URL returns HTTP ${r.value.status}.`,
                evidence: u,
                fix: "Fix or remove the link; add a link checker to CI so it cannot regress.",
                confidence: "confirmed",
              });
            } else if (r.status === "rejected" && !(r.reason instanceof Error && r.reason.message?.includes("not a valid"))) {
              broken++;
              ctx.findings.push({
                id: "autoqa-broken-link",
                severity: "low",
                title: `Unreachable link: ${u.slice(0, 100)}`,
                detail: `The link could not be fetched: ${r.reason instanceof Error ? r.reason.message.slice(0, 120) : "error"}.`,
                evidence: u,
                confidence: "single-source",
              });
            }
          });
        }
        if (soft404)
          ctx.findings.push({
            id: "autoqa-soft404",
            severity: "high",
            title: "Soft-404: unknown paths return HTTP 200",
            detail: "The server answered 200 for a random path that cannot exist. That hides every routing bug from tools and users, and search engines index garbage.",
            evidence: `GET ${ctx.target.replace(/\/$/, "")}/zqa-<random> -> 200`,
            fix: "Return a real 404 status for unknown routes.",
            confidence: "confirmed",
          });
        else if (probed > 0) ctx.positives.push(`link check (${probed} links, 0 broken)`);
        ctx.metrics.push({ label: "links probed", value: `${probed} (${broken} broken)` });
      }
      progress(1, 1, "page checks done");

      /* on-page findings from collected facts */
      for (const { url, facts } of browsedFacts) factsToFindings(ctx, url, facts);
      const titles = browsedFacts.map((b) => b.facts.title).filter(Boolean);
      if (titles.length > new Set(titles).size)
        ctx.findings.push({
          id: "autoqa-duplicate-title",
          severity: "low",
          title: "Duplicate <title> across pages",
          detail: "Two crawled pages share the same title — users with many tabs and search engines cannot tell them apart.",
          evidence: [...new Set(titles.filter((t) => titles.indexOf(t) !== titles.lastIndexOf(t)))].slice(0, 3).join(" | "),
          confidence: "presence",
        });

      /* stage 2 — axe a11y on up to 3 pages */
      progress(2, 0.05, "injecting axe-core");
      const axeSrc = axeSource();
      const axePages = browsedFacts.slice(0, AXE_PAGES);
      for (let i = 0; i < axePages.length; i++) {
        if (left(ctx) < 15_000) {
          ctx.inconclusive.push({ id: "autoqa-axe-budget", what: "axe scan on remaining pages", why: "run budget reached" });
          break;
        }
        try {
          await page.goto(axePages[i].url, { timeout: PAGE_TIMEOUT_MS, waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
          await page.addScriptTag({ content: axeSrc });
          const raw = await page.evaluate(async () => {
            const w = window as unknown as { axe?: { run: (ctx: Document, opts?: Record<string, unknown>) => Promise<{ violations: unknown[] }> } };
            if (!w.axe) return "";
            const res = await w.axe.run(document, { resultTypes: ["violations"] });
            return JSON.stringify({ violations: res.violations });
          });
          if (raw) {
            axeViolationsToFindings(ctx, axePages[i].url, raw);
            axeAudited++;
          }
        } catch (e) {
          ctx.inconclusive.push({ id: "autoqa-axe-run", what: `axe on ${axePages[i].url.slice(0, 80)}`, why: e instanceof Error ? e.message.slice(0, 120) : "failed" });
        }
        progress(2, (i + 1) / (axePages.length + 1), `axe ${i + 1}/${axePages.length}`);
      }
      if (axeAudited) ctx.metrics.push({ label: "axe pages audited", value: String(axeAudited) });

      /* login flow — always attempted on the ENTRY page (that is where the form was detected) */
      if (args.answers.useLogin) {
        progress(2, 0.75, "login flow");
        try {
          await page.goto(ctx.target, { timeout: PAGE_TIMEOUT_MS, waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        } catch {
          /* entry re-load failed — discovery below will report no-form */
        }
        let creds = { username: args.answers.username, password: args.answers.password, selectors: args.answers.loginSelectors };
        let status: "skipped" | "success" | "failed" | "uncertain" | "no-form" = await attemptLogin(ctx, page, creds);
        if (status === "no-form") {
          const a = await timedAsk(ctx, {
            id: "login-form-missing",
            prompt: "I could not find a login form on the audited pages. Where is the login?",
            kind: "text",
            hint: "Answer with a direct login URL (goto: https://site/login) or 'skip' to continue unauthenticated.",
            timeoutSec: 240,
          });
          const v = (a?.value ?? "skip").trim();
          if (v.toLowerCase() !== "skip" && /^https?:\/\//.test(v.replace(/^goto:\s*/i, ""))) {
            creds = { ...creds, selectors: `${creds.selectors} goto:${v.replace(/^goto:\s*/i, "")}` };
            status = await attemptLogin(ctx, page, creds);
          } else status = "skipped";
        }
        if (status === "failed" || status === "uncertain") {
          const a = await timedAsk(ctx, {
            id: "login-retry",
            prompt: `Login attempt returned "${status}". How should the auditor continue?`,
            kind: "login",
            hint: "Answer 'continue' to audit unauthenticated, or provide corrected credentials as: user: <value> pass: <value>",
            timeoutSec: 240,
          });
          const v = (a?.value ?? "continue").trim();
          const m = /user\s*[:=]\s*(\S+)\s+pass\s*[:=]\s*(\S+)/i.exec(v);
          if (m) {
            creds = { ...creds, username: m[1], password: m[2], selectors: creds.selectors };
            status = await attemptLogin(ctx, page, creds);
          } else status = "failed";
        }
        loginStatus = status;
        if (status === "success") {
          ctx.positives.push("login oracle passed (session established)");
          // one authenticated page for reachability evidence
          const authed = await page.evaluate(() => location.href);
          ctx.browsed.push({ url: authed, title: await page.title().catch(() => ""), status: 200 });
          ctx.metrics.push({ label: "authenticated area", value: "reached (1 page)" });
        } else if (status === "failed")
          ctx.findings.push({
            id: "autoqa-login-failed",
            severity: "medium",
            title: "Login could not be completed with the provided test credentials",
            detail: "The oracle saw an error state (or no session change) after submitting the login form. Either the credentials are wrong/expired, the form has anti-bot defenses, or the flow is broken for real users too — verify manually.",
            evidence: `entry: ${ctx.target}`,
            fix: "Verify the test account works by hand; if the form is correct, check for missing CSRF/honeypot handling and provide explicit selectors next run (user=… pass=… submit=…).",
            confidence: "presence",
          });
        else if (status === "uncertain")
          ctx.leads.push({ title: "Login result unclear", why: "The form submitted but the page state gave no clear success/failure signal.", how: "Re-run with explicit selectors: user=<sel> pass=<sel> submit=<sel>." });
        ctx.metrics.push({ label: "login oracle", value: status });
      }
      progress(2, 1, "a11y & login done");

      /* stage 3 — responsive + performance */
      progress(3, 0.1, "mobile viewport check");
      if (left(ctx) > 15_000) {
        const mctx = await newQaContext(browser, { mobile: true });
        try {
          const mpage = await mctx.newPage();
          const targets = [ctx.target, ...browsedFacts.slice(1, 3).map((b) => b.url)];
          for (const u of targets) {
            try {
              await mpage.goto(u, { timeout: PAGE_TIMEOUT_MS, waitUntil: "domcontentloaded" });
              await mpage.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
              const over = await mpage.evaluate(() => {
                const doc = document.scrollingElement ?? document.documentElement;
                const overX = doc.scrollWidth - doc.clientWidth;
                if (overX <= 1) return null;
                const el = [...document.querySelectorAll("body *")].find((n) => {
                  const r = (n as HTMLElement).getBoundingClientRect();
                  return r.right > window.innerWidth + 2 && r.width > 24;
                });
                return { overX, culprit: el ? `${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 40)}` : "unknown" };
              });
              if (over) {
                mobileOverflow.push(`${u.slice(0, 80)} (+${over.overX}px, ${over.culprit})`);
              }
            } catch {
              /* mobile load failure — desktop evidence above already covers */
            }
          }
          if (mobileOverflow.length)
            ctx.findings.push({
              id: "autoqa-mobile-overflow",
              severity: "medium",
              title: "Horizontal overflow at 375px viewport",
              detail: "Content is wider than a phone viewport, forcing sideways scrolling — the most common mobile UX failure.",
              evidence: mobileOverflow.join("\n").slice(0, 400),
              fix: "Find the overflowing element (evidence names the culprit) and fix its width/min-width; check for fixed-width tables and images without max-width.",
              confidence: "confirmed",
            });
          else if (targets.length) ctx.positives.push("no horizontal overflow at 375px");
          await mpage.close();
        } finally {
          await mctx.close().catch(() => {});
        }
      }
      progress(3, 0.55, "collecting performance metrics");
      try {
        await page.goto(ctx.target, { timeout: PAGE_TIMEOUT_MS, waitUntil: "load" });
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        perf = await page.evaluate(() => {
          const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
          const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
          const lcp = (window as unknown as { __lcp?: number }).__lcp ?? 0;
          return {
            ttfb: Math.round(nav?.responseStart ?? 0),
            dcl: Math.round(nav?.domContentLoadedEventEnd ?? 0),
            load: Math.round(nav?.loadEventEnd ?? 0),
            lcp: Math.round(lcp),
            requests: res.length + 1,
            weightKb: Math.round(res.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024),
          };
        });
      } catch {
        ctx.inconclusive.push({ id: "autoqa-perf", what: "performance metrics", why: "second timed load failed" });
      }
      progress(3, 1, "responsive & perf done");
    } finally {
      await context.close().catch(() => {});
    }
    return { aborted: false };
  });
  runAborted = runAborted || !!outcome?.aborted;
  if (runAborted) {
    const { score, grade } = scoreFindings(ctx.findings);
    return assemble(ctx, { score, grade, durationMs: Date.now() - started, aborted: true });
  }

  /* browser-derived findings */
  const uniq = (a: string[]) => [...new Set(a)];
  if (logs.pageErrors.length)
    ctx.findings.push({
      id: "autoqa-uncaught-errors",
      severity: "high",
      title: `${logs.pageErrors.length} uncaught JavaScript exception(s)`,
      detail: "Uncaught exceptions during normal use — clicked features can silently stop working.",
      evidence: uniq(logs.pageErrors).slice(0, 6).join("\n"),
      fix: "Fix the throwing code path and add a console-error gate to your e2e suite.",
      confidence: "confirmed",
    });
  if (logs.consoleErrors.length)
    ctx.findings.push({
      id: "autoqa-console-errors",
      severity: "medium",
      title: `${uniq(logs.consoleErrors).length} console error(s) during the run`,
      detail: "Errors logged by the app or failing network calls observed in the real browser session.",
      evidence: uniq(logs.consoleErrors).slice(0, 8).join("\n"),
      confidence: "confirmed",
    });
  else ctx.positives.push("console clean on audited pages");
  if (logs.failedRequests.length)
    ctx.findings.push({
      id: "autoqa-failed-requests",
      severity: "medium",
      title: `${uniq(logs.failedRequests).length} failed network request(s)`,
      detail: "Requests that never completed (DNS, CORS, aborted by server).",
      evidence: uniq(logs.failedRequests).slice(0, 8).join("\n"),
      confidence: "confirmed",
    });
  const bad4xx5xx = uniq(logs.badResponses);
  if (bad4xx5xx.length)
    ctx.findings.push({
      id: "autoqa-http-errors",
      severity: "medium",
      title: `${bad4xx5xx.length} resource(s) returned 4xx/5xx during rendering`,
      detail: "Sub-resources requested by the pages came back with error statuses (missing assets, dead API calls).",
      evidence: bad4xx5xx.slice(0, 8).join("\n"),
      confidence: "confirmed",
    });
  if (!ctx.allowPrivate && probe && !probe.finalUrl.startsWith("https://"))
    ctx.findings.push({
      id: "autoqa-no-https",
      severity: "high",
      title: "Site is served without HTTPS",
      detail: "The final URL after redirects is plain http. Everything the user types crosses the network in the clear.",
      evidence: probe.finalUrl,
      fix: "Serve https and redirect http with a 301; enable HSTS once stable.",
      confidence: "confirmed",
    });
  if (probe?.ttfbMs)
    ctx.findings.push(
      ...(probe.ttfbMs > 1500
        ? ([{ id: "autoqa-ttfb-slow", severity: "high", title: `Very slow TTFB: ${probe.ttfbMs} ms`, detail: "First byte took over 1.5s — users perceive the site as broken-slow; Core Web Vitals will fail.", evidence: `GET ${ctx.target} -> TTFB ${probe.ttfbMs} ms`, fix: "Profile the origin (cache, DB queries, cold starts) and add edge caching.", confidence: "presence" }] as Finding[])
        : probe.ttfbMs > 800
          ? ([{ id: "autoqa-ttfb-slow", severity: "medium", title: `Slow TTFB: ${probe.ttfbMs} ms`, detail: "First byte took over 800ms.", evidence: `GET ${ctx.target} -> TTFB ${probe.ttfbMs} ms`, fix: "Add caching / profile origin latency.", confidence: "presence" }] as Finding[])
          : []),
    );
  if (perf.lcp) {
    if (perf.lcp > 4000)
      ctx.findings.push({ id: "autoqa-lcp-slow", severity: "high", title: `LCP ${perf.lcp} ms (>4s)`, detail: "Largest Contentful Paint is poor; users on mid-range devices see a blank/skeleton page for seconds.", evidence: `LCP ${perf.lcp} ms on ${ctx.target}`, fix: "Optimize the hero asset, preload it, and cut render-blocking resources.", confidence: "presence" });
    else if (perf.lcp > 2500)
      ctx.findings.push({ id: "autoqa-lcp-slow", severity: "medium", title: `LCP ${perf.lcp} ms (>2.5s)`, detail: "Largest Contentful Paint misses the Core Web Vitals 'good' threshold.", evidence: `LCP ${perf.lcp} ms`, fix: "Preload the LCP asset and defer non-critical JS.", confidence: "presence" });
    else ctx.positives.push(`LCP ${perf.lcp} ms (good)`);
  }
  if (perf.weightKb && perf.weightKb > 3072)
    ctx.findings.push({ id: "autoqa-heavy-page", severity: "medium", title: `Heavy page: ${(perf.weightKb / 1024).toFixed(1)} MB transferred`, detail: "Entry page transferred over 3 MB — mobile users on metered connections pay for it.", evidence: `${perf.requests} requests, ${perf.weightKb} KB`, fix: "Code-split, compress images, defer below-fold assets.", confidence: "presence" });

  /* metrics + score */
  ctx.metrics.unshift(
    { label: "pages visited in browser", value: String(ctx.browsed.length || (browsedFacts.length ? 1 : 0)) },
    { label: "TTFB / DCL / load", value: `${perf.ttfb ?? "?"} / ${perf.dcl ?? "?"} / ${perf.load ?? "?"} ms` },
    { label: "LCP", value: perf.lcp ? `${perf.lcp} ms` : "n/a" },
    { label: "page weight", value: perf.weightKb ? `${(perf.weightKb / 1024).toFixed(2)} MB · ${perf.requests} requests` : "n/a" },
    { label: "console errors / uncaught", value: `${uniq(logs.consoleErrors).length} / ${uniq(logs.pageErrors).length}` },
    { label: "mobile overflow (375px)", value: mobileOverflow.length ? "yes" : "no" },
  );
  if (ctx.answers.flows) ctx.metrics.push({ label: "requested flows honored", value: String(flows.length) });
  if (ctx.answers.notes) ctx.metrics.push({ label: "operator notes", value: "recorded in run config" });

  tag(ctx.findings, "presence");
  const { findings, deduped } = dedupeFindings(ctx.findings);
  ctx.findings = findings;
  const { score, grade } = scoreFindings(findings);
  return assemble(ctx, { score, grade, durationMs: Date.now() - started, deduped, probe, axeAudited });
}

/* ---------------- report assembly ---------------- */

function assemble(
  ctx: Ctx,
  x: { score: number; grade: string; durationMs: number; deduped?: number; probe?: FetchedPage | null; axeAudited?: number; aborted?: boolean }
): UrlScanReport {
  const critical = ctx.findings.filter((f) => f.severity === "critical").length;
  const high = ctx.findings.filter((f) => f.severity === "high").length;
  const loginFailed = ctx.findings.some((f) => f.id === "autoqa-login-failed");
  const verdict: UrlScanReport["verdict"] = x.aborted || critical > 0 ? "blocked" : high > 0 || loginFailed ? "needs-review" : "ok";
  const WEIGHT: Record<string, number> = { critical: 40, high: 25, medium: 12, low: 5, info: 0, pass: 0 };
  const pillar = (ids: string[], label: string, hint: string) => {
    const rel = ctx.findings.filter((f) => ids.some((i) => f.id.startsWith(i)));
    const ded = rel.reduce((s, f) => s + (WEIGHT[f.severity] ?? 0), 0);
    return { label, score: Math.max(0, 100 - ded), hint };
  };
  return {
    scanner: "auto-qa",
    target: ctx.target,
    finalUrl: ctx.browsed[0]?.url ?? probeFinal(x.probe),
    durationMs: x.durationMs,
    cached: false,
    scannedAt: new Date().toISOString(),
    score: x.score,
    grade: x.grade,
    verdict,
    summary:
      x.aborted
        ? "Run ended early — the entry page never produced a usable session."
        : `Real-browser E2E: ${ctx.browsed.length || 1} page(s) visited, ${ctx.metrics.find((m) => m.label === "console errors / uncaught")?.value ?? "0/0"} console issues, ${ctx.metrics.find((m) => m.label === "links probed")?.value ?? "0 links probed"}, axe on ${x.axeAudited ?? 0} page(s), login ${ctx.metrics.find((m) => m.label === "login oracle")?.value ?? "not requested"}.`,
    findings: ctx.findings.sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3, info: 4, pass: 5 } as Record<string, number>)[a.severity] - ({ critical: 0, high: 1, medium: 2, low: 3, info: 4, pass: 5 } as Record<string, number>)[b.severity]),
    inconclusive: ctx.inconclusive.length ? ctx.inconclusive : undefined,
    positives: ctx.positives.length ? [...new Set(ctx.positives)] : undefined,
    leads: ctx.leads.length ? ctx.leads : undefined,
    breakdown: [
      pillar(["autoqa-entry", "autoqa-browser-load", "autoqa-page-load", "autoqa-soft404"], "reachability", "loads, status codes, 404 hygiene"),
      pillar(["autoqa-console", "autoqa-uncaught", "autoqa-failed-requests", "autoqa-http-errors"], "js health", "console, uncaught errors, network"),
      pillar(["autoqa-broken-link", "autoqa-flow"], "links & flows", "crawl integrity, requested checks"),
      pillar(["autoqa-axe", "autoqa-img", "autoqa-missing-lang", "autoqa-missing-h1", "autoqa-multiple-h1"], "accessibility", "axe-core WCAG mapping"),
      pillar(["autoqa-mobile", "autoqa-missing-viewport"], "responsive", "375px overflow, viewport meta"),
      pillar(["autoqa-ttfb", "autoqa-lcp", "autoqa-heavy-page"], "performance", "TTFB, LCP, weight"),
      pillar(["autoqa-no-https", "autoqa-mixed"], "transport", "https + mixed content"),
      pillar(["hsts", "csp", "x-frame", "x-content", "referrer", "cookie", "permissions", "autoqa-no-https"], "headers", "baseline response headers"),
    ],
    metrics: ctx.metrics,
    verification: {
      policy: VERIFY_POLICY,
      tokenUsed: false,
      deduped: x.deduped ?? 0,
      statuses: countStatuses(ctx.findings),
    },
  };
}

function probeFinal(probe?: FetchedPage | null): string | undefined {
  return probe?.finalUrl;
}
