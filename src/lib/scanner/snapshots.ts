/**
 * zScanner v4 — durable scan snapshots + before/after diffing.
 *
 * "Each scan gives the user a token he can save, to use for the next scan
 * to compare his previous state with the after-fixing state and see what is
 * left to fix, or what new issues appeared."
 *
 * Design (ledger .smart/fcc7905a):
 *  - Storage is SQLite (Prisma ScanSnapshot) — the only store that survives
 *    process restarts on this host; the jobs registry is memory-only/TTL'd.
 *  - Tokens are user-friendly handles: ZSC-XXXX-XXXX-XXXX-XXXX, 80-bit from
 *    crypto.randomBytes, 32-char alphabet without I/O lookalikes.
 *  - Cross-scan identity: fingerprint = sha1(ruleId | normalizedEvidence).
 *    Evidence is normalized (lowercase, whitespace-collapsed, digit runs →
 *    '#') so volatile metrics (TTFB ms, payload KB, counts) never flip an
 *    issue between fixed/new. Distinct instances that differ only by digits
 *    may merge — the common case (stable identity) wins.
 *  - A diff is only computed for the SAME scanner kind and the SAME target
 *    key (hostname / owner-repo / pasted-source); anything else gets an
 *    honest diffNote instead of a misleading comparison.
 *  - Rows never contain user GitHub tokens: repo reports are scrubbed by
 *    the github route before they reach this module.
 *  - Retention: 90 days globally, newest 40 per (scanner, targetKey).
 */

import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { type Finding, type ScanDiff, type ScanDiffEntry, type ScannerKind, type SnapshotSummary, severityOrder } from "./types";

/* ------------------------------- tokens -------------------------------- */

// 32 chars, no I/O lookalikes: 5 bits per char, 16 chars = 80 bits.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const TOKEN_CHARS = 16;

export function mintScanToken(): string {
  const bytes = randomBytes(TOKEN_CHARS); // 8 bits/char → plenty for 5-bit picks
  let out = "";
  for (let i = 0; i < TOKEN_CHARS; i++) out += ALPHABET[bytes[i] & 31];
  return `ZSC-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

/** Accept user input loosely ("zsc-xxxx-xxxx…", lowercase, spaced) — return canonical or null. */
export function normalizeScanToken(raw: string): string | null {
  const up = raw.toUpperCase().replace(/[\s-]+/g, "").replace(/^ZSC/, "");
  if (up.length !== TOKEN_CHARS) return null;
  for (const ch of up) if (!ALPHABET.includes(ch)) return null;
  return `ZSC-${up.slice(0, 4)}-${up.slice(4, 8)}-${up.slice(8, 12)}-${up.slice(12, 16)}`;
}

/* ---------------------------- fingerprints ----------------------------- */

/** Mask digit runs + collapse whitespace: "TTFB 1420 ms" ≡ "TTFB 1387 ms". */
function normEvidence(e: string): string {
  return e.toLowerCase().replace(/\s+/g, " ").replace(/\d+/g, "#").trim();
}

/** Stable cross-scan identity of a finding (diff-level, not dedup-level). */
export function diffFingerprint(f: Finding): string {
  return createHash("sha1").update(`${f.id}|${normEvidence(f.evidence ?? "")}`).digest("hex").slice(0, 12);
}

/* ------------------------------ target key ----------------------------- */

/**
 * Comparison identity. URL scans compare per-site (host), repo scans per
 * owner/repo, pasted code per "pasted-source" (the fix-loop use case: paste
 * the corrected code and diff).
 */
export function targetKeyFor(scanner: ScannerKind, target: string): string {
  if (scanner === "code" && !/github\.com\//i.test(target)) return "pasted-source";
  const gh = target.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (gh) return `${gh[1]}/${gh[2]}`.replace(/\.git$/i, "").toLowerCase();
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `https://${target}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return target.toLowerCase().slice(0, 200);
  }
}

/* -------------------------------- diff --------------------------------- */

const DIFFABLE = (f: Finding) => f.severity !== "pass";

