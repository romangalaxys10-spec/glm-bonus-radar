/**
 * zScanner — Code Reviewer (paste-based, heuristic).
 *
 * Rule pack adapted from the open-source classics (Semgrep community
 * rules, Bandit, eslint-plugin-security, detect-secrets/gitleaks) plus
 * awesome-skills' code-review-skill (MIT): framework escape hatches,
 * JWT-verify doctrine, CORS wildcard, SQL concatenation and dependency
 * version floors from fable's sec-scan. Deterministic, linear-time,
 * evidence = the offending line (plain text). The `Reviewer` seam stays
 * LLM-free: pasted code is confidential and this host's outbound policy
 * is GET-only.
 */

import { type CodeScanReport, type Finding, scoreFindings } from "./types";
import { dedupeFindings, tag, verificationBlock } from "./verify";

const MAX_BYTES = 256 * 1024;
const MAX_LINES = 5000;

export type LineRule = {
  id: string;
  severity: Finding["severity"];
  title: string;
  detail: string;
  fix?: string;
  re: RegExp;
  /** Skip when another, more specific rule already fired on the same line. */
  unless?: RegExp;
};

/** Secret-shaped line rules; also reused by the security scanner to scan
 *  served HTML bodies for leaked credentials (real exposure → finding). */
export const SECRET_LINE_RULES: LineRule[] = [
  {
    id: "sec-aws-key",
    severity: "critical",
    title: "AWS access key pattern",
    detail: "AKIA… access key id in source. Committed cloud keys are the #1 cause of account takeovers.",
    fix: "Revoke the key now, rotate, move it to env/secrets manager, and purge it from history.",
    re: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: "sec-github-token",
    severity: "critical",
    title: "GitHub token pattern",
    detail: "A ghp_/gho_/ghs_/ghu_/ghr_ token is hard-coded.",
    fix: "Revoke at github.com/settings/tokens, rotate, purge history.",
    re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  },
  {
    id: "sec-bearer-secret",
    severity: "critical",
    title: "Bearer/API secret pattern",
    detail: "A sk_-style API key is hard-coded.",
    fix: "Move to environment variables or a secrets manager; rotate the exposed key.",
    re: /\bsk-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: "sec-private-key",
    severity: "critical",
    title: "Private key material",
    detail: "A PEM private key block appears in the source.",
    fix: "Remove immediately; rotate anything signed with it; store keys outside the repo.",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: "sec-jwt-embedded",
    severity: "high",
    title: "Hard-coded JWT",
    detail: "A signed JWT (three dot-separated base64url segments) is embedded in code.",
    fix: "Tokens belong in config/env and must be short-lived; rotate any leaked signing state.",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  },
  {
    id: "sec-cred-assignment",
    severity: "high",
    title: "Possible hard-coded credential",
    detail: "password/secret/api_key/token assigned a literal string.",
    fix: "Load from environment; add this pattern to CI secret scanning.",
    re: /\b(?:password|passwd|api_?key|secret|auth_?token|access_?token)["']?\s*[:=]\s*["'][^"'\n]{8,}["']/i,
    unless: /\b(?:process\.env|os\.environ|import\.meta\.env|getenv|config\()/i,
  },
  {
    id: "sec-dsn-credentials",
    severity: "high",
    title: "Credentials embedded in connection string",
    detail: "A database/queue DSN contains user:password@.",
    fix: "Keep DSNs in env config (DATABASE_URL etc.), never in source.",
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s'"@/]+:[^\s'"@]+@/i,
  },
  {
    id: "sec-slack-token",
    severity: "critical",
    title: "Slack token pattern",
    detail: "A xoxb/xoxp/xoxa/xoxs/xoxr token is hard-coded.",
    fix: "Revoke in Slack app settings; load from a secrets manager.",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    id: "sec-google-key",
    severity: "high",
    title: "Google API key pattern",
    detail: "An AIza… Google API key is embedded in source.",
    fix: "Rotate in Google Cloud console, restrict referrers, move to env.",
    re: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
];

const JS_TS: LineRule[] = [
  {
    id: "js-eval",
    severity: "high",
    title: "eval() usage",
    detail: "eval executes arbitrary strings as code — the classic injection sink.",
    fix: "Parse structured data with JSON.parse; map dynamic logic to explicit functions.",
    re: /(?<![.\w])eval\s*\(/,
  },
  {
    id: "js-new-function",
    severity: "medium",
    title: "new Function() constructor",
    detail: "Function-body-from-string is eval with extra steps.",
    fix: "Refactor to static functions or a lookup table.",
    re: /\bnew\s+Function\s*\(/,
  },
  {
    id: "js-child-exec",
    severity: "medium",
    title: "Shell execution from Node",
    detail: "child_process exec/execSync runs a shell; interpolated input becomes command injection.",
    fix: "Prefer execFile/spawn without shell:true, with argument arrays.",
    re: /(?:child_process\s*\.\s*)?(?:execSync|exec)\s*\(/,
    unless: /\b(?:execFile|execPath|executable)\b/,
  },
  {
    id: "js-innerhtml",
    severity: "medium",
    title: "Raw HTML sink (innerHTML / document.write)",
    detail: "Assigning unsanitized strings to innerHTML (or document.write) is the DOM-XSS pattern.",
    fix: "Use textContent, or sanitize with DOMPurify before HTML contexts.",
    re: /\.innerHTML\s*=|document\.write\s*\(/,
  },
  {
    id: "js-weak-hash",
    severity: "medium",
    title: "Weak hash (md5/sha1) via crypto",
    detail: "MD5/SHA-1 are broken for signatures and password storage.",
    fix: "Use SHA-256+, or bcrypt/scrypt/argon2 for passwords.",
    re: /createHash\s*\(\s*["'](md5|sha1)["']\s*\)/,
  },
  {
    id: "js-random-secret",
    severity: "medium",
    title: "Math.random() used for security values",
    detail: "Math.random is not cryptographically secure; tokens generated from it are predictable.",
    fix: "Use crypto.randomUUID() or crypto.getRandomValues().",
    re: /(?:token|secret|nonce|session_?id|api_?key|salt)["']?\s*[:=][^;\n]{0,40}Math\.random/i,
  },
  {
    id: "js-debugger",
    severity: "low",
    title: "debugger statement",
    detail: "Leftover debugger statements freeze production-like environments.",
    fix: "Remove; enforce with an ESLint no-debugger rule in CI.",
    re: /^\s*debugger\s*;?\s*$/,
  },
  {
    id: "js-http-url",
    severity: "info",
    title: "Plain-text http:// URL",
    detail: "Non-local http:// requests downgrade transport security and can be rewritten in transit.",
    fix: "Use https:// endpoints.",
    re: /["']http:\/\/(?!localhost|127\.0\.0\.1)/,
  },
  {
    id: "js-jwt-decode",
    severity: "medium",
    title: "jwt.decode used (no signature check)",
    detail: "jwt.decode does NOT verify signatures — trusting its output authenticates nothing (awesome-skills JWT doctrine).",
    fix: "Use jwt.verify with pinned algorithms, issuer, audience and expiry.",
    re: /jwt\.decode\s*\(/,
  },
  {
    id: "js-dangerous-html",
    severity: "medium",
    title: "Framework raw-HTML escape hatch",
    detail: "dangerouslySetInnerHTML / v-html / {@html} inject raw HTML — the React/Vue/Svelte XSS sink.",
    fix: "Render text nodes, or sanitize with DOMPurify first.",
    re: /dangerouslySetInnerHTML|v-html|\{@html\s/,
  },
  {
    id: "js-shell-true",
    severity: "medium",
    title: "spawn with shell:true",
    detail: "shell:true re-opens the shell-injection surface that exec() has.",
    fix: "Pass argument arrays with the shell off.",
    re: /shell\s*:\s*true/,
  },
  {
    id: "js-cors-wildcard",
    severity: "medium",
    title: "CORS wildcard origin in code",
    detail: "Access-Control-Allow-Origin: * (worse combined with credentials) leaks authenticated responses cross-origin.",
    fix: "Echo only explicitly allowlisted origins.",
    re: /Access-Control-Allow-Origin["']?\s*[,:=]\s*["']?\*/i,
  },
  {
    id: "js-sql-concat",
    severity: "high",
    title: "SQL built by string concatenation",
    detail: "Interpolating variables into SQL text is the canonical injection sink.",
    fix: "Use parameterized queries / prepared statements.",
    re: /(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^;\n]{0,200}(?:\$\{[^}]{1,60}\}|\.format\(|%s|\+\s*\w+)|["']\s*\+\s*\w+\s*\+\s*["']\s*(?:SELECT|WHERE|AND|OR)\b/i,
  },
];

const PYTHON: LineRule[] = [
  {
    id: "py-eval-exec",
    severity: "high",
    title: "eval()/exec() usage",
    detail: "Dynamic evaluation of strings is arbitrary-code execution on a plate.",
    fix: "Use ast.literal_eval for data, explicit dispatch for logic.",
    re: /(?<![.\w])(?:eval|exec)\s*\(/,
  },
  {
    id: "py-pickle",
    severity: "high",
    title: "pickle deserialization",
    detail: "pickle.load on untrusted input executes arbitrary objects (unsafe deserialization).",
    fix: "Use JSON, or validate with hmac-signed payloads before unpickling trusted data only.",
    re: /\bpickle\.loads?\s*\(|\bcPickle\.loads?\s*\(/,
  },
  {
    id: "py-shell-true",
    severity: "high",
    title: "subprocess with shell=True",
    detail: "shell=True hands interpolated input to /bin/sh — command injection.",
    fix: "Pass an argv list with shell=False (the default).",
    re: /subprocess\.\w+\s*\([^)]*shell\s*=\s*True/,
  },
  {
    id: "py-os-system",
    severity: "medium",
    title: "os.system() call",
    detail: "os.system runs a shell command string; same injection surface as shell=True.",
    fix: "Use subprocess.run([...], shell=False).",
    re: /\bos\.system\s*\(/,
  },
  {
    id: "py-yaml-unsafe-load",
    severity: "medium",
    title: "yaml.load without safe Loader",
    detail: "yaml.load with the default Loader can construct arbitrary Python objects.",
    fix: "Use yaml.safe_load().",
    re: /\byaml\.load\s*\((?![^)\n]*Loader)/,
  },
  {
    id: "py-weak-hash",
    severity: "medium",
    title: "Weak hash (md5/sha1)",
    detail: "hashlib.md5/sha1 are unsuitable for security purposes.",
    fix: "Use sha256+, or hashlib.scrypt/pbkdf2_hmac for passwords.",
    re: /hashlib\.(?:md5|sha1)\s*\(/,
  },
  {
    id: "py-ssl-verify-off",
    severity: "high",
    title: "TLS verification disabled",
    detail: "verify=False (requests/urllib3) silently accepts any certificate — MITM paradise.",
    fix: "Keep verification on; pin CA bundles for exotic setups.",
    re: /\bverify\s*=\s*False\b/,
  },
  {
    id: "py-flask-debug",
    severity: "high",
    title: "Flask/Werkzeug debug mode enabled",
    detail: "debug=True exposes the interactive debugger (remote code execution) in production.",
    fix: "Run with a real WSGI server and debug off.",
    re: /\bdebug\s*=\s*True\b/,
  },
  {
    id: "py-tmpfile",
    severity: "low",
    title: "Predictable temp path",
    detail: "Writing to /tmp/<fixed-name> invites symlink races and data swaps between users.",
    fix: "Use tempfile.mkstemp/NamedTemporaryFile.",
    re: /["']\/tmp\/[^"']{1,60}["']/,
  },
  {
    id: "py-bare-except",
    severity: "low",
    title: "Bare except swallows everything",
    detail: "`except:` hides bugs and even KeyboardInterrupt — failures become silent.",
    fix: "Catch specific exceptions and log them.",
    re: /^\s*except\s*:/,
  },
  {
    id: "py-mutable-default",
    severity: "low",
    title: "Mutable default argument",
    detail: "def f(x=[]) shares ONE list across every call — state leaks between invocations.",
    fix: "Default to None and create the container inside.",
    re: /def\s+\w+\s*\([^)]*=\s*(?:\[\]|\{\})/,
  },
  {
    id: "py-sql-fstring",
    severity: "high",
    title: "SQL via f-string/format",
    detail: "f-string or .format SQL is string-built SQL — injection.",
    fix: "Use parameterized queries (cursor.execute(sql, params)).",
    re: /(?:f["']\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)|(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^;\n]{0,200}(?:\.format\(|%\s*\())|["']\s*\+\s*\w+\s*\+\s*["']\s*(?:SELECT|WHERE|AND|OR)\b/i,
  },
];

export const AGGREGATES: { id: string; severity: Finding["severity"]; title: string; re: RegExp; threshold: number; detail: (n: number) => string; fix?: string }[] = [
  {
    id: "dbg-prints",
    severity: "low",
    title: "Debug output left in code",
    re: /\bconsole\.(?:log|debug)\s*\(|\bprint\s*\(/,
    threshold: 8,
    detail: (n) => `${n} console/print statements — debug leftovers leak internals and add noise.`,
    fix: "Route through a logger with levels.",
  },
  {
    id: "todo-count",
    severity: "info",
    title: "Unresolved TODO/FIXME markers",
    re: /\b(?:TODO|FIXME|HACK|XXX)\b/,
    threshold: 3,
    detail: (n) => `${n} TODO/FIXME/HACK markers in the pasted code.`,
  },
  {
    id: "quality-var",
    severity: "info",
    title: "Legacy var declarations",
    re: /\bvar\s+[A-Za-z_$]/,
    threshold: 5,
    detail: (n) => `${n} var declarations — function-scoped and redeclarable, a classic bug source.`,
    fix: "Prefer const/let.",
  },
  {
    id: "quality-dead-code",
    severity: "info",
    title: "Commented-out code",
    re: /^\s*(?:\/\/|#)\s*(?:const |let |var |function |def |return |import |class )/,
    threshold: 4,
    detail: (n) => `${n} commented-out statements — dead code confuses reviewers and hides intent.`,
    fix: "Delete it; version history remembers.",
  },
];

/* ---------- dependency floors (fable sec-scan dep-vulnerable) ---------- */

type DepFloor = { eco: "npm" | "pypi"; name: string; floor: [number, number, number]; issue: string };

const DEP_FLOORS: DepFloor[] = [
  { eco: "npm", name: "next", floor: [13, 4, 20], issue: "Next.js below 13.4.20 — middleware auth-bypass / cache-poisoning CVE class" },
  { eco: "npm", name: "express", floor: [4, 18, 2], issue: "Express below 4.18.2 — CVE-2024-29041 open-redirect class" },
  { eco: "npm", name: "lodash", floor: [4, 17, 21], issue: "Lodash below 4.17.21 — CVE-2021-23337 command injection" },
  { eco: "npm", name: "axios", floor: [1, 6, 0], issue: "Axios below 1.6.0 — CVE-2023-45857 XSRF-token leak" },
  { eco: "npm", name: "json5", floor: [2, 2, 2], issue: "JSON5 below 2.2.2 — CVE-2022-46175 prototype pollution" },
  { eco: "npm", name: "ws", floor: [8, 17, 1], issue: "ws below 8.17.1 — CVE-2024-37890 DoS" },
  { eco: "pypi", name: "django", floor: [4, 2, 0], issue: "Django below 4.2 — multiple historical CVE branches" },
  { eco: "pypi", name: "flask", floor: [2, 3, 0], issue: "Flask below 2.3 — CVE-2023-25577 DoS class" },
  { eco: "pypi", name: "requests", floor: [2, 31, 0], issue: "Requests below 2.31.0 — CVE-2023-32681 proxy-auth leak" },
  { eco: "pypi", name: "pillow", floor: [10, 0, 0], issue: "Pillow below 10.0.0 — image-parsing CVE run" },
];

function semverLess(a: number[], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    const ai = a[i] ?? 0;
    if (ai !== b[i]) return ai < b[i];
  }
  return false;
}

export function dependencyFindings(code: string): Finding[] {
  const out: Finding[] = [];
  const isNpm = /"(?:dependencies|devDependencies)"\s*:\s*\{/.test(code);
  const isPypi = /^\s*(?:[A-Za-z0-9_.-]+)(?:==|>=|~=)\d/m.test(code) && /(?:django|flask|requests|pillow)/i.test(code);
  for (const dep of DEP_FLOORS) {
    if (dep.eco === "npm" && !isNpm) continue;
    if (dep.eco === "pypi" && !isPypi) continue;
    const re =
      dep.eco === "npm"
        ? new RegExp(`"${dep.name}"\\s*:\\s*["'][\\^~>=]*v?(\\d+)\\.(\\d+)\\.(\\d+)`, "i")
        : new RegExp(`\\b${dep.name}(?:==|>=|~=)v?(\\d+)\\.(\\d+)(?:\\.(\\d+))?`, "im");
    const m = re.exec(code);
    if (!m) continue;
    const ver = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
    if (semverLess(ver, dep.floor))
      out.push({
        id: "dep-vulnerable",
        severity: "high",
        title: `${dep.name} ${ver.join(".")} below known-safe floor ${dep.floor.join(".")}`,
        detail: `${dep.issue}. Pinned dependency versions below the safe floor ship known CVEs into the build.`,
        fix: `Upgrade ${dep.name} to >= ${dep.floor.join(".")} (or the latest patched line) and re-audit.`,
        evidence: m[0].slice(0, 80),
      });
  }
  return out;
}

export function detectLanguage(code: string): string {
  const py = (code.match(/\bdef\s+\w+\s*\(|\bimport\s+\w+|\bfrom\s+\w+\s+import|\bself\b|\belif\b/g) ?? []).length;
  const ts = (code.match(/:\s*(?:string|number|boolean|any|void)\b|\binterface\s+\w+|<[A-Z]\w*>(?=\()|\bimplements\s+/g) ?? []).length;
  const js = (code.match(/\b(?:const|let|var)\s+\w+|=>|console\.|\bfunction\s+\w+|\brequire\s*\(|import\s+.*\bfrom\b/g) ?? []).length;
  if (py >= 3 && py > js) return "python";
  if (ts >= 2) return "typescript";
  if (js >= 3) return "javascript";
  if (py > 0) return "python";
  return "unknown";
}

export function lineRulesFor(lang: string): LineRule[] {
  const pack = lang === "python" ? PYTHON : lang === "javascript" || lang === "typescript" ? JS_TS : [];
  return [...SECRET_LINE_RULES, ...pack];
}

/** Apply line rules with per-rule evidence caps (max 3 lines each). */
export function applyRules(lines: string[], rules: LineRule[]): Finding[] {
  const findings: Finding[] = [];
  const fired = new Map<string, Set<number>>(); // rule id -> lines

  lines.forEach((line, idx) => {
    const no = idx + 1;
    for (const rule of rules) {
      if (rule.severity === "info") continue; // aggregates handled separately
      rule.re.lastIndex = 0;
      if (!rule.re.test(line)) continue;
      if (rule.unless && rule.unless.test(line)) continue;
      const seen = fired.get(rule.id) ?? new Set<number>();
      if (seen.size >= 3) continue; // cap evidence per rule
      seen.add(no);
      fired.set(rule.id, seen);
      if (seen.size === 1) {
        findings.push({
          id: rule.id,
          severity: rule.severity,
          title: rule.title,
          detail: rule.detail,
          fix: rule.fix,
          evidence: `line ${no}: ${line.trim().slice(0, 140)}`,
        });
      } else {
        const f = findings.find((x) => x.id === rule.id)!;
        f.evidence = `${f.evidence}; line ${no}: ${line.trim().slice(0, 80)}`;
      }
    }
  });

  return findings;
}

/** Density aggregates (debug output, TODO markers, var, dead code…). */
export function applyAggregates(code: string): Finding[] {
  const out: Finding[] = [];
  for (const agg of AGGREGATES) {
    const n = (code.match(new RegExp(agg.re.source, agg.re.flags.includes("g") ? agg.re.flags : agg.re.flags + "g")) ?? []).length;
    if (n >= agg.threshold) {
      out.push({ id: agg.id, severity: agg.severity, title: agg.title, detail: agg.detail(n), fix: agg.fix });
    }
  }
  return out;
}

export function reviewCode(code: string): Omit<CodeScanReport, "durationMs" | "cached" | "scannedAt" | "target"> {
  const language = detectLanguage(code);
  const lines = code.slice(0, MAX_BYTES).split(/\r?\n/).slice(0, MAX_LINES);
  const rules = lineRulesFor(language);
  const findings: Finding[] = applyRules(lines, rules);

  const joined = code.slice(0, MAX_BYTES);
  findings.push(...applyAggregates(joined));
  findings.push(...dependencyFindings(joined));

  if (!findings.length) {
    findings.push({ id: "clean", severity: "pass", title: "No rule-pack findings", detail: `Heuristic pack (${rules.length} rules) found no matches in ${lines.length} lines of ${language === "unknown" ? "unrecognized" : language} code.` });
  }

  const severe = findings.filter((f) => f.severity === "critical" || f.severity === "high").length;
  const positives = severe
    ? undefined
    : [
        `No critical/high matches across ${rules.length} rules`,
        language !== "unknown" ? `Language detected as ${language}` : "",
      ].filter(Boolean);

  const { score, grade } = scoreFindings(findings);
  return { scanner: "code", language, linesScanned: lines.length, score, grade, findings, positives };
}

export function runCodeScan(code: string): CodeScanReport {
  const started = Date.now();
  const base = reviewCode(code);
  // Verification pass (GVS5H discipline): pasted source has exactly one
  // channel — itself. Tag, dedup, and attach the verification block.
  tag(base.findings, "single-source");
  const dedup = dedupeFindings(base.findings);
  return {
    ...base,
    findings: dedup.findings,
    target: "pasted-source",
    durationMs: Date.now() - started,
    cached: false,
    scannedAt: new Date().toISOString(),
    verification: verificationBlock(dedup.findings, dedup.deduped, { tokenUsed: false }),
  };
}
