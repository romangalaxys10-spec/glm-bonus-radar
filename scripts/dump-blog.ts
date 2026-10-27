/**
 * dump-blog.ts — dump blog posts (full) as JSON for content backups.
 * Usage: bun scripts/dump-blog.ts local   → { count, posts: [...] }
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const posts = await db.blogPost.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  process.stdout.write(
    JSON.stringify({
      count: posts.length,
      posts: posts.map((p) => ({
        slug: p.slug,
        title: p.title,
        body: p.body,
        excerpt: p.excerpt,
        tags: p.tags,
        author: p.author,
        source: p.source,
        published: p.published,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    }),
  );
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
