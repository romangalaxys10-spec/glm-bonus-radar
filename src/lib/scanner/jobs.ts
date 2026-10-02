/**
 * zScanner — async scan job registry (memory-only, per the v1 decision:
 * the only state that survives on this host is process state).
 *
 * A job runs a scan in weighted stages; the runner reports (stageIndex,
 * fraction) ticks and the engine derives overall percent + ETA. ETA uses
 * the classic linear extrapolation elapsed * remaining / completed with a
 * floor on completed so the first seconds stay honest.
 *
 * Caps: 120 live jobs, 50 events per job, 30-minute TTL — all swept on
 * create. Job ids are 128-bit random hex (crypto.randomUUID).
 */

export type StagePlan = { label: string; weight: number }[];

export type JobEvent = { at: number; pct: number; stage: string; note?: string };

type JobState = {
  id: string;
  status: "running" | "done" | "error";
  createdAt: number;
  finishedAt?: number;
  plan: StagePlan;
  doneWeight: number;
  lastPct: number;
  lastStage: string;
  events: JobEvent[];
  result?: unknown;
  error?: { code: string; message: string };
};

const jobs = new Map<string, JobState>();

const MAX_JOBS = 120;
const MAX_EVENTS = 50;
const TTL_MS = 30 * 60_000;

function sweep(): void {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.createdAt > TTL_MS) jobs.delete(id);
  if (jobs.size >= MAX_JOBS) {
    const byAge = [...jobs.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (let i = 0; i < byAge.length - MAX_JOBS + 20; i++) jobs.delete(byAge[i][0]);
  }
}

export type ProgressFn = (stageIndex: number, frac: number, note?: string) => void;

/**
 * Start a staged scan job. `fn` receives the progress callback and MUST
 * tick every stage (even once with frac=1). Returns the job id immediately.
 */
export function startJob<T>(plan: StagePlan, fn: (progress: ProgressFn) => Promise<T>): string {
  sweep();
  const id = crypto.randomUUID().replace(/-/g, "");
  const job: JobState = {
    id,
    status: "running",
    createdAt: Date.now(),
    plan,
    doneWeight: 0,
    lastPct: 0,
    lastStage: plan[0]?.label ?? "scanning",
    events: [],
  };
  jobs.set(id, job);

  const totalWeight = plan.reduce((s, p) => s + p.weight, 0) || 1;
  const progress: ProgressFn = (stageIndex, frac, note) => {
    const clamped = Math.max(0, Math.min(1, frac));
    let done = 0;
    for (let i = 0; i < plan.length; i++) {
      if (i < stageIndex) done += plan[i].weight;
      else if (i === stageIndex) done += plan[i].weight * clamped;
    }
    job.doneWeight = done;
    job.lastPct = Math.min(99.5, (done / totalWeight) * 100);
    job.lastStage = plan[Math.min(stageIndex, plan.length - 1)]?.label ?? job.lastStage;
    if (note || !job.events.length) {
      job.events.push({ at: Date.now(), pct: Math.round(job.lastPct), stage: job.lastStage, note });
      if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS);
    }
  };

  void (async () => {
    try {
      const result = await fn(progress);
      job.result = result;
      job.status = "done";
      job.lastPct = 100;
      job.finishedAt = Date.now();
      job.events.push({ at: Date.now(), pct: 100, stage: "report ready", note: undefined });
    } catch (e) {
      job.status = "error";
      job.finishedAt = Date.now();
      job.error =
        e instanceof Error && "code" in e && typeof (e as { code: unknown }).code === "string"
          ? { code: (e as { code: string }).code, message: e.message }
          : { code: "scan-failed", message: e instanceof Error ? e.message : "Scan failed." };
    }
  })();

  return id;
}

export type JobView = {
  id: string;
  status: JobState["status"];
  pct: number;
  stage: string;
  /** Rough seconds remaining; null when unknown/complete. */
  etaSec: number | null;
  events: JobEvent[];
  result?: unknown;
  error?: { code: string; message: string };
};

/** Linear-extrapolation ETA: elapsed * remaining / completed. */
export function getJob(id: string): JobView | undefined {
  const j = jobs.get(id);
  if (!j) return undefined;
  const elapsed = (j.finishedAt ?? Date.now()) - j.createdAt;
  let etaSec: number | null = null;
  if (j.status === "running") {
    const done = Math.max(j.lastPct, 2.5);
    etaSec = Math.max(1, Math.round((elapsed / 1000) * ((100 - j.lastPct) / done)));
    if (etaSec > 120) etaSec = 120; // past the scan deadline — cap the claim
  }
  return {
    id: j.id,
    status: j.status,
    pct: j.status === "done" ? 100 : Math.round(j.lastPct),
    stage: j.status === "done" ? "report ready" : j.lastStage,
    etaSec,
    events: j.events.slice(-12),
    result: j.status === "done" ? j.result : undefined,
    error: j.status === "error" ? j.error : undefined,
  };
}

/* ---------- shared stage plans (labels surface in the UI) ---------- */

export const URL_PLAN: StagePlan = [
  { label: "fetching page", weight: 45 },
  { label: "auxiliary files & probes", weight: 25 },
  { label: "analyzing & scoring", weight: 30 },
];

export const CODE_PLAN: StagePlan = [
  { label: "parsing source", weight: 30 },
  { label: "running rule packs", weight: 45 },
  { label: "scoring", weight: 25 },
];

/** GitHub repo scans: network-heavy acquisition + an explicit verify stage. */
export const REPO_PLAN: StagePlan = [
  { label: "repo metadata & tree", weight: 20 },
  { label: "fetching selected files", weight: 40 },
  { label: "analyzing & scoring", weight: 25 },
  { label: "verifying findings", weight: 15 },
];
