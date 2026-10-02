/**
 * zScanner — Security Audit.
 *
 * Rule set adapted from securityheaders.com / OWASP Secure Headers, the
 * sec-scan methodology from fable (romangalaxys10-spec/fable, MIT: server
 * version disclosure, CORS reflection, 404-baseline exposure probes,
 * secrets-in-body) and the Cloudflare security-audit-skill doctrine:
 * header gaps are hardening notes (low), actual exposures are real
 * findings (high/critical), and unvalidated suspicions become leads with
 * NO severity — severity cannot exceed demonstrated impact.
 */

import { guardedGet, plausibleTarget, ScanError, type FetchedPage } from "./fetcher";
import { type Finding, type Inconclusive, type ScanLead, type UrlScanReport, scoreFindings, stableUid } from "./types";
import { SECRET_LINE_RULES } from "./code-review";

const HSTS_MIN_AGE = 15552000; // six months, securityheaders guidance

function splitSetCookies(joined: string | undefined): string[] {
  if (!joined) return [];
  // undici merges set-cookie lines with ", " — split on a comma that is
  // followed by a fresh cookie-pair (token=...), tolerating Expires dates.
  return joined
    .split(/,(?=\s*[^\s;,=]+=[^\s;,]*)/)
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 8);
}

const STRICT_REFERRER = new Set([
  "no-referrer",
  "same-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
]);

