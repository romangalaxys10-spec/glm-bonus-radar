import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { getZai } from "@/lib/zai";
import { KNOWLEDGE, KNOWLEDGE_UPDATED } from "@/lib/assist-knowledge";
import { getDocsSnapshot } from "@/lib/docs-sync";
import { INVITE_CODE, INVITE_URL } from "@/lib/invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HISTORY = 16; // messages sent to the model (user + assistant)
const MAX_STORED = 60; // messages kept in the stored conversation
const MAX_CHARS = 2000; // per-message cap
const RATE_LIMIT = 20; // requests
const RATE_WINDOW_MS = 5 * 60 * 1000; // per 5 minutes per IP
const TOKEN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : null) || "local";
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

/** Human-friendly resume token, e.g. "K7M2Q9ZX". */
function newToken(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return out;
}

/** Peak hours: Mon–Fri 14:00–18:00 Singapore time (UTC+8). Weekends are always off-peak. */
function singaporeClock(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const hour = parseInt(get("hour"), 10);
  const minute = get("minute");
  const isWeekend = weekday === "Saturday" || weekday === "Sunday";
  const isPeak = !isWeekend && hour >= 14 && hour < 18;
  return {
    stamp: `${weekday} ${String(hour).padStart(2, "0")}:${minute} SGT (UTC+8)`,
    isPeak,
    phase: isPeak ? "PEAK (1x credit rate)" : "OFF-PEAK (0.5x credit rate)",
    flashWindow:
      hour >= 23 || hour < 9
        ? "ACTIVE (23:00–09:00 SGT daily)"
        : "not active right now (returns 23:00 SGT)",
  };
}

async function systemPrompt(now = new Date()): Promise<string> {
  const sg = singaporeClock(now);
  let latestBlock = "";
  try {
    const snapshot = await getDocsSnapshot();
    if (snapshot?.prompt) {
      latestBlock = `

--- LATEST OFFICIAL DOCS (auto-fetched ${snapshot.fetchedAt} by the hourly sync — on any conflict with the curated base above, THESE docs win) ---

${snapshot.prompt.slice(0, 48_000)}
=== END LATEST OFFICIAL DOCS ===`;
    }
  } catch {
    /* snapshot unavailable — curated base still applies */
  }

  return `You are Z-Assist, the friendly official-docs assistant for the GLM Bonus Radar portal (a community tracker for z.ai bonus windows, peak rates and discounts).

TODAY'S CONTEXT (authoritative, use it for any "now / today / right now" question):
- Current time: ${sg.stamp}
- Current credit phase: ${sg.phase} — peak hours are Mon–Fri 14:00–18:00 Singapore time; weekends are off-peak all day.
- GLM-5.3-Flash campaign window (23:00–09:00 SGT daily, until Sep 20 2026): ${sg.flashWindow}
- Today's date: ${now.toISOString().slice(0, 10)}. Curated knowledge base updated: ${KNOWLEDGE_UPDATED}. Official docs are re-fetched hourly and included below when newer.

PERSONALITY
- Warm, upbeat and genuinely helpful — like a knowledgeable teammate, not a corporate bot. A light emoji or one exclamation is fine, but stay professional.
- Concise by default: 2–6 short paragraphs or up to ~8 bullet points. Lead with the direct answer, then add the useful details.
- Format with lightweight markdown: **bold** for key numbers/dates, \`code\` for URLs/commands/config values, "- " bullets for lists. Keep lines short so they read well in a chat bubble.

GROUNDING RULES (critical)
- Answer ONLY from the doc material below (curated base + latest fetched docs) plus the today's-context block. Everything comes from the official z.ai documentation (docs.z.ai).
- If something is not covered there (e.g. account-specific billing, outages, legal questions), say so honestly and point to the right official page or support channel instead of guessing.
- Never invent prices, dates, quotas, model names or URLs. If numbers differ between plan generations (legacy vs credits-based), say which applies to whom. If the latest fetched docs contradict the curated base, follow the latest docs.
- Times are Singapore time (UTC+8) unless stated otherwise — mention that when giving a time.
- When the user asks about discounts, subscribing, the invite code, or saving money, naturally share the community invite code ${INVITE_CODE} and link ${INVITE_URL} (10% instant discount on a first GLM Coding subscription for eligible new users).
- End answers that involve schedule/price claims with a tiny source line like "Source: docs.z.ai/devpack/overview" when a specific page applies.

--- CURATED KNOWLEDGE BASE (from docs.z.ai, updated ${KNOWLEDGE_UPDATED}) ---

${KNOWLEDGE}${latestBlock}`;
}

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

