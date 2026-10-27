import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { formatBlogDate } from "@/lib/blog";
import { ToolsSection } from "@/components/portal/tools-section";
import { INVITE_CODE, INVITE_URL } from "@/lib/invite";

export const metadata: Metadata = {
  title: "My Dev Blog — build notes on the Z.AI projects (GLM Bonus Radar, zScanner, Z-Assist, zSearch, zFun, Endpoint, Membox)",
  description:
    "First-party mini articles about the projects built for and around Z.AI: the GLM Bonus Radar portal, the zScanner suite, the Z-Assist docs-grounded chat, zSearch GEO ranking, the zFun arcade, the OpenAI-compatible endpoint and Membox. Published straight from the dev's agents via a token-gated API — plus the useful-tools toolkit from the same builder.",
  alternates: { canonical: "/blog" },
};

export const dynamic = "force-dynamic";

const NAV = [
  { href: "#tools", label: "tools" },
  { href: "/", label: "← radar" },
  { href: "/scanner", label: "scanner" },
  { href: "/agent", label: "z-assist" },
  { href: "/search", label: "zsearch" },
];

function tagList(tags: string | null): string[] {
  return (tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 6);
}

export default async function BlogIndexPage() {
  const posts = await db.blogPost.findMany({
    where: { published: true },
    orderBy: { createdAt: "desc" },
    select: { slug: true, title: true, excerpt: true, tags: true, author: true, source: true, createdAt: true },
    take: 100,
  });

  return (
    <div className="flex min-h-screen flex-col bg-[var(--rc-bg)] text-[var(--rc-text)]">
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
          <a href="/blog" className="font-display text-lg font-semibold italic tracking-tight text-gradient">
            My Dev Blog
          </a>
          <nav aria-label="Blog sections" className="order-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px] md:order-2">
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
              className="flex items-center gap-1 text-[var(--rc-text-dim)] transition-colors hover:text-[var(--rc-accent)]"
            >
              github
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-20 pt-12 md:px-8">
        {/* Hero */}
        <section className="pb-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rc-accent)]">
            build notes · shipped things · {posts.length} article{posts.length === 1 ? "" : "s"}
          </p>
          <h1 className="mt-2 font-display text-3xl font-light leading-[1.1] tracking-[-0.02em] text-[var(--rc-bright)] md:text-4xl">
            My Dev Blog
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--rc-text-dim)]">
            Mini articles about the projects I built for and around Z.AI — why each one exists,
            what it does, and what I learned shipping it. New posts land here straight from my
            agents via the publishing API.
          </p>
        </section>

        {/* Posts */}
        <section aria-label="Articles" className="space-y-4">
          {posts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--rc-border)] px-5 py-10 text-center text-sm text-[var(--rc-text-dim)]">
              No articles yet — the first one is being written.
            </p>
          ) : (
            posts.map((p) => (
              <article
                key={p.slug}
                className="group rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5 transition-colors hover:border-[color-mix(in_srgb,var(--rc-accent)_40%,var(--rc-border))]"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--rc-tone3)]">
                  <time dateTime={p.createdAt.toISOString()}>{formatBlogDate(p.createdAt)}</time>
                  <span aria-hidden>·</span>
                  <span>{p.author ?? "Rommark"}</span>
                  {p.source === "agent" ? (
                    <span className="rounded-full border border-[var(--rc-border)] px-2 py-0.5 text-[9px] normal-case tracking-normal">
                      via agent api
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-2 font-display text-lg font-semibold leading-snug tracking-tight">
                  <Link
                    href={`/blog/${p.slug}`}
                    className="text-[var(--rc-bright)] transition-colors group-hover:text-[var(--rc-accent)]"
                  >
                    {p.title}
                  </Link>
                </h2>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--rc-text-dim)]">{p.excerpt}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {tagList(p.tags).map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-[color-mix(in_srgb,var(--rc-accent)_10%,var(--rc-bg))] px-2.5 py-0.5 font-mono text-[10px] text-[var(--rc-accent)]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <Link
                    href={`/blog/${p.slug}`}
                    className="font-mono text-[12px] font-semibold text-[var(--rc-accent)] transition-transform group-hover:translate-x-0.5"
                    aria-label={`Read: ${p.title}`}
                  >
                    read →
                  </Link>
                </div>
              </article>
            ))
          )}
        </section>

        {/* Useful tools — moved here from the homepage so the blog is the
            single hub for everything the builder ships alongside the radar */}
        <section id="tools" aria-label="Useful tools" className="mt-12 scroll-mt-24">
          <div className="mb-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rc-accent)]">
              toolkit · by the same builder
            </p>
            <h2 className="mt-1.5 font-display text-2xl font-light tracking-[-0.01em] text-[var(--rc-bright)] md:text-3xl">
              Useful tools
            </h2>
            <p className="mt-2 text-[15px] text-[var(--rc-text-dim)]">
              Field-tested utilities and deep-dive write-ups from Rommark.Dev — the GitHub auto-push
              protocol that keeps agent work safe, the self-healing deploy kit that keeps this very
              portal online, and hands-on reviews of agent memory and multi-agent orchestration tooling.
            </p>
          </div>
          <ToolsSection layout="narrow" />
        </section>

        {/* Agent pairing info — endpoint shape only, never the token itself */}
        <section aria-label="Publish via API" className="mt-10 rounded-2xl border border-dashed border-[var(--rc-border)] p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--rc-accent)]">
            for my agents · publish here
          </p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--rc-text-dim)]">
            This blog accepts posts from any paired agent:{" "}
            <code className="rounded bg-[color-mix(in_srgb,var(--rc-accent)_10%,var(--rc-bg))] px-1.5 py-0.5 font-mono text-[12px] text-[var(--rc-accent)]">
              POST /api/blog
            </code>{" "}
            with{" "}
            <code className="rounded bg-[color-mix(in_srgb,var(--rc-accent)_10%,var(--rc-bg))] px-1.5 py-0.5 font-mono text-[12px] text-[var(--rc-accent)]">
              Authorization: Bearer zblog_…
            </code>{" "}
            and JSON <code className="font-mono text-[12px]">{`{ title, body (markdown), excerpt?, tags?, author?, slug? }`}</code>.
            Re-pushing the same slug updates the article in place. The pairing token is issued by the owner —
            it is never shown on this page.
          </p>
        </section>
      </main>

      <footer className="mt-auto border-t border-[var(--rc-border)]">
        <div className="mx-auto max-w-6xl px-5 py-6 md:px-8">
          <p className="font-mono text-[11px] leading-relaxed text-[var(--rc-tone3)]">
            My Dev Blog · part of the GLM Bonus Radar portal · unofficial, not affiliated with Z.ai ·
            articles reflect the author&apos;s own build notes
          </p>
        </div>
      </footer>

      {/* GEO: machine-readable blog descriptor */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Blog",
            name: "My Dev Blog",
            url: "https://zhelp.space-z.ai/blog",
            description:
              "Mini articles about projects built for and around Z.AI: GLM Bonus Radar, zScanner, Z-Assist, zSearch, zFun, the OpenAI-compatible endpoint and Membox.",
            publisher: { "@type": "Person", name: "Rommark" },
            blogPost: posts.slice(0, 20).map((p) => ({
              "@type": "BlogPosting",
              headline: p.title,
              url: `https://zhelp.space-z.ai/blog/${p.slug}`,
              datePublished: p.createdAt.toISOString(),
              dateModified: p.createdAt.toISOString(),
              author: { "@type": "Person", name: p.author ?? "Rommark" },
            })),
          }),
        }}
      />
    </div>
  );
}
