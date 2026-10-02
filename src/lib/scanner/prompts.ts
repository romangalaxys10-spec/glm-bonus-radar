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

/**
 * v4 — when the report carries a diff, the prompt targets the OPEN issues
 * only (still open + newly introduced). Fixed ones are listed separately as
 * do-not-regress, so the dev agent spends its budget on what is left.
 */
function effectiveFindings(r: UrlScanReport | CodeScanReport): Finding[] {
  const d = r.diff;
  if (!d) return r.findings;
  return [...d.remaining.map((e) => e.after), ...d.added];
}

function header(kind: string, target: string, score: number, grade: string, verdict?: string): string {
  const tail = verdict ? ` · verdict: ${verdict}` : "";
  const repo = /github\.com\//.test(target) ? " The target is a git repository — findings cite file paths (path:line where available); open each file before editing." : "";
  return `You are a senior engineer fixing the findings of a zScanner ${kind} audit of ${target} — score ${score}/100, grade ${grade}${tail}. Today's date: ${new Date().toISOString().slice(0, 10)}.${repo}`;
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
${findingsJson(effectiveFindings(r))}

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
${findingsJson(effectiveFindings(r))}

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
${findingsJson(effectiveFindings(r))}

${r.positives?.length ? `Already healthy (do not touch): ${r.positives.join("; ")}.` : ""}`;
}

/**
 * v5 — auto QA auditor (real-browser E2E). The prompt carries measured run
 * facts (console errors, failed requests, axe violations, login oracle
 * result, LCP/TTFB) and follows qa-skills doctrine: reproduce → fix the
 * root cause → add the missing guard, ordered by severity, one commit per
 * finding. Explicitly forbids "fixing" findings that were only leads.
 */
function autoQaPrompt(r: UrlScanReport): string {
  const m = (r.metrics ?? []).map((x) => `- ${x.label}: ${x.value}`).join("\n");
  return `${header("auto QA (real-browser end-to-end)", r.finalUrl ?? r.target, r.score, r.grade, r.verdict)}

A headless browser drove the app end-to-end and recorded the findings below.
Measured run facts:
${m || "- (none)"}

For EACH finding in the JSON below:
1. Reproduce it the way the auditor saw it — open the cited URL, exercise the cited interaction, watch the console.
2. Fix the root cause, not the symptom (an error silenced in the console is not a fix; a 404 that redirects home is not a fix).
3. Add the missing guard so it cannot regress: a Playwright/CI test asserting the fixed behavior, an axe-core check for a11y regressions, a console-error gate ("page raises zero errors") for JS health.
4. State the blast radius and note any finding you can NOT reproduce with evidence.

Rules:
- Fix in order: critical → high → medium → low; do not touch "lead" items — they need human validation first.
- If the login oracle failed, verify the credentials flow manually before touching anything else; every authenticated finding depends on it.
- A11y findings: fix the semantics (native element / ARIA state), not the axe rule.
- Commit each as \`fix(<id>): <title>\` and re-run the audit token afterwards to prove fixed/open/new.

FINDINGS (JSON):
${findingsJson(effectiveFindings(r))}

${r.positives?.length ? `Already healthy (do not touch): ${r.positives.join("; ")}.` : ""}

Return: the plan (order + blast radius), the fixes, and the new/changed tests.`;
}

/**
 * Task 39 — Anti AI-Slop Reviewer. The rewrite brief follows the
 * unslop-my-ui editor contract (inventory → keep → direction → plan →
 * concrete edits) under gstack's "would a studio designer ship this?"
 * doctrine. Blunt; delete-and-simplify beats decoration.
 */
