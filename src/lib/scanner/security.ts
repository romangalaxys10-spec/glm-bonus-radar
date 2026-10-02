/**
 * zScanner — Security Audit.
 *
 * Rule set adapted from the securityheaders.com methodology and the OWASP
 * Secure Headers Project (ledger research-security.json): transport security,
 * HSTS, CSP, clickjacking, MIME sniffing, referrer leakage, feature policy,
 * COOP, fingerprinting headers, cookie flags and mixed content.
 */

import { guardedGet, plausibleTarget, ScanError } from "./fetcher";
import { type Finding, type Inconclusive, type UrlScanReport, scoreFindings } from "./types";

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

export async function runSecurityScan(rawUrl: string): Promise<UrlScanReport> {
  const started = Date.now();
  const target = plausibleTarget(rawUrl);
  if (!target) throw new ScanError("bad-url", "Give a public URL like example.com.");
  const page = await guardedGet(target, { bodyCap: 2_000_000 });
  const { findings, inconclusive } = analyzeSecurityHeaders(page.headers, page.finalUrl, page.body, page.status);
  const { score, grade } = scoreFindings(findings);
  return {
    scanner: "security",
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
