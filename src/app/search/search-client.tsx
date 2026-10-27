"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoDims, GeoSearchPayload, GeoSearchResult } from "@/lib/geosearch";

/**
 * zSearch — the GEO-first search engine UI.
 *
 * Visual language: fixed near-black canvas, IBM Plex Sans light display headlines with an
 * italic zinc second line, mono uppercase eyebrows, white pill CTA, a single
 * blue accent, hairline section dividers and #0a0a0b cards with white/10
 * borders. Independent of the portal palette system on purpose.
 *
 * Landing view: hero + glowing search console (the "device mockup" moment),
 * SEO-vs-GEO comparison table ("Same web. Different ranking."), the four GEO
 * signals, honesty fine print.
 * Results view: AI answer preview with citation chips, then every source with
 * its GEO rating (score ring + grade + four dimension bars) and the rank delta
 * versus the original web order. Toggle re-sorts GEO <-> web.
 *
 * Queries sync to /search?q=… so a search is a shareable URL.
 */

const EXAMPLES = [
  "glm coding plan vs pay as you go",
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

/* --------------------------------- palette --------------------------------- */

const ACCENT = "#3b82f6";
const ACCENT_HOVER = "#60a5fa";

function bandColor(score: number): string {
  if (score >= 82) return ACCENT; // A+
  if (score >= 66) return "#e4e4e7"; // B — bright
  if (score >= 50) return "#a1a1aa"; // C — mid
  return "#52525b"; // D — faint
}

/* --------------------------------- glyphs ---------------------------------- */

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

/* ------------------------------- search forms ------------------------------- */

function ConsoleSearch({ value, onChange, onSubmit, busy }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      {/* the device-mockup moment: glowing console card */}
      <div className="zs-console rounded-2xl border border-hair/10 bg-gradient-to-b from-surface2 to-surface px-5 pb-5 pt-4 transition-colors focus-within:border-azure/60">
        <div aria-hidden className="mx-auto mb-4 h-1 w-10 rounded-full bg-azure shadow-[0_0_12px_rgba(59,130,246,0.9)]" />
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="flex items-center gap-2.5"
        >
          <SearchGlyph className="h-4 w-4 shrink-0 text-deep" />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="search the web the GEO way…"
            aria-label="Search query"
            maxLength={240}
            enterKeyHint="search"
            className="zs-mono h-11 min-w-0 flex-1 bg-transparent text-[14px] text-body outline-none placeholder:text-deep"
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-10 shrink-0 items-center rounded-full bg-bright px-5 text-[13px] font-semibold tracking-tight text-canvas transition hover:bg-hair active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "scoring…" : "search →"}
          </button>
        </form>
      </div>
    </div>
  );
}

function CompactSearch({ value, onChange, onSubmit, busy }: {
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
      className="flex items-center gap-2 rounded-full border border-hair/10 bg-surface py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-azure/60"
    >
      <SearchGlyph className="h-3.5 w-3.5 shrink-0 text-deep" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="search the web the GEO way…"
        aria-label="Search query"
        maxLength={240}
        enterKeyHint="search"
        className="zs-mono h-9 min-w-0 flex-1 bg-transparent text-[13px] text-body outline-none placeholder:text-deep"
      />
      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-8 shrink-0 items-center rounded-full bg-bright px-4 text-[12px] font-semibold tracking-tight text-canvas transition hover:bg-hair active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "scoring…" : "search →"}
      </button>
    </form>
  );
}

/* ------------------------------- score visuals ------------------------------ */

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const radius = 26;
  const circ = 2 * Math.PI * radius;
  const color = bandColor(score);
  return (
    <div className="relative h-16 w-16 shrink-0 md:h-[72px] md:w-[72px]" role="img" aria-label={`GEO score ${score} of 100, grade ${grade}`}>
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
        <circle cx="32" cy="32" r={radius} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(score / 100) * circ} ${circ}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="zs-mono text-base font-bold leading-none md:text-lg" style={{ color }}>
          {score}
        </span>
        <span className="zs-mono mt-0.5 text-[9px] uppercase tracking-[0.12em] text-faint">{grade}·geo</span>
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
          <div className="zs-mono flex items-baseline justify-between gap-2 text-[10px] uppercase tracking-[0.08em] text-faint">
            <span>{label}</span>
            <span className="text-soft">{dims[key]}</span>
          </div>
          <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-hair/10">
            <div className="h-[3px] rounded-full" style={{ width: `${dims[key]}%`, background: bandColor(dims[key]) }} />
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
      className="zs-mono flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border border-hair/15 bg-hair/5 text-[10px] font-semibold text-body"
    >
      {letter}
    </span>
  );
}

