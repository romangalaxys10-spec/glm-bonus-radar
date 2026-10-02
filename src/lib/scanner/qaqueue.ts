/**
 * zScanner auto-QA — JOB-LEVEL QUEUE with position + ETA.
 *
 * Why (user request, 2026-10-03): auto-QA is resource-bound — the FC runtime
 * runs ONE real-browser audit at a time (memory + the browser launch lock in
 * browser.ts). Until now a second submitter either raced the lock or hit the
 * fail-fast smoke. Now: if all QA slots are busy, the run ENTERS A FIFO QUEUE
 * and the user gets honest telemetry — queue position, waiting count, and an
 * ETA until their run kicks in — then the normal timer/progress bar once it
 * starts (runStartedAt marks the exact hand-off).
 *
 * Design:
 *  - Slot semaphore at the JOB level (not per-browser-call): a queued run
 *    touches no browser while waiting, so the running audit is never starved.
 *  - FIFO with a hard cap (MAX_WAITING) — beyond it the route rejects with an
 *    honest "queue full" instead of silently degrading.
 *  - ETA is a documented heuristic: the rolling average of the last 8 real
 *    run durations (default 95 s when no history) — the current run is
 *    charged half its average (expected remaining), each full wave ahead is
 *    charged one average. Capped at 30 min. It is labeled "≈" everywhere.
 *  - Positions/ETAs are computed on READ from the live queue, so they are
 *    always current without any notification plumbing.
 *  - Wait timeout: a queued job abandoned by its registry sweep (30-min TTL)
 *    fails honestly instead of hanging forever.
 */

import { ScanError } from "./fetcher";
import { markJobRunStart } from "./jobs";

/** Configurable QA slot capacity (1 default — one real browser at a time). */
const CAPACITY = Math.max(1, Math.min(3, Number(process.env.QA_MAX_JOBS ?? "1") || 1));
const MAX_WAITING = 6;
const WAIT_TIMEOUT_MS = 20 * 60_000; // abandoned queue entries fail honestly
const DEFAULT_AVG_SEC = 95; // matches the UI's advertised ~60–110 s run length
const ETA_CAP_SEC = 1800;

type Waiter = { jobId: string; grant: () => void; deny: (e: Error) => void };

let running = 0;
const waiting: Waiter[] = [];
const recentDurations: number[] = []; // wall ms of COMPLETED runs (max 8)

export type QaQueueState = {
  running: number;
  waiting: number;
  capacity: number;
  avgRunSec: number | null;
  nextEtaSec: number | null;
};

function avgMs(): number | null {
  if (!recentDurations.length) return null;
  return recentDurations.reduce((s, d) => s + d, 0) / recentDurations.length;
}

/** ETA (seconds) until a run at 1-based queue position p would START. */
function etaStartSec(position: number): number {
  const eff = (avgMs() ?? DEFAULT_AVG_SEC * 1000) / 1000;
  const wave = Math.ceil(position / CAPACITY); // waves that must finish first (incl. the live one)
  const liveCharge = running > 0 ? eff * 0.5 : 0; // expected remaining of the current run(s)
  const eta = eff * (wave - 1) + liveCharge;
  return Math.max(5, Math.min(ETA_CAP_SEC, Math.round(eta)));
}

/** Live queue telemetry for the init endpoint / questionnaire. */
export function qaQueueState(): QaQueueState {
  const avg = avgMs();
  return {
    running,
    waiting: waiting.length,
    capacity: CAPACITY,
    avgRunSec: avg != null ? Math.round(avg / 1000) : null,
    nextEtaSec: waiting.length > 0 || running >= CAPACITY ? etaStartSec(1) : 0,
  };
}

/**
 * What a NEW submitter would get right now. Null = a slot is free (no queue).
 * position/waiting are 1-based within the waiting list.
 */
export function qaQueuePreview(): { position: number; waiting: number; etaSec: number } | null {
  if (running < CAPACITY) return null;
  const position = waiting.length + 1;
  return { position, waiting: waiting.length + 1, etaSec: etaStartSec(position) };
}

/** True if accepting one more queued run would exceed the hard cap. */
export function qaQueueFull(): boolean {
  return waiting.length >= MAX_WAITING;
}

/** Queue view for a SPECIFIC job while it waits; null once granted/unknown. */
export function qaQueueViewFor(jobId: string): { position: number; waiting: number; etaSec: number } | null {
  const idx = waiting.findIndex((w) => w.jobId === jobId);
  if (idx === -1) return null;
  return { position: idx + 1, waiting: waiting.length, etaSec: etaStartSec(idx + 1) };
}

/** Debug/verify telemetry: queue internals incl. waiting job ids. */
export function qaQueueDebug(): QaQueueState & { waitingIds: string[] } {
  return { ...qaQueueState(), waitingIds: waiting.map((w) => w.jobId) };
}

/**
 * Run `fn` inside a QA slot. FIFO-queues (jobId tagged) when all slots are
 * busy; marks the job's real run start; records the duration for the ETA
 * history. Never retries fn — one honest run.
 */
export async function withQaSlot<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  let wasQueued = false;
  if (running >= CAPACITY) {
    if (waiting.length >= MAX_WAITING)
      throw new ScanError("queue-full", `The QA queue is full (${MAX_WAITING} waiting) — try again in a few minutes.`);
    wasQueued = true;
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer);
        resolve();
      };
      const deny = (e: Error) => {
        clearTimeout(timer);
        reject(e);
      };
      const timer = setTimeout(() => {
        const i = waiting.findIndex((w) => w.jobId === jobId);
        if (i !== -1) waiting.splice(i, 1);
        reject(new ScanError("queue-timeout", "Queued too long without a free slot (queue timeout) — try again."));
      }, WAIT_TIMEOUT_MS);
      waiting.push({ jobId, grant, deny });
    });
  }
  if (!wasQueued) running += 1; // a granted slot is TRANSFERRED (already counted)
  markJobRunStart(jobId);
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    recentDurations.push(Date.now() - t0);
    if (recentDurations.length > 8) recentDurations.shift();
    const next = waiting.shift();
    if (next) {
      /* hand the slot over WITHOUT freeing it: the grantee continues inside
         the same slot count. Decrementing first would open a window where a
         new arrival sees a free slot and over-admits alongside the grantee. */
      next.grant();
    } else {
      running -= 1;
    }
  }
}
