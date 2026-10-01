import { db } from "@/lib/db";
import type { ZAssistBot } from "@prisma/client";
import { tgApi, sendMessage, getMe } from "@/lib/telegram";
import {
  completeAssist,
  loadStoredMessages,
  newConversationToken,
  saveConversationMessages,
  MAX_STORED,
  type IncomingMessage,
} from "@/lib/assist-core";
import {
  BONUS_WINDOWS,
  evaluateAll,
  formatSgtNow,
  formatCountdown,
  goldenWindow,
} from "@/lib/windows";
import { SITE_URL, webChatLink } from "@/lib/site";

/**
 * Telegram bridge: visitors pair their OWN bot (token from @BotFather) with
 * Z-Assist and chat with it straight from Telegram.
 *
 * - Pairing: portal shows a pair code -> owner sends "/start <CODE>" to the
 *   bot -> the bot flips to active and the chat is bound.
 * - Answers come from the exact same engine as the web chat
 *   (lib/assist-core) and are stored in the same AssistConversation table,
 *   so a thread started on Telegram continues in the web chat via token.
 * - Free tier: 5 questions per day (resets midnight SGT). When the budget
 *   is spent the bot hands the user their chat token + a one-click link to
 *   continue free & unlimited on the website.
 *
 * Delivery is getUpdates polling (no public webhook in this deployment);
 * instrumentation.ts ticks this every few seconds.
 */

export const DAILY_LIMIT = 5;
export const TYPING_ACTION = "typing";

/* ----------------------------- module state ------------------------------ */

interface PollState {
  /** update offsets per bot (telegram bot user id). */
  offsets: Map<string, number>;
  /** bots whose backlog we deliberately skipped on first sight. */
  seeded: Set<string>;
  /** consecutive getUpdates failures per bot -> exponential-ish backoff. */
  failures: Map<string, { n: number; last: number }>;
}

const g = globalThis as typeof globalThis & { __zAssistTgPoll?: PollState };
const state: PollState = (g.__zAssistTgPoll ??= {
  offsets: new Map(),
  seeded: new Set(),
  failures: new Map(),
});

/** "YYYY-MM-DD" in Singapore time — the daily-question bucket key. */
function sgtToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(now);
}

/* -------------------------------- texts ---------------------------------- */

const HELP_TEXT = `I'm Z-Assist — grounded in the official z.ai docs (docs.z.ai). Ask me about plans, credits, bonus windows, pricing and promos.

Free on Telegram: ${DAILY_LIMIT} questions a day (resets at midnight SGT). Unlimited and free on the website: ${SITE_URL}

Commands:
/status — live bonus-window radar
/token — get the web chat token to continue there
/reset — start a fresh conversation
/help — this list
/stop — unpair and forget this chat`;

function welcomeText(): string {
  return `✅ Paired! Z-Assist now lives in this chat.

Ask anything about z.ai plans, credits, bonus windows & promos — answers come straight from the official docs.

- Free here: ${DAILY_LIMIT} questions a day (resets midnight SGT)
- Unlimited & free: continue on the website ${SITE_URL} — your conversation carries over with a token (/token)

Try /status for the live bonus-window radar, or just ask away.`;
}

function handoffText(token: string | null): string {
  const tokenLine = token
    ? `Your chat token: \`${token}\`
One click: ${webChatLink(token)}

(On the site: open Z-Assist → history icon → "resume with a token" — the whole conversation is already there.)`
    : `Your chat token will appear here once we've exchanged a first message.`;
  return `🎁 That's your ${DAILY_LIMIT} free questions for today!

Good news: you can keep chatting FREE and unlimited on the website — the conversation follows you there.

${tokenLine}

The counter resets at midnight SGT. See you tomorrow! 🌙`;
}

function tokenText(token: string | null): string {
  if (!token) {
    return "No web thread yet — ask your first question and I'll mint a token you can use to continue this chat on the website anytime.";
  }
  return `🔑 Your web chat token: \`${token}\`

Continue this exact conversation, free & unlimited, on the website:
${webChatLink(token)}

(Open Z-Assist there → history icon → resume with a token — works on any device.)`;
}

