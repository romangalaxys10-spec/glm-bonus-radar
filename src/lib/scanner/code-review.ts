/**
 * zScanner — Code Reviewer (paste-based, heuristic).
 *
 * Rule pack ideas adapted from the open-source classics (ledger
 * research-code.json): Semgrep community rules, Bandit (Python),
 * eslint-plugin-security (JS), detect-secrets/gitleaks patterns.
 * Deterministic, linear-time, evidence = the offending line (plain text).
 * The `Reviewer` interface seam deliberately stays LLM-free: pasted code is
 * confidential and this host's outbound policy is GET-only.
 */

import { type CodeScanReport, type Finding, scoreFindings } from "./types";

const MAX_BYTES = 256 * 1024;
const MAX_LINES = 5000;

type LineRule = {
  id: string;
  severity: Finding["severity"];
  title: string;
  detail: string;
  fix?: string;
  re: RegExp;
  /** Skip when another, more specific rule already fired on the same line. */
  unless?: RegExp;
};

const GENERIC: LineRule[] = [
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
];

const AGGREGATES: { id: string; severity: Finding["severity"]; title: string; re: RegExp; threshold: number; detail: (n: number) => string; fix?: string }[] = [
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
];

function detectLanguage(code: string): string {
  const py = (code.match(/\bdef\s+\w+\s*\(|\bimport\s+\w+|\bfrom\s+\w+\s+import|\bself\b|\belif\b/g) ?? []).length;
  const ts = (code.match(/:\s*(?:string|number|boolean|any|void)\b|\binterface\s+\w+|<[A-Z]\w*>(?=\()|\bimplements\s+/g) ?? []).length;
  const js = (code.match(/\b(?:const|let|var)\s+\w+|=>|console\.|\bfunction\s+\w+|\brequire\s*\(|import\s+.*\bfrom\b/g) ?? []).length;
  if (py >= 3 && py > js) return "python";
  if (ts >= 2) return "typescript";
  if (js >= 3) return "javascript";
  if (py > 0) return "python";
  return "unknown";
}

function lineRulesFor(lang: string): LineRule[] {
  const pack = lang === "python" ? PYTHON : lang === "javascript" || lang === "typescript" ? JS_TS : [];
  return [...GENERIC, ...pack];
}

export function reviewCode(code: string): Omit<CodeScanReport, "durationMs" | "cached" | "scannedAt" | "target"> {
  const language = detectLanguage(code);
  const lines = code.slice(0, MAX_BYTES).split(/\r?\n/).slice(0, MAX_LINES);
  const rules = lineRulesFor(language);
  const findings: Finding[] = [];
  const fired = new Map<string, Set<number>>(); // rule id -> lines

  lines.forEach((line, idx) => {
    const no = idx + 1;
    for (const rule of rules) {
      if (rule.severity === "info") continue; // aggregates handled below
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

  const joined = code.slice(0, MAX_BYTES);
  for (const agg of AGGREGATES) {
    const n = (joined.match(new RegExp(agg.re.source, agg.re.flags.includes("g") ? agg.re.flags : agg.re.flags + "g")) ?? []).length;
    if (n >= agg.threshold) {
      findings.push({ id: agg.id, severity: agg.severity, title: agg.title, detail: agg.detail(n), fix: agg.fix });
    }
  }

  if (!findings.length) {
    findings.push({ id: "clean", severity: "pass", title: "No rule-pack findings", detail: `Heuristic pack (${rules.length} rules) found no matches in ${lines.length} lines of ${language === "unknown" ? "unrecognized" : language} code.` });
  }

  const { score, grade } = scoreFindings(findings);
  return { scanner: "code", language, linesScanned: lines.length, score, grade, findings };
}

export function runCodeScan(code: string): CodeScanReport {
  const started = Date.now();
  const base = reviewCode(code);
  return {
    ...base,
    target: "pasted-source",
    durationMs: Date.now() - started,
    cached: false,
    scannedAt: new Date().toISOString(),
  };
}
