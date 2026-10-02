/**
 * zScanner auto-QA — real-browser harness (v5).
 *
 * Drives the target with playwright-core + the chrome-headless-shell binary
 * staged under `.browsers/` (auto-discovers `~/.cache/ms-playwright` as a
 * fallback, and can auto-heal by downloading). Methodology follows
 * petrkindlmann/qa-skills (agentic-browser-testing + playwright-automation):
 * accessibility-first assertions, auto-waiting instead of waitForTimeout,
 * explicit per-check oracles, bounded step budgets.
 *
 * SSRF posture: the PUBLIC-target path reuses fetcher.ts's preflightTarget
 * (DNS + private-range guards). An operator-LOCAL exception (request without
 * X-Forwarded-For) may audit localhost/dev servers — still never the cloud
 * metadata range, and only reachable when the caller is already inside the box.
 * All browsers run with --no-sandbox inside the unprivileged sandbox.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { ScanError, preflightTarget } from "./fetcher";

export type QaTarget = { url: string; allowPrivate: boolean; origin: string };

/**
 * Operator-local mode: the host explicitly enables private-target QA
 * (QA_ALLOW_PRIVATE=1) AND the request's forwarded peer is loopback.
 * Next.js itself injects x-forwarded-for (the peer address), so on the
 * public platform it is always the client's real IP — spoofing the header
 * cannot enable localhost auditing because the injected value wins.
 */
export function isLocalCaller(headers: Headers): boolean {
  if (process.env.QA_ALLOW_PRIVATE !== "1") return false;
  const xff = (headers.get("x-forwarded-for") ?? "").toLowerCase();
  const first = xff.split(",")[0].trim();
  return first === "127.0.0.1" || first === "::1" || first === "localhost" || first === "::ffff:127.0.0.1";
}

