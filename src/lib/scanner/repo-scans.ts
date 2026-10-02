/**
 * zScanner — GitHub repo scanning layer for all four scanners
 * (ledger 9b4ac333, IDEATE Approach A).
 *
 * Presence checks read straight off the authoritative git tree (zero
 * fetches). Content checks fetch a risk-ranked, capped file selection
 * from raw.githubusercontent.com (CDN — outside the API quota). Critical
 * secret findings are re-confirmed through a second, independent GitHub
 * channel (Contents API raw) before the report claims them.
 *
 * Token secrecy: the token only flows through this file as a parameter
 * into github.ts; findings and evidence are scrubbed with scrubToken()
 * before anything leaves the process.
 */

import {
  type CodeScanReport,
  type Finding,
  type Inconclusive,
  type ScanLead,
  type UrlScanReport,
  type VerificationBlock,
  SEVERITY_WEIGHT,
  gradeFor,
  scoreFindings,
  severityOrder,
} from "./types";
import { ScanError } from "./fetcher";
import {
  SECRET_LINE_RULES,
  applyAggregates,
  applyRules,
  dependencyFindings,
  detectLanguage,
  lineRulesFor,
} from "./code-review";
import {
  fetchApiRawFile,
  fetchRawFile,
  getRepoMeta,
  getRepoTree,
  parseRepoTarget,
  scrubToken,
  type GhRepoMeta,
  type GhRepoRef,
  type GhTree,
  type RawFile,
} from "./github";
import { dedupeFindings, tag, verificationBlock } from "./verify";

export type RepoScanKind = "security" | "geo-seo" | "qa" | "code";

type StageProgress = (stageIndex: number, frac: number, note?: string) => void;

const FETCH_CONCURRENCY = 6;
const SCAN_BUDGET_MS = 75_000;
const FILE_CAP = 160 * 1024;
const MAX_LINES = 5000;

/* ---------------- path classification ---------------- */

const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb|go|php|java|cs)$/i;
const SKIP_PATH = /(?:^|\/)(?:node_modules|vendor|dist|build|out|coverage|__tests__|__snapshots__|\.git)(?:\/|$)/i;
const GENERATED = /\.(?:min|bundle)\.(?:js|jsx|ts)$/i;
const DECL = /\.d\.ts$/i;
const LOCKFILE =
  /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|poetry\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock)$/i;
const TESTISH = /(?:^|\/)(?:tests?|spec|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:go|py)$/i;

const SENSITIVE =
  /(?:^|\/)\.env(?:\.[^/]*)?$|\.pem$|\.key$|(?:^|\/)id_rsa|\.pfx$|\.p12$|(?:^|\/)credentials|\.npmrc$|(?:^|\/)Dockerfile$|(?:^|\/)docker-compose[^/]*$/i;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/i;
const MANIFEST = /^(?:package\.json|requirements\.txt)$/i;

const ENV_EXAMPLE = /\.(?:example|sample|template)$/i;
const ENV_FILE = /(?:^|\/)\.env(?:\.[^/]*)?$/i;
const KEY_FILE = /(?:^|\/)id_rsa|\.pem$|\.key$|\.pfx$|\.p12$/i;

const TEST_SIGNAL =
  /(?:^|\/)(?:tests?|spec|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:go|py)$|(?:^|\/)test_[^/]+\.py$/i;
const CI_WORKFLOW = WORKFLOW;
const LINT_CONFIG =
  /(?:^|\/)(?:\.eslintrc(?:\.[^/]+)?$|eslint\.config\.[^/]+$|\.prettierrc(?:\.[^/]+)?$|prettier\.config\.[^/]+$|biome\.json$|ruff\.toml$|\.flake8$|setup\.cfg$|pyproject\.toml$|\.stylelintrc(?:\.[^/]+)?$|\.rubocop\.yml$)/i;
