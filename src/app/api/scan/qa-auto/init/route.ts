import { NextResponse } from "next/server";
import { preflightQaTarget, browserExecutable, browserDiagnostics, probeBrowserExecutable, isLocalCaller, withQaBrowser, browserLockBusy } from "@/lib/scanner/browser";
import { qaQueueState } from "@/lib/scanner/qaqueue";
import { guardedGet, ScanError } from "@/lib/scanner/fetcher";
import { clientKey, overRate } from "@/lib/scanner/guard";
import { errorResponse, readJson } from "@/lib/scanner/http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 1 of the auto-QA flow: probe the target so the questionnaire can be
 * concrete (is it reachable? does it show a login form? how fast?). No
 * browser crawl yet — a light, guarded GET. Also verifies the QA browser is
 * available and kicks off an async auto-install when it is not.
 */
export async function POST(req: Request) {
  try {
    if (overRate(`scan:${clientKey(req)}`))
      return NextResponse.json({ error: "rate-limited", message: "Slow down — 8 scans per minute." }, { status: 429, headers: { "cache-control": "no-store" } });
    const { url } = await readJson<{ url?: string }>(req);
    if (!url || typeof url !== "string") throw new ScanError("bad-url", "Give the website / app URL to audit.");
    const allowPrivate = isLocalCaller(req.headers);
    const target = await preflightQaTarget(url, allowPrivate);

    /* browser availability (graceful degradation + async auto-heal). The
       launch error is SURFACED (never swallowed again — 2026-10-02 prod
       incident: chip said "browser failed" with zero diagnostics). */
    let browserAvailable = true;
    let browserError: string | null = null;
    try {
      browserExecutable();
    } catch {
      browserAvailable = false;
      browserError = "QA browser binary not found on this host";
      if (process.env.QA_AUTOHEAL !== "0") {
        // runtime-only path (kept opaque so the bundler never traces it)
        const sep = "/";
        const cli = [process.cwd(), "node_modules", "playwright-core", "cli.js"].join(sep);
        if (existsSync(cli)) {
          const child = spawn("node", [cli, "install", "chromium-headless-shell"], { detached: true, stdio: "ignore" });
          child.unref();
        }
      }
    }

    /* smoke: one browser launch if a binary exists (proves spawn works).
       While a QA run holds the browser lock (incl. mid-run question waits)
       the smoke is SKIPPED — queueing behind it would hang this endpoint.
       "busy" is honest: the browser obviously launches; the new run will
       simply queue for a slot. */
    let browserSmoke: "ok" | "failed" | "skipped" | "busy" = "skipped";
    if (browserAvailable) {
      if (browserLockBusy()) {
        browserSmoke = "busy";
      } else {
        try {
          await withQaBrowser(async (b) => {
            void b.version();
            return true;
          });
          browserSmoke = "ok";
        } catch (e) {
          browserSmoke = "failed";
          // 1600 chars: keep the loader's own stderr ("version `GLIBC_2.38' not
          // found (required by ...)" lives ~600 chars into playwright's message)
          browserError = e instanceof Error ? e.message.slice(0, 1600) : String(e).slice(0, 1600);
        }
      }
    }

    /* direct probe: the binary's own --version under the pack env. When the
       smoke fails this shows the LOADER's verbatim stderr (missing lib /
       symbol version) — a host we cannot ssh into describing itself. */
    let browserProbe: { code: number | null; stdout: string; stderr: string; signal: string | null } | null = null;
    if (browserAvailable && browserSmoke === "failed") {
      try {
        browserProbe = await probeBrowserExecutable();
      } catch {
        browserProbe = null;
      }
    }

    /* probe: fetcher guards for public targets, light fetch for operator-local */
    let probe;
    if (target.allowPrivate) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 10_000);
      try {
        const res = await fetch(target.url, { signal: abort.signal, redirect: "follow", headers: { "user-agent": "zScannerQA/1.0 (+https://zhelp.space-z.ai/scanner)" } });
        const body = (await res.text()).slice(0, 400_000);
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
        probe = { finalUrl: res.url || target.url, status: res.status, headers, body, bytes: body.length, truncated: false, hops: 0, ttfbMs: 0 };
      } catch {
        throw new ScanError("fetch-failure", "Target did not answer the probe.");
      } finally {
        clearTimeout(timer);
      }
    } else {
      probe = await guardedGet(target.url, { bodyCap: 400_000 }).catch((e) => {
        if (e instanceof ScanError) throw e;
        throw new ScanError("fetch-failure", "Target did not answer the probe.");
      });
    }
    const loginForm = /<form[\s>]/i.test(probe.body) && /type=(["']?)password\1/i.test(probe.body);
    const title = /<title[^>]*>([\s\S]{0,180}?)<\/title>/i.exec(probe.body)?.[1]?.trim() ?? "";
    const generator = /<meta[^>]+name=(["']?)generator\1[^>]+content=(["'])([^"']{0,80})/i.exec(probe.body)?.[3] ?? "";

    return NextResponse.json(
      {
        target: target.url,
        allowPrivate,
        probe: {
          status: probe.status,
          finalUrl: probe.finalUrl,
          ttfbMs: probe.ttfbMs,
          title,
          generator,
          bytes: probe.bytes,
        },
        loginFormDetected: loginForm,
        browserAvailable,
        browserSmoke,
        browserError,
        browserProbe,
        browser: browserDiagnostics(),
        qaQueue: qaQueueState(),
        questions: [
          {
            id: "login",
            prompt: loginForm
              ? "The entry page shows a login form. Should the audit test authenticated areas with a test account?"
              : "If the app has a members-only area, provide a test login for the audit (otherwise continue unauthenticated).",
            hint: "Credentials live in memory for this run only — never stored or logged.",
          },
          {
            id: "flows",
            prompt: "Any critical flows or texts the auditor must verify? (optional, one per line)",
            hint: "check: <text that must be visible>  |  goto: <absolute URL to also audit>",
          },
          { id: "notes", prompt: "Anything else the auditor should know? (optional)", hint: "rate limits, staging caveats, fragile endpoints…" },
        ],
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    return errorResponse(e);
  }
}
