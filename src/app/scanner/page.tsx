import type { Metadata } from "next";
import { ThemeSwitch } from "@/components/portal/theme-switch";
import { ScannerApp } from "@/components/portal/scanner-app";
import { INVITE_CODE, INVITE_URL } from "@/lib/invite";
import { GitHubMark } from "@/components/portal/scanner-icons";

export const metadata: Metadata = {
  title: "zScanner — free online Security, SEO/GEO/Performance, QA and Code scanners",
  description:
    "Four instant scanners with live progress + ETA: Security Audit (headers, CORS, exposure probes, leaked secrets), SEO/GEO/Performance audit (titles, structured data, llms.txt, AI-crawler policy, TTFB), a QA reliability audit and a heuristic Code Reviewer. Every report ends with a copy-paste fix prompt for your dev agent. No signup.",
  alternates: { canonical: "/scanner" },
};

const NAV = [
  { href: "/", label: "← radar" },
  { href: "#security", label: "security" },
  { href: "#security", label: "seo·geo·perf" },
  { href: "#security", label: "qa" },
  { href: "#security", label: "code" },
];

export default function ScannerPage() {
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

      <header className="sticky top-0 z-50 border-b border-[var(--rc-border)] bg-[color-mix(in_srgb,var(--rc-bg)_86%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-8">
          <a href="/scanner" className="font-display text-lg font-semibold italic tracking-tight text-gradient">
            zScanner
          </a>
          <nav aria-label="Scanner tabs" className="order-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px] md:order-2">
            {NAV.map((n) => (
              <a key={n.label} href={n.href} className="text-[var(--rc-text-dim)] transition-colors hover:text-[var(--rc-accent)]">
                {n.label}
              </a>
            ))}
            <a
              href="https://github.com/romangalaxys10-spec/glm-bonus-radar"
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
          <div className="order-2 md:order-3">
            <ThemeSwitch />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 pb-24 pt-12 md:px-8">
        <section className="pb-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rc-accent)]">
            zscanner · four scanners · no signup
          </p>
          <h1 className="mt-1.5 font-display text-4xl font-bold leading-[1.08] tracking-tight text-gradient md:text-5xl">
            Scan it before they rate it
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--rc-text-dim)]">
            The scanner suite behind the GLM Bonus Radar, opened up. Audit a URL&apos;s security posture (headers, CORS,
            exposed dotfiles, leaked secrets), measure how findable a page is by search engines <em>and</em> generative
            engines — now with the performance layer (TTFB, payload, render-blocking) — run a QA reliability audit, or
            review pasted code heuristically. Scans run as tracked jobs with a live progress bar and ETA, and every
            report ends with a strong copy-paste fix prompt for your dev agent. Rule sets adapted from
            securityheaders/OWASP, current GEO checklists, Semgrep/Bandit-style analysis, fable&apos;s sec-scan, Cloudflare&apos;s
            security-audit-skill and awesome-skills&apos; code-review-skill.
          </p>
        </section>

        <section id="security" aria-label="Scanner" className="scroll-mt-24">
          <ScannerApp />
        </section>

        <section className="pt-10" aria-label="How scoring works">
          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                id: "01",
                t: "Security Audit",
                d: "Transport, HSTS, CSP deep-lint, clickjacking, cookies, Permissions-Policy, CORS reflection, server-version disclosure, 404-baseline dotfile probes (.env, .git), secrets in served HTML and stack-trace leaks — Cloudflare-doctrine severity: exposures are findings, header gaps are hardening, suspicions are leads.",
              },
              {
                id: "02",
                t: "SEO · GEO · Performance",
                d: "On-page SEO (title, description, canonical, OG, headings, keyword density, internal links), the generative-engine layer (robots.txt AI-crawler policy for 14 bots, llms.txt, JSON-LD, authority, citation readiness, entity coverage) and performance (TTFB, HTML weight, images, lazy-loading, render-blocking scripts, compression) — with a four-pillar breakdown, linker-style.",
              },
              {
                id: "03",
                t: "QA Audit",
                d: "Reliability & robustness from fable's methodology: availability and response time, doctype/charset/lang/favicon hygiene, internal-link probing with a 404 baseline (soft-404 aware), insecure references, stack-trace leakage, deprecated tags — with an ok / needs-review / blocked verdict.",
              },
              {
                id: "04",
                t: "Code Reviewer",
                d: "Paste up to 256 KB of JS/TS/Python: secrets (AWS/GitHub/Slack/Google/PEM/JWT), eval/pickle/shell sinks, SQL concatenation, jwt.decode, framework raw-HTML escape hatches, CORS wildcards, weak hashes, dependency floors from package.json & requirements.txt — plus a strengths-first report per awesome-skills' review format.",
              },
            ].map((c) => (
              <div key={c.id} className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5">
                <p className="font-mono text-[11px] text-[var(--rc-accent)]">{c.id}</p>
                <h2 className="mt-1 font-display text-lg font-semibold tracking-tight">{c.t}</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--rc-text-dim)]">{c.d}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t border-[var(--rc-border)]">
        <div className="mx-auto max-w-6xl px-5 py-6 font-mono text-xs text-[var(--rc-text-dim)] md:px-8">
          <p>
            Part of{" "}
            <a href="/" className="underline decoration-dotted underline-offset-4 hover:text-[var(--rc-accent)]">
              GLM Bonus Radar
            </a>{" "}
            · developed by{" "}
            <a href="https://rommark.dev" target="_blank" rel="noopener" className="underline decoration-dotted underline-offset-4 hover:text-[var(--rc-accent)]">
              Rommark.Dev
            </a>{" "}
            · heuristic scans are advisory, not a guarantee · scans cached 10 min, 8/minute limit
          </p>
        </div>
      </footer>

      {/* GEO: machine-readable app descriptor */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "zScanner",
            applicationCategory: "SecurityApplication",
            operatingSystem: "Web",
            url: "https://zhelp.space-z.ai/scanner",
            description:
              "Free online scanner suite: HTTP security-header & exposure audit, SEO/GEO/Performance audit (incl. AI-crawler policy and llms.txt checks), a QA reliability audit and a heuristic code reviewer — with progress/ETA and per-report dev-agent fix prompts.",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          }),
        }}
      />
    </div>
  );
}