const README = /(?:^|\/)readme(?:\.[^/]*)?$/i;
const TS_CONFIG = /^(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json$/i;

function langFromExt(path: string): string | null {
  if (/\.(?:ts|tsx|mts|cts)$/i.test(path)) return "typescript";
  if (/\.(?:js|jsx|mjs|cjs)$/i.test(path)) return "javascript";
  if (/\.py$/i.test(path)) return "python";
  return null;
}

/** Risk rank for source-file selection (higher = more interesting). */
export function codePathScore(path: string, size: number): number {
  let s = Math.min(4, Math.log2(Math.max(1, size) / 512 + 1));
  if (/^(?:src|app|lib|api|server|routes|controllers|services|auth|db|database|core|internal)\//i.test(path)) s += 4;
  if (/(?:auth|admin|login|session|config|secret|token|credential|payment|billing|sql|query|migration|user)/i.test(path)) s += 3;
  if (CODE_EXT.test(path)) s += 2;
  if (!path.includes("/")) s += 1;
  if (TESTISH.test(path)) s -= 3;
  if (DECL.test(path) || GENERATED.test(path)) s -= 8;
  return s;
}

export function pickCodeFiles(tree: GhTree, cap: number): string[] {
  return tree.blobs
    .filter((b) => CODE_EXT.test(b.path) && !SKIP_PATH.test(b.path) && !LOCKFILE.test(b.path) && !GENERATED.test(b.path) && !DECL.test(b.path))
    .map((b) => ({ path: b.path, s: codePathScore(b.path, b.size) }))
    .sort((a, b) => b.s - a.s || a.path.localeCompare(b.path))
    .slice(0, cap)
    .map((x) => x.path);
}

export function pickSecurityFiles(tree: GhTree, codeFiles: string[]): string[] {
  const paths = new Set<string>();
  for (const b of tree.blobs) {
    if (SKIP_PATH.test(b.path) || LOCKFILE.test(b.path)) continue;
    if (SENSITIVE.test(b.path) && paths.size < 6) paths.add(b.path);
  }
  const workflows = tree.blobs.filter((b) => WORKFLOW.test(b.path)).map((b) => b.path).sort().slice(0, 3);
  for (const w of workflows) paths.add(w);
  for (const b of tree.blobs) if (MANIFEST.test(b.path) && paths.size < 10) paths.add(b.path);
  for (const c of codeFiles.slice(0, 3)) if (paths.size < 13) paths.add(c);
  return [...paths].slice(0, 13);
}

/* ---------------- fetching ---------------- */

type FetchedSet = { files: Map<string, RawFile>; skipped: string[]; fetchErrors: string[] };

async function fetchSelected(
  ref: GhRepoRef,
  branch: string,
  paths: string[],
  token: string | undefined,
  stage: number,
  progress: StageProgress
): Promise<FetchedSet> {
  const files = new Map<string, RawFile>();
  const skipped: string[] = [];
  const fetchErrors: string[] = [];
  const deadline = Date.now() + SCAN_BUDGET_MS;
  let done = 0;

  const worker = async (queue: string[]): Promise<void> => {
    while (queue.length) {
      const path = queue.shift();
      if (path === undefined) return;
      if (Date.now() > deadline) {
        skipped.push(path);
        done++;
        continue;
      }
      try {
        const f = await fetchRawFile(ref, branch, path, token, FILE_CAP);
        if (f) files.set(path, f);
        else skipped.push(path); // vanished between tree and fetch
      } catch (e) {
        fetchErrors.push(`${path}: ${e instanceof Error ? e.message : "fetch failed"}`);
      }
      done++;
      progress(stage, done / paths.length, `fetching ${path}`);
    }
  };

  const queue = [...paths];
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, () => worker(queue)));
  return { files, skipped, fetchErrors };
}

/* ---------------- shared verification tail ---------------- */

type VerifyMeta = {
  token: string | undefined;
  filesAnalyzed: number;
  skipped: number;
  apiCalls: number;
  treeTruncated: boolean;
};

async function finalizeRepoFindings(
  rawFindings: Finding[],
  ref: GhRepoRef,
  branch: string,
  meta: VerifyMeta
): Promise<{ findings: Finding[]; block: VerificationBlock }> {
  // Evidence hygiene first: the user's own token must never be reflected back.
  for (const f of rawFindings) {
    if (f.evidence) f.evidence = scrubToken(f.evidence, meta.token);
    f.title = scrubToken(f.title, meta.token);
  }
  tag(rawFindings, "confirmed"); // content findings cite path:line from fetched blobs
  const dedup = dedupeFindings(rawFindings);

  // Second channel: critical secrets must survive an independent fetch
  // (Contents API raw — different host + pipeline) to stay "confirmed".
  let apiCalls = meta.apiCalls;
  const criticalPaths = [
    ...new Set(
      dedup.findings
        .filter((f) => f.severity === "critical" && f.evidence?.includes(":"))
        .map((f) => f.evidence!.slice(0, f.evidence!.lastIndexOf(":line")).split(":line")[0])
        .filter(Boolean)
    ),
  ].slice(0, 3);

  for (const path of criticalPaths) {
    try {
      const fresh = await fetchApiRawFile(ref, branch, path, meta.token, FILE_CAP);
      apiCalls++;
      if (!fresh) continue;
      const lang = langFromExt(path) ?? detectLanguage(fresh.text);
      const freshIds = new Set(applyRules(fresh.text.slice(0, FILE_CAP).split(/\r?\n/).slice(0, MAX_LINES), lineRulesFor(lang)).map((f) => f.id));
      for (const f of dedup.findings) {
        if (f.severity === "critical" && f.evidence?.startsWith(`${path}:`) && !freshIds.has(f.id))
          f.confidence = "single-source"; // did not reproduce on the second channel
      }
    } catch {
      // second channel unavailable — first-channel evidence stands as-is
    }
  }

  const block = verificationBlock(dedup.findings, dedup.deduped, {
    filesAnalyzed: meta.filesAnalyzed,
    filesSkipped: meta.skipped,
    apiCalls,
    treeTruncated: meta.treeTruncated,
    tokenUsed: Boolean(meta.token),
  });
  return { findings: dedup.findings, block };
}

/* ---------------- repo code review ---------------- */

const CODE_FILE_CAP = 14;

