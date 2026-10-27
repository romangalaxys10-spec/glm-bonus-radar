import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  blogTokenMatches,
  extractBlogToken,
  getOrCreateBlogToken,
  normalizeBlogWrite,
  rotateBlogToken,
} from "@/lib/blog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * My Dev Blog — public read, token-gated write.
 *
 * GET    /api/blog?limit=20&tag=z.ai   -> newest-first list (published only),
 *                                         ?full=1 adds bodies
 * POST   /api/blog                     -> publish/update (Bearer token, upsert by slug)
 * DELETE /api/blog?slug=…              -> remove (Bearer token)
 * POST   /api/blog {action:"rotate"}   -> rotate the pairing token (Bearer token)
 *
 * Agent pairing (one-time setup — token lives in .env BLOG_PUSH_TOKEN / DB):
 *   curl -X POST https://zhelp.space-z.ai/api/blog \
 *     -H "Authorization: Bearer zblog_…" -H "Content-Type: application/json" \
 *     -d '{"title":"…","body":"markdown…","excerpt":"…","tags":"z.ai, agents","author":"MyAgent"}'
 */

const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, MAX_LIMIT);
  const tag = url.searchParams.get("tag")?.trim().toLowerCase();
  const full = url.searchParams.get("full") === "1";

  const posts = await db.blogPost.findMany({
    where: { published: true, ...(tag ? { tags: { contains: tag } } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      slug: true, title: true, excerpt: true, tags: true, author: true,
      source: true, createdAt: true, updatedAt: true, ...(full ? { body: true } : {}),
    },
  });

  return NextResponse.json({ count: posts.length, posts });
}

export async function POST(req: NextRequest) {
  const token = extractBlogToken(req);
  if (!(await blogTokenMatches(token))) {
    return NextResponse.json(
      { error: "Unauthorized — pair your agent with the blog's Bearer token." },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Token management action — lets the owner rotate without a deploy.
  if (body.action === "rotate") {
    const row = await rotateBlogToken();
    return NextResponse.json({
      rotated: true,
      note: "Store this now — the old token is dead. env BLOG_PUSH_TOKEN (if set) still works.",
      token: row.token,
    });
  }

  const norm = normalizeBlogWrite(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });

  const value = norm.value;
  const post = await db.blogPost.upsert({
    where: { slug: value.slug },
    update: {
      title: value.title, body: value.body, excerpt: value.excerpt,
      tags: value.tags, author: value.author, published: value.published,
    },
    create: { ...value, source: "agent" },
  });

  return NextResponse.json({
    ok: true,
    url: `/blog/${post.slug}`,
    slug: post.slug,
    created: post.createdAt.getTime() === post.updatedAt.getTime(),
  }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const token = extractBlogToken(req);
  if (!(await blogTokenMatches(token))) {
    return NextResponse.json({ error: "Unauthorized — Bearer token required." }, { status: 401 });
  }
  const slug = new URL(req.url).searchParams.get("slug")?.trim();
  if (!slug) return NextResponse.json({ error: "Pass ?slug= of the post to remove." }, { status: 400 });

  try {
    await db.blogPost.delete({ where: { slug } });
    return NextResponse.json({ ok: true, deleted: slug });
  } catch {
    return NextResponse.json({ error: `No post with slug "${slug}".` }, { status: 404 });
  }
}

/** Readiness probe (no secrets returned). */
export async function HEAD() {
  const row = await getOrCreateBlogToken();
  return new NextResponse(null, {
    status: 200,
    headers: { "x-blog-token-ready": row ? "1" : "0" },
  });
}
