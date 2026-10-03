"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoDims, GeoSearchPayload, GeoSearchResult } from "@/lib/geosearch";
import { ThemeSwitch } from "@/components/portal/theme-switch";

/**
 * zSearch — the GEO-first search engine UI.
 *
 * Landing view (Google-style, minus the SEO): big wordmark, one box.
 * Results view: AI answer preview with citation chips, then every source
 * with its GEO rating (score ring + grade + four dimension bars) and the
 * rank delta versus the original web order. Toggle re-sorts GEO <-> web.
 *
 * Queries sync to /search?q=… so a search is a shareable URL.
 */

const EXAMPLES = [
  "best vps for running ai agents 24/7",
  "how to make a website citable by ai assistants",
  "open source crm for solo founders",
  "email api for developers free tier",
];

const LOAD_STAGES = [
  "searching the live web…",
  "reading 10 sources…",
  "scoring citability · structure · freshness · entity…",
  "drafting the AI answer preview…",
];

/* --------------------------------- glyphs --------------------------------- */

function SearchGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <circle cx="11" cy="11" r="7" />
      <line x1="20.5" y1="20.5" x2="15.9" y2="15.9" />
    </svg>
  );
}

function SparkGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2z" />
    </svg>
  );
}

/* ---------------------------------- color --------------------------------- */

function bandColor(score: number): string {
  if (score >= 82) return "var(--rc-accent)";
  if (score >= 66) return "var(--rc-tone3)";
  if (score >= 50) return "var(--rc-brand)";
  return "var(--rc-text-dim)";
}

/* ------------------------------- form & chips ------------------------------ */

function SearchForm({ value, onChange, onSubmit, busy }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-3 sm:flex-row"
    >
      <div className="relative flex-1">
        <SearchGlyph className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--rc-text-dim)]" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="search the web the GEO way…"
          aria-label="Search query"
          maxLength={240}
          enterKeyHint="search"
          className="h-12 w-full rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] pl-11 pr-4 font-mono text-sm text-[var(--rc-text)] outline-none transition placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--rc-accent)_25%,transparent)]"
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--rc-accent)] px-7 text-sm font-semibold text-[var(--rc-on-accent)] shadow-md transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "scoring…" : "search"}
      </button>
    </form>
  );
}

/* ------------------------------- score visuals ----------------------------- */

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const radius = 26;
  const circ = 2 * Math.PI * radius;
  const color = bandColor(score);
  return (
    <div className="relative h-16 w-16 shrink-0 md:h-[72px] md:w-[72px]" role="img" aria-label={`GEO score ${score} of 100, grade ${grade}`}>
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="color-mix(in srgb, var(--rc-border) 60%, transparent)" strokeWidth="6" />
        <circle cx="32" cy="32" r={radius} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(score / 100) * circ} ${circ}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-base font-bold leading-none md:text-lg" style={{ color }}>
          {score}
        </span>
        <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--rc-text-dim)]">{grade}·geo</span>
      </div>
    </div>
  );
}

const DIMS: Array<{ key: keyof GeoDims; label: string }> = [
  { key: "citability", label: "citable" },
  { key: "structure", label: "structure" },
  { key: "freshness", label: "fresh" },
  { key: "entity", label: "entity" },
];

