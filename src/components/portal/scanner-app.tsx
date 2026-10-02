"use client";

/**
 * zScanner UI — four tabs (Security / SEO·GEO·Perf / QA / Code), async job
 * flow with live progress bar + ETA, and the report v2 language: posture
 * summary, weighted score ring, pillar breakdown, severity-chipped
 * findings, needs-validation leads (never scored), positives, and a
 * copy-paste fix prompt for the user's dev agent. Evidence is rendered as
 * plain text only — fetched/pasted content is never rendered as HTML (the
 * classic scanner-site XSS is reflected content).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CodeScanReport, type Finding, type ScanDiff, type ScanDiffEntry, type ScanLead, type ScannerKind, type Severity, type SlopShot, type SnapshotSummary, type UrlScanReport, type VerificationBlock, severityOrder } from "@/lib/scanner/types";
import { fixPromptFor } from "@/lib/scanner/prompts";

type Tab = "security" | "geo" | "qa" | "auto-qa" | "code" | "slop";

const TABS: { id: Tab; label: string }[] = [
  { id: "security", label: "security audit" },
  { id: "geo", label: "seo·geo·perf" },
  { id: "qa", label: "qa audit" },
  { id: "auto-qa", label: "auto qa auditor" },
  { id: "code", label: "code reviewer" },
  { id: "slop", label: "anti ai-slop reviewer" },
];

const SEV_CLASS: Record<Severity, string> = {
  critical: "border-[color-mix(in_srgb,var(--rc-gone)_55%,transparent)] bg-[color-mix(in_srgb,var(--rc-gone)_14%,transparent)] text-[var(--rc-gone)]",
  high: "border-[color-mix(in_srgb,var(--rc-accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--rc-accent)_12%,transparent)] text-[var(--rc-accent)]",
  medium: "border-[color-mix(in_srgb,var(--rc-tone2)_55%,transparent)] bg-[color-mix(in_srgb,var(--rc-tone2)_12%,transparent)] text-[var(--rc-tone2)]",
  low: "border-[color-mix(in_srgb,var(--rc-tone3)_55%,transparent)] bg-[color-mix(in_srgb,var(--rc-tone3)_12%,transparent)] text-[var(--rc-tone3)]",
  info: "border-[var(--rc-border)] bg-[var(--rc-bg)] text-[var(--rc-text-dim)]",
  pass: "border-[color-mix(in_srgb,var(--rc-brand)_55%,transparent)] bg-[color-mix(in_srgb,var(--rc-brand)_12%,transparent)] text-[var(--rc-brand)]",
};

function SevChip({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center rounded-full border px-2 py-[2px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] ${SEV_CLASS[severity]}`}
    >
      {severity}
    </span>
  );
}

function ConfidenceChip({ confidence }: { confidence: NonNullable<Finding["confidence"]> }) {
  return (
    <span
      title="How this finding was verified before reporting"
      className="inline-flex shrink-0 select-none items-center rounded-full border border-[color-mix(in_srgb,var(--rc-brand)_45%,transparent)] px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.06em] text-[var(--rc-brand)]"
    >
      {confidence}
    </span>
  );
}

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 85 ? "var(--rc-brand)" : pct >= 55 ? "var(--rc-tone3)" : pct >= 40 ? "var(--rc-tone2)" : "var(--rc-gone)";
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 84 84" className="h-[84px] w-[84px] -rotate-90">
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--rc-border)" strokeWidth="7" />
        <circle
          cx="42"
          cy="42"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(c * pct) / 100} ${c}`}
        />
        <text x="42" y="42" textAnchor="middle" dominantBaseline="central" className="rotate-90" style={{ transformOrigin: "42px 42px" }} fill="var(--rc-text)" fontSize="20" fontWeight="700">
          {pct}
        </text>
      </svg>
      <div>
        <p className="font-display text-3xl font-bold tracking-tight">grade {grade}</p>
        <p className="font-mono text-xs text-[var(--rc-text-dim)]">weighted deduction score, 0–100</p>
      </div>
    </div>
  );
}

function BreakdownBars({ items }: { items: { label: string; score: number; hint?: string }[] }) {
  const color = (s: number) => (s >= 85 ? "var(--rc-brand)" : s >= 55 ? "var(--rc-tone3)" : s >= 40 ? "var(--rc-tone2)" : "var(--rc-gone)");
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((b) => (
        <div key={b.label} className="rounded-lg border border-[var(--rc-border)] bg-[var(--rc-bg)] px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-medium">{b.label}</span>
            <span className="font-mono text-[11px] text-[var(--rc-text-dim)]">{b.score}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--rc-border)_70%,transparent)]">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(2, Math.min(100, b.score))}%`, background: color(b.score) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function VerdictChip({ verdict }: { verdict: "ok" | "needs-review" | "blocked" }) {
  const cls =
    verdict === "ok"
      ? SEV_CLASS.pass
      : verdict === "needs-review"
        ? SEV_CLASS.medium
        : SEV_CLASS.critical;
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] ${cls}`}>
      {verdict}
    </span>
  );
}

function FindingsList({ findings }: { findings: Finding[] }) {
  const sorted = [...findings].sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
  return (
    <ul className="grid gap-2">
      {sorted.map((f) => (
        <li key={f.id + f.evidence?.slice(0, 24)} className="rounded-xl border border-[var(--rc-border)] bg-[var(--rc-bg)] p-3.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <SevChip severity={f.severity} />
            {f.confidence ? <ConfidenceChip confidence={f.confidence} /> : null}
            <span className="text-sm font-semibold">{f.title}</span>
            <span className="ml-auto font-mono text-[10px] text-[var(--rc-text-dim)]">{f.id}</span>
          </div>
          {f.detail ? <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--rc-text-dim)]">{f.detail}</p> : null}
          {f.fix ? (
            <p className="mt-1.5 text-[13px] leading-relaxed">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-accent)]">fix </span>
              {f.fix}
            </p>
          ) : null}
          {f.evidence ? (
            <p className="mt-2 overflow-hidden rounded-lg border border-[var(--rc-border)] bg-[var(--rc-surface)] px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">
              {f.evidence}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function LeadsList({ leads }: { leads: ScanLead[] }) {
  return (
    <div className="rounded-xl border border-dashed border-[color-mix(in_srgb,var(--rc-tone2)_55%,transparent)] bg-[color-mix(in_srgb,var(--rc-tone2)_6%,transparent)] p-3.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-tone2)]">
        needs validation — not scored
      </p>
      <ul className="mt-2 grid gap-2.5">
        {leads.map((l) => (
          <li key={l.title + l.evidence?.slice(0, 20)}>
            <p className="text-[13px] font-semibold">{l.title}</p>
            <p className="text-[13px] leading-relaxed text-[var(--rc-text-dim)]">{l.why}</p>
            {l.how ? <p className="mt-1 text-[13px] leading-relaxed"><span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-accent)]">validate </span>{l.how}</p> : null}
            {l.evidence ? <p className="mt-1.5 overflow-hidden rounded-lg border border-[var(--rc-border)] bg-[var(--rc-surface)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--rc-text-dim)]">{l.evidence}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FixPromptBlock({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = prompt;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
      } catch {
        /* selection stays visible for manual copy */
      }
      ta.remove();
    }
    setTimeout(() => setCopied(false), 2200);
  }, [prompt]);
  return (
    <div className="rounded-xl border border-[color-mix(in_srgb,var(--rc-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--rc-accent)_6%,transparent)] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-accent)]">fix prompt — paste into your dev agent</p>
        <button
          onClick={copy}
          className="ml-auto rounded-full border border-[var(--rc-accent)] px-3 py-1 font-mono text-[11px] font-semibold text-[var(--rc-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--rc-accent)_14%,transparent)]"
        >
          {copied ? "copied ✓" : "copy prompt"}
        </button>
      </div>
      <pre className="mt-2.5 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--rc-border)] bg-[var(--rc-bg)] p-3 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">{prompt}</pre>
    </div>
  );
}