function RankDelta({ geoRank, webRank }: { geoRank: number; webRank: number }) {
  const d = webRank - geoRank; // positive = moved up under GEO
  if (d > 0) return <div className="zs-mono text-[11px] font-semibold" style={{ color: ACCENT_HOVER }}>↑{d}</div>;
  if (d < 0) return <div className="zs-mono text-[11px] text-deep">↓{Math.abs(d)}</div>;
  return <div className="zs-mono text-[11px] text-deep">·</div>;
}

/* --------------------------------- results --------------------------------- */

function ResultRow({ r, order }: { r: GeoSearchResult; order: "geo" | "web" }) {
  return (
    <li
      id={`r${r.webRank}`}
      className="scroll-mt-24 rounded-[14px] border border-hair/10 bg-surface p-4 transition-colors hover:border-hair/25 md:p-5"
    >
      <div className="flex items-start gap-3 md:gap-4">
        <div className="w-8 shrink-0 pt-1 text-right md:w-11">
          <div className="text-[26px] font-light leading-none tracking-tight text-bright md:text-[30px]">
            {order === "geo" ? r.geoRank : r.webRank}
          </div>
          <div className="mt-1.5">{order === "geo" ? <RankDelta geoRank={r.geoRank} webRank={r.webRank} /> : <div className="zs-mono text-[11px] text-deep">web</div>}</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <DomainAvatar domain={r.domain} />
            <span className="zs-mono text-xs text-faint">{r.domain}</span>
            {r.date && <span className="zs-mono text-[11px] text-deep">· {r.date}</span>}
            {r.cited && (
              <span className="zs-mono inline-flex shrink-0 items-center rounded-full border border-azure/50 bg-azure/10 px-2 py-[2px] text-[9px] font-semibold uppercase tracking-[0.08em] text-azure2">
                cited in ai answer
              </span>
            )}
          </div>
          <a
            href={r.url}
            target="_blank"
            rel="noopener"
            className="mt-1.5 block text-[17px] font-medium leading-snug tracking-tight text-body transition-colors hover:text-azure2 md:text-lg"
          >
            {r.title}
          </a>
          {r.snippet && <p className="mt-1.5 line-clamp-3 text-[14px] leading-relaxed text-dim">{r.snippet}</p>}
          <DimBars dims={r.dims} />
          <p className="zs-mono mt-2.5 text-[11px] leading-relaxed text-deep">↳ {r.note}</p>
        </div>

        <ScoreRing score={r.score} grade={r.grade} />
      </div>
    </li>
  );
}