/* ----------------------------- radar status ------------------------------ */

async function radarStatusText(): Promise<string> {
  const now = Date.now();
  const lines: string[] = [`🟢 GLM Bonus Radar — ${formatSgtNow(now)}`];

  for (const st of evaluateAll(now, BONUS_WINDOWS)) {
    if (st.ended) continue;
    const label = st.def.name;
    if (st.active) {
      const left = st.transitionMs != null ? formatCountdown(st.transitionMs - now) : "—";
      lines.push(`• ${label}: ACTIVE — ${left} left`);
    } else if (st.transitionMs != null) {
      lines.push(`• ${label}: opens in ${formatCountdown(st.transitionMs - now)}`);
    }
  }

  const gw = goldenWindow(now, BONUS_WINDOWS);
  if (gw.status === "open" && gw.countdownMs != null) {
    lines.push(`⭐ Golden window: OPEN — ${formatCountdown(gw.countdownMs)} left (unlimited Flash in ZCode)`);
  } else if (gw.status === "upcoming" && gw.countdownMs != null) {
    lines.push(`⭐ Golden window opens in ${formatCountdown(gw.countdownMs)}`);
  }

  try {
    const last = await db.syncRun.findFirst({ orderBy: { createdAt: "desc" } });
    if (last) {
      const ago = formatCountdown(now - last.createdAt.getTime());
      lines.push(`Docs synced: last check ${ago} ago (${last.status})`);
    }
  } catch {
    /* journal unavailable — skip the line */
  }

  lines.push(`Ask me anything — or open ${SITE_URL} for the full live tracker.`);
  return lines.join("\n");
}

/* --------------------------- telegram helpers ---------------------------- */

/** markdown-lite -> Telegram HTML (bold + inline code), HTML-escaped. */
function mdToTelegramHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
}

/** Telegram hard-caps messages at 4096 chars — split on paragraph edges. */
function chunkReply(text: string, max = 4000): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.4) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.4) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) parts.push(rest);
  return parts;
}

