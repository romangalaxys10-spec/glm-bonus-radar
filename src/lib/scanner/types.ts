/**
 * zScanner — shared types for the three scanners.
 *
 * Findings model follows the ledger research (Semgrep/securityheaders/
 * GEO-checklist style): every check yields a finding with a severity, a
 * machine-readable id, human title/detail and a fix hint. Scores are
 * weighted deductions from 100; "inconclusive" checks are excluded from
 * scoring and surfaced separately — never silently scored as pass/fail.
 */

export type Severity = "critical" | "high" | "medium" | "low" | "info" | "pass";

export type Finding = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Short remediation hint, when applicable. */
  fix?: string;
  /** Truncated raw evidence (rendered as plain text only). */
  evidence?: string;
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

export type UrlScanReport = ScanMeta & {
  scanner: "security" | "geo-seo";
  score: number;
  grade: string;
  findings: Finding[];
  inconclusive?: Inconclusive[];
};

export type CodeScanReport = ScanMeta & {
  scanner: "code";
  language: string;
  linesScanned: number;
  score: number;
  grade: string;
  findings: Finding[];
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