async function repoCodeScan(
  ref: GhRepoRef,
  meta: GhRepoMeta,
  tree: GhTree,
  branch: string,
  token: string | undefined,
  progress: StageProgress
): Promise<CodeScanReport> {
  const started = Date.now();
  const wanted = new Set(pickCodeFiles(tree, CODE_FILE_CAP));
  for (const b of tree.blobs) if (MANIFEST.test(b.path) && wanted.size < CODE_FILE_CAP + 2) wanted.add(b.path);

  progress(1, 0.15, `fetching ${wanted.size} files`);
  const { files, skipped, fetchErrors } = await fetchSelected(ref, branch, [...wanted], token, 1, progress);
  progress(1, 1, `${files.size} files fetched`);

  type PerFile = { language: string; lines: number; score: number; findings: Finding[] };
  const perFile: PerFile[] = [];
  const all: Finding[] = [];
  let analyzed = 0;

  files.forEach((file, path) => {
    const language = langFromExt(path) ?? detectLanguage(file.text);
    const lines = file.text.slice(0, FILE_CAP).split(/\r?\n/).slice(0, MAX_LINES);
    const rules = lineRulesFor(language);
    const fFindings = applyRules(lines, rules);
    for (const f of fFindings) if (f.evidence) f.evidence = `${path}:${f.evidence}`;
    fFindings.push(...applyAggregates(file.text.slice(0, FILE_CAP)));
    if (MANIFEST.test(path)) fFindings.push(...dependencyFindings(file.text.slice(0, FILE_CAP)));
    const { score } = scoreFindings(fFindings);
    perFile.push({ language, lines: lines.length, score, findings: fFindings });
    all.push(...fFindings);
    if (fFindings.some((f) => f.severity !== "pass")) analyzed++;
  });

  progress(2, 0.6, "scoring");

  // Lines-weighted average so one bad small file cannot erase a clean repo.
  const totalLines = perFile.reduce((s, p) => s + p.lines, 0) || 1;
  const score = Math.round(perFile.reduce((s, p) => s + p.score * p.lines, 0) / totalLines);
  const grade = gradeFor(score);
  const language =
    meta.language ??
    [...perFile.reduce((m, p) => m.set(p.language, (m.get(p.language) ?? 0) + p.lines), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "unknown";

  const clean = perFile.filter((p) => !p.findings.some((f) => f.severity !== "pass")).length;
  const severe = all.filter((f) => f.severity === "critical" || f.severity === "high").length;
  const positives = severe
    ? undefined
    : [
        `${clean}/${perFile.length} scanned files came back clean`,
        meta.language ? `GitHub language: ${meta.language}` : "",
      ].filter(Boolean);

  all.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
  if (!all.length)
    all.push({ id: "clean", severity: "pass", title: "No rule-pack findings", detail: `Heuristic packs across ${perFile.length} files (${totalLines} lines) found no matches.` });

  const { findings, block } = await finalizeRepoFindings(all.slice(0, 60), ref, branch, {
    token,
    filesAnalyzed: perFile.length,
    skipped: skipped.length,
    apiCalls: 2,
    treeTruncated: tree.truncated,
  });
  progress(2, 1);

  const inconclusive: Inconclusive[] = [];
  if (tree.truncated) inconclusive.push({ id: "repo-tree-truncated", what: "Full-file coverage", why: "The repository tree exceeded GitHub's listing cap — a sample of the largest/riskiest files was analyzed." });
  if (skipped.length) inconclusive.push({ id: "repo-files-skipped", what: `${skipped.length} selected file(s)`, why: "Skipped: scan budget reached or file vanished between tree and fetch." });
  for (const e of fetchErrors.slice(0, 3)) inconclusive.push({ id: "repo-fetch-error", what: "File fetch", why: e });

  return {
    scanner: "code",
    target: `github.com/${ref.owner}/${ref.repo}`,
    language,
    linesScanned: totalLines,
    durationMs: Date.now() - started,
    cached: false,
    scannedAt: new Date().toISOString(),
    score,
    grade,
    findings,
    positives,
    inconclusive: inconclusive.length ? inconclusive : undefined,
    verification: block,
  };
}

/* ---------------- repo security ---------------- */

async function repoSecurityScan(
  ref: GhRepoRef,
  meta: GhRepoMeta,
  tree: GhTree,
  branch: string,
  token: string | undefined,
  progress: StageProgress
): Promise<UrlScanReport> {
  const started = Date.now();
  const findings: Finding[] = [];
  const leads: ScanLead[] = [];
  const codeFiles = pickCodeFiles(tree, 6);
  const wanted = pickSecurityFiles(tree, codeFiles);

  progress(1, 0.1, `fetching ${wanted.length} risk-ranked files`);
  const { files, skipped } = await fetchSelected(ref, branch, wanted, token, 1, progress);
  progress(1, 1, `${files.size} files fetched`);

  /* presence checks — the tree is authoritative, zero fetches */
  const envPaths = tree.blobs.filter((b) => ENV_FILE.test(b.path) && !ENV_EXAMPLE.test(b.path)).map((b) => b.path);
  if (envPaths.length)
    findings.push({
      id: "sec-repo-env",
      severity: "critical",
      title: `Environment file(s) committed: ${envPaths.slice(0, 3).join(", ")}`,
      detail: `${meta.visibility === "public" ? "A PUBLIC repository" : "This repository"} tracks ${envPaths.length} .env file(s) at the git level. Even if secrets were later removed, they remain in history for anyone who clones.`,
      fix: "Remove from tracking (git rm --cached), add to .gitignore, rotate every value inside, and purge history (git filter-repo / BFG).",
      evidence: envPaths.slice(0, 4).join(", "),
    });
  const keyPaths = tree.blobs.filter((b) => KEY_FILE.test(b.path) && !SKIP_PATH.test(b.path)).map((b) => b.path);
  if (keyPaths.length)
    findings.push({
      id: "sec-repo-keyfile",
      severity: "high",
      title: `Private-key-like file(s) in tree: ${keyPaths.slice(0, 3).join(", ")}`,
      detail: "Committed PEM/identity files usually mean credential material in version control; even test keys teach bad habits and automated scanners will flag them.",
      fix: "Remove from the repo, rotate the real keys, generate fixtures programmatically in CI instead.",
      evidence: keyPaths.slice(0, 4).join(", "),
    });
  const hasGitignore = tree.blobs.some((b) => /(?:^|\/)\.gitignore$/i.test(b.path));
  if (!hasGitignore)
    findings.push({ id: "sec-repo-no-gitignore", severity: "low", title: "No .gitignore", detail: "Nothing marks local artifacts (env files, keys, build output) as untracked — one careless `git add .` away from a leak.", fix: "Add a .gitignore covering .env*, *.pem, keys and build output." });

  /* content checks on fetched files */
  files.forEach((file, path) => {
    const lines = file.text.slice(0, FILE_CAP).split(/\r?\n/).slice(0, MAX_LINES);
    for (const f of applyRules(lines, SECRET_LINE_RULES)) {
      if (f.evidence) f.evidence = `${path}:${f.evidence}`;
      findings.push(f);
    }
    if (MANIFEST.test(path)) findings.push(...dependencyFindings(file.text.slice(0, FILE_CAP)));
    if (WORKFLOW.test(path)) {
      const text = file.text;
      const prt = /pull_request_target/.test(text);
      const headCheckout = /(?:ref:\s*[^$\n]*\$\{\{[^}]*github\.event\.pull_request\.head|github\.event\.pull_request\.head\.ref)/.test(text);
      if (prt && headCheckout)
        findings.push({
          id: "sec-repo-wf-prt-head",
          severity: "high",
          title: `Workflow checks out PR-head code under pull_request_target (${path})`,
          detail: "pull_request_target grants fork PRs access to repository secrets AND running their code is the classic pwn-request: attacker-controlled checkout + privileged context.",
          fix: "Never check out and build the PR head in a pull_request_target workflow; split untrusted parsing into a separate unprivileged job.",
          evidence: path,
        });
      else if (prt)
        leads.push({
          title: `pull_request_target in ${path} without an obvious head checkout`,
          why: "pull_request_target runs with repo secrets; combined with any script that processes PR-supplied data it becomes privilege escalation. Automated scan found no direct head checkout.",
          how: "Read the workflow end-to-end: any use of github.event.pull_request (number, body, head ref) reaching checkout, scripts, or actions is dangerous.",
          evidence: path,
        });
      if (/uses:\s*[^@\s]+@(?:v\d+|main|master)/.test(text))
        leads.push({
          title: `Actions referenced by mutable tag in ${path}`,
          why: "Tag-pinned actions move: a compromised upstream tag injects code into a privileged workflow. SHA-pinning is the standard hardening (defense-in-depth, not a vulnerability).",
          how: "Pin third-party actions to a full commit SHA and dependabot-manage the bumps.",
          evidence: path,
        });
    }
  });

  progress(2, 0.6, "scoring");
  const { findings: deduped, block } = await finalizeRepoFindings(findings, ref, branch, {
    token,
    filesAnalyzed: files.size,
    skipped: skipped.length,
    apiCalls: 2,
    treeTruncated: tree.truncated,
  });
  // A clean scan must still say WHAT was checked — an empty findings list
  // reads as a broken report (verify-suite caught exactly that).
  const verified = deduped.length
    ? deduped
    : [
        {
          id: "sec-repo-clean",
          severity: "pass" as const,
          title: "No exposures in the scanned sample",
          detail: `${tree.blobs.length} tracked paths checked for committed .env/key files; ${files.size} risk-ranked files, manifests and workflow(s) scanned for secret-shaped lines, below-floor dependencies and dangerous pull_request_target patterns — nothing found.`,
        },
      ];
  progress(2, 1);
  progress(3, 1);

  const critical = verified.filter((f) => f.severity === "critical").length;
  const high = verified.filter((f) => f.severity === "high").length;
  const hardening = verified.filter((f) => f.severity === "low" || f.severity === "info").length;
  const { score, grade } = scoreFindings(verified);
  const summary = critical || high
    ? `${critical} critical / ${high} high exposure${high + critical === 1 ? "" : "s"} in the repository itself — committed secrets and dangerous CI beats missing headers every time.`
    : hardening
      ? "No confirmed exposures in the tree or workflows; hardening notes below."
      : "Tree, manifests and workflows all came back clean — no committed credentials, no dangerous CI patterns, no below-floor dependencies.";

  const inconclusive: Inconclusive[] = [];
  if (tree.truncated) inconclusive.push({ id: "repo-tree-truncated", what: "Complete file sweep", why: "The tree listing hit GitHub's cap; probes covered the risk-ranked sample." });
  if (skipped.length) inconclusive.push({ id: "repo-files-skipped", what: `${skipped.length} selected file(s)`, why: "Not fetched (budget or vanished)." });

  return {
    scanner: "security",
    target: `github.com/${ref.owner}/${ref.repo}`,
    durationMs: Date.now() - started,
    cached: false,
    scannedAt: new Date().toISOString(),
    score,
    grade,
    summary,
    positives: critical + high ? undefined : ["No .env or key files committed", "No secret-shaped lines in fetched files", "No below-floor dependency pins in manifests"].filter((_, i) => [!envPaths.length, true, true][i]),
    findings: verified,
    leads: leads.length ? leads : undefined,
    inconclusive: inconclusive.length ? inconclusive : undefined,
    verification: block,
  };
}

/* ---------------- repo QA ---------------- */

const CI_TEST_RUN = /(?:npm (?:run |ci )?test|pnpm test|yarn test|pytest|go test|cargo test|jest|vitest|playwright|cypress|\btox\b|make test|mvn test|gradle test)/i;

async function repoQaScan(
  ref: GhRepoRef,
  meta: GhRepoMeta,
  tree: GhTree,
  branch: string,
  token: string | undefined,
  progress: StageProgress
): Promise<UrlScanReport> {
  const started = Date.now();
  const findings: Finding[] = [];
  const inconclusive: Inconclusive[] = [];

  const hasTests = tree.blobs.some((b) => TEST_SIGNAL.test(b.path) && !SKIP_PATH.test(b.path));
  const hasLint = tree.blobs.some((b) => LINT_CONFIG.test(b.path));
  const workflows = tree.blobs.filter((b) => CI_WORKFLOW.test(b.path)).map((b) => b.path);
  const hasReadme = tree.blobs.some((b) => README.test(b.path));
  const hasTsConfig = tree.blobs.some((b) => TS_CONFIG.test(b.path));
  const hasTsCode = tree.blobs.some((b) => /\.(?:ts|tsx)$/i.test(b.path));
  const hasContributing = tree.blobs.some((b) => /(?:^|\/)contributing(?:\.[^/]*)?$/i.test(b.path));
  const hasSecurityMd = tree.blobs.some((b) => /(?:^|\/)security(?:\.md)?$/i.test(b.path));
  const hasChangelog = tree.blobs.some((b) => /(?:^|\/)changelog(?:\.[^/]*)?$/i.test(b.path));
  const hasLicense = tree.blobs.some((b) => /(?:^|\/)licen[cs]e(?:\.[^/]*)?$/i.test(b.path));

  const wanted: string[] = [];
  if (hasReadme) wanted.push(tree.blobs.find((b) => README.test(b.path))!.path);
  if (hasTsConfig) wanted.push(tree.blobs.find((b) => TS_CONFIG.test(b.path))!.path);
  const manifest = tree.blobs.find((b) => MANIFEST.test(b.path));
  if (manifest) wanted.push(manifest.path);
  for (const w of workflows.slice(0, 2)) wanted.push(w);
  progress(0, 1, "tree read");

  progress(1, 0.2, `fetching ${wanted.length} files`);
  const { files, skipped } = await fetchSelected(ref, branch, wanted, token, 1, progress);
  progress(1, 1);

  /* P0: health — the repo equivalent is CI + tests */
  progress(2, 0.25, "P0 tests & CI");
  if (hasTests || (files.get("package.json") && /"(?:test|playwright|vitest|jest)"|"(?:@vue\/test-utils|@playwright\/test)"/.test(files.get("package.json")!.text)))
    findings.push({ id: "qa-tests-ok", severity: "pass", title: "Automated tests present", detail: hasTests ? "Test files/directories detected in the tree." : "Test runner wiring detected in package.json." });
  else
    findings.push({ id: "qa-no-tests", severity: "medium", title: "No automated tests detected", detail: "No test files/directories and no test runner in the manifests — every change ships blind.", fix: "Add a test suite (vitest/jest/pytest/playwright) and wire it into CI." });

  if (!workflows.length)
    findings.push({ id: "qa-no-ci", severity: "medium", title: "No CI workflows", detail: "No .github/workflows — nothing enforces tests, builds or lint on pull requests.", fix: "Add a CI workflow that runs tests + lint on every PR." });
  else {
    const wfText = [...workflows.map((w) => files.get(w)?.text ?? "").join("\n")];
    if (CI_TEST_RUN.test(wfText.join(" ")))
      findings.push({ id: "qa-ci-ok", severity: "pass", title: `CI runs tests (${workflows.length} workflow(s))`, detail: workflows.slice(0, 3).join(", ") });
    else
      findings.push({ id: "qa-ci-no-tests", severity: "low", title: "CI does not appear to run tests", detail: "Workflows exist but no test-runner invocation was found — CI that only builds is half a CI.", fix: "Add a test step to the workflow." });
  }

  progress(2, 0.5, "P1 hygiene");
  if (!hasLint) findings.push({ id: "qa-no-lint", severity: "low", title: "No lint/format config", detail: "No ESLint/Prettier/Ruff/equivalent config — style stays a human argument instead of a machine check.", fix: "Add a linter config and run it in CI." });
  else findings.push({ id: "qa-lint-ok", severity: "pass", title: "Lint/format config present", detail: "Machine-enforced style reduces review noise." });

  const tsconfig = [...files.entries()].find(([p]) => TS_CONFIG.test(p));
  if (tsconfig) {
    if (/"strict"\s*:\s*false/.test(tsconfig[1].text))
      findings.push({ id: "qa-ts-strict", severity: "low", title: "TypeScript strict mode disabled", detail: `strict:false in ${tsconfig[0]} — null-safety and noImplicitAny keep bugs out for free.`, fix: 'Set "strict": true and fix the fallout incrementally.' });
    else findings.push({ id: "qa-ts-strict-ok", severity: "pass", title: "TypeScript strict mode on", detail: tsconfig[0] });
  } else if (hasTsCode) findings.push({ id: "qa-no-tsconfig", severity: "info", title: "TypeScript code without a visible tsconfig", detail: "Compiler options live somewhere else (or defaults are trusted blindly)." });

  if (!hasReadme) findings.push({ id: "qa-no-readme", severity: "medium", title: "No README", detail: "A repository nobody can run is a repository nobody can QA.", fix: "Add a README with setup, run and test instructions." });
  else {
    const rm = [...files.entries()].find(([p]) => README.test(p));
    if (rm && rm[1].text.trim().length < 200)
      findings.push({ id: "qa-readme-thin", severity: "low", title: "README is a stub", detail: `Only ${rm[1].text.trim().length} characters — not enough to onboard a contributor.`, fix: "Document setup, run, test and deploy steps." });
  }
  if (!hasLicense) findings.push({ id: "qa-no-license", severity: "low", title: "No LICENSE", detail: "Without a license, nobody legally can — users and contributors stay away.", fix: "Pick one (MIT/Apache-2.0) and commit it." });
  if (!hasContributing) findings.push({ id: "qa-no-contributing", severity: "info", title: "No CONTRIBUTING guide", detail: "Contributor workflow is tribal knowledge." });
  if (!hasSecurityMd) findings.push({ id: "qa-no-security-md", severity: "info", title: "No SECURITY.md", detail: "No documented channel for responsible disclosure." });
  if (!hasChangelog) findings.push({ id: "qa-no-changelog", severity: "info", title: "No CHANGELOG", detail: "Release history lives only in git log." });

  progress(2, 0.8, "verdict");
  const critical = findings.filter((f) => f.severity === "critical").length;
  const high = findings.filter((f) => f.severity === "high").length;
  const medium = findings.filter((f) => f.severity === "medium").length;
  const verdict: "ok" | "needs-review" | "blocked" = critical ? "blocked" : high + medium >= 1 ? "needs-review" : "ok";
  const summary =
    verdict === "blocked"
      ? "Critical reliability signal — treat as a blocker before the next release."
      : verdict === "needs-review"
        ? `${medium} medium gap(s) (tests/CI/README class) worth closing; nothing broken.`
        : "Trees, tests, CI and hygiene checks came back clean.";

  tag(findings, "presence", (f) =>
    /qa-tests-ok|qa-ci-ok|qa-dead-links|qa-soft404/.test(f.id) ? "confirmed" : f.id === "qa-tests-ok" || f.id === "qa-ci-ok" ? "confirmed" : undefined
  );
  const dedup = dedupeFindings(findings);
  const { score, grade } = scoreFindings(dedup.findings);

  if (tree.truncated) inconclusive.push({ id: "repo-tree-truncated", what: "Complete tree analysis", why: "Tree listing hit GitHub's cap." });
  if (skipped.length) inconclusive.push({ id: "repo-files-skipped", what: `${skipped.length} file(s)`, why: "Not fetched (vanished between tree and fetch)." });

  progress(2, 1);
  progress(3, 1);

  return {
    scanner: "qa",
    target: `github.com/${ref.owner}/${ref.repo}`,
    durationMs: Date.now() - started,
    cached: false,
    scannedAt: new Date().toISOString(),
    score,
    grade,
    verdict,
    summary,
    positives: dedup.findings.filter((f) => f.severity === "pass").slice(0, 6).map((f) => f.title),
    findings: dedup.findings,
    inconclusive: inconclusive.length ? inconclusive : undefined,
    verification: verificationBlock(dedup.findings, dedup.deduped, {
      filesAnalyzed: files.size,
      filesSkipped: skipped.length,
      apiCalls: 2,
      treeTruncated: tree.truncated,
      tokenUsed: Boolean(token),
    }),
  };
}

/* ---------------- repo SEO/GEO ---------------- */

function pillarFrom(findings: Finding[], ids: string[]): number | null {
  const mine = findings.filter((f) => ids.includes(f.id) && f.severity !== "pass" && f.severity !== "info");
  if (!ids.length) return null;
  const deduction = mine.reduce((s, f) => s + (SEVERITY_WEIGHT[f.severity as keyof typeof SEVERITY_WEIGHT] ?? 0), 0);
  return Math.max(0, 100 - deduction);
}

async function repoGeoScan(
  ref: GhRepoRef,
  meta: GhRepoMeta,
  tree: GhTree,
  branch: string,
  token: string | undefined,
  progress: StageProgress
): Promise<UrlScanReport> {
  const started = Date.now();
  const findings: Finding[] = [];
  const leads: ScanLead[] = [];
  const inconclusive: Inconclusive[] = [];

  const readmeEntry = tree.blobs.find((b) => README.test(b.path));
  progress(0, 1, "metadata & tree read");

  let readmeText: string | null = null;
  if (readmeEntry) {
    progress(1, 0.3, `fetching ${readmeEntry.path}`);
    const f = await fetchRawFile(ref, branch, readmeEntry.path, token, 300 * 1024);
    readmeText = f?.text ?? null;
  }
  progress(1, 1, readmeText ? "README fetched" : "no README");

  /* discoverability */
  if (!meta.description || !meta.description.trim())
    findings.push({ id: "geo-no-desc", severity: "medium", title: "No repository description", detail: "The description is the single highest-signal line for GitHub search, Google and LLMs answering \"which repo does X?\".", fix: "One sentence: what it is, for whom, and the key capability." });
  else if (meta.description.trim().length < 30)
    findings.push({ id: "geo-desc-short", severity: "low", title: "Description is very short", detail: `“${meta.description.trim()}” — add the what/for-whom/key-capability triple.`, fix: "Aim for one specific sentence (30+ chars)." });
  if (!meta.topics.length)
    findings.push({ id: "geo-no-topics", severity: "medium", title: "No topics/tags", detail: "Topics power GitHub topic search and recommendation surfaces; zero topics makes the repo undiscoverable outside direct links.", fix: "Add 3–8 topics (e.g. nextjs, security-tools, scanner)." });
  else if (meta.topics.length < 3)
    findings.push({ id: "geo-few-topics", severity: "low", title: `Only ${meta.topics.length} topic(s)`, detail: "Thin topic coverage narrows discovery surfaces.", fix: "Add a few more precise topics." });
  if (!meta.homepage)
    findings.push({ id: "geo-no-homepage", severity: "info", title: "No homepage link", detail: "A live demo URL in the repo header converts drive-by visitors.", fix: "Set the homepage field to the deployed site." });
  else
    leads.push({
      title: `Homepage set: ${meta.homepage}`,
      why: "The repository advertises a live site — its SEO/GEO posture is a separate, unscanned surface.",
      how: "Run the website SEO/GEO/Performance scan on this URL (website mode).",
      evidence: meta.homepage,
    });

  /* README clarity */
  if (!readmeText)
    findings.push({ id: "geo-no-readme", severity: "high", title: "No README", detail: "The README is the landing page for humans AND the primary corpus AI engines quote about the project.", fix: "Write one: what/why, quickstart, usage example, links." });
  else {
    const text = readmeText.trim();
    if (text.length < 500)
      findings.push({ id: "geo-readme-thin", severity: "medium", title: "README is thin", detail: `${text.length} characters — answer engines need substance to cite and rank the project.`, fix: "Expand: problem, features, quickstart, config, FAQ." });
    const headings = (text.match(/^#{2,3}\s+\S/gm) ?? []).length;
    if (headings < 2)
      findings.push({ id: "geo-readme-structure", severity: "low", title: "README lacks section headings", detail: `${headings} ##/### headings — structure is how LLMs chunk and retrieve content.`, fix: "Split into Quickstart / Usage / Configuration / FAQ sections." });
    if (!/```/.test(text))
      findings.push({ id: "geo-readme-nocode", severity: "low", title: "No code examples in README", detail: "A fenced code block is the fastest path from README to running — and a strong citation signal.", fix: "Add an install + minimal usage snippet." });
    if (!/install|quick ?start|getting started|usage/i.test(text))
      findings.push({ id: "geo-readme-no-usage", severity: "low", title: "No install/usage section", detail: "Readers (and models) look for a canonical getting-started path.", fix: "Add a Quickstart section." });
    findings.push({ id: "geo-readme-ok", severity: "pass", title: "README present", detail: `${text.length} chars, ${headings} headings` });
  }

  /* GEO / trust signals */
  if (tree.blobs.some((b) => /^llms\.txt$/i.test(b.path)))
    findings.push({ id: "geo-llms", severity: "pass", title: "llms.txt present", detail: "The emerging convention for AI-readable content indexes — early adopter signal." });
  else
    findings.push({ id: "geo-no-llms", severity: "info", title: "No llms.txt (yet)", detail: "A short llms.txt indexing docs/pages helps AI agents navigate the project. Emerging convention, no downside.", fix: "Add llms.txt linking the docs and key pages." });
  if (meta.licenseSpdx) findings.push({ id: "geo-license", severity: "pass", title: `Licensed (${meta.licenseSpdx})`, detail: "License metadata is a trust signal for both registries and models." });
  else findings.push({ id: "geo-no-license", severity: "low", title: "No detectable license", detail: "Unlicensed repos are legally unusable by companies — a real adoption blocker.", fix: "Add LICENSE (MIT/Apache-2.0)." });
  if (meta.archived)
    findings.push({ id: "geo-archived", severity: "medium", title: "Repository is archived", detail: "Archived repos are read-only; search engines and agents down-rank maintenance-ended projects.", fix: "Unarchive if development resumes, or point the README to the successor." });
  if (meta.fork) findings.push({ id: "geo-fork", severity: "info", title: "Repository is a fork", detail: "Forks inherit the parent's identity in search; original content still ranks." });
  if (meta.pushedAt) {
    const months = (Date.now() - new Date(meta.pushedAt).getTime()) / 26_298_000;
    if (months > 24)
      findings.push({ id: "geo-stale", severity: "medium", title: `Last push ${Math.round(months / 12)} years ago`, detail: "Freshness is a ranking input for GitHub search and a trust signal for humans.", fix: "Refresh dependencies/README or mark the successor." });
    else if (months > 12) findings.push({ id: "geo-stale", severity: "low", title: `Last push ${Math.round(months)} months ago`, detail: "Consider a maintenance pass to keep discovery signals warm." });
    else findings.push({ id: "geo-fresh", severity: "pass", title: "Actively maintained", detail: `Last push ${Math.round(months)} month(s) ago.` });
  }

  progress(2, 0.6, "scoring");
  tag(findings, "presence", (f) => (f.id === "geo-no-readme" || f.id === "geo-readme-thin" ? "confirmed" : undefined));
  const dedup = dedupeFindings(findings);

  const breakdown = [
    { label: "Discoverability", ids: ["geo-no-desc", "geo-desc-short", "geo-no-topics", "geo-few-topics", "geo-no-homepage"] },
    { label: "README clarity", ids: ["geo-no-readme", "geo-readme-thin", "geo-readme-structure", "geo-readme-nocode", "geo-readme-no-usage"] },
    { label: "Freshness", ids: ["geo-archived", "geo-stale"] },
    { label: "Trust & licensing", ids: ["geo-no-license", "geo-fork"] },
  ]
    .map((p) => ({ label: p.label, score: pillarFrom(dedup.findings, p.ids) }))
    .filter((p): p is { label: string; score: number } => p.score !== null);

  const { score, grade } = scoreFindings(dedup.findings);
  const highCount = dedup.findings.filter((f) => f.severity === "critical" || f.severity === "high").length;
  progress(2, 1);
  progress(3, 1);

  return {
    scanner: "geo-seo",
    target: `github.com/${ref.owner}/${ref.repo}`,
    durationMs: Date.now() - started,
    cached: false,
    scannedAt: new Date().toISOString(),
    score,
    grade,
    summary: `${highCount} high-impact issue(s), ${dedup.findings.filter((f) => f.severity !== "pass").length} actionable in total, across discoverability, README clarity, freshness and trust.`,
    breakdown,
    positives: dedup.findings.filter((f) => f.severity === "pass").slice(0, 6).map((f) => f.title),
    leads: leads.length ? leads : undefined,
    findings: dedup.findings,
    inconclusive: inconclusive.length ? inconclusive : undefined,
    verification: verificationBlock(dedup.findings, dedup.deduped, {
      filesAnalyzed: readmeText ? 1 : 0,
      filesSkipped: 0,
      apiCalls: 2,
      treeTruncated: tree.truncated,
      tokenUsed: Boolean(token),
    }),
  };
}

/* ---------------- orchestrator ---------------- */

export async function runRepoScan(
  kind: RepoScanKind,
  repoRaw: string,
  token: string | undefined,
  progress: StageProgress = () => {}
): Promise<UrlScanReport | CodeScanReport> {
  const ref = parseRepoTarget(repoRaw);
  if (!ref) throw new ScanError("gh-bad-target", "Give a repository like owner/name or a github.com URL.");

  progress(0, 0.25, "reading repo metadata");
  const meta = await getRepoMeta(ref, token);
  progress(0, 0.6, "listing file tree");
  const tree = await getRepoTree(ref, meta.defaultBranch, token);
  progress(0, 1, `${tree.blobs.length} files in tree`);
  if (!tree.blobs.length && !tree.truncated)
    throw new ScanError("gh-empty-repo", "The repository tree is empty — nothing to scan.");

  switch (kind) {
    case "code":
      return repoCodeScan(ref, meta, tree, meta.defaultBranch, token, progress);
    case "security":
      return repoSecurityScan(ref, meta, tree, meta.defaultBranch, token, progress);
    case "qa":
      return repoQaScan(ref, meta, tree, meta.defaultBranch, token, progress);
    case "geo-seo":
      return repoGeoScan(ref, meta, tree, meta.defaultBranch, token, progress);
  }
}