async function reply(botToken: string, chatId: string, text: string): Promise<void> {
  for (const part of chunkReply(text)) {
    const html = mdToTelegramHtml(part);
    let res = await tgApi(botToken, "sendMessage", {
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    if (!res.ok && /can't parse|parse/i.test(res.description ?? "")) {
      // Never lose a reply over formatting — fall back to plain text.
      res = await sendMessage(botToken, chatId, part);
    }
  }
}

/* ------------------------------ the engine ------------------------------- */

interface TgMessage {
  chat: { id: number | string; title?: string; first_name?: string; username?: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
}

type Row = ZAssistBot | null;

async function handleQuestion(row: NonNullable<Row>, msg: TgMessage, question: string): Promise<void> {
  const botToken = row.botToken;
  const chatId = String(msg.chat.id);

  // Strangers on an active bot: keep the pairing private, stay polite.
  if (row.status !== "active" || !row.ownerChatId) {
    await reply(
      botToken,
      chatId,
      row.status === "pending"
        ? "This bot isn't paired yet. Its owner can pair it with Z-Assist on the GLM Bonus Radar portal (" +
            SITE_URL +
            ") — then send /start <code> here."
        : "This bot is paired with Z-Assist in another chat. Its owner can send /stop there to re-pair it here.",
    );
    return;
  }

  const today = sgtToday();
  const used = row.questionsDate === today ? row.questionsToday ?? 0 : 0;

  if (used >= DAILY_LIMIT) {
    await reply(botToken, chatId, handoffText(row.conversationToken));
    return;
  }

  const questionNo = used + 1;
  await tgApi(botToken, "sendChatAction", { chat_id: chatId, action: TYPING_ACTION }).catch(() => null);

  // Same thread as the web chat: load, extend, persist.
  let token = row.conversationToken;
  let history: IncomingMessage[] = [];
  let createdToken = false;
  try {
    if (token) {
      history = await loadStoredMessages(token);
    } else {
      token = newConversationToken();
      createdToken = true;
    }
    const nextHistory = [...history, { role: "user" as const, content: question.slice(0, 2000) }];

    let answer: string;
    try {
      answer = await completeAssist(nextHistory);
    } catch (err) {
      console.error("[zassist-tg] completion failed:", err);
      if (createdToken) token = null; // don't leave an empty thread behind
      await db.zAssistBot
        .update({ where: { id: row.id }, data: { lastError: "model call failed" } })
        .catch(() => null);
      await reply(
        botToken,
        chatId,
        "Z-Assist hit a snag reaching the model — that question didn't count against your daily 5. Please try again in a moment 🙏",
      );
      return;
    }

    const stored = [...nextHistory, { role: "assistant" as const, content: answer }].slice(-MAX_STORED);
    await saveConversationMessages(token, stored, `Telegram · @${row.botUsername}`);
    // This question counted — persist the counter with the thread.
    await db.zAssistBot
      .update({
        where: { id: row.id },
        data: {
          conversationToken: token,
          questionsDate: today,
          questionsToday: questionNo,
          totalReplies: { increment: 1 },
          lastMessageAt: new Date(),
          lastError: null,
        },
      })
      .catch(() => null);

    if (questionNo >= DAILY_LIMIT) {
      answer += `\n\n🔔 That was question ${questionNo}/${DAILY_LIMIT} for today. Next question? Continue FREE on the website:\n${webChatLink(token)}\n(token: \`${token}\`)`;
    } else {
      answer += `\n\n— ${questionNo}/${DAILY_LIMIT} free today · /token to continue on the web`;
    }
    await reply(botToken, chatId, answer);
  } catch (err) {
    console.error("[zassist-tg] handler failed:", err);
    await db.zAssistBot
      .update({ where: { id: row.id }, data: { lastError: err instanceof Error ? err.message : "handler failed" } })
      .catch(() => null);
  }
}

async function handleMessage(row: NonNullable<Row>, msg: TgMessage): Promise<void> {
  const botToken = row.botToken;
  const chatId = String(msg.chat.id);
  const title = msg.chat.title ?? msg.chat.first_name ?? msg.chat.username ?? null;
  const userId = msg.from?.id != null ? String(msg.from.id) : null;
  const text = (msg.text ?? "").trim();
  if (!text) return;

  /* ---- pairing: /start <CODE> ---- */
  if (/^\/start/i.test(text)) {
    const code = text.split(/\s+/)[1]?.toUpperCase();
    if (row.status === "active") {
      await reply(
        botToken,
        chatId,
        row.ownerChatId === chatId
          ? `Already paired with this chat ✅\n\n${HELP_TEXT}`
          : "This bot is already paired with another chat. Its owner can send /stop there first.",
      );
      return;
    }
    if (!code || code !== row.pairCode.toUpperCase()) {
      await reply(
        botToken,
        chatId,
        `Almost! Open the GLM Bonus Radar portal (${SITE_URL}), open Z-Assist → Telegram, paste this bot's token and send me the /start code it shows you.`,
      );
      return;
    }
    await db.zAssistBot.update({
      where: { id: row.id },
      data: {
        status: "active",
        ownerChatId: chatId,
        ownerTitle: title,
        ownerUserId: userId,
        lastError: null,
      },
    });
    await reply(botToken, chatId, welcomeText());
    return;
  }

  /* ---- /stop: unpair and forget ---- */
  if (/^\/stop$/i.test(text)) {
    await db.zAssistBot.delete({ where: { id: row.id } }).catch(() => null);
    state.offsets.delete(row.botId);
    state.seeded.delete(row.botId);
    await reply(
      botToken,
      chatId,
      "Unpaired. The bot token and conversation link are wiped from the portal — send /start with a fresh code to pair again.",
    );
    return;
  }

  /* ---- commands ---- */
  if (/^\/help/i.test(text)) {
    await reply(botToken, chatId, HELP_TEXT);
    return;
  }
  if (/^\/status/i.test(text)) {
    await reply(botToken, chatId, await radarStatusText());
    return;
  }
  if (/^\/token/i.test(text)) {
    await reply(botToken, chatId, tokenText(row.conversationToken));
    return;
  }
  if (/^\/reset/i.test(text)) {
    if (row.conversationToken) {
      await db.assistConversation.deleteMany({ where: { token: row.conversationToken } }).catch(() => null);
      await db.zAssistBot
        .update({ where: { id: row.id }, data: { conversationToken: null } })
        .catch(() => null);
    }
    await reply(botToken, chatId, "🧹 Fresh start! The web thread was cleared too — ask away.");
    return;
  }

  /* ---- everything else: it's a question ---- */
  await handleQuestion(row, msg, text);
}

/* ------------------------------- poll loop ------------------------------- */

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

/**
 * One poll tick across every paired bot. Safe to call frequently:
 * no rows -> immediate no-op; per-bot failures back off to one attempt
 * per 2 minutes; first sight of a bot skips its update backlog.
 */
export async function pollAssistBots(): Promise<void> {
  let rows: NonNullable<Row>[];
  try {
    rows = await db.zAssistBot.findMany();
  } catch {
    return; // table not ready yet
  }
  if (rows.length === 0) return;

  const now = Date.now();
  for (const row of rows) {
    const fail = state.failures.get(row.botId);
    if (fail && fail.n >= 3 && now - fail.last < 120_000) continue; // backing off

    const key = String(row.botId);
    let offset: number | undefined = state.offsets.get(key);

    // First poll after (re)start: jump to the newest update, skip backlog,
    // so old messages are never re-answered.
    if (!state.seeded.has(key)) {
      state.seeded.add(key);
      const skip = await tgApi<TgUpdate[]>(row.botToken, "getUpdates", { offset: -1, timeout: 0 });
      if (skip.ok && Array.isArray(skip.result) && skip.result.length > 0) {
        state.offsets.set(key, skip.result[skip.result.length - 1].update_id + 1);
      }
      offset = state.offsets.get(key);
      if (offset == null && !skip.ok) {
        // invalid token / network — record and back off
        state.failures.set(key, { n: (fail?.n ?? 0) + 1, last: now });
        await db.zAssistBot
          .update({
            where: { id: row.id },
            data: { lastError: skip.description?.slice(0, 180) ?? "getUpdates failed" },
          })
          .catch(() => null);
        continue;
      }
    }

    const res = await tgApi<TgUpdate[]>(row.botToken, "getUpdates", {
      offset,
      timeout: 0,
      allowed_updates: ["message"],
    });

    if (!res.ok) {
      state.failures.set(key, { n: (fail?.n ?? 0) + 1, last: now });
      await db.zAssistBot
        .update({
          where: { id: row.id },
          data: { lastError: res.description?.slice(0, 180) ?? "getUpdates failed" },
        })
        .catch(() => null);
      continue;
    }

    state.failures.delete(key);
    if (row.lastError != null) {
      await db.zAssistBot.update({ where: { id: row.id }, data: { lastError: null } }).catch(() => null);
    }
    if (!Array.isArray(res.result)) continue;

    for (const u of res.result) {
      state.offsets.set(key, Math.max(state.offsets.get(key) ?? 0, u.update_id + 1));
      if (u.message?.text) await handleMessage(row, u.message);
    }
  }
}

/** Used by the pair API to sanity-check a token before storing it. */
export async function verifyBotToken(token: string): Promise<{ ok: boolean; botId?: string; username?: string; error?: string }> {
  const me = await getMe(token);
  if (!me.ok || !me.result?.id) {
    const desc = (me.description ?? "").toLowerCase();
    const error =
      desc === "unauthorized"
        ? "Telegram rejected this token (Unauthorized). Copy a fresh token from @BotFather — /mybots → your bot → API Token."
        : me.description || "Telegram rejected this token (getMe failed).";
    return { ok: false, error };
  }
  return { ok: true, botId: String(me.result.id), username: me.result.username };
}
