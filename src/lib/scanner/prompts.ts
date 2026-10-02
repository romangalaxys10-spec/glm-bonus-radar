/**
 * zScanner — dev-agent fix-prompt generator.
 *
 * Every report ends with a copy-paste prompt the user hands to their dev
 * agent. Templates follow the source skills' philosophies: Cloudflare
 * security-audit-skill (state the invariant → smallest enforcing change →
 * regression test; leads are validated, never auto-fixed), awesome-skills
 * code-review-skill (severity-ordered, educational, Option A/B on
 * tradeoffs, strengths acknowledged, no style nitpicks) and linker's AI
 * fixer prompts (meta description 120–160 chars in 3 variants with a
 * one-line rationale; titles 50–60 chars; JSON-LD Article/WebPage +
 * Organization minimum). Deterministic — no AI dependency at report time.
 */

import { type CodeScanReport, type Finding, type UrlScanReport } from "./types";

function findingsJson(findings: Finding[], cap = 40): string {
  const compact = findings
    .filter((f) => f.severity !== "pass")
    .slice(0, cap)
    .map((f) => ({ id: f.id, severity: f.severity, title: f.title, evidence: f.evidence, suggested_fix: f.fix }));
  return JSON.stringify(compact, null, 2).slice(0, 14_000);
}

function header(kind: string, target: string, score: number, grade: string, verdict?: string): string {
  const tail = verdict ? ` · verdict: ${verdict}` : "";
  return `You are a senior engineer fixing the findings of a zScanner ${kind} audit of ${target} — score ${score}/100, grade ${grade}${tail}. Today's date: ${new Date().toISOString().slice(0, 10)}.`;
}

function securityPrompt(r: UrlScanReport): string {
  return `${header("Security", r.finalUrl ?? r.target, r.score, r.grade)}

For EACH finding in the JSON below:
1. Open the cited location — response-header config, edge rules, route, or template line.
2. State the security invariant that must hold: which principal, which resource, which trust boundary.
3. Implement the SMALLEST change that enforces that invariant at the last trusted decision point. No defense-in-depth padding, no relocating the check somewhere weaker.
4. Add a regression test that fails before and passes after.
5. Confirm in one sentence why the fix is complete and nothing else regressed.

Rules:
- Fix critical/high first. Commit each fix as \`fix(<id>): <title>\`.
- Never disable or weaken a control to make a test pass.
- Severity must not exceed demonstrated impact — if you cannot reproduce a claimed exposure, downgrade it with evidence instead of "fixing" a non-issue.
- Hardening notes (low/info) go last; batch them into one refactor commit.
- The LEADS section was NOT confirmed by the scanner. Validate each lead manually first (e.g. follow the redirect parameter with an absolute off-site value); only then open a finding.

FINDINGS (JSON):
${findingsJson(r.findings)}

${r.leads?.length ? `LEADS (needs validation — do NOT auto-fix):\n${JSON.stringify(r.leads, null, 2).slice(0, 4000)}` : "LEADS: none."}

If anything is ambiguous after reproduction, ask ONE focused question before editing.`;
}

function geoseoPrompt(r: UrlScanReport): string {
  return `${header("SEO/GEO/Performance", r.finalUrl ?? r.target, r.score, r.grade)}

Act as an SEO + GEO (generative-engine optimization) specialist. For EACH finding in the JSON below produce the exact artifact, not advice:

1. Titles: 50–60 characters (max 70), primary term first, natural separator.
2. Meta descriptions: 120–160 characters — give 3 variants plus a one-line rationale for the recommended one.
3. Structured data: output a complete JSON-LD block — Article/WebPage + Organization at minimum; add FAQPage/HowTo/BreadcrumbList where the finding suggests it. Use only facts already visible on the page; never invent claims, stats or dates.
4. Content gaps (clarity/citation/entity): rewrite the thin section in place, adding 2–3 concrete, sourced facts and one summary list — same voice as the existing page.
5. Performance: name the largest offender first (HTML size, blocking scripts, uncompressed body, missing lazy-loading) and give the smallest config/markup change (e.g. defer/async, edge caching header, loading="lazy").

Output format per finding:
### <id> — <severity>
Change: <exact HTML/header/copy edit, ready to paste>
Why: <one sentence tying it to how search/answer engines score it>

Work top-down by severity. Commit as \`fix(<id>): <title>\`.

FINDINGS (JSON):
${findingsJson(r.findings)}

${r.breakdown?.length ? `Pillar breakdown (0–100): ${r.breakdown.map((b) => `${b.label} ${b.score}`).join(" · ")}. Weakest pillar gets priority.` : ""}`;
}

function qaPrompt(r: UrlScanReport): string {
  return `${header("QA / reliability", r.finalUrl ?? r.target, r.score, r.grade, r.verdict)}

For EACH finding in the JSON below:
1. Reproduce it (curl the URL, load the page, follow the link).
2. Fix the root cause, not the symptom — a 404 fix that 302s to the home page is not a fix.
3. Add the missing guard so it cannot regress (route test, link checker in CI, error-page template).
4. Note the blast radius: what else this change could affect.

Rules:
- Fix in order: blocked (outage) → high → medium → low.
- Commit each as \`fix(<id>): <title>\`.
- If the site returns 200 for unknown paths (soft-404), fix that FIRST — it hides every other routing bug from tools and users.

FINDINGS (JSON):
${findingsJson(r.findings)}

${r.positives?.length ? `Already healthy (do not touch): ${r.positives.join("; ")}.` : ""}`;
}

function codePrompt(r: CodeScanReport): string {
  return `${header("Code review", `pasted ${r.language} snippet (${r.linesScanned} lines)`, r.score, r.grade)}

Apply PR-review discipline to the findings below:
1. Acknowledge what is already solid first (structure, naming, tests) — then findings.
2. For each finding: severity label, exact location (line from evidence), WHY it matters (the failure scenario, not the rule name), and the smallest change that fixes it.
3. Where two reasonable designs exist, give Option A / Option B with the tradeoff in one line each — do not command, propose.
4. Behavioral bugs (injection sinks, unsafe deserialization, broken verification) are blocking: fix before merge. Info-tier items are suggestions; do not block on them.
5. Add or adapt one test that proves the fix for each blocking finding.

Rules:
- Keep public behavior unless the finding itself is behavioral.
- No formatting nitpicks — linters do that job.
- If evidence points at generated or vendored code, fix the generator/source, not the artifact.

FINDINGS (JSON):
${findingsJson(r.findings)}

Return the corrected code in full, followed by a one-paragraph review summary.`;
}

export function fixPromptFor(report: UrlScanReport | CodeScanReport): string {
  switch (report.scanner) {
    case "security":
      return securityPrompt(report);
    case "geo-seo":
      return geoseoPrompt(report);
    case "qa":
      return qaPrompt(report);
    case "code":
      return codePrompt(report);
  }
}
