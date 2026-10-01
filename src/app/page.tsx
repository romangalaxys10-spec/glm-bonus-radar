import Link from "next/link";
import { ThemeSwitch } from "@/components/portal/theme-switch";
import {
  GoldenStrip,
  LiveTable,
  StatusGrid,
  TimelineSection,
} from "@/components/portal/windows-section";
import { PricingSection } from "@/components/portal/pricing-section";
import { PlansSection } from "@/components/portal/plans-section";
import { InviteSection } from "@/components/portal/invite-section";
import { ZAssist, AskZAssistLink } from "@/components/portal/z-assist";
import { NotifyEngine, NotificationsBell } from "@/components/portal/notifications-center";
import { DataFreshnessBadge } from "@/components/portal/data-freshness";
import { AnnouncementsStrip } from "@/components/portal/announcements-strip";
import { AiVpsBanner } from "@/components/portal/ai-vps-banner";
import { CnOpsSection } from "@/components/portal/cn-ops-section";
import { ToolsSection } from "@/components/portal/tools-section";
import { INVITE_CODE, INVITE_URL } from "@/lib/invite";
import { LiveClocks } from "@/components/portal/live-clocks";

const NAV = [
  { href: "#windows", label: "windows" },
  { href: "#timeline", label: "timeline" },
  { href: "#cn-ops", label: "cn ops" },
  { href: "#pricing", label: "pricing" },
  { href: "#plans", label: "plans" },
  { href: "#invite", label: "invite" },
  { href: "#tools", label: "tools" },
];

const GITHUB_REPO = "https://github.com/romangalaxys10-spec/glm-bonus-radar";