function AnswerText({ text }: { text: string }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p className="text-[15px] leading-relaxed text-body">
      {parts.map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (!m) return <span key={i}>{part}</span>;
        return (
          <a
            key={i}
            href={`#r${m[1]}`}
            className="zs-mono mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-hair/15 bg-hair/5 px-1 align-middle text-[10px] font-semibold text-soft transition-colors hover:border-azure hover:text-azure2"
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
      className="rounded-[14px] border border-azure/30 bg-[rgba(59,130,246,0.05)] p-5"
    >
      <p className="zs-mono flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-azure2">
        <SparkGlyph className="h-3.5 w-3.5" />
        ai answer preview
      </p>
      {data.answer ? (
        <>
          <div className="mt-3">
            <AnswerText text={data.answer} />
          </div>
          {cited.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hair/10 pt-3">
              <span className="zs-mono text-[11px] text-faint">cited sources:</span>
              {cited.map((r) => (
                <a
                  key={r.webRank}
                  href={`#r${r.webRank}`}
                  className="zs-mono inline-flex items-center gap-1.5 rounded-full border border-hair/15 bg-hair/[0.03] px-2.5 py-1 text-[11px] text-soft transition-colors hover:border-azure"
                >
                  <span className="font-semibold text-azure2">[{r.webRank}]</span>
                  {r.domain}
                </a>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-dim">
          Answer preview unavailable for this run — the GEO ratings below were estimated from snippet signals instead.
        </p>
      )}
    </section>
  );
}

function HowItWorks() {
  return (
    <section aria-label="How the geo rating works" className="mt-6">
      <h2 className="text-center text-[clamp(1.6rem,3.5vw,2.2rem)] font-light tracking-[-0.02em] text-bright">
        How the rating works.
      </h2>
      <div className="mx-auto mt-6 max-w-2xl border-t border-hair/10">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-medium text-body transition-colors hover:text-azure2">
            The four signals — and the honest limits
            <span aria-hidden className="text-lg text-faint transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="grid gap-2.5 pb-5 text-[14px] leading-relaxed text-dim">
            <p>
              <strong className="font-semibold text-body">citability 35%</strong> — quotable definitions, concrete
              numbers, claims an answer engine could repeat verbatim.
            </p>
            <p>
              <strong className="font-semibold text-body">structure 25%</strong> — answer-first signals: direct
              answers, steps, lists, tables, comparisons.
            </p>
            <p>
              <strong className="font-semibold text-body">freshness 20%</strong> — recency signals, weighted by how
              much the query needs up-to-date information.
            </p>
            <p>
              <strong className="font-semibold text-body">entity 20%</strong> — unambiguous identity: named product,
              brand or niche, clear about-ness.
            </p>
            <p>
              Honest limits: scoring reads the same public snippets listed above — not the full pages — so a rating is an
              estimate, not a verdict. Want a deep, on-page GEO audit of your own site instead?{" "}
              <Link href="/scanner" className="font-medium transition-colors" style={{ color: ACCENT_HOVER }}>
                Run the free SEO·GEO·Perf scanner →
              </Link>
            </p>
          </div>
        </details>
        <div className="border-t border-hair/10" />
      </div>
    </section>
  );
}

/* --------------------------------- landing ---------------------------------- */

const COMPARE: Array<[string, string, string]> = [
  ["ranks for", "clicks from humans", "citations from AI answers"],
  ["signals", "keywords, backlinks, click-through", "citability · structure · freshness · entity"],
  ["optimized output", "a page people visit", "a passage an engine quotes"],
  ["blind spot", "never sees the AI answer", "younger index · estimates, not verdicts"],
  ["rating shown", "none — position only", "0–100 GEO score per source"],
];

const SIGNALS: Array<{ title: string; body: string }> = [
  { title: "Citability · 35%", body: "Quotable definitions, concrete numbers, claims an answer engine could repeat verbatim." },
  { title: "Structure · 25%", body: "Answer-first pages: direct answers, steps, lists, tables, comparisons." },
  { title: "Freshness · 20%", body: "Recency signals, weighted by how much the query needs up-to-date information." },
  { title: "Entity clarity · 20%", body: "Unambiguous identity — a named product, brand or niche with clear about-ness." },
];

function Landing({ input, setInput, onSubmit, busy }: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (q?: string) => void;
  busy: boolean;
}) {
  return (
    <div>
      {/* hero */}
      <section className="relative px-5 pt-16 text-center md:pt-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-10 mx-auto h-72 w-[44rem] max-w-full bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.10),transparent_65%)]"
        />
        <p className="zs-mono relative text-[11px] uppercase tracking-[0.22em] text-faint">
          geo-first search · live web · ranked for ai answers
        </p>
        <h1 className="relative mx-auto mt-6 max-w-4xl text-[clamp(2.6rem,7.5vw,4.9rem)] font-light leading-[1.05] tracking-[-0.025em] text-bright">
          Search the web,
          <br />
          <em className="italic text-dim">for AI answers.</em>
        </h1>
        <p className="relative mx-auto mt-6 max-w-[470px] text-[16px] leading-relaxed text-dim">
          Google ranks blue links by SEO. zSearch ranks sources by GEO — Generative Engine Optimization — how likely each
          one is to be <span className="text-body">cited inside AI answers</span>. Every result carries its GEO
          rating.
        </p>

        <div className="relative mt-10">
          <ConsoleSearch value={input} onChange={setInput} onSubmit={onSubmit} busy={busy} />
          <p className="zs-mono mt-5 text-[11px] text-deep">
            10 live sources per search · scored 0–100 · free, no signup
          </p>
        </div>

        <div className="relative mt-6 flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setInput(ex);
                onSubmit(ex);
              }}
              className="zs-mono rounded-full border border-hair/10 bg-hair/[0.03] px-3.5 py-1.5 text-[12px] text-dim transition-colors hover:border-hair/30 hover:text-body"
            >
              {ex}
            </button>
          ))}
        </div>
      </section>

      {/* comparison: same web, different ranking */}
      <section className="mt-20 border-t border-hair/10 md:mt-28">
        <div className="px-5 py-16 md:py-24">
          <h2 className="text-center text-[clamp(1.9rem,4.5vw,2.9rem)] font-light leading-tight tracking-[-0.02em] text-bright">
            Same web. <span className="text-dim">Different ranking.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md text-center text-[15px] leading-relaxed text-dim">
            What each engine optimizes for, side by side.
          </p>
          <div className="mx-auto mt-12 max-w-4xl overflow-x-auto rounded-xl border border-hair/10">
            <table className="w-full min-w-[620px] border-collapse text-left align-top text-[14px]">
              <thead>
                <tr className="bg-surface">
                  <th scope="col" className="zs-mono px-4 py-4 text-[11px] font-medium uppercase tracking-[0.18em] text-faint md:px-5">
                    compare
                  </th>
                  <th scope="col" className="zs-mono px-4 py-4 text-[11px] font-medium uppercase tracking-[0.18em] text-faint md:px-5">
                    seo search
                  </th>
                  <th scope="col" className="zs-mono bg-[rgba(59,130,246,0.06)] px-4 py-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-azure2 md:px-5">
                    zsearch · geo
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([label, seo, geo]) => (
                  <tr key={label} className="border-t border-hair/[0.07]">
                    <th scope="row" className="px-4 py-4 text-[14px] font-medium text-body md:px-5">
                      {label}
                    </th>
                    <td className="px-4 py-4 text-[14px] leading-relaxed text-dim md:px-5">{seo}</td>
                    <td className="bg-[rgba(59,130,246,0.06)] px-4 py-4 text-[14px] font-medium leading-relaxed text-body md:px-5">
                      {geo}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* what geo measures */}
      <section className="border-t border-hair/10">
        <div className="px-5 py-16 md:py-24">
          <h2 className="text-center text-[clamp(1.9rem,4.5vw,2.9rem)] font-light leading-tight tracking-[-0.02em] text-bright">
            What GEO measures.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-center text-[15px] leading-relaxed text-dim">
            Four signals, one number — how citable a source is inside generative answers.
          </p>
          <div className="mx-auto mt-12 grid max-w-4xl gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {SIGNALS.map((s) => (
              <div key={s.title}>
                <h3 className="text-[16px] font-semibold tracking-tight text-body">{s.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-dim">{s.body}</p>
              </div>
            ))}
          </div>
          <p className="zs-mono mx-auto mt-16 max-w-2xl text-center text-[11px] leading-relaxed text-deep">
            live web results · geo ratings are estimates scored from public snippets · not affiliated with the ranked
            sites
          </p>
        </div>
      </section>
    </div>
  );
}

