import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { tgApi } from "@/lib/telegram";
import { verifyBotToken, DAILY_LIMIT } from "@/lib/assist-telegram";

/**
 * Portal-side API for pairing visitors' own Telegram bots with Z-Assist.
 *
 * GET  ?ownerKey=...                  -> this browser's paired bots (masked)
 * POST { action: "pair", token, ownerKey }  -> verify via getMe + store
 * POST { action: "code", id, ownerKey }     -> regenerate the /start code
 * POST { action: "unpair", id, ownerKey }   -> delete pairing (token wiped)
 *
 * Privacy: rows are scoped by a browser-generated ownerKey stored in
 * localStorage — the portal never shows one visitor another visitor's bot.
 * Bot tokens are never returned; only their last 4 characters.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAIR_RATE = 10; // pair attempts
const PAIR_RATE_WINDOW_MS = 60 * 60 * 1000; // per hour per IP

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + PAIR_RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > PAIR_RATE;
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : null) || "local";
}

function newPairCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — Telegram-safe to read out
  const bytes = randomBytes(6);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function validOwnerKey(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v);
}

function deepLink(username: string, code: string): string {
  return `https://t.me/${username}?start=${code}`;
}

function masked(row: {
  id: string;
  botUsername: string;
  status: string;
  pairCode: string;
  ownerTitle: string | null;
  conversationToken: string | null;
  questionsDate: string | null;
  questionsToday: number;
  totalReplies: number;
  lastMessageAt: Date | null;
  lastError: string | null;
  botToken: string;
  createdAt: Date;
}) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date());
  const usedToday = row.questionsDate === today ? row.questionsToday : 0;
  return {
    id: row.id,
    botUsername: row.botUsername,
    status: row.status,
    pairCode: row.status === "active" ? null : row.pairCode,
    deepLink: row.status === "active" ? `https://t.me/${row.botUsername}` : deepLink(row.botUsername, row.pairCode),
    tokenTail: `••••${row.botToken.slice(-4)}`,
    ownerTitle: row.ownerTitle,
    conversationToken: row.conversationToken,
    usedToday,
    dailyLimit: DAILY_LIMIT,
    totalReplies: row.totalReplies,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const ownerKey = req.nextUrl.searchParams.get("ownerKey");
  if (!validOwnerKey(ownerKey)) {
    return NextResponse.json({ error: "ownerKey required" }, { status: 400 });
  }
  try {
    const rows = await db.zAssistBot.findMany({
      where: { ownerKey },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });
    return NextResponse.json({ bots: rows.map(masked) });
  } catch (err) {
    console.error("[assist-telegram] GET failed:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const ownerKey = body.ownerKey;

  if (!validOwnerKey(ownerKey)) {
    return NextResponse.json({ error: "ownerKey required" }, { status: 400 });
  }

  try {
    if (action === "pair") {
      if (rateLimited(clientIp(req))) {
        return NextResponse.json(
          { error: "Too many pairing attempts — try again in an hour." },
          { status: 429 },
        );
      }
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
        return NextResponse.json(
          { error: "That doesn't look like a bot token. Copy the exact token @BotFather gives you (format: 123456789:AA...)." },
          { status: 400 },
        );
      }

      const verified = await verifyBotToken(token);
      if (!verified.ok || !verified.botId || !verified.username) {
        return NextResponse.json(
          { error: verified.error ?? "Telegram rejected this token. Double-check it in @BotFather." },
          { status: 400 },
        );
      }

      // Polling (getUpdates) conflicts with webhooks — clear any stale one.
      await tgApi(token, "deleteWebhook", { drop_pending_updates: false }).catch(() => null);

      const pairCode = newPairCode();
      const row = await db.zAssistBot.upsert({
        where: { botToken: token },
        create: {
          ownerKey,
          botToken: token,
          botId: verified.botId,
          botUsername: verified.username,
          pairCode,
        },
        // Re-pairing an existing bot (e.g. new browser / new code) takes
        // ownership and refreshes the /start code.
        update: { ownerKey, pairCode, status: "pending", ownerChatId: null, ownerTitle: null, lastError: null },
      });

      return NextResponse.json({
        ok: true,
        bot: masked(row),
      });
    }

    if (action === "code") {
      const id = typeof body.id === "string" ? body.id : "";
      const row = await db.zAssistBot.findUnique({ where: { id } });
      if (!row || row.ownerKey !== ownerKey) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      if (row.status === "active") {
        return NextResponse.json({ error: "Bot already paired." }, { status: 409 });
      }
      const updated = await db.zAssistBot.update({ where: { id }, data: { pairCode: newPairCode() } });
      return NextResponse.json({ ok: true, bot: masked(updated) });
    }

    if (action === "unpair") {
      const id = typeof body.id === "string" ? body.id : "";
      const row = await db.zAssistBot.findUnique({ where: { id } });
      if (!row || row.ownerKey !== ownerKey) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      await db.zAssistBot.delete({ where: { id } }).catch(() => null);
      if (row.conversationToken) {
        await db.assistConversation.deleteMany({ where: { token: row.conversationToken } }).catch(() => null);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[assist-telegram] POST failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "telegram action failed" },
      { status: 503 },
    );
  }
}
