import { db } from "@/lib/db";

/**
 * My Dev Blog — shared plumbing for the public blog and its agent API.
 *
 * Pairing model (mirrors the endpoint key pattern):
 *   - Auth accepts `Authorization: Bearer <token>`.
 *   - The token is checked against env BLOG_PUSH_TOKEN first (survives DB
 *     wipes), then against the singleton BlogToken row (self-heals after
 *     a DB reset). The seed script keeps both in sync.
 *   - Publishing is an upsert on `slug`: an agent can re-push the same
 *     slug to update an article in place, or omit `slug` to get one
 *     derived from the title.
 */

export const BLOG_KEY_PREFIX = "zblog_";

/** Suggestive limits — long enough for real articles, short enough to blunt abuse. */
const LIMITS = {
  title: { min: 3, max: 180 },
  excerpt: { max: 400 },
  body: { min: 20, max: 40_000 },
  tags: { max: 200 },
  author: { max: 80 },
  slug: { max: 120 },
} as const;

export function mintBlogToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return BLOG_KEY_PREFIX + hex;
}

/** Singleton DB token row — created on first call if missing. */
export async function getOrCreateBlogToken() {
  const existing = await db.blogToken.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return db.blogToken.create({ data: { token: mintBlogToken() } });
}

export async function rotateBlogToken() {
  const existing = await db.blogToken.findFirst({ orderBy: { createdAt: "asc" } });
  if (!existing) return getOrCreateBlogToken();
  return db.blogToken.update({ where: { id: existing.id }, data: { token: mintBlogToken() } });
}

/** Bearer extraction (Authorization header only — no query-string secrets). */
export function extractBlogToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : null;
}

/** True when `raw` matches env BLOG_PUSH_TOKEN or the singleton DB token. */
export async function blogTokenMatches(raw: string | null): Promise<boolean> {
  if (!raw || raw.length < 12 || raw.length > 128) return false;
  const envToken = process.env.BLOG_PUSH_TOKEN?.trim();
  if (envToken && raw === envToken) return true;
  const row = await db.blogToken.findUnique({ where: { token: raw } });
  return row != null;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, LIMITS.slug.max)
    .replace(/^-+|-+$/g, "");
}

export type BlogWriteResult =
  | { ok: true; value: {
      title: string; body: string; excerpt: string; tags: string | null;
      author: string | null; slug: string; published: boolean;
    } }
  | { ok: false; error: string };

function asString(v: unknown): string | null {
  return typeof v === "string" ? v.trim() || null : null;
}

/** Validates + normalizes an agent (or seed) payload into safe columns. */
export function normalizeBlogWrite(input: Record<string, unknown>): BlogWriteResult {
  const title = asString(input.title);
  if (!title || title.length < LIMITS.title.min || title.length > LIMITS.title.max) {
    return { ok: false, error: `title must be a string of ${LIMITS.title.min}-${LIMITS.title.max} chars.` };
  }
  const body = asString(input.body);
  if (!body || body.length < LIMITS.body.min || body.length > LIMITS.body.max) {
    return { ok: false, error: `body must be a markdown string of ${LIMITS.body.min}-${LIMITS.body.max} chars.` };
  }
  const excerpt = asString(input.excerpt) ?? body.replace(/[#>*`\[\]()!-]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
  const tags = asString(input.tags)?.toLowerCase().slice(0, LIMITS.tags.max) ?? null;
  const author = asString(input.author)?.slice(0, LIMITS.author.max) ?? null;
  const slug = slugify(asString(input.slug) ?? title);
  if (!slug) return { ok: false, error: "could not derive a slug — pass an explicit `slug` (a-z, 0-9, dashes)." };
  const published = input.published === undefined ? true : Boolean(input.published);
  return { ok: true, value: { title, body, excerpt: excerpt.slice(0, LIMITS.excerpt.max), tags, author, slug, published } };
}

/** Date formatting shared by the index, the post page and the API. */
export function formatBlogDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