function VerificationBlockView({ v }: { v: VerificationBlock }) {
  const s = v.statuses;
  const bits = [`${s.confirmed} confirmed`, `${s.presence} presence`, `${s["single-source"]} single-source`, `${s.inferred} inferred`];
  const extras = [
    typeof v.filesAnalyzed === "number" ? `${v.filesAnalyzed} file${v.filesAnalyzed === 1 ? "" : "s"} analyzed` : null,
    typeof v.filesSkipped === "number" && v.filesSkipped > 0 ? `${v.filesSkipped} skipped` : null,
    typeof v.apiCalls === "number" ? `${v.apiCalls} GitHub API calls` : null,
    v.treeTruncated ? "tree listing truncated — sampled" : null,
    v.tokenUsed ? "token used (not stored)" : "anonymous scan",
  ].filter(Boolean);
  return (
    <div className="rounded-xl border border-[var(--rc-border)] bg-[var(--rc-bg)] px-3.5 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-brand)]">verification pass</p>
      <p className="mt-1.5 font-mono text-[11px] text-[var(--rc-text)]">{bits.join(" · ")}{v.deduped ? ` · ${v.deduped} deduped` : ""}</p>
      <p className="mt-1 font-mono text-[11px] text-[var(--rc-text-dim)]">{extras.join(" · ")}</p>
      <p className="mt-2 text-[12px] leading-relaxed text-[var(--rc-text-dim)]">{v.policy}</p>
    </div>
  );
}

type Progress = { pct: number; stage: string; etaSec: number | null; phase?: "scan" | "queue" };

/* ------------------- v4 — scan tokens & before/after diff ------------------ */

const LS_TOKENS = "br-scan-tokens";

type TokenMap = Record<string, string>;

function loadTokenMap(): TokenMap {
  try {
    const m = JSON.parse(localStorage.getItem(LS_TOKENS) ?? "{}") as unknown;
    return m && typeof m === "object" && !Array.isArray(m) ? (m as TokenMap) : {};
  } catch {
    return {};
  }
}

function saveTokenToMap(key: string, token: string): void {
  try {
    const m = loadTokenMap();
    m[key] = token;
    localStorage.setItem(LS_TOKENS, JSON.stringify(m));
  } catch {
    /* private mode / storage full — the copy button still works */
  }
}

/** Mirror of the server-side targetKeyFor: keys the per-target token memory. */
function targetKeyOf(scanner: ScannerKind, target: string): string {
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

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the textarea path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function CopyTokenCard({ scanner, target, token }: { scanner: ScannerKind; target: string; token: string }) {
  const [copied, setCopied] = useState(false);
  const mapKey = `${scanner}:${targetKeyOf(scanner, target)}`;
  useEffect(() => {
    saveTokenToMap(mapKey, token);
  }, [mapKey, token]);
  const copy = useCallback(async () => {
    if (await copyText(token)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  }, [token]);
  return (
    <div className="rounded-xl border border-[color-mix(in_srgb,var(--rc-brand)_45%,transparent)] bg-[color-mix(in_srgb,var(--rc-brand)_7%,transparent)] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-brand)]">scan token — save it to diff next time</p>
        <button
          onClick={copy}
          className="ml-auto rounded-full border border-[var(--rc-brand)] px-3 py-1 font-mono text-[11px] font-semibold text-[var(--rc-brand)] transition-colors hover:bg-[color-mix(in_srgb,var(--rc-brand)_14%,transparent)]"
        >
          {copied ? "copied ✓" : "copy token"}
        </button>
      </div>
      <p className="mt-2 select-all font-mono text-[17px] font-bold tracking-[0.06em] text-[var(--rc-text)]">{token}</p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--rc-text-dim)]">
        Auto-saved on this device for this target and suggested on your next visit. Paste it into the compare field before a later
        scan of the same target — the report then shows what you fixed, what is still open and what is new. Snapshots are kept 90 days.
      </p>
    </div>
  );
}

function RemainingList({ entries }: { entries: ScanDiffEntry[] }) {
  return (
    <ul className="grid gap-2">
      {entries.map((e, i) => (
        <li key={e.after.id + String(i)} className="rounded-xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-3.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <SevChip severity={e.after.severity} />
            {e.before.severity !== e.after.severity ? (
              <span title="Severity changed since the previous scan" className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--rc-text-dim)]">
                was {e.before.severity}
              </span>
            ) : null}
            <span className="text-sm font-semibold">{e.after.title}</span>
            <span className="ml-auto font-mono text-[10px] text-[var(--rc-text-dim)]">{e.after.id}</span>
          </div>
          {e.after.detail ? <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--rc-text-dim)]">{e.after.detail}</p> : null}
          {e.after.fix ? (
            <p className="mt-1.5 text-[13px] leading-relaxed">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-accent)]">fix </span>
              {e.after.fix}
            </p>
          ) : null}
          {e.after.evidence ? (
            <p className="mt-2 overflow-hidden rounded-lg border border-[var(--rc-border)] bg-[var(--rc-bg)] px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">{e.after.evidence}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function DiffView({ diff, scoreAfter }: { diff: ScanDiff; scoreAfter: number }) {
  const delta = scoreAfter - diff.scoreBefore;
  const day = new Date(diff.prevDate).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const deltaCls = delta > 0 ? "text-[var(--rc-brand)]" : delta < 0 ? "text-[var(--rc-gone)]" : "text-[var(--rc-text-dim)]";
  return (
    <div className="mt-5 rounded-xl border border-[color-mix(in_srgb,var(--rc-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--rc-accent)_5%,transparent)] p-3.5" aria-live="polite">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-accent)]">before / after diff</p>
        <span className="font-mono text-[11px] text-[var(--rc-text-dim)]">
          vs {diff.prevToken} · {day}
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-[var(--rc-border)] bg-[var(--rc-bg)] px-2.5 py-1 font-mono text-[12px] font-semibold">
          {diff.scoreBefore} → {scoreAfter} <span className={deltaCls}>({delta >= 0 ? "+" : ""}{delta})</span>
        </span>
        <span className="rounded-full border border-[color-mix(in_srgb,var(--rc-brand)_55%,transparent)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[var(--rc-brand)]">{diff.fixed.length} fixed</span>
        <span className="rounded-full border border-[color-mix(in_srgb,var(--rc-tone2)_55%,transparent)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[var(--rc-tone2)]">{diff.remaining.length} still open</span>
        <span className="rounded-full border border-[color-mix(in_srgb,var(--rc-gone)_55%,transparent)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[var(--rc-gone)]">{diff.added.length} new</span>
      </div>
      {diff.added.length ? (
        <details open className="mt-3">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--rc-gone)]">new since last scan ({diff.added.length})</summary>
          <div className="mt-2">
            <FindingsList findings={diff.added} />
          </div>
        </details>
      ) : null}
      {diff.remaining.length ? (
        <details open className="mt-3">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--rc-tone2)]">still open ({diff.remaining.length})</summary>
          <div className="mt-2">
            <RemainingList entries={diff.remaining} />
          </div>
        </details>
      ) : null}
      {diff.fixed.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--rc-brand)]">fixed since last scan ({diff.fixed.length}) — do not regress</summary>
          <div className="mt-2 opacity-80">
            <FindingsList findings={diff.fixed} />
          </div>
        </details>
      ) : null}
      {diff.fixed.length > 0 && diff.remaining.length === 0 && diff.added.length === 0 ? (
        <p className="mt-3 text-[13px] font-medium text-[var(--rc-brand)]">All previous findings are fixed — clean board. Keep this token for the next round.</p>
      ) : null}
    </div>
  );
}