function sanitizeHistory(raw: unknown): IncomingMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is IncomingMessage =>
        !!m &&
        typeof m === "object" &&
        ((m as IncomingMessage).role === "user" || (m as IncomingMessage).role === "assistant") &&
        typeof (m as IncomingMessage).content === "string",
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
    .slice(-MAX_HISTORY);
}

/* ------------------------- conversation storage ------------------------- */

async function readConversation(token: string) {
  const row = await db.assistConversation.findUnique({ where: { token } });
  if (!row) return null;
  let messages: IncomingMessage[] = [];
  try {
    messages = JSON.parse(row.messages) as IncomingMessage[];
  } catch {
    messages = [];
  }
  return {
    token: row.token,
    title: row.title,
    messages,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/* --------------------------------- GET ---------------------------------- */

/**
 * GET /api/assist                 -> 400 (need token or tokens)
 * GET /api/assist?token=ABC       -> full conversation
 * GET /api/assist?tokens=A,B,C    -> summaries for the history list
 */
export async function GET(req: NextRequest) {
  const tokensParam = req.nextUrl.searchParams.get("tokens");
  const token = req.nextUrl.searchParams.get("token");

  try {
    if (tokensParam != null) {
      const tokens = tokensParam
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter((t) => /^[A-Z0-9]{6,12}$/.test(t))
        .slice(0, 12);
      const rows = await db.assistConversation.findMany({
        where: { token: { in: tokens } },
        orderBy: { updatedAt: "desc" },
      });
      return NextResponse.json({
        conversations: rows.map((r) => {
          let count = 0;
          try {
            count = (JSON.parse(r.messages) as unknown[]).length;
          } catch {
            count = 0;
          }
          return {
            token: r.token,
            title: r.title,
            count,
            updatedAt: r.updatedAt.toISOString(),
          };
        }),
      });
    }

    if (token) {
      const clean = token.trim().toUpperCase();
      if (!/^[A-Z0-9]{6,12}$/.test(clean)) {
        return NextResponse.json({ error: "Invalid token format." }, { status: 400 });
      }
      const conversation = await readConversation(clean);
      if (!conversation) {
        return NextResponse.json({ error: "No conversation found for that token." }, { status: 404 });
      }
      return NextResponse.json(conversation);
    }

    return NextResponse.json({ error: "Provide ?token= or ?tokens=." }, { status: 400 });
  } catch (err) {
    console.error("[assist] GET failed:", err);
    return NextResponse.json({ error: "Could not load conversations." }, { status: 500 });
  }
}

/* --------------------------------- POST --------------------------------- */

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Rate limit reached — give Z-Assist a breather and try again in a few minutes." },
      { status: 429 },
    );
  }

  let body: { messages?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const history = sanitizeHistory(body.messages);
  if (history.length === 0) {
    return NextResponse.json({ error: "Send at least one user message." }, { status: 400 });
  }
  if (history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "The last message must come from the user." }, { status: 400 });
  }

  const requestedToken =
    typeof body.token === "string" && /^[A-Za-z0-9]{6,12}$/.test(body.token.trim())
      ? body.token.trim().toUpperCase()
      : null;

  try {
    const zai = await getZai();
    const completion = await zai.chat.completions.create({
      messages: [{ role: "assistant", content: await systemPrompt() }, ...history.slice(-MAX_HISTORY)],
      thinking: { type: "disabled" },
    });

    const reply = completion.choices[0]?.message?.content?.trim();
    if (!reply) {
      throw new Error("Empty completion");
    }

    // Persist/extend the conversation, issuing a resume token when needed.
    let conversationToken = requestedToken;
    if (conversationToken) {
      const existing = await db.assistConversation.findUnique({ where: { token: conversationToken } });
      if (existing) {
        // The client thread is authoritative — store it plus the new reply.
        const merged = [...history, { role: "assistant" as const, content: reply }].slice(-MAX_STORED);
        await db.assistConversation.update({
          where: { token: conversationToken },
          data: { messages: JSON.stringify(merged) },
        });
      } else {
        // Unknown token — issue a fresh one rather than failing the chat.
        conversationToken = null;
      }
    }
    if (!conversationToken) {
      conversationToken = newToken();
      const firstUser = history.find((m) => m.role === "user")?.content ?? "chat";
      await db.assistConversation.create({
        data: {
          token: conversationToken,
          title: firstUser.slice(0, 60),
          messages: JSON.stringify([...history.slice(-MAX_STORED), { role: "assistant", content: reply }]),
        },
      });
    }

    return NextResponse.json({ reply, token: conversationToken });
  } catch (err) {
    console.error("[assist] completion failed:", err);
    return NextResponse.json(
      {
        error:
          "Z-Assist hit a snag reaching the model. Please try again in a moment — or browse the docs at docs.z.ai meanwhile.",
      },
      { status: 502 },
    );
  }
}
