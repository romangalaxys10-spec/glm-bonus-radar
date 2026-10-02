import { createHash } from "node:crypto";

/**
 * zScanner — shared types for the scanners.
 *
 * Findings model follows the ledger research (Semgrep/securityheaders/
 * GEO-checklist style): every check yields a finding with a severity, a
 * machine-readable id, human title/detail and a fix hint. Scores are
 * weighted deductions from 100; "inconclusive" checks are excluded from
 * scoring and surfaced separately — never silently scored as pass/fail.
 */

export type Severity = "critical" | "high" | "medium" | "low" | "info" | "pass";

/**
 * Verification confidence (GVS5H VERIFY discipline applied to findings):
 * a claimed finding means nothing until it is re-verified.
 *  - confirmed      — re-probed / baseline-checked / fetched blob with path:line /
 *                     second-channel agreement
 *  - single-source  — real evidence, but only one channel saw it (pasted code)
 *  - presence       — derived from the observed response or the authoritative tree
 *  - inferred       — conclusion from an absence (e.g. no lockfile), weakest class
 */
export type Confidence = "confirmed" | "single-source" | "presence" | "inferred";

export type Finding = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Short remediation hint, when applicable. */
  fix?: string;
  /** Truncated raw evidence (rendered as plain text only). */
  evidence?: string;
  /** How the finding was verified before reporting (see Confidence). */
  confidence?: Confidence;
};

/** A check that could not run (network error, unreachable file, etc.). */
export type Inconclusive = {
  id: string;
  what: string;
  why: string;
};

export type ScanMeta = {
  target: string;
  /** Final URL after redirects, when the scan follows them. */
  finalUrl?: string;
  durationMs: number;
  cached: boolean;
  scannedAt: string;
};

/** Per-report verification summary rendered by the UI. */
export type VerificationBlock = {
  /** One-sentence policy: what was re-verified and how. */
  policy: string;
  filesAnalyzed?: number;
  filesSkipped?: number;
  apiCalls?: number;
  treeTruncated?: boolean;
  /** True when the scan used a user-supplied GitHub token (never stored). */
  tokenUsed: boolean;
  /** Findings removed by stable-UID dedup. */
  deduped: number;
  statuses: { confirmed: number; "single-source": number; presence: number; inferred: number };
};

export type UrlScanReport = ScanMeta & {
  scanner: "security" | "geo-seo" | "qa";
  score: number;
  grade: string;
  findings: Finding[];
  inconclusive?: Inconclusive[];
  /** One-line posture summary (Cloudflare security-audit-skill report shape). */
  summary?: string;
  /** Things checked and cleared — surfaced per awesome-skills review format. */
  positives?: string[];
  /** Suspicious surfaces that need a human/agent follow-up. NEVER scored —
   *  severity cannot be assigned to unvalidated leads (CF doctrine). */
  leads?: ScanLead[];
  /** Pillar breakdown 0–100 (linker-style sub-scores), UI draws bars. */
  breakdown?: { label: string; score: number; hint?: string }[];
  /** Fable-style verdict for the QA scanner. */
  verdict?: "ok" | "needs-review" | "blocked";
  /** Verification summary (see VerificationBlock). */
  verification?: VerificationBlock;
};

export type ScanLead = {
  title: string;
  why: string;
  /** Concrete local next step for the validating agent. */
  how?: string;
  evidence?: string;
};

export type CodeScanReport = ScanMeta & {
  scanner: "code";
  language: string;
  linesScanned: number;
  score: number;
  grade: string;
  findings: Finding[];
  positives?: string[];
  inconclusive?: Inconclusive[];
  /** Verification summary (see VerificationBlock). */
  verification?: VerificationBlock;
};

export const SEVERITY_WEIGHT: Record<Exclude<Severity, "info" | "pass">, number> = {
  critical: 40,
  high: 25,
  medium: 12,
  low: 5,
};

export function gradeFor(score: number): string {
  if (score >= 95) return "A+";
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

/** Deduct findings from 100 (severity-weighted, floored at 0). */
export function scoreFindings(findings: Finding[]): { score: number; grade: string } {
  let deduction = 0;
  for (const f of findings) {
    const w = SEVERITY_WEIGHT[f.severity as keyof typeof SEVERITY_WEIGHT];
    if (typeof w === "number") deduction += w;
  }
  const score = Math.max(0, 100 - deduction);
  return { score, grade: gradeFor(score) };
}

export function severityOrder(s: Severity): number {
  const order: Severity[] = ["critical", "high", "medium", "low", "info", "pass"];
  return order.indexOf(s);
}

/** Stable finding UID (fable secmonitor style): sha1(id|evidence)[:12]. */
export function stableUid(id: string, evidence: string): string {
  return createHash("sha1").update(`${id}|${evidence.slice(0, 200)}`).digest("hex").slice(0, 12);
}
