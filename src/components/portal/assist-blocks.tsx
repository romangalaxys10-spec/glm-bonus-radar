"use client";

import { useMemo, useState } from "react";
import type {
  ActionsBlock,
  AssistBlock,
  CalcBlock,
  ChartBlock,
  StepsBlock,
  TableBlock,
} from "@/lib/assist-blocks";

/**
 * Generative-UI renderers for Z-Assist answers — "answers you can interact
 * with", adapted from CopilotKit's OpenIntelligentUI patterns. Components are
 * typed React (no HTML/JS channels), styled to the portal's promo tokens,
 * keyboard-accessible, narrow-screen safe, with provenance captions that
 * distinguish documented values, user inputs and computed estimates.
 */

const EYEBROW: Record<AssistBlock["type"], string> = {
  table: "comparison",
  chart: "chart",
  steps: "walkthrough",
  actions: "jump to",
  calc: "interactive tool",
};

function BlockCard({
  kind,
  label,
  title,
  note,
  source,
  children,
}: {
  kind: AssistBlock["type"];
  label?: string;
  title: string;
  note?: string;
  source?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--rc-border)_80%,transparent)] bg-[color-mix(in_srgb,var(--rc-bg)_72%,var(--rc-surface))]">
      <div className="border-b border-[color-mix(in_srgb,var(--rc-border)_55%,transparent)] px-3 py-2.5">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[var(--rc-accent)]">
          {label ?? EYEBROW[kind]}
        </p>
        <p className="mt-0.5 text-[12.5px] font-semibold leading-snug text-[var(--rc-bright)]">{title}</p>
      </div>
      <div className="px-3 py-2.5">{children}</div>
      {(note || source) && (
        <div className="border-t border-[color-mix(in_srgb,var(--rc-border)_45%,transparent)] px-3 py-1.5">
          {note && (
            <p className="font-mono text-[9.5px] leading-relaxed text-[var(--rc-tone3)]">
              <span className="text-[var(--rc-text-dim)]">assumptions · </span>
              {note}
            </p>
          )}
          {source && (
            <p className="mt-0.5 font-mono text-[9.5px] leading-relaxed text-[var(--rc-tone3)]">
              <span className="text-[var(--rc-text-dim)]">source · </span>
              {source}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- table ---------------------------------- */

function TableBlockView({ block }: { block: TableBlock }) {
  return (
    <BlockCard kind="table" title={block.title} note={block.note} source={block.source}>
      <div className="-mx-0.5 overflow-x-auto">
        <table className="w-full min-w-[280px] border-collapse text-left text-[12px] leading-snug">
          <thead>
            <tr>
              {block.columns.map((c, i) => (
                <th
                  key={i}
                  scope="col"
                  className="border-b border-[var(--rc-border)] px-1.5 pb-1.5 pt-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-[var(--rc-tone3)]"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r} className={r % 2 === 1 ? "bg-[color-mix(in_srgb,var(--rc-border)_14%,transparent)]" : ""}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={`border-b border-[color-mix(in_srgb,var(--rc-border)_35%,transparent)] px-1.5 py-1.5 align-top ${
                      c === 0 ? "font-medium text-[var(--rc-text)]" : "text-[var(--rc-text-dim)]"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BlockCard>
  );
}

/* --------------------------------- chart ---------------------------------- */

function ChartBlockView({ block }: { block: ChartBlock }) {
  const max = useMemo(
    () => Math.max(...block.bars.map((b) => Math.abs(b.value)), Number.EPSILON),
    [block.bars],
  );
  return (
    <BlockCard kind="chart" title={block.title} note={block.note} source={block.source}>
      <ul className="space-y-2" aria-label={block.title}>
        {block.bars.map((bar, i) => {
          const pct = Math.max(2, Math.min(100, (Math.abs(bar.value) / max) * 100));
          return (
            <li key={i} className="grid grid-cols-[minmax(72px,104px)_1fr] items-center gap-2">
              <span className="truncate text-[11.5px] text-[var(--rc-text)]" title={bar.label}>
                {bar.label}
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 grow overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--rc-border)_45%,transparent)]"
                  title={bar.hint}
                >
                  <span
                    className="block h-full rounded-full bg-[var(--rc-accent)] transition-[width] duration-500 motion-reduce:transition-none"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--rc-text)]">
                  {bar.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  {block.unit ? <span className="text-[var(--rc-tone3)]"> {block.unit}</span> : null}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </BlockCard>
  );
}

/* --------------------------------- steps ---------------------------------- */

function StepsBlockView({ block }: { block: StepsBlock }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return (
    <BlockCard kind="steps" title={block.title} note={block.note} source={block.source}>
      <ol className="space-y-1.5">
        {block.items.map((item, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => toggle(i)}
              aria-pressed={done.has(i)}
              className="flex w-full items-start gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--rc-border)_25%,transparent)]"
            >
              <span
                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border font-mono text-[9px] transition-colors ${
                  done.has(i)
                    ? "border-[var(--rc-accent)] bg-[var(--rc-accent)] text-[var(--rc-on-accent)]"
                    : "border-[var(--rc-border)] text-[var(--rc-tone3)]"
                }`}
                aria-hidden
              >
                {done.has(i) ? "✓" : i + 1}
              </span>
              <span
                className={`text-[12px] leading-snug transition-colors ${
                  done.has(i) ? "text-[var(--rc-tone3)] line-through" : "text-[var(--rc-text)]"
                }`}
              >
                {item}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-1.5 font-mono text-[9.5px] text-[var(--rc-tone3)]">
        tap a step to tick it off · progress stays on this answer only
      </p>
    </BlockCard>
  );
}

/* -------------------------------- actions --------------------------------- */

function ActionsBlockView({ block }: { block: ActionsBlock }) {
  return (
    <BlockCard kind="actions" title={block.title} note={block.note} source={block.source}>
      <div className="grid gap-1.5">
        {block.links.map((link, i) => (
          <a
            key={i}
            href={link.href}
            {...(link.href.startsWith("https://") ? { target: "_blank", rel: "noopener" } : {})}
            className="group flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--rc-border)_60%,transparent)] bg-[var(--rc-surface)] px-2.5 py-2 transition-colors hover:border-[var(--rc-accent)]"
          >
            <span className="min-w-0 grow">
              <span className="block truncate text-[12px] font-semibold text-[var(--rc-text)] group-hover:text-[var(--rc-bright)]">
                {link.label}
              </span>
              {link.note && (
                <span className="block truncate font-mono text-[9.5px] text-[var(--rc-tone3)]">{link.note}</span>
              )}
            </span>
            <span aria-hidden className="shrink-0 font-mono text-[11px] text-[var(--rc-accent)]">
              →
            </span>
          </a>
        ))}
      </div>
    </BlockCard>
  );
}

/* ------------------------------ calculators ------------------------------- */

const RANGE =
  "w-full accent-[var(--rc-accent)]";
const NUM =
  "w-16 rounded-md border border-[var(--rc-border)] bg-[var(--rc-bg)] px-1.5 py-1 text-right font-mono text-[11.5px] tabular-nums text-[var(--rc-text)] outline-none focus:border-[var(--rc-accent)]";

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1">
      <span className="text-[11.5px] text-[var(--rc-text)]">{label}</span>
      {children}
    </label>
  );
}

/** Weekly token capacity anchors (GLM-5.3, 95% cache hit) — docs.z.ai/devpack/overview. */
const PLAN_ANCHORS = [
  { name: "Lite", peakM: 48 },
  { name: "Pro", peakM: 290 },
  { name: "Max", peakM: 676 },
] as const;

function CreditEstimator({ prefill, note, source }: { prefill?: Record<string, number>; note?: string; source?: string }) {
  const [plan, setPlan] = useState(() => clampNum(prefill?.plan, 0, 2, 0));
  const [weeklyM, setWeeklyM] = useState(clampNum(prefill?.weeklyTokensM, 5, 1400, 100));
  const [offPct, setOffPct] = useState(clampNum(prefill?.offPeakPct, 0, 100, 60));

  const anchor = PLAN_ANCHORS[plan].peakM;
  const boost = 1 / (1 - 0.5 * (offPct / 100)); // 1x all-peak → 2x all-off-peak
  const capacity = anchor * boost;
  const loadPct = Math.min(150, (weeklyM / capacity) * 100);
  const verdict =
    loadPct <= 60
      ? { text: "fits comfortably in this plan", tone: "text-[var(--rc-brand)]" }
      : loadPct <= 100
        ? { text: "fits, but the week runs tight", tone: "text-[var(--rc-text)]" }
        : { text: "over this plan's weekly quota — size up or shift more runs off-peak", tone: "text-[var(--rc-gone)]" };

  return (
    <BlockCard kind="calc" label="interactive tool · local math" title={`Weekly quota check — ${PLAN_ANCHORS[plan].name} plan`} note={note ?? undefined} source={source ?? undefined}>
      <div className="space-y-2.5">
        <div role="radiogroup" aria-label="Coding plan" className="grid grid-cols-3 gap-1">
          {PLAN_ANCHORS.map((p, i) => (
            <button
              key={p.name}
              type="button"
              role="radio"
              aria-checked={plan === i}
              onClick={() => setPlan(i)}
              className={`rounded-lg border px-2 py-1.5 text-[11.5px] font-semibold transition-colors ${
                plan === i
                  ? "border-[var(--rc-accent)] bg-[color-mix(in_srgb,var(--rc-accent)_14%,transparent)] text-[var(--rc-bright)]"
                  : "border-[var(--rc-border)] text-[var(--rc-text-dim)] hover:border-[color-mix(in_srgb,var(--rc-accent)_50%,transparent)]"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <ControlRow label="Your weekly usage (M tokens)">
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={5}
              max={1400}
              step={5}
              value={weeklyM}
              onChange={(e) => setWeeklyM(Number(e.target.value))}
              className={`${RANGE} w-32`}
              aria-label="Weekly usage in millions of tokens"
            />
            <input
              type="number"
              min={5}
              max={1400}
              value={weeklyM}
              onChange={(e) => setWeeklyM(clampNum(Number(e.target.value), 5, 1400, weeklyM))}
              className={NUM}
              aria-label="Weekly usage in millions of tokens (exact)"
            />
          </span>
        </ControlRow>
        <ControlRow label="Runs done off-peak (%)">
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={offPct}
              onChange={(e) => setOffPct(Number(e.target.value))}
              className={`${RANGE} w-32`}
              aria-label="Percentage of runs done off-peak"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={offPct}
              onChange={(e) => setOffPct(clampNum(Number(e.target.value), 0, 100, offPct))}
              className={NUM}
              aria-label="Percentage of runs done off-peak (exact)"
            />
          </span>
        </ControlRow>

        <div className="rounded-lg border border-[var(--rc-border)] bg-[var(--rc-bg)] px-2.5 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--rc-tone3)]">
              est. weekly capacity
            </span>
            <span className="font-mono text-[13px] font-semibold tabular-nums text-[var(--rc-bright)]">
              ≈ {Math.round(capacity).toLocaleString("en-US")}M tokens
            </span>
          </div>
          <div className="mt-1.5">
            <span className="block h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--rc-border)_45%,transparent)]">
              <span
                className={`block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${
                  loadPct > 100 ? "bg-[var(--rc-gone)]" : "bg-[var(--rc-accent)]"
                }`}
                style={{ width: `${Math.max(2, Math.min(100, loadPct))}%` }}
              />
            </span>
            <p className="mt-1 text-[11px] leading-snug text-[var(--rc-text-dim)]">
              your {weeklyM.toLocaleString("en-US")}M ≈{" "}
              <span className="font-mono tabular-nums">{Math.round(loadPct)}%</span> of quota —{" "}
              <span className={verdict.tone}>{verdict.text}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setPlan(0);
              setWeeklyM(100);
              setOffPct(60);
            }}
            className="font-mono text-[10px] text-[var(--rc-tone3)] underline-offset-2 transition-colors hover:text-[var(--rc-text)] hover:underline"
          >
            reset
          </button>
          <span className="font-mono text-[9px] text-[var(--rc-tone3)]">numbers stay in your browser</span>
        </div>
      </div>
    </BlockCard>
  );
}

function AlwaysOnTco({ prefill, note, source }: { prefill?: Record<string, number>; note?: string; source?: string }) {
  const [seats, setSeats] = useState(clampNum(prefill?.seats, 1, 50, 3));
  const [seatCost, setSeatCost] = useState(clampNum(prefill?.seatCost, 1, 500, 20));
  const VPS_ENTRY = 5.75;

  const saasMonthly = seats * seatCost;
  const yearlySave = (saasMonthly - VPS_ENTRY) * 12;
  const showSave = yearlySave > 0;

  return (
    <BlockCard kind="calc" label="interactive tool · local math" title="Per-seat SaaS vs one always-on box" note={note ?? undefined} source={source ?? undefined}>
      <div className="space-y-2.5">
        <ControlRow label="AI seats / users">
          <input
            type="number"
            min={1}
            max={50}
            value={seats}
            onChange={(e) => setSeats(clampNum(Number(e.target.value), 1, 50, seats))}
            className={NUM}
            aria-label="Number of seats"
          />
        </ControlRow>
        <ControlRow label="Per-seat SaaS, $ / month">
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={seatCost}
              onChange={(e) => setSeatCost(Number(e.target.value))}
              className={`${RANGE} w-32`}
              aria-label="Per-seat monthly cost in dollars"
            />
            <input
              type="number"
              min={1}
              max={500}
              value={seatCost}
              onChange={(e) => setSeatCost(clampNum(Number(e.target.value), 1, 500, seatCost))}
              className={NUM}
              aria-label="Per-seat monthly cost in dollars (exact)"
            />
          </span>
        </ControlRow>

        <div className="grid grid-cols-2 gap-1.5">
          <div className="rounded-lg border border-[var(--rc-border)] bg-[var(--rc-bg)] px-2.5 py-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--rc-tone3)]">per-seat SaaS</p>
            <p className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums text-[var(--rc-text)]">
              ${saasMonthly.toLocaleString("en-US", { maximumFractionDigits: 2 })}<span className="text-[9.5px] text-[var(--rc-tone3)]">/mo</span>
            </p>
          </div>
          <div className="rounded-lg border border-[color-mix(in_srgb,var(--rc-accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--rc-accent)_10%,var(--rc-bg))] px-2.5 py-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--rc-accent)]">24x7 agent vps</p>
            <p className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums text-[var(--rc-bright)]">
              ${VPS_ENTRY.toFixed(2)}<span className="text-[9.5px] text-[var(--rc-tone3)]">/mo entry</span>
            </p>
          </div>
        </div>
        <p className="text-[11.5px] leading-snug text-[var(--rc-text-dim)]">
          {showSave ? (
            <>
              one flat always-on box instead of {seats} seats saves about{" "}
              <strong className="font-semibold text-[var(--rc-bright)]">
                ${Math.round(yearlySave).toLocaleString("en-US")} / year
              </strong>{" "}
              at your entered cost.
            </>
          ) : (
            <>
              at your entered cost the per-seat total is below the VPS entry price — the math only wins when seats ×
              cost clears ${VPS_ENTRY.toFixed(2)}/mo.
            </>
          )}
        </p>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setSeats(3);
              setSeatCost(20);
            }}
            className="font-mono text-[10px] text-[var(--rc-tone3)] underline-offset-2 transition-colors hover:text-[var(--rc-text)] hover:underline"
          >
            reset
          </button>
          <span className="font-mono text-[9px] text-[var(--rc-tone3)]">numbers stay in your browser</span>
        </div>
      </div>
    </BlockCard>
  );
}

function clampNum(v: number | undefined, min: number, max: number, fallback: number): number {
  if (v == null || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function CalcBlockView({ block }: { block: CalcBlock }) {
  const props = { prefill: block.prefill, note: block.note, source: block.source };
  return block.tool === "credit-estimator" ? <CreditEstimator {...props} /> : <AlwaysOnTco {...props} />;
}

/* ------------------------------ entry point ------------------------------- */

function BlockView({ block }: { block: AssistBlock }) {
  switch (block.type) {
    case "table":
      return <TableBlockView block={block} />;
    case "chart":
      return <ChartBlockView block={block} />;
    case "steps":
      return <StepsBlockView block={block} />;
    case "actions":
      return <ActionsBlockView block={block} />;
    case "calc":
      return <CalcBlockView block={block} />;
  }
}

/** Renders the generative-UI blocks that accompanied one assistant reply. */
export function AssistBlocks({ blocks }: { blocks: AssistBlock[] }) {
  if (!blocks.length) return null;
  return (
    <div className="space-y-2.5">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}