/** GitHub octicon mark (MIT-licensed octicons path). */
export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** Pill-style GitHub badge linking the source repo. */
export function GitHubBadge() {
  return (
    <a
      href={GITHUB_REPO}
      target="_blank"
      rel="noopener"
      aria-label="View the source code on GitHub"
      title="Open source — star it on GitHub"
      className="inline-flex items-center overflow-hidden rounded-full border border-[var(--rc-border)] font-mono text-[11px] font-semibold shadow-sm transition-colors hover:border-[var(--rc-accent)]"
    >
      <span className="flex items-center gap-1.5 bg-[var(--rc-surface)] px-3 py-1.5 text-[var(--rc-text)]">
        <GitHubMark className="h-3.5 w-3.5" />
        star
      </span>
      <span className="flex items-center gap-1.5 bg-[var(--rc-accent)] px-3 py-1.5 text-[var(--rc-on-accent)]">
        GitHub
      </span>
    </a>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Top invite banner */}
      <a
        href={INVITE_URL}
        target="_blank"
        rel="noopener"
        className="block bg-[var(--rc-accent)] px-4 py-2 text-center text-[13px] font-semibold text-[var(--rc-on-accent)] transition-opacity hover:opacity-90"
      >
        <span className="font-mono">10% OFF</span> your first GLM Coding subscription — invite token{" "}
        <span className="font-mono underline decoration-dotted underline-offset-2">{INVITE_CODE}</span> · claim here →
      </a>

      {/* Sticky header */}
      <header className="sticky top-0 z-50 border-b border-[var(--rc-border)] bg-[color-mix(in_srgb,var(--rc-bg)_86%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-8">
          <a href="#top" className="font-display text-lg font-semibold italic tracking-tight text-gradient">
            GLM Bonus Radar
          </a>
          <nav aria-label="Sections" className="order-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px] md:order-2">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="text-[var(--rc-text-dim)] transition-colors hover:text-[var(--rc-accent)]"
              >
                {n.label}
              </a>
            ))}
            <a
              href="/api/metrics"
              className="text-[var(--rc-brand)] transition-colors hover:text-[var(--rc-accent)]"
              title="Prometheus-compatible metrics endpoint"
            >
              /metrics
            </a>
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noopener"
              aria-label="Source on GitHub"
              title="Source on GitHub"
              className="flex items-center gap-1 text-[var(--rc-text-dim)] transition-colors hover:text-[var(--rc-accent)]"
            >
              <GitHubMark className="h-3.5 w-3.5" />
              github
            </a>
          </nav>
          <div className="order-2 flex items-center gap-2 md:order-3">
            <NotificationsBell />
            <ThemeSwitch />
          </div>
        </div>
      </header>

      <main id="top" className="mx-auto w-full max-w-6xl flex-1 px-5 pb-24 pt-12 md:px-8">
        {/* Hero */}
        <section className="pb-10">
          <h1 className="max-w-3xl font-display text-4xl font-bold leading-[1.08] tracking-tight text-gradient md:text-6xl">
            Bonus inference,
            <br className="hidden sm:block" /> peak rates &amp; token discounts
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-[var(--rc-text-dim)]">
            Every known z.ai bonus window, multiplier and limited-time discount — computed live in your browser with
            ticking countdowns, timezone-aware timelines and a Prometheus-compatible metrics endpoint. No stale
            screenshots, no guessing when to fire the heavy agent runs.
          </p>
          <LiveClocks />
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <AskZAssistLink />
            <DataFreshnessBadge />
          </div>
          <AnnouncementsStrip />
          <AiVpsBanner />
        </section>

        {/* Windows */}
        <section id="windows" aria-label="Bonus windows" className="scroll-mt-24 pb-14">
          <SectionHeader
            eyebrow="live status · ai-synced hourly"
            title="Bonus windows"
            blurb="Status badges flip automatically as windows open and close. Countdowns tick every second; schedules are evaluated against Asia/Singapore time exactly as the official notices define them — and an AI bot re-verifies them against docs.z.ai every hour."
          />
          <div className="mb-4">
            <DataFreshnessBadge compact />
          </div>
          <div className="grid gap-4">
            <GoldenStrip />
            <StatusGrid />
            <LiveTable />
          </div>
        </section>

        {/* Timeline */}
        <section id="timeline" aria-label="24 hour timeline" className="scroll-mt-24 pb-14">
          <SectionHeader
            eyebrow="planner"
            title="When to run what"
            blurb="The same 24 hours shown twice: once in schedule time (SGT), once in your local clock. Line up the bright segments and you never accidentally pay peak rates again."
          />
          <TimelineSection />
        </section>

        {/* China ops calendar */}
        <section id="cn-ops" aria-label="China ops calendar" className="scroll-mt-24 pb-14">
          <SectionHeader
            eyebrow="planner · utc+8"
            title="China ops calendar"
            blurb="z.ai is built in Beijing — during China's public holidays (Golden Week, Spring Festival and friends) support replies, pricing updates and non-critical releases slow down across China-based companies. Plan heavy work and deadline-sensitive runs around these windows; the API itself stays up."
          />
          <CnOpsSection />
        </section>

        {/* Pricing */}
        <section id="pricing" aria-label="API pricing" className="scroll-mt-24 pb-14">
          <SectionHeader
            eyebrow="pay as you go"
            title="API token pricing"
            blurb="Prices per 1M tokens in USD. The GLM-5.3-Flash 50% promotion is live right now — input, cached input and output are all halved until 2026-09-09 24:00 SGT."
          />
          <PricingSection />
        </section>

        {/* Plans */}
        <section id="plans" aria-label="Coding plans" className="scroll-mt-24 pb-14">
          <SectionHeader
            eyebrow="subscriptions"
            title="GLM Coding Plan tiers"
            blurb="Credits-based plans for Claude Code, Cline, OpenCode, ZCode and more. Off-peak usage bills at 50% of the standard credit rate — the same window the radar tracks above."
          />
          <PlansSection />
        </section>

        {/* Invite */}
        <section id="invite" aria-label="Invite offer" className="scroll-mt-24 pb-14">
          <InviteSection />
        </section>

        {/* Useful tools */}
        <section id="tools" aria-label="Useful tools" className="scroll-mt-24">
          <SectionHeader
            eyebrow="toolkit · by the same builder"
            title="Useful tools"
            blurb="Field-tested utilities and deep-dive write-ups from Rommark.Dev — the GitHub auto-push protocol that keeps agent work safe, the self-healing deploy kit that keeps this very portal online, and hands-on reviews of agent memory and multi-agent orchestration tooling."
          />
          <ToolsSection />
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-[var(--rc-border)]">
        <div className="mx-auto max-w-6xl px-5 pt-8 pb-32 font-mono text-xs text-[var(--rc-text-dim)] md:px-8 md:pb-20">
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <p className="mb-2 font-semibold uppercase tracking-[0.08em] text-[var(--rc-tone3)]">sources</p>
              <ul className="grid gap-1">
                {[
                  ["usage revision & peak hours", "https://docs.z.ai/devpack/notice/usage-revision"],
                  ["GLM-5.3-Flash campaign", "https://docs.z.ai/devpack/notice/event-glm-5.3-flash"],
                  ["API pricing", "https://docs.z.ai/guides/overview/pricing"],
                  ["coding plan overview", "https://docs.z.ai/devpack/overview"],
                  ["invite campaign rules", "https://docs.z.ai/devpack/credit-campaign-rules"],
                ].map(([label, href]) => (
                  <li key={href}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener"
                      className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
                    >
                      {label} ↗
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 font-semibold uppercase tracking-[0.08em] text-[var(--rc-tone3)]">machine readable</p>
              <ul className="grid gap-1">
                <li>
                  <a
                    href="/api/metrics"
                    className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
                  >
                    /api/metrics — Prometheus format
                  </a>
                </li>
                <li>
                  <a
                    href="/api/announcements"
                    className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
                  >
                    /api/announcements — Atom / RSS feed
                  </a>
                </li>
                <li>
                  <Link
                    href="/changelog"
                    className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
                  >
                    /changelog — AI audit trail
                  </Link>
                </li>
                <li>
                  <span className="font-mono">bonus_inference_active</span>,{" "}
                  <span className="font-mono">_transition_seconds</span>,{" "}
                  <span className="font-mono">_end_timestamp_seconds</span>
                </li>
              </ul>
            </div>
            <div>
              <p className="mb-2 font-semibold uppercase tracking-[0.08em] text-[var(--rc-tone3)]">disclaimer</p>
              <p>
                Unofficial community tracker. Schedules and prices come from the official z.ai documentation; all times
                are evaluated in Asia/Singapore (UTC+8) and rendered in your local timezone. Not affiliated with
                Z.ai Platform.
              </p>
            </div>
          </div>

          {/* Credit + source badge */}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t border-[var(--rc-border)] pt-5">
            <p className="text-[11px] leading-relaxed">
              Developed by{" "}
              <a
                href="https://rommark.dev"
                target="_blank"
                rel="noopener"
                className="font-semibold text-[var(--rc-text)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
              >
                Rommark.Dev
              </a>
              <span aria-hidden> · </span>
              <a
                href="https://t.me/VibeCodePrompterSystem"
                target="_blank"
                rel="noopener"
                className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
              >
                Telegram ↗
              </a>
              <span aria-hidden> · </span>
              <a
                href="https://www.linkedin.com/in/rоman-m-793b3310?utm_source=share_via&utm_content=profile&utm_medium=member_android"
                target="_blank"
                rel="noopener"
                className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
              >
                LinkedIn ↗
              </a>
            </p>
            <GitHubBadge />
          </div>
        </div>
      </footer>

      {/* Z-Assist live chat — grounded in official z.ai docs */}
      <ZAssist />

      {/* Headless: browser notifications for opted-in event/announcement categories */}
      <NotifyEngine />

      {/* SEO/GEO: machine-readable offer for the sponsor badge (paired with
          the visible sponsored banner in the hero). Server-rendered so
          crawlers and generative engines read it in the initial HTML. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: "xshredo AI VPS",
            description:
              "AI-tuned VPS hosting for running AI agents and inference workloads 24/7, priced for individual developers.",
            brand: { "@type": "Brand", name: "xshredo" },
            category: "Cloud Hosting",
            offers: {
              "@type": "Offer",
              url: "https://xshredo.com/ai-vps",
              availability: "https://schema.org/InStock",
            },
          }),
        }}
      />
    </div>
  );
}

function SectionHeader({ eyebrow, title, blurb }: { eyebrow: string; title: string; blurb: string }) {
  return (
    <div className="mb-6 max-w-3xl">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rc-accent)]">{eyebrow}</p>
      <h2 className="mt-1.5 font-display text-2xl font-bold tracking-tight md:text-3xl">{title}</h2>
      <p className="mt-2 text-[15px] text-[var(--rc-text-dim)]">{blurb}</p>
    </div>
  );
}
