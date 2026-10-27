import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatBlogDate } from "@/lib/blog";
import { BlogMarkdown } from "@/components/blog/blog-markdown";
import { INVITE_CODE, INVITE_URL } from "@/lib/invite";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

async function getPost(slug: string) {
  return db.blogPost.findUnique({ where: { slug } });
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post || !post.published) return { title: "Post not found — My Dev Blog" };
  return {
    title: `${post.title} — My Dev Blog`,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { title: post.title, description: post.excerpt, type: "article" },
  };
}

export default async function BlogPostPage({ params }: Params) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post || !post.published) notFound();

  const tags = (post.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 6);
  const updated = post.updatedAt.getTime() - post.createdAt.getTime() > 60_000;

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
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3 md:px-8">
          <a href="/blog" className="font-display text-lg font-semibold italic tracking-tight text-gradient">
            My Dev Blog
          </a>
          <Link
            href="/blog"
            className="font-mono text-[12px] text-[var(--rc-text-dim)] transition-colors hover:text-[var(--rc-accent)]"
          >
            ← all articles
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-20 pt-10 md:px-8">
        <article>
          <header className="pb-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--rc-tone3)]">
              <time dateTime={post.createdAt.toISOString()}>{formatBlogDate(post.createdAt)}</time>
              <span aria-hidden>·</span>
              <span>{post.author ?? "Rommark"}</span>
              {updated ? (
                <>
                  <span aria-hidden>·</span>
                  <span>updated {formatBlogDate(post.updatedAt)}</span>
                </>
              ) : null}
            </div>
            <h1 className="mt-3 font-display text-3xl font-light leading-[1.12] tracking-[-0.02em] text-[var(--rc-bright)] md:text-4xl">
              {post.title}
            </h1>
            <p className="mt-3 text-[15.5px] leading-relaxed text-[var(--rc-text-dim)]">{post.excerpt}</p>
            {tags.length ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-[color-mix(in_srgb,var(--rc-accent)_10%,var(--rc-bg))] px-2.5 py-0.5 font-mono text-[10px] text-[var(--rc-accent)]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
          </header>

          <hr className="border-[var(--rc-border)]" />

          <div className="pt-6">
            <BlogMarkdown source={post.body} />
          </div>
        </article>

        <div className="mt-10 rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5">
          <p className="font-display text-base font-semibold text-[var(--rc-bright)]">
            Like this kind of thing?
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--rc-text-dim)]">
            These projects all live on this portal — try the{" "}
            <Link href="/agent" className="underline decoration-dotted underline-offset-2 hover:text-[var(--rc-accent)]">docs-grounded Z-Assist chat</Link>, run your site through the{" "}
            <Link href="/scanner" className="underline decoration-dotted underline-offset-2 hover:text-[var(--rc-accent)]">six-in-one scanner</Link>, or check how AI-citable you are with{" "}
            <Link href="/search" className="underline decoration-dotted underline-offset-2 hover:text-[var(--rc-accent)]">zSearch</Link>.
          </p>
        </div>
      </main>

      <footer className="mt-auto border-t border-[var(--rc-border)]">
        <div className="mx-auto max-w-6xl px-5 py-6 md:px-8">
          <p className="font-mono text-[11px] leading-relaxed text-[var(--rc-tone3)]">
            My Dev Blog · part of the GLM Bonus Radar portal · unofficial, not affiliated with Z.ai
          </p>
        </div>
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: post.excerpt,
            url: `https://zhelp.space-z.ai/blog/${post.slug}`,
            datePublished: post.createdAt.toISOString(),
            dateModified: post.updatedAt.toISOString(),
            author: { "@type": "Person", name: post.author ?? "Rommark" },
            publisher: { "@type": "Organization", name: "GLM Bonus Radar" },
          }),
        }}
      />
    </div>
  );
}
