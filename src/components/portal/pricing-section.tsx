"use client";

import { useNow } from "./live";
import { CountdownTimer } from "./countdown";
import { usePricingOverride } from "@/lib/dynamic-data";
import type { DynamicPricingRow } from "@/lib/site-data";

const DEFAULT_API_PROMO_END = Date.parse("2026-09-10T00:00:00+08:00");

const DEFAULT_FEATURED: DynamicPricingRow[] = [
  {
    name: "GLM-5.3",
    tagline: "Flagship coding model",
    input: "$1.4",
    cached: "$0.26",
    output: "$4.4",
    promo: false,
    featured: false,
  },
  {
    name: "GLM-5.3-Flash",
    tagline: "Fast · 50% off for a limited time",
    input: "$0.075",
    cached: "$0.015",
    output: "$0.25",
    listInput: "$0.15",
    listCached: "$0.03",
    listOutput: "$0.50",
    promo: true,
    featured: true,
  },
];

const DEFAULT_OTHER: Array<[string, string, string]> = [
  ["GLM-5.2", "$1.4 / $0.26", "$4.4"],
  ["GLM-5.1", "$1.4 / $0.26", "$4.4"],
  ["GLM-5", "$1.0 / $0.20", "$3.2"],
  ["GLM-4.7", "$0.6 / $0.11", "$2.2"],
  ["GLM-4.5-Air", "$0.2 / $0.03", "$1.1"],
  ["GLM-4.7-FlashX", "$0.07 / $0.01", "$0.4"],
  ["GLM-4.6V (vision)", "$0.3 / $0.05", "$0.9"],
  ["GLM-4.7-Flash", "Free", "Free"],
];

export function PricingSection() {
  const now = useNow();
  const override = usePricingOverride();
  const featured = override?.featured?.length ? override.featured : DEFAULT_FEATURED;
  const otherModels: Array<[string, string, string]> = override?.other?.length
    ? override.other.map((m) => [m.name, m.combo, m.output])
    : DEFAULT_OTHER;
  const apiPromoEnd = override?.apiPromoEndMs != null ? override.apiPromoEndMs : DEFAULT_API_PROMO_END;
  const promoLeft = now == null ? null : apiPromoEnd - now;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {featured.map((m) => (
          <article
            key={m.name}
            className={`card-surface relative flex flex-col gap-4 overflow-hidden rounded-xl p-6 ${
              m.featured ? "border-[var(--rc-accent)]" : ""
            }`}
            style={m.featured ? { borderWidth: 1.5 } : undefined}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-xl font-semibold">{m.name}</h3>
                <p className="text-[13px] text-[var(--rc-text-dim)]">{m.tagline}</p>
              </div>
              {m.promo && (
                <span className="rounded-full bg-[var(--rc-accent)] px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-[var(--rc-on-accent)]">
                  −50%
                </span>
              )}
            </div>
            <dl className="grid gap-2.5 text-sm">
              {(
                [
                  ["Input", m.input, m.listInput ?? null],
                  ["Cached input", m.cached, m.listCached ?? null],
                  ["Output", m.output, m.listOutput ?? null],
                ] as Array<[string, string, string | null]>
              ).map(([label, price, list]) => (
                <div key={label} className="flex items-baseline justify-between gap-2 border-b border-dashed border-[var(--rc-border)] pb-2 last:border-b-0 last:pb-0">
                  <dt className="text-[var(--rc-text-dim)]">{label}</dt>
                  <dd className="font-mono text-[15px] font-bold text-[var(--rc-bright)] tnum">
                    {list && <span className="mr-2 text-xs font-normal text-[var(--rc-gone)] line-through">{list}</span>}
                    {price}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-auto text-xs text-[var(--rc-text-dim)]">per 1M tokens · cached input storage free for a limited time</p>
          </article>
        ))}
      </div>

      <div className="card-surface rounded-xl p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold">More API models</h3>
          {promoLeft != null && promoLeft > 0 && (
            <div className="flex items-center gap-2.5">
              <p className="font-mono text-xs text-[var(--rc-accent)]">Flash −50% ends in</p>
              <CountdownTimer msLeft={promoLeft} size="sm" accent />
            </div>
          )}
        </div>
        <div className="table-scroll overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["model", "input / cached input per 1M", "output per 1M"].map((h) => (
                  <th
                    key={h}
                    className="border-b border-[var(--rc-border)] px-2.5 pb-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--rc-tone2)]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {otherModels.map(([name, inp, out], i) => (
                <tr key={name} className={i % 2 === 1 ? "bg-[var(--rc-surface)]" : ""}>
                  <td className="border-b border-[var(--rc-border)] px-2.5 py-2 font-semibold text-[var(--rc-bright)]">{name}</td>
                  <td className="border-b border-[var(--rc-border)] px-2.5 py-2 font-mono text-xs tnum">{inp}</td>
                  <td className="border-b border-[var(--rc-border)] px-2.5 py-2 font-mono text-xs tnum">{out}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--rc-text-dim)]">
          Full price list at{" "}
          <a
            href="https://docs.z.ai/guides/overview/pricing"
            target="_blank"
            rel="noopener"
            className="text-[var(--rc-accent)] underline decoration-dotted underline-offset-4 hover:text-[var(--rc-bright)]"
          >
            docs.z.ai/guides/overview/pricing&nbsp;↗
          </a>
        </p>
      </div>
    </div>
  );
}
