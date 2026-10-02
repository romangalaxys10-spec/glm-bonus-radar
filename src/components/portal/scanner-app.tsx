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

import { useCallback, useMemo, useRef, useState } from "react";
import { type CodeScanReport, type Finding, type ScanLead, type Severity, type UrlScanReport, severityOrder } from "@/lib/scanner/types";
import { fixPromptFor } from "@/lib/scanner/prompts";

type Tab = "security" | "geo" | "qa" | "code";

const TABS: { id: Tab; label: string }[] = [
  { id: "security", label: "security audit" },
  { id: "geo", label: "seo·geo·perf" },
  { id: "qa", label: "qa audit" },
  { id: "code", label: "code reviewer" },
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

type Progress = { pct: number; stage: string; etaSec: number | null };

function ProgressBar({ progress }: { progress: Progress }) {
  const eta = progress.etaSec != null ? `≈ ${progress.etaSec}s left` : "working…";
  return (
    <div className="mt-6 rounded-xl border border-[var(--rc-border)] bg-[var(--rc-bg)] p-4" aria-live="polite" role="status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[12px] text-[var(--rc-text)]">
          <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--rc-accent)] align-middle" />
          {progress.stage}
        </p>
        <p className="font-mono text-[12px] text-[var(--rc-text-dim)]">
          {progress.pct}% · {eta}
        </p>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--rc-border)_70%,transparent)]">
        <div
          className="h-full rounded-full bg-[var(--rc-accent)] transition-all duration-500"
          style={{ width: `${Math.max(3, Math.min(100, progress.pct))}%` }}
        />
      </div>
    </div>
  );
}

type AnyReport = (UrlScanReport | CodeScanReport) & { cached?: boolean };

const SAMPLE_URLS = ["zhelp.space-z.ai", "example.com", "github.com"];
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [report, setReport] = useState<AnyReport | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const runUrl = () => {
    if (!url.trim()) {
      setError("Give a public URL first.");
      return;
    }
    const endpoint = tab === "security" ? "/api/scan/security" : tab === "geo" ? "/api/scan/geo-seo" : "/api/scan/qa";
    run(endpoint, { url: url.trim() });
  };
  const runCode = () => {
    if (!code.trim()) {
      setError("Paste some code first.");
      return;
    }
    run("/api/scan/code", { code });
  };

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

      {/* Input area */}
      {tab === "code" ? (
        <div className="mt-4">
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
      ) : (
        <div className="mt-4">
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
              {busy ? "scanning…" : tab === "security" ? "Run audit" : tab === "geo" ? "Run audit" : "Run QA"}
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

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--rc-gone)_45%,transparent)] bg-[color-mix(in_srgb,var(--rc-gone)_10%,transparent)] px-3.5 py-2.5 text-[13px] text-[var(--rc-gone)]">
          {error}
        </p>
      ) : null}

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
          {"positives" in report && report.positives?.length ? (
            <p className="mt-4 text-[13px] leading-relaxed text-[var(--rc-text-dim)]">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-brand)]">already right </span>
              {report.positives.join(" · ")}
            </p>
          ) : null}

          <div className="mt-5">
            <FindingsList findings={report.findings} />
          </div>

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

          <p className="mt-5 border-t border-[var(--rc-border)] pt-4 text-xs leading-relaxed text-[var(--rc-text-dim)]">
            Heuristic point-in-time audit, not a penetration test. Findings reflect what this response revealed — absent
            evidence is not proof of safety. Rule sets adapted from linker &amp; fable (romangalaxys10-spec), Cloudflare
            security-audit-skill and awesome-skills code-review-skill (MIT). Scans cached 10 minutes; rate limit 8/minute.
          </p>
        </div>
      ) : null}
    </div>
  );
}
