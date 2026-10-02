import type { Metadata } from "next";
import { ThemeSwitch } from "@/components/portal/theme-switch";
import { ScannerApp } from "@/components/portal/scanner-app";
import { INVITE_CODE, INVITE_URL } from "@/lib/invite";
import { GitHubMark } from "@/components/portal/scanner-icons";

export const metadata: Metadata = {
  title: "zScanner — free online Security, GEO/SEO and Code scanners",
  description:
    "Three instant scanners: Security Audit (CSP, HSTS, cookies, mixed content), GEO/SEO Audit (titles, structured data, llms.txt, AI-crawler policy) and a heuristic Code Reviewer. No signup, results in seconds.",
  alternates: { canonical: "/scanner" },
};

const NAV = [
  { href: "/", label: "← radar" },
  { href: "#security", label: "security" },
  { href: "#geo", label: "geo/seo" },
  { href: "#code", label: "code" },
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
              <a key={n.href} href={n.href} className="text-[var(--rc-text-dim)] transition-colors hover:text-[var(--rc-accent)]">
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
            zscanner · three scanners · no signup
          </p>
          <h1 className="mt-1.5 font-display text-4xl font-bold leading-[1.08] tracking-tight text-gradient md:text-5xl">
            Scan it before they rate it
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--rc-text-dim)]">
            The scanner suite behind the GLM Bonus Radar, opened up. Audit a URL&apos;s security headers, measure how
            findable a page is by search engines <em>and</em> generative engines (the 2026 layer: llms.txt, AI-crawler
            policy, structured data), or run a heuristic code review — instantly, with weighted scores and concrete
            fixes. Rule sets adapted from securityheaders/OWASP, current GEO checklists and Semgrep/Bandit-style
            analysis.
          </p>
        </section>

        <section id="security" aria-label="Scanner" className="scroll-mt-24">
          <ScannerApp />
        </section>

        <section className="pt-10" aria-label="How scoring works">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                id: "01",
                t: "Security Audit",
                d: "Transport, HSTS, CSP, clickjacking, MIME sniffing, referrer policy, COOP, cookie flags, fingerprinting headers and mixed content — graded like securityheaders.com, with a fix line per finding.",
              },
              {
                id: "02",
                t: "GEO/SEO Audit",
                d: "On-page SEO (title, description, canonical, viewport, OG, h1, alt, JSON-LD) plus the generative-engine layer: robots.txt AI-crawler policy for GPTBot/ClaudeBot/PerplexityBot & friends, llms.txt, sitemap, citation-worthiness.",
              },
              {
                id: "03",
                t: "Code Reviewer",
                d: "Paste up to 256 KB of JS/TS/Python: hard-coded secrets and keys, eval/pickle/shell sinks, weak hashes, TLS verification disabled, debug leftovers — Semgrep/Bandit-style heuristics, deterministic and offline.",
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
              "Free online scanner suite: HTTP security-header audit, GEO/SEO audit (incl. AI-crawler policy and llms.txt checks) and a heuristic code reviewer.",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          }),
        }}
      />
    </div>
  );
}
