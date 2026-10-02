"use client";

/**
 * zScanner UI — three tabs (Security / GEO·SEO / Code), shared result
 * language: weighted score ring, grade, severity-chipped findings sorted by
 * severity, evidence as plain text only (fetched/pasted content is never
 * rendered as HTML — the classic scanner-site XSS is reflected content).
 */

import { useCallback, useState } from "react";
import { type CodeScanReport, type Finding, type Severity, type UrlScanReport, severityOrder } from "@/lib/scanner/types";

type Tab = "security" | "geo" | "code";

const TABS: { id: Tab; label: string }[] = [
  { id: "security", label: "security audit" },
  { id: "geo", label: "geo/seo audit" },
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

type AnyReport = (UrlScanReport | CodeScanReport) & { cached?: boolean };

const SAMPLE_URLS = ["zhelp.space-z.ai", "example.com", "github.com"];
const SAMPLE_CODE = `import pickle, requests, hashlib

API_KEY = "sk-live-9f8ac3d2b1e7440d8f2c1b9e77aa2c31"

def load_session(blob):
    return pickle.loads(blob)

def fetch(url):
    r = requests.get(url, verify=False)
    token = str(int(hashlib.md5(url.encode()).hexdigest(), 16))
    print("token", token)
    return eval(r.headers.get("x-op"))

# TODO: rate limiting, FIXME: error handling
`;

export function ScannerApp() {
  const [tab, setTab] = useState<Tab>("security");
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AnyReport | null>(null);

  const run = useCallback(
    async (body: Record<string, string>, endpoint: string) => {
      setBusy(true);
      setError(null);
      setReport(null);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as AnyReport | { message?: string };
        if (!res.ok || !("findings" in data)) {
          setError(("message" in data && data.message) || `Scan failed (HTTP ${res.status}).`);
        } else {
          setReport(data);
        }
      } catch {
        setError("The scanner could not be reached. Try again.");
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const runUrl = () => {
    if (!url.trim()) {
      setError("Give a public URL first.");
      return;
    }
    run({ url: url.trim() }, tab === "security" ? "/api/scan/security" : "/api/scan/geo-seo");
  };
  const runCode = () => {
    if (!code.trim()) {
      setError("Paste some code first.");
      return;
    }
    run({ code }, "/api/scan/code");
  };

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
              setTab(t.id);
              setError(null);
              setReport(null);
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
            <span className="font-mono text-[11px] text-[var(--rc-text-dim)]">{code.length ? `${(code.length / 1024).toFixed(1)} KB` : "auto-detects js/ts/python"}</span>
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
              {busy ? "scanning…" : "Run audit"}
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
                {report.cached ? " · served from cache (10 min TTL)" : ""}
              </p>
            </div>
          </div>
          <div className="mt-5">
            <FindingsList findings={report.findings} />
          </div>
          {"inconclusive" in report && report.inconclusive?.length ? (
            <p className="mt-4 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">
              inconclusive (not scored): {report.inconclusive.map((i) => `${i.what} — ${i.why}`).join("; ")}
            </p>
          ) : null}
          <p className="mt-5 border-t border-[var(--rc-border)] pt-4 text-xs leading-relaxed text-[var(--rc-text-dim)]">
            Heuristic point-in-time audit, not a penetration test. Findings reflect what this response revealed — absent
            evidence is not proof of safety. Scans are cached 10 minutes; rate limit 8/minute.
          </p>
        </div>
      ) : null}
    </div>
  );
}