function DimBars({ dims }: { dims: GeoDims }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      {DIMS.map(({ key, label }) => (
        <div key={key}>
          <div className="flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-text-dim)]">
            <span>{label}</span>
            <span className="text-[var(--rc-text)]">{dims[key]}</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--rc-border)_55%,transparent)]">
            <div className="h-1 rounded-full" style={{ width: `${dims[key]}%`, background: bandColor(dims[key]) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DomainAvatar({ domain }: { domain: string }) {
  const letter = (domain.replace(/^www\./, "").charAt(0) || "?").toUpperCase();
  return (
    <span
      aria-hidden
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[var(--rc-border)] bg-[var(--rc-bg)] font-mono text-[10px] font-bold text-[var(--rc-brand)]"
    >
      {letter}
    </span>
  );
}

function RankDelta({ geoRank, webRank }: { geoRank: number; webRank: number }) {
  const d = webRank - geoRank; // positive = moved up under GEO
  if (d > 0) return <div className="font-mono text-[11px] font-semibold text-[var(--rc-accent)]">↑{d}</div>;
  if (d < 0) return <div className="font-mono text-[11px] text-[var(--rc-text-dim)]">↓{Math.abs(d)}</div>;
  return <div className="font-mono text-[11px] text-[var(--rc-text-dim)]">·</div>;
}

/* --------------------------------- results --------------------------------- */

function ResultRow({ r, order }: { r: GeoSearchResult; order: "geo" | "web" }) {
  return (
    <li
      id={`r${r.webRank}`}
      className="scroll-mt-24 rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-4 transition-colors hover:border-[color-mix(in_srgb,var(--rc-accent)_45%,var(--rc-border))] md:p-5"
    >
      <div className="flex items-start gap-3 md:gap-4">
        <div className="w-8 shrink-0 pt-1 text-right md:w-11">
          <div className="font-mono text-xl font-bold leading-none text-[var(--rc-bright)] md:text-2xl">
            {order === "geo" ? r.geoRank : r.webRank}
          </div>
          <div className="mt-1">{order === "geo" ? <RankDelta geoRank={r.geoRank} webRank={r.webRank} /> : <div className="font-mono text-[11px] text-[var(--rc-text-dim)]">web</div>}</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <DomainAvatar domain={r.domain} />
            <span className="font-mono text-xs text-[var(--rc-text-dim)]">{r.domain}</span>
            {r.date && <span className="font-mono text-[11px] text-[var(--rc-text-dim)]">· {r.date}</span>}
            {r.cited && (
              <span className="inline-flex shrink-0 items-center rounded-full border border-[color-mix(in_srgb,var(--rc-accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--rc-accent)_10%,transparent)] px-2 py-[2px] font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--rc-accent)]">
                cited in ai answer
              </span>
            )}
          </div>
          <a
            href={r.url}
            target="_blank"
            rel="noopener"
            className="mt-1.5 block font-display text-[17px] font-semibold leading-snug text-[var(--rc-text)] transition-colors hover:text-[var(--rc-accent)] md:text-lg"
          >
            {r.title}
          </a>
          {r.snippet && <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-[var(--rc-text-dim)]">{r.snippet}</p>}
          <DimBars dims={r.dims} />
          <p className="mt-2.5 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">↳ {r.note}</p>
        </div>

        <ScoreRing score={r.score} grade={r.grade} />
      </div>
    </li>
  );
}

function AnswerText({ text }: { text: string }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p className="text-[15px] leading-relaxed text-[var(--rc-text)]">
      {parts.map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (!m) return <span key={i}>{part}</span>;
        return (
          <a
            key={i}
            href={`#r${m[1]}`}
            className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-[var(--rc-border)] bg-[var(--rc-bg)] px-1 align-middle font-mono text-[10px] font-semibold text-[var(--rc-brand)] transition-colors hover:border-[var(--rc-accent)] hover:text-[var(--rc-accent)]"
          >
            {m[1]}
          </a>
        );
      })}
    </p>
  );
}

function AnswerCard({ data }: { data: GeoSearchPayload }) {
  const cited = data.results.filter((r) => r.cited).sort((a, b) => a.webRank - b.webRank);
  return (
    <section
      aria-label="AI answer preview"
      className="rounded-2xl border border-[color-mix(in_srgb,var(--rc-accent)_40%,var(--rc-border))] bg-[color-mix(in_srgb,var(--rc-accent)_6%,var(--rc-surface))] p-5"
    >
      <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--rc-accent)]">
        <SparkGlyph className="h-3.5 w-3.5" />
        ai answer preview
      </p>
      {data.answer ? (
        <>
          <div className="mt-3">
            <AnswerText text={data.answer} />
          </div>
          {cited.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[color-mix(in_srgb,var(--rc-border)_60%,transparent)] pt-3">
              <span className="font-mono text-[11px] text-[var(--rc-text-dim)]">cited sources:</span>
              {cited.map((r) => (
                <a
                  key={r.webRank}
                  href={`#r${r.webRank}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--rc-border)] bg-[var(--rc-bg)] px-2.5 py-1 font-mono text-[11px] text-[var(--rc-text)] transition-colors hover:border-[var(--rc-accent)]"
                >
                  <span className="font-semibold text-[var(--rc-accent)]">[{r.webRank}]</span>
                  {r.domain}
                </a>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-[var(--rc-text-dim)]">
          Answer preview unavailable for this run — the GEO ratings below were estimated from snippet signals instead.
        </p>
      )}
    </section>
  );
}

function HowItWorks() {
  return (
    <details className="group rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5">
      <summary className="cursor-pointer list-none font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--rc-text-dim)] transition-colors hover:text-[var(--rc-accent)]">
        how the geo rating works
        <span aria-hidden className="ml-2 inline-block transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="mt-3 grid gap-2.5 text-sm leading-relaxed text-[var(--rc-text-dim)]">
        <p>
          <strong className="font-semibold text-[var(--rc-text)]">citability 35%</strong> — quotable definitions, concrete
          numbers, claims an answer engine could repeat verbatim.
        </p>
        <p>
          <strong className="font-semibold text-[var(--rc-text)]">structure 25%</strong> — answer-first signals: direct
          answers, steps, lists, tables, comparisons.
        </p>
        <p>
          <strong className="font-semibold text-[var(--rc-text)]">freshness 20%</strong> — recency signals, weighted by how
          much the query needs up-to-date information.
        </p>
        <p>
          <strong className="font-semibold text-[var(--rc-text)]">entity 20%</strong> — unambiguous identity: named product,
          brand or niche, clear about-ness.
        </p>
        <p>
          Honest limits: scoring reads the same public snippets listed above — not the full pages — so a rating is an
          estimate, not a verdict. Want a deep, on-page GEO audit of your own site instead?{" "}
          <Link href="/scanner" className="text-[var(--rc-accent)] underline decoration-dotted underline-offset-4">
            Run the free SEO·GEO·Perf scanner →
          </Link>
        </p>
      </div>
    </details>
  );
}

/* ---------------------------------- views ---------------------------------- */

function Landing({ input, setInput, onSubmit, busy }: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (q?: string) => void;
  busy: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl pt-10 text-center md:pt-20">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--rc-accent)]">
        geo-first search engine · live web
      </p>
      <h1 className="mt-4 font-display text-6xl font-bold tracking-tight md:text-7xl">
        <span className="text-[var(--rc-accent)]">z</span>Search
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[var(--rc-text-dim)]">
        Google ranks blue links by SEO. zSearch ranks sources by GEO — Generative Engine Optimization — how likely each
        one is to be <em className="not-italic text-[var(--rc-text)]">cited inside AI answers</em>. Every result carries a
        GEO rating, and an AI answer preview shows who actually gets quoted.
      </p>

      <div className="mt-8 text-left">
        <SearchForm value={input} onChange={setInput} onSubmit={onSubmit} busy={busy} />
      </div>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setInput(ex);
              onSubmit(ex);
            }}
            className="rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] px-3.5 py-1.5 font-mono text-[12px] text-[var(--rc-text-dim)] transition-colors hover:border-[var(--rc-accent)] hover:text-[var(--rc-accent)]"
          >
            {ex}
          </button>
        ))}
      </div>

      <div className="mt-10 grid gap-4 text-left sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--rc-text-dim)]">
            classic search · seo
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--rc-text-dim)]">
            Ranks for humans clicking blue links: keyword matches, backlinks, click-through. Great at finding pages —
            silent about whether an AI assistant would ever repeat them.
          </p>
        </div>
        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--rc-accent)_40%,var(--rc-border))] bg-[color-mix(in_srgb,var(--rc-accent)_6%,var(--rc-surface))] p-5">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--rc-accent)]">
            zsearch · geo
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--rc-text)]">
            Ranks for being the answer: citability, structure, freshness and entity clarity, scored per source — with the
            AI answer preview exposing which results a generative engine would actually cite.
          </p>
        </div>
      </div>

      <p className="mt-8 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">
        live web results · geo ratings are estimates scored from public snippets · not affiliated with the ranked sites
      </p>
    </div>
  );
}

function Loading({ stage }: { stage: number }) {
  return (
    <div className="grid gap-4 pt-4" aria-live="polite" aria-label="Searching and scoring">
      <p className="font-mono text-[12px] text-[var(--rc-accent)]">
        {LOAD_STAGES[stage]}
        <span aria-hidden className="animate-pulse">
          ▍
        </span>
      </p>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5"
          style={{ opacity: 1 - i * 0.15 }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="grid flex-1 gap-2.5">
              <div className="h-3 w-44 rounded bg-[color-mix(in_srgb,var(--rc-border)_75%,transparent)]" />
              <div className="h-4 w-3/4 rounded bg-[color-mix(in_srgb,var(--rc-border)_75%,transparent)]" />
              <div className="h-3 w-full rounded bg-[color-mix(in_srgb,var(--rc-border)_50%,transparent)]" />
              <div className="h-3 w-5/6 rounded bg-[color-mix(in_srgb,var(--rc-border)_50%,transparent)]" />
            </div>
            <div className="h-16 w-16 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--rc-border)_75%,transparent)] md:h-[72px] md:w-[72px]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------- main ----------------------------------- */

export function SearchClient() {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [data, setData] = useState<GeoSearchPayload | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [order, setOrder] = useState<"geo" | "web">("geo");
  const [stage, setStage] = useState(0);
  const autoRanRef = useRef(false);

  const runSearch = useCallback(async (raw: string) => {
    const query = raw.trim();
    if (query.length < 2) {
      setErrorMsg("Type at least two characters to search.");
      setPhase("error");
      return;
    }
    setPhase("loading");
    setStage(0);
    setOrder("geo");
    setErrorMsg("");
    try {
      const res = await fetch("/api/geo-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const json = (await res.json().catch(() => null)) as (GeoSearchPayload & { error?: string }) | null;
      if (!res.ok || !json || typeof json.error === "string") {
        throw new Error(json?.error || "zSearch hit a snag reaching the live web. Try again in a moment.");
      }
      setData(json);
      setPhase("done");
      try {
        window.history.replaceState(null, "", `/search?q=${encodeURIComponent(query)}`);
        document.title = `${query} — zSearch`;
      } catch {
        /* environment without history API — non-fatal */
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "zSearch hit a snag. Try again in a moment.");
      setPhase("error");
    }
  }, []);

  // Deep link: /search?q=… runs the search once on mount (StrictMode-safe).
  useEffect(() => {
    if (autoRanRef.current) return;
    autoRanRef.current = true;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q && q.trim().length >= 2) {
      setInput(q);
      void runSearch(q);
    }
  }, [runSearch]);

  // Cycle the loading stage captions while scoring.
  useEffect(() => {
    if (phase !== "loading") return;
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, LOAD_STAGES.length - 1)), 2800);
    return () => clearInterval(timer);
  }, [phase]);

  const submit = useCallback((q?: string) => void runSearch(q ?? input), [input, runSearch]);

  const results =
    data && (phase === "done" || (phase === "error" && data))
      ? order === "geo"
        ? data.results
        : [...data.results].sort((a, b) => a.webRank - b.webRank)
      : null;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--rc-bg)] text-[var(--rc-text)]">
      <header className="sticky top-0 z-40 border-b border-[var(--rc-border)] bg-[color-mix(in_srgb,var(--rc-bg)_86%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3 md:px-8">
          <Link
            href="/"
            className="whitespace-nowrap font-mono text-[12px] text-[var(--rc-text-dim)] transition-colors hover:text-[var(--rc-accent)]"
          >
            ← radar
          </Link>
          <Link href="/search" className="font-display text-lg font-semibold italic tracking-tight">
            <span className="text-[var(--rc-accent)]">z</span>Search
          </Link>
          <ThemeSwitch />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-20 pt-8 md:px-8">
        {phase === "idle" && (
          <Landing
            input={input}
            setInput={setInput}
            onSubmit={submit}
            busy={false}
          />
        )}

        {phase === "loading" && <Loading stage={stage} />}

        {phase === "error" && !data && (
          <div className="mx-auto max-w-xl pt-16 text-center">
            <h1 className="font-display text-3xl font-bold tracking-tight">
              <span className="text-[var(--rc-accent)]">z</span>Search
            </h1>
            <p className="mt-4 rounded-2xl border border-[var(--rc-gone)] bg-[color-mix(in_srgb,var(--rc-gone)_10%,transparent)] px-4 py-3 text-sm leading-relaxed text-[var(--rc-text)]">
              {errorMsg}
            </p>
            <div className="mt-6 text-left">
              <SearchForm value={input} onChange={setInput} onSubmit={submit} busy={false} />
            </div>
          </div>
        )}

        {results && data && (
          <div className="grid gap-5">
            <div className="grid gap-3">
              <SearchForm value={input} onChange={setInput} onSubmit={submit} busy={false} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]" aria-live="polite">
                  {data.results.length} sources · GEO-ranked in {(data.tookMs / 1000).toFixed(1)}s ·{" "}
                  {data.mode === "model"
                    ? "scored by GLM from public snippets"
                    : "scored from snippet signals (model scorer unavailable)"}
                </p>
                <div
                  role="group"
                  aria-label="Result ordering"
                  className="flex items-center gap-1 rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] p-1"
                >
                  {(["geo", "web"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={order === mode}
                      onClick={() => setOrder(mode)}
                      className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors ${
                        order === mode
                          ? "bg-[var(--rc-accent)] text-[var(--rc-on-accent)]"
                          : "text-[var(--rc-text-dim)] hover:text-[var(--rc-text)]"
                      }`}
                    >
                      {mode === "geo" ? "geo rank" : "web rank"}
                    </button>
                  ))}
                </div>
              </div>
              {phase === "error" && (
                <p className="rounded-xl border border-[var(--rc-gone)] bg-[color-mix(in_srgb,var(--rc-gone)_10%,transparent)] px-4 py-3 text-sm leading-relaxed text-[var(--rc-text)]">
                  {errorMsg}
                </p>
              )}
            </div>

            <AnswerCard data={data} />

            <ol className="grid gap-3" aria-label="Search results ranked by GEO">
              {results.map((r) => (
                <ResultRow key={r.url} r={r} order={order} />
              ))}
            </ol>

            <HowItWorks />
          </div>
        )}
      </main>

      <footer className="mt-auto border-t border-[var(--rc-border)]">
        <div className="mx-auto max-w-5xl px-5 py-8 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)] md:px-8">
          <p>
            zSearch — a GEO-first search experiment by{" "}
            <Link href="/" className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]">
              GLM Bonus Radar
            </Link>
            . Live web results via the z.ai search function; GEO ratings are estimates computed for this page, not
            rankings published by the sites themselves. Not affiliated with Google or any answer engine.
          </p>
          <p className="mt-2">
            Want your own site to score better here?{" "}
            <Link href="/scanner" className="text-[var(--rc-accent)] underline decoration-dotted underline-offset-4">
              Run the free SEO·GEO·Perf scanner →
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
