"use client";

import { useState } from "react";
import { INVITE_CODE, INVITE_URL } from "@/lib/invite";

export function InviteSection() {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  async function copy(text: string, what: "code" | "link") {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers / non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-[var(--rc-accent)] p-6 md:p-10"
      style={{
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--rc-accent) 16%, var(--rc-bg)), color-mix(in srgb, var(--rc-brand) 12%, var(--rc-bg)))",
      }}
      aria-labelledby="invite-heading"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-25"
        style={{ background: "radial-gradient(circle, var(--rc-accent), transparent 70%)" }}
      />
      <div className="relative grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rc-accent)]">invite token · first order only</p>
          <h2 id="invite-heading" className="mt-2 font-display text-3xl font-bold leading-tight md:text-4xl">
            10% off your first GLM Coding subscription
          </h2>
          <p className="mt-3 max-w-xl text-[15px] text-[var(--rc-text-dim)]">
            Subscribe through this invite token and the discount is applied instantly at checkout — no manual activation.
            Valid for new users and existing accounts that have never had a paid subscription, on the first{" "}
            <strong className="text-[var(--rc-bright)]">GLM Coding</strong> order only.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => copy(INVITE_CODE, "code")}
              aria-label={`Copy invite code ${INVITE_CODE}`}
              className="group inline-flex h-12 items-center gap-3 rounded-xl border-2 border-dashed border-[var(--rc-accent)] bg-[color-mix(in_srgb,var(--rc-accent)_8%,transparent)] px-5 font-mono text-lg font-bold tracking-[0.12em] text-[var(--rc-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--rc-accent)_16%,transparent)]"
            >
              {INVITE_CODE}
              <span className="text-xs font-semibold uppercase tracking-normal text-[var(--rc-accent)]">
                {copied === "code" ? "copied ✓" : "copy"}
              </span>
            </button>
            <a
              href={INVITE_URL}
              target="_blank"
              rel="noopener"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-[var(--rc-accent)] px-6 text-[15px] font-semibold text-[var(--rc-on-accent)] shadow-lg transition-all hover:opacity-90 hover:shadow-xl"
              style={{ boxShadow: "0 10px 30px -12px color-mix(in srgb, var(--rc-accent) 60%, transparent)" }}
            >
              Claim 10% OFF <span aria-hidden>→</span>
            </a>
            <button
              type="button"
              onClick={() => copy(INVITE_URL, "link")}
              className="text-[13px] font-semibold text-[var(--rc-text-dim)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-bright)]"
            >
              {copied === "link" ? "link copied ✓" : "copy invite link"}
            </button>
          </div>
        </div>

        <ul className="grid gap-2.5 rounded-xl border border-[var(--rc-border)] bg-[color-mix(in_srgb,var(--rc-bg)_65%,transparent)] p-5 text-[13px] text-[var(--rc-text-dim)]">
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--rc-accent)]" />
            10% is deducted from the first GLM Coding subscription order at checkout (Stripe minimum $0.50 applies).
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--rc-accent)]" />
            One redemption per user (by phone / email); not stackable with other first-order promos.
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--rc-accent)]" />
            Renewals, upgrades and follow-up orders bill at the standard price.
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--rc-accent)]" />
            Rules:{" "}
            <a
              href="https://docs.z.ai/devpack/credit-campaign-rules"
              target="_blank"
              rel="noopener"
              className="text-[var(--rc-accent)] underline decoration-dotted underline-offset-4 hover:text-[var(--rc-bright)]"
            >
              Invite Friends, Get Credits&nbsp;↗
            </a>
          </li>
        </ul>
      </div>
    </section>
  );
}
