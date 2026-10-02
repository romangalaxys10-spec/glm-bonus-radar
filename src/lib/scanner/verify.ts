/**
 * zScanner — the verification pass (ledger 9b4ac333, T6).
 *
 * This is the GVS5H VERIFY discipline turned into product: a checker's
 * claim means nothing until it is re-verified. Three mechanical layers:
 *
 *   1. dedupeFindings — stable-UID dedup so the same finding found twice
 *      (same rule, same evidence) never double-counts.
 *   2. tag            — confidence assignment per the Confidence lattice
 *      (confirmed > single-source > presence > inferred).
 *   3. verificationBlock — the per-report summary the UI renders above
 *      the fix prompt, so the reader sees exactly how much of the report
 *      was independently verified and by what policy.
 *
 * Scanners keep their own stronger layers on top (404 baselines, second
 * GitHub channel for critical secrets); this module is the shared floor.
 */

import { type Confidence, type Finding, type VerificationBlock, stableUid } from "./types";

export const VERIFY_POLICY =
  "findings were re-verified before reporting: probes checked against a 404 baseline or repeated, header checks reflect the observed response, repo findings cite path:line from fetched blobs, critical secrets were re-confirmed through a second GitHub channel, and unvalidated suspicions stay in leads — never scored.";

export function countStatuses(findings: Finding[]): VerificationBlock["statuses"] {
  const s: VerificationBlock["statuses"] = { confirmed: 0, "single-source": 0, presence: 0, inferred: 0 };
  for (const f of findings) if (f.confidence) s[f.confidence]++;
  return s;
}

/** Stable-UID dedup: same rule on the same evidence collapses to one finding. */
export function dedupeFindings(findings: Finding[]): { findings: Finding[]; deduped: number } {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const uid = stableUid(f.id, f.evidence ?? `${f.title}|${f.detail}`);
    if (seen.has(uid)) continue;
    seen.add(uid);
    out.push(f);
  }
  return { findings: out, deduped: findings.length - out.length };
}

/**
 * Assign confidence to every finding that does not already carry one.
 * `override` can upgrade individual findings (e.g. probe-verified ones).
 */
export function tag(findings: Finding[], confidence: Confidence, override?: (f: Finding) => Confidence | undefined): void {
  for (const f of findings) {
    const v = override?.(f);
    f.confidence = v ?? f.confidence ?? confidence;
  }
}

export function verificationBlock(
  findings: Finding[],
  deduped: number,
  extra: { filesAnalyzed?: number; filesSkipped?: number; apiCalls?: number; treeTruncated?: boolean; tokenUsed: boolean }
): VerificationBlock {
  return {
    policy: VERIFY_POLICY,
    statuses: countStatuses(findings),
    deduped,
    ...extra,
  };
}