function Loading({ stage }: { stage: number }) {
  return (
    <div className="grid gap-4 pt-4" aria-live="polite" aria-label="Searching and scoring">
      <p className="zs-mono text-[12px] text-azure2">
        {LOAD_STAGES[stage]}
        <span aria-hidden className="animate-pulse">
          ▍
        </span>
      </p>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-[14px] border border-hair/10 bg-surface p-5"
          style={{ opacity: 1 - i * 0.15 }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="grid flex-1 gap-2.5">
              <div className="h-3 w-44 rounded bg-hair/10" />
              <div className="h-4 w-3/4 rounded bg-hair/10" />
              <div className="h-3 w-full rounded bg-hair/[0.06]" />
              <div className="h-3 w-5/6 rounded bg-hair/[0.06]" />
            </div>
            <div className="h-16 w-16 shrink-0 rounded-full bg-hair/10 md:h-[72px] md:w-[72px]" />
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
    <div className="zs flex min-h-screen flex-col bg-canvas text-body antialiased selection:bg-azure/30">
      <header className="sticky top-0 z-40 border-b border-hair/10 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3.5 md:px-8">
          <Link href="/search" className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-bright text-[13px] font-semibold leading-none text-canvas"
            >
              z
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-bright">zSearch</span>
            <span className="hidden text-[12px] text-faint sm:inline">by GLM Bonus Radar</span>
          </Link>
          <Link href="/" className="text-[14px] tracking-tight text-body transition-colors hover:text-dim">
            ← radar
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {phase === "idle" && (
          <Landing input={input} setInput={setInput} onSubmit={submit} busy={false} />
        )}

        {phase === "loading" && (
          <div className="mx-auto max-w-5xl px-5 pb-20 pt-10 md:px-8">
            <Loading stage={stage} />
          </div>
        )}

        {phase === "error" && !data && (
          <div className="mx-auto max-w-xl px-5 pb-20 pt-16 text-center">
            <h1 className="text-[clamp(2rem,5vw,3rem)] font-light tracking-[-0.02em] text-bright">
              Search the web, <em className="italic text-dim">for AI answers.</em>
            </h1>
            <p className="mx-auto mt-6 max-w-md rounded-[14px] border border-hair/10 bg-surface px-4 py-3 text-[14px] leading-relaxed text-body">
              {errorMsg}
            </p>
            <div className="mt-8">
              <ConsoleSearch value={input} onChange={setInput} onSubmit={submit} busy={false} />
            </div>
          </div>
        )}

        {results && data && (
          <div className="mx-auto w-full max-w-5xl px-5 pb-20 pt-8 md:px-8">
            <div className="grid gap-3">
              <CompactSearch value={input} onChange={setInput} onSubmit={submit} busy={false} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="zs-mono text-[11px] leading-relaxed text-faint" aria-live="polite">
                  {data.results.length} sources · GEO-ranked in {(data.tookMs / 1000).toFixed(1)}s ·{" "}
                  {data.mode === "model"
                    ? "scored by GLM from public snippets"
                    : "scored from snippet signals (model scorer unavailable)"}
                </p>
                <div
                  role="group"
                  aria-label="Result ordering"
                  className="flex items-center gap-1 rounded-full border border-hair/10 bg-surface p-1"
                >
                  {(["geo", "web"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={order === mode}
                      onClick={() => setOrder(mode)}
                      className={`zs-mono rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors ${
                        order === mode
                          ? "bg-bright text-canvas"
                          : "text-faint hover:text-body"
                      }`}
                    >
                      {mode === "geo" ? "geo rank" : "web rank"}
                    </button>
                  ))}
                </div>
              </div>
              {phase === "error" && (
                <p className="rounded-[14px] border border-hair/10 bg-surface px-4 py-3 text-[14px] leading-relaxed text-body">
                  {errorMsg}
                </p>
              )}
            </div>

            <div className="mt-5">
              <AnswerCard data={data} />
            </div>

            <ol className="mt-5 grid gap-3" aria-label="Search results ranked by GEO">
              {results.map((r) => (
                <ResultRow key={r.url} r={r} order={order} />
              ))}
            </ol>

            <HowItWorks />
          </div>
        )}
      </main>

      <footer className="mt-auto border-t border-hair/10">
        <div className="mx-auto max-w-5xl px-5 py-10 md:px-8">
          <p className="max-w-3xl text-[13px] leading-relaxed text-faint">
            zSearch — a GEO-first search experiment by{" "}
            <Link
              href="/"
              className="text-soft underline decoration-dotted underline-offset-4 transition-colors hover:text-azure2"
            >
              GLM Bonus Radar
            </Link>
            . Live web results via the z.ai search function; GEO ratings are estimates computed for this page, not
            rankings published by the sites themselves. Not affiliated with Google or any answer engine.
          </p>
          <p className="zs-mono mt-3 text-[12px] leading-relaxed text-faint">
            Want your own site to score better here?{" "}
            <Link href="/scanner" className="font-medium transition-colors" style={{ color: ACCENT_HOVER }}>
              Run the free SEO·GEO·Perf scanner →
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