const FORBIDDEN_HOSTS = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
/** 169.254.x (metadata/link-local) is forbidden in EVERY mode. */
const METADATA_HOST = /^(169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

function validatePrivate(u: URL): void {
  const h = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (METADATA_HOST.test(h)) throw new ScanError("private-host", "Metadata/link-local targets are never scanned.");
  if (!FORBIDDEN_HOSTS.test(h) && !h.endsWith(".local") && !h.endsWith(".internal") && !h.includes("localhost")) {
    throw new ScanError("private-host", "This URL is not a local target.");
  }
}

/**
 * Validate a QA target. Public targets go through the full fetcher guard;
 * local targets are accepted only in operator mode (any http port, still
 * no credentials, never metadata ranges).
 */
export async function preflightQaTarget(raw: string, allowPrivate: boolean): Promise<QaTarget> {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new ScanError("bad-url", "That is not a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new ScanError("bad-scheme", "Only http(s) URLs can be audited.");
  if (u.username || u.password) throw new ScanError("bad-credentials", "URLs with embedded credentials are not audited.");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const isPrivate =
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (!isPrivate) {
    const normalized = await preflightTarget(raw); // full public-URL guard (DNS, ranges)
    const nu = new URL(normalized);
    return { url: normalized, allowPrivate: false, origin: nu.origin };
  }
  if (!allowPrivate) throw new ScanError("private-host", "Local/internal targets can only be audited from inside the host.");
  validatePrivate(u);
  return { url: u.toString(), allowPrivate: true, origin: u.origin };
}

/* ---------- executable discovery ---------- */

const CANDIDATE_DIRS = [
  join(process.cwd(), ".browsers"), // staged copy — ships inside the deploy artifact
  join(homedir(), ".cache", "ms-playwright"),
];

/**
 * Revision playwright-core expects (from its browsers.json, e.g. "1200" for
 * 1.57). Production incident 2026-10-02: the image cache also carries NEWER
 * builds (1243); "highest first" ordering made prod pick a mismatched binary
 * while dev (with .browsers/ staged first) always used the matching one.
 * Discovery now prefers the EXPECTED revision in every candidate dir.
 */
let expectedRevision: string | null | undefined;
function playwrightExpectedRevision(): string | null {
  if (expectedRevision !== undefined) return expectedRevision;
  expectedRevision = null;
  // path-based lookup (bundler-opaque): works in dev, standalone keeps
  // node_modules/playwright-core/browsers.json (traced)
  const candidates = [join(process.cwd(), "node_modules", "playwright-core", "browsers.json")];
  for (const p of candidates) {
    try {
      const json = JSON.parse(readFileSync(p, "utf8")) as { browsers?: { name: string; revision: string }[] };
      const b = json.browsers?.find((x) => x.name === "chromium-headless-shell");
      if (b?.revision) {
        expectedRevision = b.revision;
        break;
      }
    } catch {
      /* try next */
    }
  }
  return expectedRevision;
}

function exeCandidatesIn(dir: string, build: string): string[] {
  return [
    join(dir, build, "chrome-headless-shell-linux64", "chrome-headless-shell"),
    join(dir, build, "chrome-linux", "headless_shell"),
    join(dir, build, "chrome-linux64", "chrome"),
  ];
}

function findHeadlessShell(): string | null {
  const rev = playwrightExpectedRevision();
  for (const dir of CANDIDATE_DIRS) {
    if (!existsSync(dir)) continue;
    let builds: string[] = [];
    try {
      builds = readdirSync(dir).filter((n) => n.startsWith("chromium_headless_shell-") || n === "chromium-1200");
    } catch {
      continue;
    }
    // expected playwright revision first, then newest-first as fallback
    builds.sort((a, b) => {
      const ra = rev && a === `chromium_headless_shell-${rev}` ? 1 : 0;
      const rb = rev && b === `chromium_headless_shell-${rev}` ? 1 : 0;
      if (ra !== rb) return rb - ra;
      return a < b ? 1 : a > b ? -1 : 0;
    });
    for (const b of builds) {
      for (const p of exeCandidatesIn(dir, b)) if (existsSync(p)) return p;
    }
  }
  return null;
}

let exeWarning: string | null = null;
void exeWarning;

export function browserExecutable(): string {
  const found = findHeadlessShell();
  if (found) return found;
  exeWarning = "no chromium binary found — run: bash scripts/qa_browser_pack.sh (or bunx playwright-core install chromium-headless-shell)";
  throw new ScanError("browser-missing", "The QA browser is not installed on this host yet — try again in a minute (auto-setup) or contact the operator.");
}

/* ---------- portable launch environment (qa_browser_pack.sh contract) ---------- */

const qaHome = join(tmpdir(), "zqa-home");

/**
 * Launch env TIERS. The pack tier prepends .browsers/libs (baseline-glibc
 * closure built by scripts/qa_browser_pool.py — buster/glibc-2.28 floor, so
 * it resolves on old prod images too). The host tier is the fallback for the
 * (unlikely) case the pack libs ever conflict with a host. Fonts + writable
 * HOME apply to both tiers.
 *  - libs: slim runtime images miss libnss3/glib/X11 etc.
 *  - fonts: slim images ship zero fonts; fontconfig gets the shipped DejaVu
 *    set so text metrics (375px overflow oracle) are stable.
 *  - HOME: crashpad/locks need a writable dir; /root may be read-only.
 */
export type QaEnvTier = "pack" | "host";

function baseLaunchEnv(): { env: Record<string, string>; homeOk: boolean } {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  const pack = join(process.cwd(), ".browsers");
  let homeOk = false;
  const fonts = join(pack, "fonts");
  if (existsSync(fonts)) {
    try {
      mkdirSync(qaHome, { recursive: true });
      const fc = join(qaHome, "fontconfig");
      mkdirSync(join(fc, "cache"), { recursive: true });
      writeFileSync(
        join(fc, "fonts.conf"),
        `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n<fontconfig>\n  <dir>${fonts}</dir>\n  <cachedir>${join(fc, "cache")}</cachedir>\n</fontconfig>\n`
      );
      env.FONTCONFIG_FILE = join(fc, "fonts.conf");
      env.FONTCONFIG_PATH = fc;
    } catch {
      delete env.FONTCONFIG_FILE; // fall back to host fontconfig
    }
  }
  try {
    mkdirSync(qaHome, { recursive: true });
    env.HOME = qaHome;
    homeOk = true;
  } catch {
    /* keep host HOME */
  }
  return { env, homeOk };
}

function launchEnv(tier: QaEnvTier): Record<string, string> {
  const { env } = baseLaunchEnv();
  if (tier === "pack") {
    const libs = join(process.cwd(), ".browsers", "libs");
    if (existsSync(libs)) env.LD_LIBRARY_PATH = `${libs}${env.LD_LIBRARY_PATH ? `:${env.LD_LIBRARY_PATH}` : ""}`;
  } else {
    delete env.LD_LIBRARY_PATH; // pure host resolution
  }
  return env;
}

/** Host glibc version (the thing that killed prod launch twice) — for diagnostics. */
export function hostGlibcVersion(): string | null {
  try {
    const header = (process as unknown as { report?: { getReport?: () => { header?: { glibcVersionRuntime?: string } } } }).report;
    return header?.getReport?.().header?.glibcVersionRuntime ?? null;
  } catch {
    return null;
  }
}

/** Diagnostics surfaced by /api/scan/qa-auto/init so failures are never silent. */
export function browserDiagnostics(): {
  exe: string | null;
  libs: boolean;
  fonts: boolean;
  glibc: string | null;
  tier: QaEnvTier | null;
} {
  let exe: string | null = null;
  try {
    exe = browserExecutable();
  } catch {
    exe = null;
  }
  const pack = join(process.cwd(), ".browsers");
  return {
    exe: exe ? basename(exe) : null,
    libs: existsSync(join(pack, "libs")),
    fonts: existsSync(join(pack, "fonts")),
    glibc: hostGlibcVersion(),
    tier: lastGoodTier,
  };
}

/**
 * Run the browser binary DIRECTLY (`--version`) with the pack env. The loader
 * prints its own complaint to stderr when symbols/libs are missing — the most
 * direct possible evidence from a host we cannot log into. Used by the init
 * route when the smoke fails so prod can self-describe.
 */
export async function probeBrowserExecutable(
  timeoutMs = 8_000
): Promise<{ code: number | null; stdout: string; stderr: string; signal: string | null }> {
  const { execFile } = await import("node:child_process");
  const exe = browserExecutable();
  return new Promise((resolve) => {
    execFile(
      exe,
      ["--version"],
      { env: launchEnv("pack") as unknown as NodeJS.ProcessEnv, timeout: timeoutMs, killSignal: "SIGKILL" },
      (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? ((err as unknown as { code: number }).code) : err ? null : 0;
        resolve({
          code,
          stdout: String(stdout ?? "").slice(0, 400),
          stderr: String(stderr ?? "").slice(0, 1200),
          signal: err && typeof (err as { signal?: unknown }).signal === "string" ? (err as unknown as { signal: string }).signal : null,
        });
      }
    );
  });
}

/* launch lock: one QA browser at a time (memory-safe) */
let browserLock: Promise<unknown> = Promise.resolve();
let inflightBrowserRuns = 0;

/** True while a QA browser session is open or queued behind the lock. */
export function browserLockBusy(): boolean {
  return inflightBrowserRuns > 0;
}

/** Which env tier last launched successfully ("pack" libs first, host fallback). */
let lastGoodTier: QaEnvTier | null = null;
export function lastQaEnvTier(): QaEnvTier | null {
  return lastGoodTier;
}

/**
 * Tiered launch: try the remembered-good tier first, then the other one.
 * ONLY launch-phase failures switch tiers — errors thrown by fn() after a
 * successful launch are the scan's own business and are never retried.
 */
async function launchTiered(exe: string): Promise<Browser> {
  const tiers: QaEnvTier[] = lastGoodTier === "host" ? ["host", "pack"] : ["pack", "host"];
  const failures: string[] = [];
  for (const tier of tiers) {
    try {
      const browser = await chromium.launch({
        executablePath: exe,
        env: launchEnv(tier),
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
        timeout: 20_000,
      });
      lastGoodTier = tier;
      return browser;
    } catch (e) {
      failures.push(`[${tier}-tier] ${e instanceof Error ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)}`);
    }
  }
  const err = new Error(`browser launch failed on every env tier — ${failures.join(" — ")}`);
  (err as Error & { tierFailures?: string[] }).tierFailures = failures;
  throw err;
}

export function withQaBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const run = browserLock.then(async () => {
    inflightBrowserRuns += 1;
    try {
      const exe = browserExecutable();
      const browser = await launchTiered(exe);
      try {
        return await fn(browser);
      } finally {
        await browser.close().catch(() => {});
      }
    } finally {
      inflightBrowserRuns -= 1;
    }
  });
  browserLock = run.catch(() => {}); // keep the chain alive on failures
  return run as Promise<T>;
}

/** Cached launch smoke for fail-fast paths (start route) — 60s TTL. */
let lastGoodLaunch = 0;
export async function ensureLaunchable(): Promise<void> {
  /* a live QA run proves the browser launches — never queue behind its lock */
  if (browserLockBusy()) return;
  if (Date.now() - lastGoodLaunch < 60_000) return;
  await withQaBrowser(async (b) => {
    void b.version();
    return true;
  });
  lastGoodLaunch = Date.now();
}

export type QaPageLog = {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: string[];
  badResponses: string[];
};

export function wirePageLogging(page: import("playwright-core").Page): QaPageLog {
  const log: QaPageLog = { consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [], badResponses: [] };
  const push = (arr: string[], line: string) => {
    if (arr.length < 40) arr.push(line.slice(0, 240));
  };
  page.on("console", (m) => {
    if (m.type() === "error") push(log.consoleErrors, m.text());
    else if (m.type() === "warning") push(log.consoleWarnings, m.text());
  });
  page.on("pageerror", (e) => push(log.pageErrors, `${e.name}: ${e.message}`));
  page.on("requestfailed", (r) => {
    const f = r.failure()?.errorText ?? "failed";
    if (/ERR_BLOCKED_BY_CLIENT|ERR_ABORTED/.test(f)) return; // extensions/cancelled — noise
    push(log.failedRequests, `${r.method()} ${r.url().slice(0, 160)} -> ${f}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) push(log.badResponses, `${r.status()} ${r.url().slice(0, 160)}`);
  });
  return log;
}

/** New hardened context: realistic desktop UA, no third-party cookies. */
export async function newQaContext(browser: Browser, opts?: { mobile?: boolean }): Promise<BrowserContext> {
  return browser.newContext({
    viewport: opts?.mobile ? { width: 375, height: 812 } : { width: 1366, height: 900 },
    userAgent: opts?.mobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 zScannerQA/1.0"
      : "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 zScannerQA/1.0",
    ignoreHTTPSErrors: false,
    serviceWorkers: "block",
  });
}

/** Vendored axe-core source (public/vendor/axe.min.js) for a11y injection. */
let axeCache: string | null = null;
export function axeSource(): string {
  if (axeCache) return axeCache;
  const p = join(process.cwd(), "public", "vendor", "axe.min.js");
  if (!existsSync(p)) throw new ScanError("axe-missing", "axe-core asset is not deployed.");
  axeCache = readFileSync(p, "utf8");
  return axeCache;
}

export const QA_PLAN = [
  { label: "probe & first load", weight: 20 },
  { label: "crawl & page checks", weight: 25 },
  { label: "accessibility & login flow", weight: 25 },
  { label: "responsive & performance", weight: 15 },
  { label: "scoring & report", weight: 15 },
];
