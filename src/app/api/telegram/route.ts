import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  broadcast,
  createLinkCode,
  getBotConfig,
  getMe,
  parsePrefs,
  peekLinkCode,
  setBotConfig,
  sendMessage,
  type TelegramPrefs,
} from "@/lib/telegram";

/**
 * Telegram integration endpoint for the notifications panel.
 *
 * GET  ?action=status                 → { configured, username, chats }
 * GET  ?action=link-status&code=XYZ   → { pending }
 * GET  ?action=prefs&chatId=...       → { prefs, title }
 * POST { action: "set-bot", token }   → validates via getMe, stores
 * POST { action: "link" }             → { code, botUsername }
 * POST { action: "prefs", chatId, prefs, title? }
 * POST { action: "test", chatId? }    → sends a test alert
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizePrefs(input: unknown): TelegramPrefs | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  return {
    golden: row.golden === true,
    windows: row.windows === true,
    announcements: row.announcements === true,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "status";

  try {
    if (action === "status") {
      const cfg = await getBotConfig();
      const chats = await db.telegramChat.count();
      return NextResponse.json({
        configured: cfg != null,
        username: cfg?.username ?? null,
        chats,
      });
    }

    if (action === "link-status") {
      const code = (url.searchParams.get("code") ?? "").toUpperCase();
      if (!/^[A-Z0-9]{4,12}$/.test(code)) {
        return NextResponse.json({ error: "bad code" }, { status: 400 });
      }
      return NextResponse.json({ pending: peekLinkCode(code) });
    }

    if (action === "prefs") {
      const chatId = url.searchParams.get("chatId");
      if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });
      const chat = await db.telegramChat.findUnique({ where: { chatId } });
      if (!chat) return NextResponse.json({ error: "chat not linked" }, { status: 404 });
      return NextResponse.json({ prefs: parsePrefs(chat.prefs), title: chat.title });
    }

    if (action === "prefs-list") {
      const chats = await db.telegramChat.findMany({
        select: { chatId: true, prefs: true, title: true },
        orderBy: { createdAt: "asc" },
        take: 50,
      });
      return NextResponse.json({
        chats: chats.map((c) => ({ chatId: c.chatId, prefs: parsePrefs(c.prefs), title: c.title })),
      });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "telegram unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "set-bot") {
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
        return NextResponse.json(
          { error: "That does not look like a bot token. Copy the exact token from @BotFather." },
          { status: 400 },
        );
      }
      const me = await getMe(token);
      if (!me.ok || !me.result?.username) {
        return NextResponse.json(
          { error: "Telegram rejected this token (getMe failed). Check it and try again." },
          { status: 400 },
        );
      }
      await setBotConfig({ token, username: me.result.username });
      return NextResponse.json({ ok: true, username: me.result.username });
    }

    if (action === "link") {
      const cfg = await getBotConfig();
      if (!cfg) return NextResponse.json({ error: "Connect a bot first." }, { status: 409 });
      const code = createLinkCode();
      return NextResponse.json({ code, botUsername: cfg.username ?? null });
    }

    if (action === "prefs") {
      const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
      const prefs = sanitizePrefs(body.prefs);
      if (!chatId || !prefs) return NextResponse.json({ error: "chatId and prefs required" }, { status: 400 });
      const title = typeof body.title === "string" ? body.title.slice(0, 120) : undefined;
      await db.telegramChat.upsert({
        where: { chatId },
        create: { chatId, prefs: JSON.stringify(prefs), title },
        update: { prefs: JSON.stringify(prefs), ...(title != null ? { title } : {}) },
      });
      return NextResponse.json({ ok: true, prefs });
    }

    if (action === "test") {
      const chatId = typeof body.chatId === "string" ? body.chatId.trim() : null;
      const cfg = await getBotConfig();
      if (!cfg) return NextResponse.json({ ok: false, delivered: 0 });
      if (chatId) {
        const res = await sendMessage(cfg.token, chatId, "Test alert from GLM Bonus Radar — this chat is connected.");
        return NextResponse.json({ ok: res.ok, delivered: res.ok ? 1 : 0 });
      }
      const delivered = await broadcast("announcements", "Test alert from GLM Bonus Radar — Telegram alerts are live.");
      return NextResponse.json({ ok: delivered > 0, delivered });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "telegram action failed" },
      { status: 503 },
    );
  }
}