export function diffFindings(prev: Finding[], curr: Finding[]): Omit<ScanDiff, "prevToken" | "prevDate" | "scoreBefore" | "scoreAfter"> {
  const prevMap = new Map<string, Finding>();
  for (const f of prev) if (DIFFABLE(f)) prevMap.set(diffFingerprint(f), f);
  const currMap = new Map<string, Finding>();
  for (const f of curr) if (DIFFABLE(f)) currMap.set(diffFingerprint(f), f);

  const fixed: Finding[] = [];
  const remaining: ScanDiffEntry[] = [];
  const added: Finding[] = [];

  for (const [fp, before] of prevMap) {
    const after = currMap.get(fp);
    if (after) remaining.push({ before, after });
    else fixed.push(before);
  }
  for (const [fp, after] of currMap) if (!prevMap.has(fp)) added.push(after);

  const bySev = (a: Finding, b: Finding) => severityOrder(a.severity) - severityOrder(b.severity);
  fixed.sort(bySev);
  added.sort(bySev);
  remaining.sort((a, b) => severityOrder(a.after.severity) - severityOrder(b.after.severity));
  return { fixed, remaining, added };
}

/* ------------------------------- storage ------------------------------- */

const RETAIN_DAYS = 90;
const RETAIN_PER_TARGET = 40;
const CACHE_REUSE_MS = 10 * 60_000; // mirrors guard.cachedScan TTL

type Reportish = { target: string; score: number; grade: string; findings: Finding[] };

export type SnapshotOutcome = { token: string; diff?: ScanDiff; diffNote?: string };

/**
 * Route-side wrapper: strip v4 fields + the cache flag from a finished
 * report, store it under a fresh token, optionally diff against the user's
 * saved token, and merge the outcome into the job result.
 */
export async function finishScan<T extends Reportish & { scanner: ScannerKind; cached?: boolean; scanToken?: string; diff?: unknown; diffNote?: string }>(args: {
  report: T;
  compareToken?: string;
}): Promise<T & { scanToken: string; diff: ScanDiff | null; diffNote?: string }> {
  try {
    const { cached, scanToken: _s, diff: _d, diffNote: _n, ...clean } = args.report;
    const outcome = await recordScanSnapshot({
      scanner: args.report.scanner,
      target: args.report.target,
      report: clean,
      compareToken: args.compareToken,
      cached,
    });
    return {
      ...args.report,
      scanToken: outcome.token,
      diff: outcome.diff ?? null,
      ...(outcome.diffNote ? { diffNote: outcome.diffNote } : {}),
    };
  } catch {
    // A snapshot problem must never take the scan report down with it.
    return { ...args.report, scanToken: "", diff: null, diffNote: "Snapshot storage unavailable — this scan was not saved under a token." };
  }
}

/**
 * Store a finished scan under a fresh token; optionally diff against a
 * user-supplied previous token. Never throws into the scan path — a
 * storage hiccup degrades to "scan stored without comparison".
 */
