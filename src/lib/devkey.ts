import { db } from "@/lib/db";
import path from "node:path";

/**
 * Dev Control endpoint (/api/dev) — remote project management for the
 * owner's paired agents.
 *
 * Pairing model (mirrors the blog token pattern):
 *   - Auth accepts `Authorization: Bearer <token>`.
 *   - The token is checked against env DEV_PUSH_TOKEN first (survives DB
 *     wipes), then against the singleton DevToken row (self-heals after a
 *     DB reset).
 *   - Actions: status | read | list | write | delete | exec | rotate.
 *
 * This endpoint can modify the running project, so path writes are guarded:
 *   - everything must resolve INSIDE the project root;
 *   - a small denylist protects files that would brick auth/integrity or
 *     corrupt live state (.env*, .git, node_modules, .next, live SQLite);
 *   - `exec` is intentionally powerful (install/build/migrate/git) — it is
 *     owner-trust by design and protected only by the token.
 */

export const DEV_KEY_PREFIX = "zdev_";

export function mintDevToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return DEV_KEY_PREFIX + hex;
}

/** Singleton DB token row — created on first call if missing. */
export async function getOrCreateDevToken() {
  const existing = await db.devToken.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return db.devToken.create({ data: { token: mintDevToken() } });
}

export async function rotateDevToken() {
  const existing = await db.devToken.findFirst({ orderBy: { createdAt: "asc" } });
  if (!existing) return getOrCreateDevToken();
  return db.devToken.update({ where: { id: existing.id }, data: { token: mintDevToken() } });
}

/** Bearer extraction (Authorization header only — no query-string secrets). */
export function extractDevToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : null;
}

/** True when `raw` matches env DEV_PUSH_TOKEN or the singleton DB token. */
export async function devTokenMatches(raw: string | null): Promise<boolean> {
  if (!raw || raw.length < 12 || raw.length > 128) return false;
  const envToken = process.env.DEV_PUSH_TOKEN?.trim();
  if (envToken && raw === envToken) return true;
  const row = await db.devToken.findUnique({ where: { token: raw } });
  return row != null;
}

/* ------------------------------ path safety ------------------------------ */

/** Files/dirs the remote API must never touch (auth, VCS, builds, live DB). */
const DENYLIST = [
  /^\.env(\..*)?$/, // secrets — never readable/writable remotely
  /^\.git(\/|$)/, // repository integrity
  /^node_modules(\/|$)/, // managed by bun install
  /^\.next(\/|$)/, // build output — managed by `bun run build`
  /^\.zscripts\/cache(\/|$)/, // deploy artifact cache
  /^db\/custom\.db(-journal|-wal|-shm)?$/, // live SQLite (open handles + secrets)
];

export type PathCheck =
  | { ok: true; abs: string; rel: string }
  | { ok: false; error: string };

/**
 * Resolve a project-relative path safely. Returns the absolute path guarded
 * to live inside PROJECT_ROOT, or an error for traversal/denylist hits.
 */
export function resolveProjectPath(rawPath: unknown): PathCheck {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return { ok: false, error: "path must be a non-empty project-relative string." };
  }
  const rel = rawPath.trim().replace(/^\/+/, "");
  if (rel.includes("\0")) return { ok: false, error: "path contains a null byte." };
  const abs = path.resolve(process.cwd(), rel);
  if (abs !== process.cwd() && !abs.startsWith(process.cwd() + path.sep)) {
    return { ok: false, error: "path escapes the project root." };
  }
  const relNorm = path.relative(process.cwd(), abs);
  if (DENYLIST.some((re) => re.test(relNorm))) {
    return { ok: false, error: `path "${relNorm}" is protected on the dev endpoint denylist.` };
  }
  return { ok: true, abs, rel: relNorm };
}

/* ------------------------------ exec plumbing ----------------------------- */

export const EXEC_TIMEOUT_MS = 120_000;
export const OUTPUT_CAP = 512 * 1024; // per stream
export const MAX_WRITE_BYTES = 2 * 1024 * 1024;
export const MAX_READ_BYTES = 512 * 1024;

export function trimOutput(s: string): string {
  if (s.length <= OUTPUT_CAP) return s;
  return s.slice(0, OUTPUT_CAP) + `\n… [truncated ${s.length - OUTPUT_CAP} bytes]`;
}