function ProgressBar({ progress }: { progress: Progress }) {
  const eta =
    progress.etaSec != null
      ? progress.phase === "queue"
        ? `starts in ≈ ${progress.etaSec}s`
        : `≈ ${progress.etaSec}s left`
      : "working…";
  return (
    <div className="mt-6 rounded-xl border border-[var(--rc-border)] bg-[var(--rc-bg)] p-4" aria-live="polite" role="status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[12px] text-[var(--rc-text)]">
          <span className={`mr-2 inline-block h-2 w-2 animate-pulse rounded-full align-middle ${progress.phase === "queue" ? "bg-[color-mix(in_srgb,var(--rc-accent)_55%,transparent)]" : "bg-[var(--rc-accent)]"}`} />
          {progress.stage}
        </p>
        <p className="font-mono text-[12px] text-[var(--rc-text-dim)]">
          {progress.pct}% · {eta}
        </p>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--rc-border)_70%,transparent)]">
        <div
          className={`h-full rounded-full transition-all duration-500 ${progress.phase === "queue" ? "bg-[color-mix(in_srgb,var(--rc-accent)_45%,transparent)] animate-pulse" : "bg-[var(--rc-accent)]"}`}
          style={{ width: `${Math.max(3, Math.min(100, progress.pct))}%` }}
        />
      </div>
    </div>
  );
}

type AnyReport = (UrlScanReport | CodeScanReport) & { cached?: boolean };

const SAMPLE_URLS = ["zhelp.space-z.ai", "example.com", "github.com"];
const SAMPLE_REPOS = ["expressjs/express", "pallets/flask", "romangalaxys10-spec/zai-hosting-patcher"];

/* ---------- v5 — auto QA auditor types ---------- */
type JobQuestion = { id: string; prompt: string; kind: "login" | "choice" | "text" | "info"; hint?: string; timeoutSec: number };
type QaInit = {
  target: string;
  allowPrivate: boolean;
  probe: { status: number; finalUrl: string; ttfbMs: number; title: string; generator: string; bytes: number };
  loginFormDetected: boolean;
  browserAvailable: boolean;
  browserSmoke: "ok" | "failed" | "skipped" | "busy";
  browserError?: string | null;
  browserProbe?: { code: number | null; stdout: string; stderr: string; signal: string | null } | null;
  browser?: { exe: string | null; libs: boolean; fonts: boolean; glibc: string | null; tier: string | null };
  qaQueue?: { running: number; waiting: number; capacity: number; avgRunSec: number | null; nextEtaSec: number | null };
  questions: { id: string; prompt: string; hint?: string }[];
};
type InboxMsg = { from: string; to: string; subject: string; date: string; preview: string; receivedAt: string };

function QaQuestionBox({
  question,
  value,
  setValue,
  onSubmit,
}: {
  question: JobQuestion;
  value: string;
  setValue: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-5 rounded-xl border border-[color-mix(in_srgb,var(--rc-accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--rc-accent)_8%,transparent)] p-4" role="status">
      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-accent)]">the auditor needs your input</p>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--rc-text)]">{question.prompt}</p>
      {question.hint ? <p className="mt-1 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">{question.hint}</p> : null}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          placeholder={question.kind === "login" ? "user: … pass: …  (or: continue)" : question.kind === "choice" ? "continue / url: … / skip" : "your answer (or: skip)"}
          className="min-w-0 flex-1 rounded-full border border-[var(--rc-border)] bg-[var(--rc-bg)] px-4 py-2 font-mono text-[12.5px] text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)]"
          autoFocus
        />
        <button
          onClick={onSubmit}
          className="rounded-full bg-[var(--rc-accent)] px-4 py-2 text-sm font-semibold text-[var(--rc-on-accent)] transition-opacity hover:opacity-90"
        >
          answer
        </button>
      </div>
      <p className="mt-1.5 font-mono text-[11px] text-[var(--rc-text-dim)]">No answer within {Math.round(question.timeoutSec / 60) || 1} min → the auditor proceeds with its documented default. The run is paused while it waits.</p>
    </div>
  );
}