function slopPrompt(r: UrlScanReport): string {
  return `${header("Anti AI-Slop review", r.finalUrl ?? r.target, r.score, r.grade)}

You are a ruthless UI editor. Unslop this page: remove the generic AI defaults and restore intentional craft. The audit already ran deterministic detectors (gstack design-review blacklist, Gesso guards, sloptrim wordlists) — their findings are the inventory below.

For EACH finding in the JSON:
1. Locate it in the source (the evidence quotes the class names, colors or copy that fired).
2. Decide: delete, replace, or keep-with-reason. Prefer delete-and-simplify over more decoration.
3. Apply the concrete edit — exact CSS/JSX/copy replacement, ready to paste. Palette suggestions carry hex or OKLCH values; type swaps name the actual face.
4. Quote the BEFORE and AFTER so the change can be reviewed without opening the file.

Keep anything that is clearly brand-mandated or required for accessibility — the keep-list below is the do-not-touch set; extend it only with the same standard.

Unslop direction requirements in the final summary:
- Name the aesthetic this page should have in 2–5 words (it must fit THIS product).
- One signature move; everything else gets quieter.
- Palette roles with values (bg, surface, ink, muted, accent, border).
- Type pairing (display + body) — ban the fonts you removed.
- What NOT to do on the next pass.

Rules:
- Critical/high first (gradient text, purple/indigo band, 3-col icon grids, generic hero copy). Commit each as \`fix(<id>): <title>\`.
- One solid accent the palette owns — no gradient fills on text, buttons or cards.
- Every edit must survive the test: would a human designer at a respected studio ship this?
- Re-run the review token afterwards; the goal is a slop grade of B or better with zero critical/high tells.

FINDINGS (JSON):
${findingsJson(effectiveFindings(r))}

${r.metrics?.length ? `Measured context: ${r.metrics.map((x) => `${x.label}=${x.value}`).join(" · ")}.` : ""}
${r.positives?.length ? `KEEP — already works, do not rewrite for sport: ${r.positives.join("; ")}.` : ""}`;
}

function codePrompt(r: CodeScanReport): string {
  const isRepo = r.target !== "pasted-source";
  return `${header("Code review", isRepo ? `${r.target} — repo mode (${r.linesScanned} lines across ${r.verification?.filesAnalyzed ?? "?"} files)` : `pasted ${r.language} snippet (${r.linesScanned} lines)`, r.score, r.grade)}

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
${findingsJson(effectiveFindings(r))}

Return the corrected code in full, followed by a one-paragraph review summary.`;
}

export function fixPromptFor(report: UrlScanReport | CodeScanReport): string {
  const d = report.diff;
  const base = (() => {
    switch (report.scanner) {
      case "security":
        return securityPrompt(report);
      case "geo-seo":
        return geoseoPrompt(report);
      case "qa":
        return qaPrompt(report);
      case "auto-qa":
        return autoQaPrompt(report);
      case "slop":
        return slopPrompt(report);
      case "code":
        return codePrompt(report);
    }
  })();
  if (!d) return base;

  const open = d.remaining.length + d.added.length;
  const delta = report.score - d.scoreBefore;
  const day = d.prevDate.slice(0, 10);
  const head = `RE-SCAN CONTEXT: follow-up audit compared with token ${d.prevToken} (${day}) — score ${d.scoreBefore}/100 → ${report.score}/100 (${delta >= 0 ? "+" : ""}${delta}). ${d.fixed.length} earlier finding(s) are FIXED; ${d.remaining.length} still open, ${d.added.length} newly introduced. Work ONLY on the open issues in the FINDINGS section below.${open === 0 ? " Nothing is open — do not invent work." : ""}\n\n`;
  if (open === 0) return `${head}All previously reported findings are fixed. Re-scan after your next change to confirm the fixed state holds.${d.fixed.length ? `\n\nDO NOT REGRESS (fixed since ${day} — keep them green):\n${d.fixed.map((f, i) => `${i + 1}. [${f.severity}] ${f.title}`).join("\n").slice(0, 2000)}` : ""}`;
  const tail = d.fixed.length ? `\n\nDO NOT REGRESS (fixed since ${day} — keep them green):\n${d.fixed.map((f, i) => `${i + 1}. [${f.severity}] ${f.title}`).join("\n").slice(0, 2000)}` : "";
  return head + base + tail;
}