export function analyzeSecurityHeaders(
  headers: Record<string, string>,
  finalUrl: string,
  body: string,
  status: number
): { findings: Finding[]; inconclusive: Inconclusive[] } {
  const findings: Finding[] = [];
  const inconclusive: Inconclusive[] = [];
  const https = finalUrl.startsWith("https://");
  const has = (h: string) => Boolean(headers[h]?.trim());
  const val = (h: string) => (headers[h] ?? "").trim();

  // Transport
  if (https) {
    findings.push({
      id: "sec-https",
      severity: "pass",
      title: "Served over HTTPS",
      detail: "The final response came from an https:// origin.",
    });
  } else {
    findings.push({
      id: "sec-https",
      severity: "critical",
      title: "No transport encryption",
      detail: "The page was reached over plain http://. Everything a user sees or sends can be read and altered in transit.",
      fix: "Serve everything over HTTPS and redirect http:// permanently.",
    });
  }

  // HSTS
  const hsts = val("strict-transport-security");
  if (https && !hsts) {
    findings.push({
      id: "sec-hsts",
      severity: "high",
      title: "Strict-Transport-Security missing",
      detail: "Without HSTS a visitor's very first request (and any typed http:// request) can be downgraded to plaintext.",
      fix: 'Send: Strict-Transport-Security: max-age=63072000; includeSubDomains; preload',
    });
  } else if (https) {
    const maxAge = /max-age=(\d+)/i.exec(hsts)?.[1];
    const age = maxAge ? Number(maxAge) : 0;
    if (age < HSTS_MIN_AGE) {
      findings.push({
        id: "sec-hsts",
        severity: "medium",
        title: "HSTS max-age too short",
        detail: `max-age=${age} is below the six-month floor recommended by securityheaders-style audits.`,
        fix: "Raise max-age to at least 15552000 (ideally 63072000 with includeSubDomains).",
        evidence: hsts.slice(0, 120),
      });
    } else {
      findings.push({
        id: "sec-hsts",
        severity: "pass",
        title: "HSTS present",
        detail: `max-age ${age.toLocaleString()}s${/includeSubDomains/i.test(hsts) ? ", includeSubDomains" : ""}${/preload/i.test(hsts) ? ", preload" : ""}.`,
        evidence: hsts.slice(0, 120),
      });
    }
  }

  // CSP
  const csp = val("content-security-policy");
  if (!csp) {
    findings.push({
      id: "sec-csp",
      severity: https ? "high" : "medium",
      title: "Content-Security-Policy missing",
      detail: "No CSP means no structural defense against injected scripts (XSS), even when other headers are perfect.",
      fix: "Start with a report-only policy, then enforce; avoid 'unsafe-inline' for scripts.",
    });
  } else if (/unsafe-inline/i.test(csp) && !/(nonce-|sha\d{3}-|strict-dynamic)/i.test(csp)) {
    findings.push({
      id: "sec-csp",
      severity: "medium",
      title: "CSP weakened by 'unsafe-inline' without nonces/hashes",
      detail: "An allow-all inline policy blocks little more than nothing — most XSS payloads execute normally.",
      fix: "Move to nonce- or hash-based script-src (strict-dynamic).",
      evidence: csp.replace(/\s+/g, " ").slice(0, 160),
    });
  } else {
    findings.push({
      id: "sec-csp",
      severity: "pass",
      title: "Content-Security-Policy present",
      detail: /unsafe-inline/i.test(csp)
        ? "Policy present (contains unsafe-inline — acceptable for style-src, risky for script-src)."
        : "Policy present.",
      evidence: csp.replace(/\s+/g, " ").slice(0, 160),
    });
  }

  // Clickjacking
  const frameAncestors = /frame-ancestors/i.test(csp);
  const xfo = val("x-frame-options");
  if (!xfo && !frameAncestors) {
    findings.push({
      id: "sec-clickjack",
      severity: "medium",
      title: "No clickjacking protection",
      detail: "Neither X-Frame-Options nor CSP frame-ancestors is set, so the page can be framed by third parties (clickjacking, likejacking).",
      fix: "Send CSP frame-ancestors 'self' (or X-Frame-Options: DENY for legacy clients).",
    });
  } else {
    findings.push({
      id: "sec-clickjack",
      severity: "pass",
      title: "Framing controlled",
      detail: frameAncestors ? "CSP frame-ancestors directive found." : `X-Frame-Options: ${xfo.slice(0, 40)}.`,
    });
  }

  // MIME sniffing
  if (val("x-content-type-options").toLowerCase().includes("nosniff")) {
    findings.push({
      id: "sec-nosniff",
      severity: "pass",
      title: "X-Content-Type-Options: nosniff",
      detail: "Browsers will not MIME-sniff responses away from their declared type.",
    });
  } else {
    findings.push({
      id: "sec-nosniff",
      severity: "low",
      title: "nosniff missing",
      detail: "Without X-Content-Type-Options: nosniff, browsers may reinterpret responses (e.g. text as script).",
      fix: "Send: X-Content-Type-Options: nosniff",
    });
  }

  // Referrer-Policy
  const rp = val("referrer-policy").toLowerCase();
  if (!rp) {
    findings.push({
      id: "sec-referrer",
      severity: "low",
      title: "Referrer-Policy missing",
      detail: "Full URLs (including query strings, sometimes tokens) can leak to third-party sites via the Referer header.",
      fix: "Send: Referrer-Policy: strict-origin-when-cross-origin",
    });
  } else if (/unsafe-url/i.test(rp)) {
    findings.push({
      id: "sec-referrer",
      severity: "high",
      title: "Referrer-Policy: unsafe-url",
      detail: "The full referrer URL is deliberately sent cross-origin.",
      fix: "Use strict-origin-when-cross-origin or stricter.",
    });
  } else if (STRICT_REFERRER.has(rp.split(",")[0].trim())) {
    findings.push({ id: "sec-referrer", severity: "pass", title: "Referrer-Policy strict", detail: rp });
  } else {
    findings.push({
      id: "sec-referrer",
      severity: "low",
      title: "Referrer-Policy permissive",
      detail: `"${rp}" is set but not one of the strict values.`,
      fix: "Prefer strict-origin-when-cross-origin.",
    });
  }

  // Permissions-Policy
  findings.push(
    has("permissions-policy")
      ? {
          id: "sec-permissions",
          severity: "pass",
          title: "Permissions-Policy present",
          detail: "Powerful browser features are explicitly gated.",
          evidence: val("permissions-policy").slice(0, 120),
        }
      : {
          id: "sec-permissions",
          severity: "low",
          title: "Permissions-Policy missing",
          detail: "The site does not declare which browser features (camera, geolocation, …) third parties may use.",
          fix: "Send a minimal deny-list, e.g. Permissions-Policy: camera=(), microphone=(), geolocation=()",
        }
  );

  // COOP
  findings.push(
    has("cross-origin-opener-policy")
      ? { id: "sec-coop", severity: "pass", title: "Cross-Origin-Opener-Policy present", detail: val("cross-origin-opener-policy") }
      : {
          id: "sec-coop",
          severity: "low",
          title: "Cross-Origin-Opener-Policy missing",
          detail: "Without COOP, cross-origin popups keep window references (Spectre-class and XS-Leak hardening is weaker).",
          fix: "Send: Cross-Origin-Opener-Policy: same-origin",
        }
  );

  // Fingerprinting
  const powered = ["x-powered-by", "x-aspnet-version", "x-generator", "x-drupal-cache", "x-runtime"].find(has);
  if (powered) {
    findings.push({
      id: "sec-fingerprint",
      severity: "low",
      title: `Server technology disclosed (${powered})`,
      detail: "Fingerprinting headers make targeted attacks cheaper; attackers map your stack from them.",
      fix: "Strip x-powered-by and friends at the edge (Next.js: poweredByHeader=false).",
      evidence: val(powered).slice(0, 80),
    });
  }

  // Cookies
  const cookies = splitSetCookies(headers["set-cookie"]);
  if (cookies.length) {
    const noSecure = cookies.filter((c) => !/\bsecure\b/i.test(c));
    const noHttpOnly = cookies.filter((c) => !/\bhttponly\b/i.test(c));
    const noSameSite = cookies.filter((c) => !/\bsamesite=/i.test(c));
    if (https && noSecure.length)
      findings.push({
        id: "sec-cookie-secure",
        severity: "high",
        title: `${noSecure.length} cookie(s) without Secure`,
        detail: "Cookies without the Secure attribute travel on plaintext connections.",
        fix: "Add Secure to every cookie.",
        evidence: noSecure[0].slice(0, 60) + "…",
      });
    if (noHttpOnly.length)
      findings.push({
        id: "sec-cookie-httponly",
        severity: "medium",
        title: `${noHttpOnly.length} cookie(s) without HttpOnly`,
        detail: "Script-readable cookies are exactly what XSS exfiltrates.",
        fix: "Add HttpOnly to every session cookie.",
      });
    if (noSameSite.length)
      findings.push({
        id: "sec-cookie-samesite",
        severity: "low",
        title: `${noSameSite.length} cookie(s) without SameSite`,
        detail: "SameSite=Lax/Strict is the main CSRF defense line.",
        fix: "Add SameSite=Lax (or Strict) to cookies.",
      });
    if (!noSecure.length && !noHttpOnly.length && !noSameSite.length)
      findings.push({ id: "sec-cookies-ok", severity: "pass", title: "Cookie flags", detail: `All ${cookies.length} observed cookies carry Secure/HttpOnly/SameSite.` });
  }

  // Mixed content
  if (https) {
    const mixed = /(?:src|href)\s*=\s*["']http:\/\/(?!localhost)/i.exec(body);
    if (mixed) {
      findings.push({
        id: "sec-mixed",
        severity: "medium",
        title: "Mixed content referenced",
        detail: "The HTTPS page references http:// resources; browsers block or downgrade these, and any that load travel unencrypted.",
        evidence: mixed[0].slice(0, 80),
      });
    }
  }

  if (status >= 500) {
    inconclusive.push({
      id: "sec-status",
      what: "Header checks",
      why: `Target answered HTTP ${status}; findings reflect whatever the error page still sends.`,
    });
  }

  return { findings, inconclusive };
}

export async function runSecurityScan(
  rawUrl: string,
  progress: (i: number, f: number, note?: string) => void = () => {}
): Promise<UrlScanReport> {
  const started = Date.now();
  const target = plausibleTarget(rawUrl);
  if (!target) throw new ScanError("bad-url", "Give a public URL like example.com.");
  progress(0, 0.35, "resolving & fetching");
  const page = await guardedGet(target, { bodyCap: 2_000_000 });
  progress(0, 1);
  progress(1, 0.25, "CORS & exposure probes");
  const { findings, inconclusive, leads, positives } = await deepChecks(page);
  const base = analyzeSecurityHeaders(page.headers, page.finalUrl, page.body, page.status);
  findings.push(...base.findings);
  inconclusive.push(...base.inconclusive);
  progress(1, 1);
  progress(2, 0.5, "scoring");
  const { score, grade } = scoreFindings(findings);
  const highCount = findings.filter((f) => f.severity === "critical" || f.severity === "high").length;
  const passFindings = findings.filter((f) => f.severity === "pass");
  return {
    scanner: "security",
    target,
    finalUrl: page.finalUrl,
    durationMs: Date.now() - started,
    cached: false,
    scannedAt: new Date().toISOString(),
    score,
    grade,
    summary:
      highCount
        ? `${highCount} exposure(s) confirmed at the transport/header/content layer; hardening gaps listed below them.`
        : `No confirmed exposure. ${leads.length ? `${leads.length} lead(s) need validation before they count as findings.` : "Header posture is solid; hardening notes only."}`,
    positives: [...positives, ...passFindings.slice(0, 4).map((f) => f.title)].slice(0, 8),
    leads: leads.length ? leads : undefined,
    findings,
    inconclusive: inconclusive.length ? inconclusive : undefined,
  };
}

/* ---------- deep checks: CORS, probes, leaks (fable sec-scan port) ---------- */

const PROBES: { path: string; id: string; severity: Finding["severity"]; title: string; detail: string; fix?: string }[] = [
  { path: "/.env", id: "sec-probe-env", severity: "critical", title: ".env file publicly readable", detail: "A served .env typically carries app secrets (DB DSNs, API keys). This is a live exposure, not a hardening gap.", fix: "Block dotfiles at the edge and rotate any credential that lived in that file." },
  { path: "/.git/HEAD", id: "sec-probe-git", severity: "high", title: ".git directory exposed", detail: "If /.git/HEAD serves, the whole repository history is usually downloadable — source and any committed secrets included.", fix: "Deny /.git at the web server; never deploy the VCS directory." },
  { path: "/server-status", id: "sec-probe-status", severity: "medium", title: "/server-status reachable", detail: "Apache server-status exposes requests, vhosts and client IPs to anonymous visitors.", fix: "Restrict server-status to localhost." },
  { path: "/.DS_Store", id: "sec-probe-dsstore", severity: "low", title: ".DS_Store served", detail: "macOS metadata leaks directory listings from the deploy artifact.", fix: "Strip .DS_Store from deploys." },
];

const LEAK_PROBE = "/.well-known/security.txt";

/** Exported for the deep-check unit test (fabricated-page fixture). */
export async function deepChecks(page: FetchedPage): Promise<{
  findings: Finding[];
  inconclusive: Inconclusive[];
  leads: ScanLead[];
  positives: string[];
}> {
  const findings: Finding[] = [];
  const inconclusive: Inconclusive[] = [];
  const leads: ScanLead[] = [];
  const positives: string[] = [];
  const origin = new URL(page.finalUrl).origin;

  // --- CORS reflection test (real control check, not a header-gap note)
  try {
    const evil = await guardedGet(page.finalUrl, {
      bodyCap: 1_024,
      headers: { origin: "https://zscanner-audit.example" },
    });
    const acao = (evil.headers["access-control-allow-origin"] ?? "").trim();
    const acac = (evil.headers["access-control-allow-credentials"] ?? "").trim().toLowerCase();
    if (acao === "https://zscanner-audit.example" && acac === "true")
      findings.push({ id: "sec-cors-reflect", severity: "high", title: "CORS reflects arbitrary origin with credentials", detail: "The server echoes any Origin and allows credentials — any site can read authenticated responses cross-origin.", fix: "Allowlist origins explicitly; never reflect unvalidated Origins with credentials.", evidence: `ACAO: ${acao} · ACAC: ${acac}` });
    else if (acao === "*" && acac === "true")
      findings.push({ id: "sec-cors-star-cred", severity: "high", title: "CORS wildcard combined with credentials", detail: "Access-Control-Allow-Origin: * with allow-credentials:true is an invalid pairing — browsers reject it, proxies normalize it, and the intent (open + credentialed) is itself the vulnerability.", fix: "Pick one: allowlisted origins with credentials, or wildcard without." });
    else if (acao)
      positives.push(`CORS policy explicit (${acao === "*" ? "wildcard, no credentials" : "restricted"})`);
  } catch {
    inconclusive.push({ id: "sec-cors-test", what: "CORS reflection test", why: "origin-flagged re-fetch failed" });
  }

  // --- 404 baseline, then exposure probes (fable sec-scan model)
  let baselineOk = true;
  try {
    const rand = `/zscan-${Math.random().toString(36).slice(2, 10)}`;
    const baseline = await guardedGet(`${origin}${rand}`, { bodyCap: 1_024 });
    if (baseline.status >= 200 && baseline.status < 300) {
      baselineOk = false;
      inconclusive.push({ id: "sec-probes", what: "Exposure probes", why: "unknown paths answer 200 (soft-404), so probe results would be noise" });
    }
  } catch {
    baselineOk = false;
    inconclusive.push({ id: "sec-probes", what: "Exposure probes", why: "baseline request failed" });
  }
  if (baselineOk) {
    const probes = await Promise.all(
      PROBES.map(async (p) => {
        try {
          const r = await guardedGet(`${origin}${p.path}`, { bodyCap: 4_096 });
          return { p, status: r.status };
        } catch {
          return { p, status: -1 };
        }
      })
    );
    for (const { p, status } of probes) {
      if (status >= 200 && status < 300)
        findings.push({ id: p.id, severity: p.severity, title: p.title, detail: p.detail, fix: p.fix, evidence: `GET ${p.path} → HTTP ${status} · uid ${stableUid(p.id, p.path)}` });
    }
    try {
      const secTxt = await guardedGet(`${origin}${LEAK_PROBE}`, { bodyCap: 4_096 });
      if (secTxt.status >= 200 && secTxt.status < 300 && /contact/i.test(secTxt.body))
        positives.push("security.txt published (RFC 9116) — reports have a landing place");
    } catch {
      // optional positive check only
    }
  }

  // --- secrets in served body (real exposure → real severity)
  for (const rule of SECRET_LINE_RULES) {
    rule.re.lastIndex = 0;
    const m = rule.re.exec(page.body.slice(0, 262_144));
    if (m) {
      const isCredAssign = rule.id === "sec-cred-assignment";
      findings.push({
        id: "sec-leak-body",
        severity: isCredAssign ? "high" : rule.severity === "critical" ? "high" : rule.severity,
        title: `Secret-shaped string in served HTML (${rule.title})`,
        detail: `The page itself contains ${rule.detail.toLowerCase()}`,
        fix: rule.fix,
        evidence: `${m[0].slice(0, 60)}… · uid ${stableUid("sec-leak-body", m[0])}`,
      });
      break; // one representative exposure is enough
    }
  }

  // --- server version disclosure (fable hdr-server-version, downgraded per
  // CF doctrine: internal disclosure = low, not high)
  const server = (page.headers["server"] ?? "").trim();
  if (/\d/.test(server))
    findings.push({ id: "sec-server-version", severity: "low", title: `Server version disclosed (${server.slice(0, 40)})`, detail: "Version numbers in the Server header make attacker recon cheaper.", fix: "Strip or minimize the Server header at the edge." });
  if ((page.headers["via"] ?? "").trim())
    findings.push({ id: "sec-via", severity: "info", title: "Via header reveals proxy chain", detail: page.headers["via"].slice(0, 80) });

  // --- error-page stack trace (info-leak = medium per OWASP, CF "low" floor)
  if (page.status >= 400) {
    const trace = /(?:Traceback \(most recent call last\)|at\s+[/\w.-]+:\d+:\d+|SQLSTATE\[\w+\]|ORA-\d{5})/.exec(page.body);
    if (trace)
      findings.push({ id: "sec-error-trace", severity: "medium", title: "Error page leaks internal detail", detail: "The 4xx/5xx body contains stack-trace or database error markers — internal paths and queries are attacker gold.", evidence: trace[0].slice(0, 100), fix: "Serve generic error bodies; log details server-side only." });
  }

  // --- leads: open-redirect-looking parameters (CF doctrine: never scored
  // without following the redirect — emitted as needs-validation leads)
  const redirectish = /(?:href|action)\s*=\s*["'][^"']*[?&](?:redirect|return|returnurl|next|url|goto|continue|callback|target)\s*=[^"']{1,120}["']/gi;
  const leadMatches = [...page.body.slice(0, 262_144).matchAll(redirectish)].slice(0, 2);
  for (const m of leadMatches) {
    leads.push({
      title: "Open-redirect-looking parameter",
      why: "A link parameter named like a redirect target was found. Whether it is exploitable depends on server-side validation, which a GET-only scan cannot demonstrate.",
      how: "Request the URL with the parameter set to an absolute off-site value (e.g. https://example.invalid) and check whether the server 3xx-redirects off-host without validation.",
      evidence: m[0].slice(0, 120),
    });
  }

  return { findings, inconclusive, leads, positives };
}
