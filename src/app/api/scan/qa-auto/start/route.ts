import { NextResponse } from "next/server";
import { runAutoQaScan, type QaAnswers } from "@/lib/scanner/autoqa";
import { QA_PLAN, preflightQaTarget, isLocalCaller, browserExecutable, ensureLaunchable } from "@/lib/scanner/browser";
import { askJob, startJob } from "@/lib/scanner/jobs";
import { withQaSlot, qaQueueViewFor, qaQueueFull, qaQueueDebug } from "@/lib/scanner/qaqueue";
import { clientKey, overRate } from "@/lib/scanner/guard";
import { errorResponse, readJson } from "@/lib/scanner/http";
import { ScanError } from "@/lib/scanner/fetcher";
import { finishScan } from "@/lib/scanner/snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 2: start the real E2E run. The answers (incl. optional test
 * credentials) live ONLY inside the running job's closure — never persisted,
 * cached, snapshotted or logged. Mid-run questions flow back through
 * job.question; answers arrive via /api/scan/qa-auto/answer.
 */
export async function POST(req: Request) {
  try {
    if (overRate(`scan:${clientKey(req)}`))
      return NextResponse.json({ error: "rate-limited", message: "Slow down — 8 scans per minute." }, { status: 429, headers: { "cache-control": "no-store" } });
    const body = await readJson<{
      url?: string;
      compareToken?: string;
      answers?: { useLogin?: boolean; username?: string; password?: string; loginSelectors?: string; flows?: string; notes?: string };
    }>(req, 60_000);
    if (!body.url || typeof body.url !== "string") throw new ScanError("bad-url", "Give the website / app URL to audit.");
    if (body.answers?.useLogin && (!body.answers.username || !body.answers.password))
      throw new ScanError("bad-answers", "Login testing requested but username/password missing.");
    const allowPrivate = isLocalCaller(req.headers);
    const target = await preflightQaTarget(body.url, allowPrivate);
    browserExecutable(); // absent binary -> clear browser-missing error
    await ensureLaunchable(); // launch smoke (60s-cached) -> clear env error, no doomed jobs
    const answers: QaAnswers = {
      useLogin: !!body.answers?.useLogin,
      username: body.answers?.username?.slice(0, 200) ?? "",
      password: body.answers?.password?.slice(0, 200) ?? "",
      loginSelectors: body.answers?.loginSelectors?.slice(0, 400) ?? "",
      flows: body.answers?.flows?.slice(0, 2000) ?? "",
      notes: body.answers?.notes?.slice(0, 1000) ?? "",
    };
    const prev = typeof body.compareToken === "string" ? body.compareToken.slice(0, 80) : undefined;

    /* queue admission: honest rejection when the FIFO is saturated (v5.1) */
    if (qaQueueFull())
      throw new ScanError("queue-full", "The QA queue is full — several audits are ahead of you. Try again in a few minutes.");

    const id = startJob(QA_PLAN, (progress, jobId) =>
      /* withQaSlot: FIFO queue when all QA slots are busy; marks runStartedAt
         on grant (the user's timer/progress bar starts exactly there) */
      withQaSlot(jobId, () =>
        runAutoQaScan({ target: target.url, answers, allowPrivate, ask: (q) => askJob(jobId, q) }, progress).then((report) =>
          finishScan({ report, compareToken: prev })
        )
      )
    );
    return NextResponse.json(
      { jobId: id, queue: qaQueueViewFor(id), queueState: qaQueueDebug() },
      { status: 202, headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    return errorResponse(e);
  }
}