function MetricsStrip({ metrics }: { metrics: { label: string; value: string }[] }) {
  if (!metrics?.length) return null;
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {metrics.map((m) => (
        <div key={m.label} className="rounded-lg border border-[var(--rc-border)] bg-[var(--rc-bg)] px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--rc-text-dim)]">{m.label}</p>
          <p className="mt-0.5 truncate font-mono text-[12.5px] text-[var(--rc-text)]" title={m.value}>
            {m.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * v6 — visual evidence gallery (slop scanner): screenshots of the actual
 * elements behind the important tells, highlighted in the page, plus the
 * clean full-page context shot. Click a card to zoom.
 */
function ShotsGallery({ shots, note }: { shots?: SlopShot[]; note?: string }) {
  const [zoom, setZoom] = useState<SlopShot | null>(null);
  const hasShots = !!shots?.length;
  /* Escape closes the lightbox from anywhere — a div-level keydown only fires
     when the overlay holds focus, which real users (and automation) skip. */
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  if (!hasShots && !note) return null;
  const tells = shots?.filter((s) => s.id !== "context") ?? [];
  const context = shots?.find((s) => s.id === "context");
  return (
    <div className="mt-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--rc-accent)]">visual evidence</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--rc-text-dim)]">
        {hasShots
          ? "The tells below were located in the live DOM and captured from the rendered page — the red outline marks the exact element the detector flagged."
          : null}
      </p>
      {hasShots ? (
        <div className="mt-3 grid gap-4">
          {context ? (
            <ShotCard shot={context} onZoom={setZoom} wide />
          ) : null}
          {tells.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {tells.map((s) => (
                <ShotCard key={`${s.id}-${s.w}x${s.h}-${s.label}`} shot={s} onZoom={setZoom} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {note ? (
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">visual evidence not captured: {note}</p>
      ) : null}
      {zoom ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={zoom.label}
          onClick={() => setZoom(null)}
          onKeyDown={(e) => e.key === "Escape" && setZoom(null)}
          tabIndex={-1}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4 md:p-10 outline-none"
        >
          <figure className="max-h-full max-w-6xl" onClick={(e) => e.stopPropagation()}>
            <img src={zoom.dataUrl} alt={zoom.label} className="max-h-[80vh] w-auto max-w-full rounded-lg shadow-2xl" />
            <figcaption className="mt-2 flex items-start justify-between gap-4 rounded-lg bg-[var(--rc-surface)] px-3 py-2">
              <span className="text-[12.5px] leading-relaxed text-[var(--rc-text)]">{zoom.caption}</span>
              <button
                onClick={() => setZoom(null)}
                className="shrink-0 rounded-full border border-[var(--rc-border)] px-3 py-1 font-mono text-[11px] text-[var(--rc-text-dim)] transition-colors hover:border-[var(--rc-accent)] hover:text-[var(--rc-accent)]"
              >
                close
              </button>
            </figcaption>
          </figure>
        </div>
      ) : null}
    </div>
  );
}

function ShotCard({ shot, onZoom, wide }: { shot: SlopShot; onZoom: (s: SlopShot) => void; wide?: boolean }) {
  return (
    <button
      onClick={() => onZoom(shot)}
      className="group block w-full overflow-hidden rounded-xl border border-[var(--rc-border)] bg-[var(--rc-bg)] text-left transition-colors hover:border-[var(--rc-accent)]"
      title="Click to zoom"
    >
      <div className="relative">
        <img src={shot.dataUrl} alt={shot.label} loading="lazy" className={`w-full object-cover object-top transition-opacity group-hover:opacity-90 ${wide ? "max-h-[420px]" : "max-h-[240px]"}`} />
        <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-[2px] font-mono text-[9px] uppercase tracking-[0.08em] text-white opacity-0 transition-opacity group-hover:opacity-100">
          zoom
        </span>
      </div>
      <div className="border-t border-[var(--rc-border)] px-3 py-2">
        <div className="flex items-center gap-2">
          {shot.id === "context" ? (
            <span className="inline-flex shrink-0 select-none items-center rounded-full border border-[var(--rc-border)] px-2 py-[2px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--rc-text-dim)]">context</span>
          ) : (
            <SevChip severity={shot.severity} />
          )}
          <span className="truncate font-mono text-[11.5px] font-semibold text-[var(--rc-text)]">{shot.label}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[var(--rc-text-dim)]">{shot.caption}</p>
      </div>
    </button>
  );
}
const SAMPLE_CODE = `import pickle, requests, hashlib

API_KEY = "sk-live-9f8ac3d2b1e7440d8f2c1b9e77aa2c31"
SLACK = "xoxb-123456789012-abcdef"

def load_session(blob):
    return pickle.loads(blob)

def fetch(url):
    r = requests.get(url, verify=False)
    token = str(int(hashlib.md5(url.encode()).hexdigest(), 16))
    print("token", token)
    return eval(r.headers.get("x-op"))

def query(user):
    cur.execute("SELECT * FROM users WHERE name = '" + user + "'")

except:
    pass

# TODO: rate limiting, FIXME: error handling
`;

export function ScannerApp() {
  const [tab, setTab] = useState<Tab>("security");
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [targetKind, setTargetKind] = useState<"web" | "repo">("web");
  const [codeMode, setCodeMode] = useState<"paste" | "repo">("paste");
  const [repo, setRepo] = useState("");
  const [ghToken, setGhToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [report, setReport] = useState<AnyReport | null>(null);
  const [compareToken, setCompareToken] = useState("");
  const [tokenCheck, setTokenCheck] = useState<{ ok: boolean; msg: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* v5 — auto QA auditor flow states */
  const [qaInit, setQaInit] = useState<QaInit | null>(null);
  const [qaStage, setQaStage] = useState<"input" | "questionnaire" | "running">("input");
  const [qaUseLogin, setQaUseLogin] = useState(false);
  const [qaUser, setQaUser] = useState("");
  const [qaPass, setQaPass] = useState("");
  const [qaSelectors, setQaSelectors] = useState("");
  const [qaFlows, setQaFlows] = useState("");
  const [qaNotes, setQaNotes] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<JobQuestion | null>(null);
  const [answerText, setAnswerText] = useState("");

  /* v5 — email notifications (from glm@zhelp.space-z.ai) */
  const [mailTo, setMailTo] = useState("");
  const [mailStatus, setMailStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [mailBusy, setMailBusy] = useState(false);
  const [autoSend, setAutoSend] = useState(false);
  const [inbox, setInbox] = useState<InboxMsg[] | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const qaJobIdRef = useRef<string>("");

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const run = useCallback(
    (endpoint: string, body: Record<string, string>) => {
      stopPolling();
      setBusy(true);
      setError(null);
      setReport(null);
      setProgress({ pct: 0, stage: "queueing scan", etaSec: null });
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          const data = (await res.json()) as { jobId?: string; message?: string };
          if (!res.ok || !data.jobId) {
            setError(data.message || `Scan failed (HTTP ${res.status}).`);
            setBusy(false);
            setProgress(null);
            return;
          }
          const startedAt = Date.now();
          pollRef.current = setInterval(() => {
            fetch(`/api/scan/job/${data.jobId}`, { cache: "no-store" })
              .then(async (r) => {
                if (r.status === 404) throw new Error("lost");
                const j = (await r.json()) as { status: string; pct: number; stage: string; etaSec: number | null; result?: AnyReport; error?: { message?: string } };
                setProgress({ pct: j.pct, stage: j.stage, etaSec: j.etaSec });
                if (j.status === "done") {
                  stopPolling();
                  setReport(j.result ?? null);
                  setBusy(false);
                  setProgress(null);
                } else if (j.status === "error") {
                  stopPolling();
                  setError(j.error?.message || "Scan failed.");
                  setBusy(false);
                  setProgress(null);
                } else if (Date.now() - startedAt > 120_000) {
                  stopPolling();
                  setError("Scan timed out — try again.");
                  setBusy(false);
                  setProgress(null);
                }
              })
              .catch(() => {
                /* transient poll error — keep polling until the deadline */
              });
          }, 700);
        })
        .catch(() => {
          setError("The scanner could not be reached. Try again.");
          setBusy(false);
          setProgress(null);
        });
    },
    [stopPolling]
  );

  const repoMode = tab === "code" ? codeMode === "repo" : tab === "slop" ? false : targetKind === "repo";

  /* v4 — saved-token plumbing: recall → preflight → send with the scan. */
  const scannerKind: ScannerKind = tab === "geo" ? "geo-seo" : tab;
  const recallKey = useCallback((): string => {
    if (repoMode) {
      const gh = repo.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
      return gh ? `${gh[1]}/${gh[2]}`.toLowerCase() : repo.trim().toLowerCase();
    }
    if (tab === "code" && codeMode === "paste") return "pasted-source";
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
      return u.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return url.trim().toLowerCase();
    }
  }, [repoMode, repo, tab, codeMode, url]);

  // Suggest the last saved token for this scanner+target when the field is empty.
  useEffect(() => {
    if (compareToken) return;
    const key = recallKey();
    if (!key) return;
    const saved = loadTokenMap()[`${scannerKind}:${key}`];
    if (saved) setCompareToken(saved);
  }, [url, repo, targetKind, codeMode, tab, compareToken, scannerKind, recallKey]);

  const preflight = useCallback(async (raw: string) => {
    setChecking(true);
    setTokenCheck(null);
    try {
      const res = await fetch(`/api/scan/snapshot?token=${encodeURIComponent(raw.trim())}`, { cache: "no-store" });
      if (res.status === 404) {
        setTokenCheck({ ok: false, msg: "✗ not found — expired after 90 days or mistyped." });
        return;
      }
      const s = (await res.json()) as Partial<SnapshotSummary> & { message?: string };
      if (!res.ok || !s.token || !s.scanner || !s.createdAt) {
        setTokenCheck({ ok: false, msg: `✗ ${s.message ?? "lookup failed — try again."}` });
        return;
      }
      setTokenCheck({
        ok: true,
        msg: `✓ ${s.scanner} scan of ${s.target} · score ${s.score} (${s.grade}) · ${new Date(s.createdAt).toLocaleDateString()} · ${s.findings} findings`,
      });
    } catch {
      setTokenCheck({ ok: false, msg: "✗ lookup failed — try again." });
    } finally {
      setChecking(false);
    }
  }, []);

  const withCompare = useCallback(
    (body: Record<string, string>): Record<string, string> => {
      const t = compareToken.trim();
      if (t) body.compareToken = t;
      return body;
    },
    [compareToken]
  );

  const runUrl = () => {
    if (tab === "auto-qa") {
      void prepareQa();
      return;
    }
    if (!url.trim()) {
      setError("Give a public URL first.");
      return;
    }
    const endpoint =
      tab === "security"
        ? "/api/scan/security"
        : tab === "geo"
          ? "/api/scan/geo-seo"
          : tab === "slop"
            ? "/api/scan/slop"
            : "/api/scan/qa";
    run(endpoint, withCompare({ url: url.trim() }));
  };
  const runCode = () => {
    if (!code.trim()) {
      setError("Paste some code first.");
      return;
    }
    run("/api/scan/code", withCompare({ code }));
  };

  const runRepo = () => {
    if (!repo.trim()) {
      setError("Give a repo like owner/name or a github.com URL.");
      return;
    }
    const scanner = tab === "geo" ? "geo-seo" : tab;
    const body: Record<string, string> = withCompare({ repo: repo.trim(), scanner });
    if (ghToken.trim()) body.token = ghToken.trim();
    run("/api/scan/github", body);
  };

  /* v5 — auto QA auditor: prepare → questionnaire → run with mid-run questions */
  const prepareQa = useCallback(async () => {
    if (!url.trim()) {
      setError("Give the website / app URL to audit first.");
      return;
    }
    stopPolling();
    setBusy(true);
    setError(null);
    setReport(null);
    setProgress({ pct: 8, stage: "probing target & preparing questions", etaSec: null });
    try {
      const res = await fetch("/api/scan/qa-auto/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await res.json()) as QaInit & { message?: string };
      if (!res.ok) {
        setError(data.message || `Probe failed (HTTP ${res.status}).`);
        setProgress(null);
        setBusy(false);
        return;
      }
      setQaInit(data);
      setQaUseLogin(data.loginFormDetected);
      setQaStage("questionnaire");
      setProgress(null);
    } catch {
      setError("The scanner could not be reached. Try again.");
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }, [url, stopPolling]);

  const runQaE2E = useCallback(() => {
    if (!qaInit) return;
    setQaStage("running");
    setBusy(true);
    setError(null);
    setReport(null);
    setPendingQuestion(null);
    setProgress({ pct: 0, stage: "queueing browser run", etaSec: null });
    const answers: Record<string, unknown> = {
      useLogin: qaUseLogin,
      username: qaUser,
      password: qaPass,
      loginSelectors: qaSelectors,
      flows: qaFlows,
      notes: qaNotes,
    };
    const body = withCompare({ url: qaInit.target, answers } as unknown as Record<string, string>);
    fetch("/api/scan/qa-auto/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        const data = (await res.json()) as { jobId?: string; queue?: { position: number; waiting: number; etaSec: number } | null; message?: string };
        if (!res.ok || !data.jobId) {
          setError(data.message || `Could not start (HTTP ${res.status}).`);
          setBusy(false);
          setProgress(null);
          setQaStage("questionnaire");
          return;
        }
        qaJobIdRef.current = data.jobId;
        /* v5.1 — the server answers immediately with a queue preview when all
           QA slots are busy: position + ETA before the first poll even lands */
        if (data.queue)
          setProgress({
            pct: 0,
            stage: `in queue — position ${data.queue.position} of ${data.queue.waiting} waiting`,
            etaSec: data.queue.etaSec,
            phase: "queue",
          });
        const startedAt = Date.now();
        let waitingSec = 0; // time spent waiting on user input does not hit the deadline
        pollRef.current = setInterval(() => {
          fetch(`/api/scan/job/${data.jobId}`, { cache: "no-store" })
            .then(async (r) => {
              if (r.status === 404) throw new Error("lost");
              const j = (await r.json()) as { status: string; pct: number; stage: string; etaSec: number | null; result?: AnyReport; error?: { message?: string }; question?: JobQuestion; runStartedAt?: number; queue?: { position: number; waiting: number; etaSec: number } | null };
              setPendingQuestion(j.question ?? null);
              if (j.queue) {
                /* queued — honest position + ETA + queued-for timer; the work
                   budget does not run while waiting for a slot */
                const queuedForSec = Math.round((Date.now() - startedAt) / 1000);
                setProgress({
                  pct: 0,
                  stage: `in queue — position ${j.queue.position} of ${j.queue.waiting} waiting · queued ${queuedForSec}s`,
                  etaSec: j.queue.etaSec,
                  phase: "queue",
                });
              } else {
                if (j.question) waitingSec += 0.7;
                setProgress({ pct: j.pct, stage: j.question ? "paused — the auditor asked you a question" : j.stage, etaSec: j.etaSec, phase: "scan" });
              }
              if (j.status === "done") {
                stopPolling();
                setReport(j.result ?? null);
                setBusy(false);
                setProgress(null);
                setPendingQuestion(null);
              } else if (j.status === "error") {
                stopPolling();
                setError(j.error?.message || "Scan failed.");
                setBusy(false);
                setProgress(null);
                setQaStage("questionnaire");
              } else if (!j.queue && !j.question && Date.now() - (j.runStartedAt ?? startedAt) - waitingSec * 1000 > 150_000) {
                stopPolling();
                setError("Run exceeded its work budget without finishing — try again.");
                setBusy(false);
                setProgress(null);
              }
            })
            .catch(() => {
              /* transient poll error — keep polling */
            });
        }, 700);
      })
      .catch(() => {
        setError("The scanner could not be reached. Try again.");
        setBusy(false);
        setQaStage("questionnaire");
      });
  }, [qaInit, qaUseLogin, qaUser, qaPass, qaSelectors, qaFlows, qaNotes, withCompare, stopPolling]);

  const answerQa = useCallback(
    (q: JobQuestion) => {
      const v = answerText.trim() || (q.kind === "choice" ? "continue" : "skip");
      if (!qaJobIdRef.current) return;
      fetch("/api/scan/qa-auto/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: qaJobIdRef.current, answerId: q.id, value: v }),
      })
        .then(() => {
          setPendingQuestion(null);
          setAnswerText("");
        })
        .catch(() => {});
    },
    [answerText]
  );

  /* v5 — email notifications */
  const sendMail = useCallback(
    async (subject: string, text: string) => {
      const to = mailTo.trim();
      if (!to) {
        setMailStatus({ ok: false, msg: "Add a recipient email first." });
        return false;
      }
      setMailBusy(true);
      setMailStatus(null);
      try {
        const res = await fetch("/api/notify/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to, subject, text }),
        });
        const data = (await res.json()) as { status?: string; message?: string; detail?: string; routing?: string };
        const ok = res.ok && data.status === "accepted";
        setMailStatus({
          ok,
          msg: ok
            ? `✓ accepted from glm@zhelp.space-z.ai — ${data.detail ?? (data.routing === "local-mailbox" ? "in the local mailbox" : "queued for relay")}`
            : `✗ ${data.message ?? `send failed (HTTP ${res.status})`}`,
        });
        return ok;
      } catch {
        setMailStatus({ ok: false, msg: "✗ mail endpoint unreachable." });
        return false;
      } finally {
        setMailBusy(false);
      }
    },
    [mailTo]
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem("br-notify-to");
      if (saved) setMailTo(saved);
      const a = localStorage.getItem("br-notify-auto");
      if (a === "1") setAutoSend(true);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (mailTo) localStorage.setItem("br-notify-to", mailTo);
      localStorage.setItem("br-notify-auto", autoSend ? "1" : "0");
    } catch {}
  }, [mailTo, autoSend]);

  const reportSummaryText = useCallback((r: AnyReport): string => {
    const open = r.findings.filter((f) => f.severity !== "pass");
    const lines = [
      `zScanner ${r.scanner} report — ${r.target}`,
      `Score: ${r.score}/100 (${r.grade}) · ${open.length} finding(s)`,
      `Token: ${r.scanToken ?? "n/a"} (save it to diff your next scan)`,
      "",
      ...open.slice(0, 12).map((f) => `[${f.severity}] ${f.title}`),
      open.length > 12 ? `… and ${open.length - 12} more (full report: https://zhelp.space-z.ai/scanner)` : "",
      "",
      "Sent by GLM Radar notifications (glm@zhelp.space-z.ai).",
    ];
    return lines.filter((l) => l !== "").join("\n");
  }, []);

  useEffect(() => {
    if (!report || !autoSend || !mailTo.trim()) return;
    void sendMail(
      `zScanner ${report.scanner}: ${report.target} — ${report.score}/100`,
      reportSummaryText(report)
    );
  }, [report]);

  const loadInbox = useCallback(() => {
    setInboxOpen(true);
    fetch("/api/notify/inbox", { cache: "no-store" })
      .then(async (r) => (await r.json()) as { available: boolean; messages?: InboxMsg[] })
      .then((d) => setInbox(d.messages ?? []))
      .catch(() => setInbox([]));
  }, []);

  const fixPrompt = useMemo(() => (report ? fixPromptFor(report) : ""), [report]);

  return (
    <div className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5 md:p-6">
      {/* Tabs */}
      <div role="tablist" aria-label="Scanner" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              stopPolling();
              setTab(t.id);
              setError(null);
              setReport(null);
              setProgress(null);
              setBusy(false);
            }}
            className={`rounded-full border px-3.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors ${
              tab === t.id
                ? "border-[var(--rc-accent)] bg-[color-mix(in_srgb,var(--rc-accent)_12%,transparent)] text-[var(--rc-accent)]"
                : "border-[var(--rc-border)] bg-[var(--rc-bg)] text-[var(--rc-text-dim)] hover:text-[var(--rc-text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Input area — target type toggle + the per-mode inputs */}
      <div className="mt-4">
        {tab !== "code" && tab !== "auto-qa" && tab !== "slop" ? (
          <div role="group" aria-label="Target type" className="flex flex-wrap gap-1.5">
            {([
              { id: "web", label: "website / ip" },
              { id: "repo", label: "github repo" },
            ] as const).map((m) => {
            const active = targetKind === m.id;
            return (
              <button
                key={m.id}
                onClick={() => {
                  setTargetKind(m.id);
                  setError(null);
                }}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-colors ${
                  active
                    ? "border-[var(--rc-brand)] bg-[color-mix(in_srgb,var(--rc-brand)_10%,transparent)] text-[var(--rc-brand)]"
                    : "border-[var(--rc-border)] bg-[var(--rc-bg)] text-[var(--rc-text-dim)] hover:text-[var(--rc-text)]"
                }`}
              >
                {m.label}
              </button>
            );
          })}
          </div>
        ) : null}

        {repoMode ? (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2.5">
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runRepo()}
                placeholder="owner/name or https://github.com/owner/repo"
                inputMode="url"
                className="min-w-0 flex-1 rounded-full border border-[var(--rc-border)] bg-[var(--rc-bg)] px-4 py-2 font-mono text-[13px] text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)]"
              />
              <button
                onClick={runRepo}
                disabled={busy}
                className="rounded-full bg-[var(--rc-accent)] px-5 py-2 text-sm font-semibold text-[var(--rc-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "scanning…" : "Scan repo"}
              </button>
            </div>
            <input
              type="password"
              value={ghToken}
              onChange={(e) => setGhToken(e.target.value)}
              placeholder="GitHub token — optional for public repos, required for private ones"
              autoComplete="off"
              aria-label="GitHub token (used in memory only)"
              className="mt-2.5 w-full rounded-full border border-[var(--rc-border)] bg-[var(--rc-bg)] px-4 py-2 font-mono text-[12px] text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)]"
            />
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">
              The token is used in memory for this scan only — never stored, logged, or sent anywhere except GitHub&apos;s API.
              Private repos: classic PAT with <span className="text-[var(--rc-accent)]">repo</span> scope, or fine-grained with Metadata + Contents read.
              Public repos: optional — raises GitHub&apos;s rate ceiling.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-[var(--rc-text-dim)]">try:</span>
              {SAMPLE_REPOS.map((s) => (
                <button
                  key={s}
                  onClick={() => setRepo(s)}
                  className="rounded-full border border-[var(--rc-border)] px-2.5 py-[3px] font-mono text-[11px] text-[var(--rc-text-dim)] transition-colors hover:border-[var(--rc-accent)] hover:text-[var(--rc-accent)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : tab === "code" ? (
          <div>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={10}
              spellCheck={false}
              placeholder="Paste code to review (max 256 KB) — it is analyzed locally, never sent to third parties."
              className="w-full resize-y rounded-xl border border-[var(--rc-border)] bg-[var(--rc-bg)] p-3.5 font-mono text-[12.5px] leading-relaxed text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)]"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={runCode}
                disabled={busy}
                className="rounded-full bg-[var(--rc-accent)] px-5 py-2 text-sm font-semibold text-[var(--rc-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "reviewing…" : "Review code"}
              </button>
              <button onClick={() => setCode(SAMPLE_CODE)} className="font-mono text-[11px] text-[var(--rc-text-dim)] underline decoration-dotted underline-offset-4 hover:text-[var(--rc-accent)]">
                load risky sample
              </button>
              <span className="font-mono text-[11px] text-[var(--rc-text-dim)]">{code.length ? `${(code.length / 1024).toFixed(1)} KB` : "auto-detects js/ts/python · package.json & requirements.txt dependency floors"}</span>
            </div>
          </div>
        ) : tab === "auto-qa" ? (
          <div>
            <div className="flex flex-wrap gap-2.5">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runUrl()}
                placeholder="your-app.example.com — or a localhost URL when run from the operator host"
                inputMode="url"
                className="min-w-0 flex-1 rounded-full border border-[var(--rc-border)] bg-[var(--rc-bg)] px-4 py-2 font-mono text-[13px] text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)]"
              />
              <button
                onClick={runUrl}
                disabled={busy || qaStage === "running"}
                className="rounded-full bg-[var(--rc-accent)] px-5 py-2 text-sm font-semibold text-[var(--rc-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "probing…" : "Prepare audit"}
              </button>
            </div>
            {qaStage !== "input" && qaInit ? (
              <div className="mt-4 rounded-xl border border-[var(--rc-border)] bg-[var(--rc-bg)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[11px] text-[var(--rc-text-dim)]">
                    target probed: <span className="text-[var(--rc-text)]">{qaInit.probe.finalUrl}</span> · HTTP {qaInit.probe.status} · TTFB {qaInit.probe.ttfbMs} ms
                    {qaInit.probe.title ? ` · “${qaInit.probe.title.slice(0, 60)}”` : ""}
                  </p>
                  <span className={`rounded-full border px-2 py-[2px] font-mono text-[10px] ${!qaInit.browserAvailable || qaInit.browserSmoke === "failed" ? "border-[color-mix(in_srgb,var(--rc-gone)_55%,transparent)] text-[var(--rc-gone)]" : "border-[color-mix(in_srgb,var(--rc-brand)_55%,transparent)] text-[var(--rc-brand)]"}`}>
                    {qaInit.browserAvailable
                      ? qaInit.browserSmoke === "ok"
                        ? "browser ready"
                        : qaInit.browserSmoke === "busy"
                          ? "browser busy — your run will queue"
                          : `browser ${qaInit.browserSmoke}${qaInit.browserError ? ` — ${qaInit.browserError.split("\n")[0].slice(0, 90)}` : ""}`
                      : "browser installing — retry in ~2 min"}
                  </span>
                </div>
                {qaInit.browserAvailable && qaInit.browserSmoke === "failed" ? (
                  <details className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--rc-gone)_35%,transparent)] bg-[var(--rc-surface)] p-2.5">
                    <summary className="cursor-pointer font-mono text-[11px] text-[var(--rc-text-dim)]">browser diagnostics — host details</summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-[var(--rc-text-dim)]">{[
                      `host glibc: ${qaInit.browser?.glibc ?? "unknown"} · pack libs: ${qaInit.browser?.libs ? "yes" : "no"} · fonts: ${qaInit.browser?.fonts ? "yes" : "no"} · exe: ${qaInit.browser?.exe ?? "-"} · last good tier: ${qaInit.browser?.tier ?? "-"}`,
                      qaInit.browserProbe ? `direct probe: exit=${qaInit.browserProbe.code}${qaInit.browserProbe.signal ? ` sig=${qaInit.browserProbe.signal}` : ""}${qaInit.browserProbe.stdout ? ` out=${qaInit.browserProbe.stdout.trim()}` : ""}${qaInit.browserProbe.stderr ? `\nloader stderr:\n${qaInit.browserProbe.stderr.trim()}` : ""}` : null,
                      qaInit.browserError ? `launch error:\n${qaInit.browserError}` : null,
                    ].filter(Boolean).join("\n\n")}</pre>
                  </details>
                ) : null}
                {qaInit.qaQueue && (qaInit.qaQueue.running > 0 || qaInit.qaQueue.waiting > 0) ? (
                  <p className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--rc-accent)_35%,transparent)] bg-[var(--rc-surface)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">
                    auto-QA is busy — {qaInit.qaQueue.running} running · {qaInit.qaQueue.waiting} queued
                    {qaInit.qaQueue.nextEtaSec ? ` · next slot frees in ≈ ${qaInit.qaQueue.nextEtaSec}s` : ""}
                    {qaInit.qaQueue.avgRunSec ? ` · recent runs ≈ ${qaInit.qaQueue.avgRunSec}s` : ""}
                    — your audit enters the queue and starts automatically
                  </p>
                ) : null}
                <p className="mt-3 text-[13.5px] font-medium leading-relaxed text-[var(--rc-text)]">Before the run — the auditor asks:</p>
                <label className="mt-2 flex items-start gap-2.5 text-[13px] leading-relaxed text-[var(--rc-text)]">
                  <input type="checkbox" checked={qaUseLogin} onChange={(e) => setQaUseLogin(e.target.checked)} className="mt-1 accent-[var(--rc-accent)]" />
                  <span>
                    {qaInit.loginFormDetected ? "A login form was detected on the entry page. " : ""}Test authenticated areas with a test account (credentials stay in memory for this run only — never stored, logged, or snapshotted).
                  </span>
                </label>
                {qaUseLogin ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input
                      value={qaUser}
                      onChange={(e) => setQaUser(e.target.value)}
                      placeholder="test username or email"
                      autoComplete="off"
                      className="rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] px-4 py-2 font-mono text-[12.5px] text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)]"
                    />
                    <input
                      type="password"
                      value={qaPass}
                      onChange={(e) => setQaPass(e.target.value)}
                      placeholder="test password"
                      autoComplete="new-password"
                      className="rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] px-4 py-2 font-mono text-[12.5px] text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)]"
                    />
                    <input
                      value={qaSelectors}
                      onChange={(e) => setQaSelectors(e.target.value)}
                      placeholder="advanced: user=#login_user pass=#login_pass submit=#btn (optional)"
                      className="rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] px-4 py-2 font-mono text-[12px] text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)] sm:col-span-2"
                    />
                  </div>
                ) : null}
                <p className="mt-3 font-mono text-[11px] text-[var(--rc-text-dim)]">{qaInit.questions[1]?.prompt}</p>
                <textarea
                  value={qaFlows}
                  onChange={(e) => setQaFlows(e.target.value)}
                  rows={2}
                  spellCheck={false}
                  placeholder={"check: Pricing shows \u201c10% OFF\u201d\ngoto: https://your-app.example.com/dashboard"}
                  className="mt-1.5 w-full resize-y rounded-xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-3 font-mono text-[12px] leading-relaxed text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)]"
                />
                <input
                  value={qaNotes}
                  onChange={(e) => setQaNotes(e.target.value)}
                  placeholder={qaInit.questions[2]?.prompt ?? "Anything else the auditor should know? (optional)"}
                  className="mt-2 w-full rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] px-4 py-2 font-mono text-[12.5px] text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)]"
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    onClick={runQaE2E}
                    disabled={busy || (qaInit.browserAvailable && qaInit.browserSmoke === "failed")}
                    className="rounded-full bg-[var(--rc-accent)] px-5 py-2 text-sm font-semibold text-[var(--rc-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {qaStage === "running" ? "running end-to-end…" : "Run full E2E audit"}
                  </button>
                  {qaInit.browserAvailable && qaInit.browserSmoke === "failed" ? (
                    <button
                      onClick={prepareQa}
                      disabled={busy}
                      className="rounded-full border border-[var(--rc-border)] px-4 py-2 font-mono text-[11px] text-[var(--rc-text)] transition-colors hover:border-[var(--rc-accent)] hover:text-[var(--rc-accent)] disabled:opacity-50"
                    >
                      re-check browser
                    </button>
                  ) : null}
                  <button
                    onClick={() => {
                      setQaStage("input");
                      setQaInit(null);
                    }}
                    className="font-mono text-[11px] text-[var(--rc-text-dim)] underline decoration-dotted underline-offset-4 hover:text-[var(--rc-accent)]"
                  >
                    edit target
                  </button>
                  <span className="font-mono text-[11px] text-[var(--rc-text-dim)]">real browser · console + network + axe a11y + login oracle + 375px + perf · ~60–110 s</span>
                </div>
              </div>
            ) : null}
            <p className="mt-3 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">
              A headless browser drives the app end-to-end. It may pause and ask you questions (login issues, bot challenges, unclear states) — answer inline and the run continues. Every finding cites its evidence.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex flex-wrap gap-2.5">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runUrl()}
                placeholder="example.com"
                inputMode="url"
                className="min-w-0 flex-1 rounded-full border border-[var(--rc-border)] bg-[var(--rc-bg)] px-4 py-2 font-mono text-[13px] text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)]"
              />
              <button
                onClick={runUrl}
                disabled={busy}
                className="rounded-full bg-[var(--rc-accent)] px-5 py-2 text-sm font-semibold text-[var(--rc-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "scanning…" : tab === "security" ? "Run audit" : tab === "geo" ? "Run audit" : tab === "slop" ? "Run review" : "Run QA"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-[var(--rc-text-dim)]">try:</span>
              {SAMPLE_URLS.map((s) => (
                <button
                  key={s}
                  onClick={() => setUrl(s)}
                  className="rounded-full border border-[var(--rc-border)] px-2.5 py-[3px] font-mono text-[11px] text-[var(--rc-text-dim)] transition-colors hover:border-[var(--rc-accent)] hover:text-[var(--rc-accent)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* v4 — compare with a saved scan token (all modes) */}
      <div className="mt-3">
        <div className="flex flex-wrap gap-2.5">
          <input
            value={compareToken}
            onChange={(e) => {
              setCompareToken(e.target.value.toUpperCase());
              setTokenCheck(null);
            }}
            placeholder="compare with a previous scan token — ZSC-… (optional)"
            aria-label="Previous scan token to compare against"
            className="min-w-0 flex-1 rounded-full border border-[var(--rc-border)] bg-[var(--rc-bg)] px-4 py-2 font-mono text-[12px] tracking-[0.04em] text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] placeholder:normal-case placeholder:tracking-normal focus:border-[var(--rc-accent)]"
          />
          <button
            onClick={() => compareToken.trim() && preflight(compareToken)}
            disabled={!compareToken.trim() || checking}
            className="rounded-full border border-[var(--rc-border)] px-4 py-2 font-mono text-[12px] text-[var(--rc-text-dim)] transition-colors hover:border-[var(--rc-accent)] hover:text-[var(--rc-accent)] disabled:opacity-50"
          >
            {checking ? "checking…" : "check token"}
          </button>
        </div>
        {tokenCheck ? (
          <p className={`mt-1.5 font-mono text-[11px] leading-relaxed ${tokenCheck.ok ? "text-[var(--rc-brand)]" : "text-[var(--rc-gone)]"}`} role="status">
            {tokenCheck.msg}
          </p>
        ) : null}
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">
          Every scan gets a saveable token. Paste a previous one here — the new report will show what you fixed, what is still open and what is
          new. Same scanner + same target compares; snapshots are kept 90 days.
        </p>
      </div>

      {/* v5 — email notifications (sent from glm@zhelp.space-z.ai) */}
      <div className="mt-4 rounded-xl border border-[var(--rc-border)] bg-[var(--rc-bg)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-text-dim)]">email notifications · sent from glm@zhelp.space-z.ai</p>
          <button onClick={() => (inboxOpen ? setInboxOpen(false) : loadInbox())} className="font-mono text-[11px] text-[var(--rc-text-dim)] underline decoration-dotted underline-offset-4 hover:text-[var(--rc-accent)]">
            {inboxOpen ? "hide inbox" : "notifications inbox"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={mailTo}
            onChange={(e) => setMailTo(e.target.value)}
            placeholder="recipient email (e.g. you@example.com)"
            inputMode="email"
            className="min-w-0 flex-1 rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] px-4 py-2 font-mono text-[12.5px] text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)]"
          />
          <button
            onClick={() => void sendMail("GLM Radar — notification test", "This is a test notification from the GLM Radar portal, sent from its own account glm@zhelp.space-z.ai.\n\nIf you received this, the notification channel works.")}
            disabled={mailBusy}
            className="rounded-full border border-[var(--rc-border)] px-4 py-2 font-mono text-[12px] text-[var(--rc-text-dim)] transition-colors hover:border-[var(--rc-accent)] hover:text-[var(--rc-accent)] disabled:opacity-50"
          >
            {mailBusy ? "sending…" : "send test"}
          </button>
          <label className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--rc-text-dim)]">
            <input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} className="accent-[var(--rc-accent)]" />
            email me every report
          </label>
        </div>
        {mailStatus ? (
          <p className={`mt-1.5 font-mono text-[11px] leading-relaxed ${mailStatus.ok ? "text-[var(--rc-brand)]" : "text-[var(--rc-gone)]"}`} role="status">
            {mailStatus.msg}
          </p>
        ) : (
          <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">
            Local addresses (@zhelp.space-z.ai) are delivered to the portal mailbox instantly; external recipients are queued on the relay and fly out as soon as its credentials are set.
          </p>
        )}
        {inboxOpen ? (
          <div className="mt-3 max-h-56 space-y-2 overflow-y-auto border-t border-[var(--rc-border)] pt-3">
            {inbox === null ? <p className="font-mono text-[11px] text-[var(--rc-text-dim)]">loading…</p> : inbox.length === 0 ? <p className="font-mono text-[11px] text-[var(--rc-text-dim)]">mailbox empty (or not mounted on this host).</p> : (
              inbox.map((m, i) => (
                <div key={i} className="rounded-lg border border-[var(--rc-border)] px-3 py-2">
                  <p className="truncate font-mono text-[11.5px] text-[var(--rc-text)]">
                    <span className="text-[var(--rc-accent)]">{m.subject || "(no subject)"}</span> · {m.date}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-[var(--rc-text-dim)]">{m.preview}</p>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--rc-gone)_45%,transparent)] bg-[color-mix(in_srgb,var(--rc-gone)_10%,transparent)] px-3.5 py-2.5 text-[13px] text-[var(--rc-gone)]">
          {error}
        </p>
      ) : null}

      {pendingQuestion ? <QaQuestionBox question={pendingQuestion} value={answerText} setValue={setAnswerText} onSubmit={() => answerQa(pendingQuestion)} /> : null}

      {progress ? <ProgressBar progress={progress} /> : null}

      {/* Results */}
      {report ? (
        <div className="mt-6 border-t border-[var(--rc-border)] pt-5" aria-live="polite">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <ScoreRing score={report.score} grade={report.grade} />
            <div className="text-right font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">
              {report.scanner === "code" ? (
                <p>
                  {(report as CodeScanReport).language} · {(report as CodeScanReport).linesScanned} lines
                  {(report as CodeScanReport).verification?.filesAnalyzed ? ` · ${(report as CodeScanReport).verification!.filesAnalyzed} files` : ""}
                </p>
              ) : (
                <p className="max-w-[320px] truncate">{(report as UrlScanReport).finalUrl ?? report.target}</p>
              )}
              <p>
                {report.findings.length} findings · {report.durationMs} ms
                {report.cached ? " · cached (10 min TTL)" : ""}
              </p>
            </div>
          </div>

          {report.diffNote ? (
            <p className="mt-4 rounded-xl border border-dashed border-[color-mix(in_srgb,var(--rc-tone2)_55%,transparent)] bg-[color-mix(in_srgb,var(--rc-tone2)_6%,transparent)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--rc-tone2)]">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em]">compare note </span>
              {report.diffNote}
            </p>
          ) : null}
          {report.diff && report.scanToken ? <DiffView diff={report.diff} scoreAfter={report.score} /> : null}

          {"summary" in report && report.summary ? (
            <p className="mt-4 text-[13.5px] leading-relaxed">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-accent)]">posture </span>
              {report.summary}
            </p>
          ) : null}
          {"verdict" in report && report.verdict ? (
            <div className="mt-2.5 flex items-center gap-2">
              <VerdictChip verdict={report.verdict} />
              <span className="font-mono text-[11px] text-[var(--rc-text-dim)]">fable-model verdict</span>
            </div>
          ) : null}
          {"breakdown" in report && report.breakdown?.length ? (
            <div className="mt-4">
              <BreakdownBars items={report.breakdown} />
            </div>
          ) : null}
          {"metrics" in report && report.metrics?.length ? <MetricsStrip metrics={report.metrics} /> : null}
          {report.scanner === "slop" ? <ShotsGallery shots={report.shots} note={report.shotsNote} /> : null}
          {"positives" in report && report.positives?.length ? (
            <p className="mt-4 text-[13px] leading-relaxed text-[var(--rc-text-dim)]">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-brand)]">already right </span>
              {report.positives.join(" · ")}
            </p>
          ) : null}

          <div className="mt-5">
            <FindingsList findings={report.findings} />
          </div>

          {"verification" in report && report.verification ? (
            <div className="mt-4">
              <VerificationBlockView v={report.verification} />
            </div>
          ) : null}

          {"leads" in report && report.leads?.length ? (
            <div className="mt-4">
              <LeadsList leads={report.leads} />
            </div>
          ) : null}

          {"inconclusive" in report && report.inconclusive?.length ? (
            <p className="mt-4 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">
              inconclusive (not scored): {report.inconclusive.map((i) => `${i.what} — ${i.why}`).join("; ")}
            </p>
          ) : null}

          {fixPrompt ? (
            <div className="mt-5">
              <FixPromptBlock prompt={fixPrompt} />
            </div>
          ) : null}

          {report.scanToken ? (
            <div className="mt-5">
              <CopyTokenCard scanner={report.scanner} target={report.target} token={report.scanToken} />
            </div>
          ) : null}

          {report.scanToken ? (
            <button
              onClick={() => void sendMail(`zScanner ${report.scanner}: ${report.target} — ${report.score}/100`, reportSummaryText(report))}
              disabled={mailBusy || !mailTo.trim()}
              className="mt-3 rounded-full border border-[var(--rc-border)] px-4 py-2 font-mono text-[12px] text-[var(--rc-text-dim)] transition-colors hover:border-[var(--rc-accent)] hover:text-[var(--rc-accent)] disabled:opacity-50"
            >
              {mailBusy ? "sending…" : "email me this report (from glm@zhelp.space-z.ai)"}
            </button>
          ) : null}

          <p className="mt-5 border-t border-[var(--rc-border)] pt-4 text-xs leading-relaxed text-[var(--rc-text-dim)]">
            Heuristic point-in-time audit, not a penetration test. Findings reflect what this response revealed — absent
            evidence is not proof of safety. GitHub repo scans read public metadata + a risk-ranked file sample; private
            repos need your token, which stays in memory for the scan only and is never stored. Completed scans are snapshotted for 90 days
            under a token you can re-use to diff fixed/open/new. Rule sets adapted from linker &amp; fable (romangalaxys10-spec), Cloudflare
            security-audit-skill, awesome-skills code-review-skill (MIT), gstack design-review, the Unslop-My-UI brief, Gesso anti-slop guards and
            sloptrim AI-writing patterns. Scans cached 10 minutes; rate limit 8/minute.
          </p>
        </div>
      ) : null}
    </div>
  );
}
