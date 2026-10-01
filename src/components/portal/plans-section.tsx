"use client";

import { INVITE_URL } from "@/lib/invite";
import { usePlansOverride } from "@/lib/dynamic-data";
import type { DynamicPlan } from "@/lib/site-data";

const DEFAULT_TIERS: DynamicPlan[] = [
  {
    name: "Lite",
    price: "from $18",
    per: "/month",
    credits5h: "2,000",
    creditsWeek: "10,000",
    blurb: "Daily driving for solo developers — quick fixes, codebase Q&A, completion-heavy work.",
    highlights: ["GLM-5.3 + GLM-5.3-Flash", "Vision, Web Search, Web Reader & Zread MCP", "50% credit rate off-peak"],
  },
  {
    name: "Pro",
    price: "—",
    per: "",
    credits5h: "12,000",
    creditsWeek: "60,000",
    blurb: "High-frequency feature work on real repositories — 6× the Lite allowance in both windows.",
    highlights: ["6× Lite credits", "Same model + MCP access", "Best value for daily repo work"],
    featured: true,
  },
  {
    name: "Max",
    price: "—",
    per: "",
    credits5h: "28,000",
    creditsWeek: "140,000",
    blurb: "All-day agentic coding on large codebases, long refactors and parallel agent fleets.",
    highlights: ["14× Lite credits", "Up to ~4.4B Flash tokens / week at 98% cache hit", "Built for autonomous agent runs"],
  },
];

export function PlansSection() {
  const override = usePlansOverride();
  const tiers = override?.length ? override : DEFAULT_TIERS;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {tiers.map((t) => (
        <article
          key={t.name}
          className={`card-surface relative flex flex-col gap-4 overflow-hidden rounded-xl p-6 ${
            t.featured ? "border-[var(--rc-accent)]" : ""
          }`}
          style={t.featured ? { borderWidth: 1.5 } : undefined}
        >
          {t.featured && (
            <span className="absolute right-4 top-4 rounded-full bg-[var(--rc-accent)] px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-[var(--rc-on-accent)]">
              popular
            </span>
          )}
          <header>
            <h3 className="font-display text-xl font-semibold">{t.name}</h3>
            <p className="mt-1 text-[13px] text-[var(--rc-text-dim)]">{t.blurb}</p>
          </header>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-[var(--rc-border)] p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-tone3)]">5-hour credits</p>
              <p className="mt-1 font-mono text-xl font-bold text-[var(--rc-bright)] tnum">{t.credits5h}</p>
            </div>
            <div className="rounded-lg border border-[var(--rc-border)] p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--rc-tone3)]">weekly credits</p>
              <p className="mt-1 font-mono text-xl font-bold text-[var(--rc-bright)] tnum">{t.creditsWeek}</p>
            </div>
          </div>

          <ul className="grid gap-1.5 text-[13px] text-[var(--rc-text-dim)]">
            {(t.highlights ?? []).map((h) => (
              <li key={h} className="flex items-start gap-2">
                <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--rc-accent)]" />
                {h}
              </li>
            ))}
          </ul>

          <a
            href={INVITE_URL}
            target="_blank"
            rel="noopener"
            className="mt-auto inline-flex h-10 items-center justify-center rounded-lg bg-[var(--rc-accent)] px-4 text-sm font-semibold text-[var(--rc-on-accent)] transition-opacity hover:opacity-85"
          >
            Get {t.name} — 10% off first order
          </a>
        </article>
      ))}

      <p className="text-xs text-[var(--rc-text-dim)] md:col-span-3">
        Credits refresh dynamically: the 5-hour bucket resets 5 hours after consumption, the weekly bucket resets every
        7 days. Credit usage = (input × input multiplier + cached input × cached multiplier + output × output
        multiplier) ÷ 10,000 — and everything billed off-peak costs half. Source:{" "}
        <a
          href="https://docs.z.ai/devpack/overview"
          target="_blank"
          rel="noopener"
          className="text-[var(--rc-accent)] underline decoration-dotted underline-offset-4 hover:text-[var(--rc-bright)]"
        >
          GLM Coding Plan overview&nbsp;↗
        </a>
      </p>
    </div>
  );
}