export async function recordScanSnapshot(opts: {
  scanner: ScannerKind;
  target: string;
  report: Reportish;
  compareToken?: string;
  /** True when guard.cachedScan served a hit — reuse the recent row. */
  cached?: boolean;
}): Promise<SnapshotOutcome> {
  const targetKey = targetKeyFor(opts.scanner, opts.target);
  let outcome: SnapshotOutcome = { token: "" };

  // 1) Optional comparison against a saved token.
  let prevRow: { token: string; reportJson: string; score: number; createdAt: Date } | null = null;
  const asked = opts.compareToken?.trim();
  if (asked) {
    const norm = normalizeScanToken(asked);
    if (!norm) {
      outcome.diffNote = "That does not look like a zScanner token (expected ZSC-XXXX-XXXX-XXXX-XXXX) — scan stored without comparison.";
    } else {
      try {
        prevRow = await db.scanSnapshot.findUnique({ where: { token: norm } });
      } catch {
        prevRow = null;
      }
      if (!prevRow) {
        outcome.diffNote = "Saved token not found — expired (90-day retention) or mistyped. This scan is stored without comparison.";
      } else {
        const prev = safeParse(prevRow.reportJson) as (Reportish & { scanner?: string }) | null;
        if (!prev || !Array.isArray(prev.findings)) {
          outcome.diffNote = "Saved token points to an unreadable snapshot — comparison skipped.";
          prevRow = null;
        } else if (prev.scanner !== opts.scanner) {
          outcome.diffNote = `Token is from a different scanner (${prev.scanner ?? "unknown"}, this is ${opts.scanner}) — run the same scanner to compare.`;
          prevRow = null;
        } else if (targetKeyFor((prev.scanner ?? opts.scanner) as ScannerKind, prev.target) !== targetKey) {
          outcome.diffNote = `Token is for a different target (${prev.target}) — comparison skipped.`;
          prevRow = null;
        }
      }
    }
  }

  // 2) Compute the diff while both sides are in hand.
  if (prevRow) {
    const prev = safeParse(prevRow.reportJson) as Reportish & { scanner?: string };
    const { fixed, remaining, added } = diffFindings(prev.findings, opts.report.findings);
    outcome.diff = {
      prevToken: prevRow.token,
      prevDate: prevRow.createdAt.toISOString(),
      scoreBefore: prevRow.score,
      scoreAfter: opts.report.score,
      fixed,
      remaining,
      added,
    };
  }

  // 3) Persist (or reuse the row a cached report already produced).
  const clean = JSON.stringify(opts.report);
  try {
    if (opts.cached) {
      const recent = await db.scanSnapshot.findFirst({
        where: { scanner: opts.scanner, targetKey, createdAt: { gte: new Date(Date.now() - CACHE_REUSE_MS) } },
        orderBy: { createdAt: "desc" },
      });
      if (recent && recent.reportJson === clean) {
        outcome.token = recent.token;
        return outcome;
      }
    }
    outcome.token = await insertWithRetry({ scanner: opts.scanner, targetKey, target: opts.report.target, score: opts.report.score, grade: opts.report.grade, reportJson: clean });
  } catch {
    // Storage unavailable — the scan itself still ships.
    if (!outcome.diffNote) outcome.diffNote = "Snapshot storage unavailable — this scan was not saved under a token.";
    outcome.token = outcome.token || "";
  }

  // 4) Best-effort retention sweep (never blocks the report).
  void pruneSnapshots(opts.scanner, targetKey).catch(() => undefined);
  return outcome;
}

async function insertWithRetry(row: { scanner: string; targetKey: string; target: string; score: number; grade: string; reportJson: string }): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = mintScanToken();
    try {
      await db.scanSnapshot.create({ data: { ...row, token } });
      return token;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "P2002" || attempt === 1) throw e; // unique collision → remint once
    }
  }
  throw new Error("unreachable");
}

async function pruneSnapshots(scanner: string, targetKey: string): Promise<void> {
  await db.scanSnapshot.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETAIN_DAYS * 86_400_000) } } });
  const keep = await db.scanSnapshot.findMany({
    where: { scanner, targetKey },
    orderBy: { createdAt: "desc" },
    take: RETAIN_PER_TARGET,
    select: { id: true },
  });
  if (keep.length === RETAIN_PER_TARGET) {
    const cutoff = await db.scanSnapshot.findFirst({ where: { scanner, targetKey }, orderBy: { createdAt: "desc" }, skip: RETAIN_PER_TARGET - 1, take: 1, select: { createdAt: true } });
    if (cutoff) await db.scanSnapshot.deleteMany({ where: { scanner, targetKey, createdAt: { lt: cutoff.createdAt } } });
  }
}

function safeParse(json: string): Record<string, unknown> | null {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* ------------------------------- lookup -------------------------------- */

/** Preflight a saved token for the UI compare field (null = unknown/expired). */
export async function getSnapshotSummary(rawToken: string): Promise<SnapshotSummary | null> {
  const token = normalizeScanToken(rawToken);
  if (!token) return null;
  const row = await db.scanSnapshot.findUnique({ where: { token } });
  if (!row) return null;
  const report = safeParse(row.reportJson) as { findings?: Finding[] } | null;
  return {
    token: row.token,
    scanner: row.scanner as ScannerKind,
    target: row.target,
    score: row.score,
    grade: row.grade,
    createdAt: row.createdAt.toISOString(),
    findings: Array.isArray(report?.findings) ? report.findings.length : 0,
  };
}
