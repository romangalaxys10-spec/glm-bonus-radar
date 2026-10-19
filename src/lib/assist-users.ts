import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";

/**
 * Z-Assist chat users (/agent) — a name plus a personal access token.
 *
 * The token is the whole account: it authenticates every /api/agent call,
 * owns the conversations, and restores the same history on any device.
 * Format ZA-XXXXXX — human-friendly alphabet (no 0/O/1/I/L), unguessable
 * enough for a support chat (32^6 ≈ 1e9) and never displayed to others.
 */

export const USER_TOKEN_REGEX = /^ZA-[A-HJ-NP-Z2-9]{6}$/;
export const MAX_CONVERSATIONS_PER_USER = 60;

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

export function newUserToken(): string {
  const bytes = randomBytes(6);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `ZA-${out}`;
}

/** Cleans a display name: trimmed, single-spaced, printable, 1–40 chars. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw
    // strip control characters, collapse whitespace
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
  return name.length > 0 ? name : null;
}

export function normalizeUserToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase();
  return USER_TOKEN_REGEX.test(t) ? t : null;
}

export async function findUser(token: string) {
  return db.assistUser.findUnique({ where: { token } });
}

/** Authenticated read — bumps lastSeenAt (best-effort, never blocks the call). */
export async function authUser(token: string) {
  const user = await findUser(token);
  if (!user) return null;
  void db.assistUser
    .update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);
  return user;
}

/**
 * Keeps a user's conversation drawer honest: after a new thread is created,
 * drop the oldest empties first, then the oldest threads beyond the cap.
 */
export async function pruneConversations(userToken: string): Promise<void> {
  const rows = await db.assistConversation.findMany({
    where: { userToken },
    orderBy: { updatedAt: "asc" },
    select: { id: true, token: true, messages: true },
  });
  if (rows.length <= MAX_CONVERSATIONS_PER_USER) return;
  const overflow = rows.length - MAX_CONVERSATIONS_PER_USER;
  const emptyFirst = [...rows].sort((a, b) => {
    const len = (r: (typeof rows)[number]) => {
      try {
        return (JSON.parse(r.messages) as unknown[]).length;
      } catch {
        return 0;
      }
    };
    if (len(a) === 0 && len(b) !== 0) return -1;
    if (len(b) === 0 && len(a) !== 0) return 1;
    return 0;
  });
  for (const row of emptyFirst.slice(0, overflow)) {
    await db.assistConversation.delete({ where: { token: row.token } });
  }
}

/** Counts messages in a stored conversation JSON (0 when unreadable). */
export function storedMessageCount(messagesJson: string): number {
  try {
    return (JSON.parse(messagesJson) as unknown[]).length;
  } catch {
    return 0;
  }
}
