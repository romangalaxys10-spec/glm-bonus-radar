/**
 * merge-prod-content.ts — union of production + local blog content.
 *
 * STANDING RULE support (owner, 2026-10-27): before any update/patch/deploy,
 * production content is read and folded into the version being shipped so a
 * deploy can never silently drop posts that exist only on the live site.
 *
 * Modes:
 *   bun scripts/merge-prod-content.ts <prod.json> <local.json>
 *       Merge the two snapshot files into the LOCAL DB (newest updatedAt
 *       wins per slug) — used by .zscripts/build.sh before packing.
 *
 *   bun scripts/merge-prod-content.ts --snapshot-only <prod.json> <local.json>
 *       No DB writes — print the union JSON (tracked snapshot for git).
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

type SnapPost = {
  slug: string;
  title: string;
  body?: string;
  excerpt?: string | null;
  tags?: string | null;
  author?: string | null;
  source?: string;
  published?: boolean;
  createdAt?: string;
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

/** Union by slug, newest updatedAt wins; falls back to whichever side has it. */
export function unionPosts(prod: SnapPost[], local: SnapPost[]): SnapPost[] {
  const bySlug = new Map<string, SnapPost>();
  const ts = (p?: SnapPost) => Date.parse(p?.updatedAt ?? p?.createdAt ?? "") || 0;
  for (const p of [...prod, ...local]) {
    if (!p?.slug || !p?.title) continue;
    const prev = bySlug.get(p.slug);
    if (!prev || ts(p) >= ts(prev)) bySlug.set(p.slug, p);
  }
  return [...bySlug.values()].sort((a, b) => ts(b) - ts(a));
}

async function main() {
  const snapshotOnly = process.argv[2] === "--snapshot-only";
  const prodPath = snapshotOnly ? process.argv[3] : process.argv[2];
  const localPath = snapshotOnly ? process.argv[4] : process.argv[3];
  if (!prodPath || !localPath) {
    console.error("usage: merge-prod-content.ts [--snapshot-only] <prod.json> <local.json>");
    process.exit(1);
  }

  const merged = unionPosts(load(prodPath), load(localPath));
  const out = JSON.stringify({ count: merged.length, posts: merged });

  if (snapshotOnly) {
    process.stdout.write(out);
    return;
  }

  const db = new PrismaClient();
  let inserted = 0;
  let updated = 0;
  for (const p of merged) {
    const data = {
      title: p.title,
      body: p.body ?? "",
      excerpt: p.excerpt ?? "",
      tags: p.tags ?? null,
      author: p.author ?? null,
      published: p.published ?? true,
    };
    if (!data.body || !data.title) continue; // list-only payloads are not restorable
    const res = await db.blogPost.upsert({
      where: { slug: p.slug },
      update: data,
      create: { ...data, slug: p.slug, source: p.source ?? "restored" },
    });
    // crude created vs updated signal via create/update timestamps
    if (res.createdAt.getTime() === res.updatedAt.getTime()) inserted++;
    else updated++;
  }
  console.log(`[merge-prod-content] union=${merged.length} inserted=${inserted} updated=${updated}`);
  await db.$disconnect();
}

if (require.main === module) main().catch((e) => (console.error(e), process.exit(1)));
