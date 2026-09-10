import { db } from "@/lib/db";

/**
 * Telegram alert channel — server side.
 *
 * Design notes:
 * - The bot token (from @BotFather) is stored in the SiteData key-value table
 *   under "telegram-bot" — no dedicated schema needed.
 * - There is no public webhook URL in this deployment, so incoming updates
 *   are read via getUpdates long-ish polling from the instrumentation
 *   scheduler (single process; fine for a community tracker).
 * - Outgoing alerts go through broadcast(): every linked chat gets the
 *   message when its per-category prefs allow it.
 */

export const TELEGRAM_BOT_KEY = "telegram-bot";

export type TelegramPrefs = {
  golden: boolean;
  windows: boolean;
  announcements: boolean;
};

export const DEFAULT_TG_PREFS: TelegramPrefs = {
  golden: true,
  windows: true,
  announcements: true,
};

interface TokenPayload {
  token: string;
  username?: string;
}

/* ------------------------------ token ----------------------------------- */

let cachedToken: { value: TokenPayload | null; at: number } | null = null;
const TOKEN_TTL_MS = 60_000;

export async function getBotConfig(): Promise<TokenPayload | null> {
  if (cachedToken && Date.now() - cachedToken.at < TOKEN_TTL_MS) return cachedToken.value;
  let value: TokenPayload | null = null;
  try {
    const row = await db.siteData.findUnique({ where: { key: TELEGRAM_BOT_KEY } });
    if (row) {
      const parsed = JSON.parse(row.payload) as TokenPayload;
      if (parsed && typeof parsed.token === "string" && parsed.token.length > 20) value = parsed;
    }
  } catch {
    value = null;
  }
  cachedToken = { value, at: Date.now() };
  return value;
}

export async function setBotConfig(next: TokenPayload): Promise<void> {
  await db.siteData.upsert({
    where: { key: TELEGRAM_BOT_KEY },
    create: { key: TELEGRAM_BOT_KEY, payload: JSON.stringify(next) },
    update: { payload: JSON.stringify(next) },
  });
  cachedToken = { value: next, at: Date.now() };
}

export async function clearBotConfig(): Promise<void> {
  await db.siteData.deleteMany({ where: { key: TELEGRAM_BOT_KEY } });
  cachedToken = { value: null, at: Date.now() };
}

/* ------------------------------- API ------------------------------------ */

export interface TgApiResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export async function tgApi<T>(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 12_000,
): Promise<TgApiResult<T>> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return (await res.json()) as TgApiResult<T>;
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : "network error" };
  }
}

export interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
}

export async function getMe(token: string): Promise<TgApiResult<TgUser>> {
  return tgApi<TgUser>(token, "getMe");
}

export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<TgApiResult<unknown>> {
  return tgApi<unknown>(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}

/* --------------------------- pending links ------------------------------ */

interface PendingLink {
  createdAt: number;
}
const LINK_TTL_MS = 15 * 60_000;

const g = globalThis as typeof globalThis & {
  __tgPendingLinks?: Map<string, PendingLink>;
  __tgOffset?: number;
};
const pending = (g.__tgPendingLinks ??= new Map());

export function createLinkCode(): string {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  pending.set(code, { createdAt: Date.now() });
  // opportunistic cleanup
  for (const [k, v] of pending) if (Date.now() - v.createdAt > LINK_TTL_MS) pending.delete(k);
  return code;
}

export function consumeLinkCode(code: string): boolean {
  const hit = pending.get(code);
  if (!hit || Date.now() - hit.createdAt > LINK_TTL_MS) return false;
  pending.delete(code);
  return true;
}

export function peekLinkCode(code: string): boolean {
  const hit = pending.get(code);
  return hit != null && Date.now() - hit.createdAt <= LINK_TTL_MS;
}

/* ------------------------------ chats ----------------------------------- */

export function parsePrefs(raw: string | null | undefined): TelegramPrefs {
  try {
    const parsed = JSON.parse(raw ?? "") as Partial<TelegramPrefs>;
    return {
      golden: parsed.golden !== false,
      windows: parsed.windows !== false,
      announcements: parsed.announcements !== false,
    };
  } catch {
    return { ...DEFAULT_TG_PREFS };
  }
}

/** Sends text to every linked chat opted into `category`. Returns delivered count. */
export async function broadcast(category: keyof TelegramPrefs, text: string): Promise<number> {
  const cfg = await getBotConfig();
  if (!cfg) return 0;
  let chats: Array<{ chatId: string; prefs: string }> = [];
  try {
    chats = await db.telegramChat.findMany({ select: { chatId: true, prefs: true } });
  } catch {
    return 0;
  }
  let delivered = 0;
  for (const chat of chats) {
    if (!parsePrefs(chat.prefs)[category]) continue;
    const res = await sendMessage(cfg.token, chat.chatId, text);
    if (res.ok) delivered += 1;
  }
  return delivered;
}

/* --------------------------- update polling ----------------------------- */

interface TgUpdate {
  update_id: number;
  message?: {
    chat: { id: number | string; title?: string; first_name?: string; username?: string };
    text?: string;
  };
}

/**
 * One poll tick. Handles:
 *   /start <CODE>  → links the chat to a pending web-generated code
 *   /stop          → unlinks the chat
 *   anything else  → short help text
 */
export async function pollTelegramUpdates(): Promise<void> {
  const cfg = await getBotConfig();
  if (!cfg) return;
  const res = await tgApi<TgUpdate[]>(cfg.token, "getUpdates", {
    offset: g.__tgOffset ?? undefined,
    timeout: 0,
    allowed_updates: ["message"],
  });
  if (!res.ok || !Array.isArray(res.result)) return;
  for (const u of res.result) {
    g.__tgOffset = Math.max(g.__tgOffset ?? 0, u.update_id + 1);
    const msg = u.message;
    if (!msg?.text) continue;
    const chatId = String(msg.chat.id);
    const title = msg.chat.title ?? msg.chat.first_name ?? msg.chat.username ?? null;
    const text = msg.text.trim();

    if (/^\/start/i.test(text)) {
      const code = text.split(/\s+/)[1]?.toUpperCase();
      if (code && consumeLinkCode(code)) {
        await db.telegramChat.upsert({
          where: { chatId },
          create: { chatId, title },
          update: { title },
        });
        await sendMessage(
          cfg.token,
          chatId,
          "Linked to GLM Bonus Radar. You will get alerts when the golden window opens, bonus windows flip and new z.ai announcements land. Manage categories on the radar page, or send /stop to unsubscribe.",
        );
      } else {
        await sendMessage(
          cfg.token,
          chatId,
          "To link this chat, open the GLM Bonus Radar notifications panel, press Connect and open the link it gives you (it includes this /start code).",
        );
      }
      continue;
    }

    if (/^\/stop$/i.test(text)) {
      await db.telegramChat.deleteMany({ where: { chatId } });
      await sendMessage(cfg.token, chatId, "Unlinked. You will no longer receive GLM Bonus Radar alerts here.");
      continue;
    }

    await sendMessage(
      cfg.token,
      chatId,
      "GLM Bonus Radar bot: alerts arrive automatically once this chat is linked from the radar's notifications panel. Send /stop to unsubscribe.",
    );
  }
}
