/**
 * restore-blog.ts — re-push backed-up blog posts into a target /api/blog.
 * Usage: bun scripts/restore-blog.ts <prod.json> <local.json> <targetURL> <token>
 * Pushes the UNION (newest-wins per slug) so nothing on either side is lost.
 * Upsert semantics: existing slugs are updated in place, never duplicated.
 */
import { readFileSync } from "node:fs";

type SnapPost = {
  slug: string;
  title: string;
  body?: string;
  excerpt?: string | null;
  tags?: string | null;
  author?: string | null;
  published?: boolean;
  updatedAt?: string;
};

function load(path: string): SnapPost[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed.posts) ? parsed.posts : [];
  } catch {
    return [];
  }
}

async function main() {
  const [prodPath, localPath, target, token] = process.argv.slice(2);
  if (!prodPath || !localPath || !target || !token) {
    console.error("usage: restore-blog.ts <prod.json> <local.json> <targetURL> <token>");
    process.exit(1);
  }

  // newest-wins union per slug (same rule as merge-prod-content)
  const tsOf = (p: SnapPost) => Date.parse(p.updatedAt ?? "") || 0;
  const bySlug = new Map<string, SnapPost>();
  for (const p of [...load(prodPath), ...load(localPath)]) {
    if (!p?.slug || !p?.title || !p?.body) continue;
    const prev = bySlug.get(p.slug);
    if (!prev || tsOf(p) >= tsOf(prev)) bySlug.set(p.slug, p);
  }

  let ok = 0;
  let fail = 0;
  for (const p of bySlug.values()) {
    const res = await fetch(`${target}/api/blog`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: p.slug,
        title: p.title,
        body: p.body,
        excerpt: p.excerpt ?? undefined,
        tags: p.tags ?? undefined,
        author: p.author ?? undefined,
      }),
    });
    if (res.ok) {
      ok++;
      console.log(`[restore-blog] ok: ${p.slug}`);
    } else {
      fail++;
      const text = await res.text().catch(() => "");
      console.error(`[restore-blog] FAIL ${res.status}: ${p.slug} — ${text.slice(0, 120)}`);
    }
  }
  console.log(`[restore-blog] done: ok=${ok} fail=${fail} (union=${bySlug.size})`);
  if (fail > 0) process.exit(2);
}

main().catch((e) => (console.error(e), process.exit(1)));
