import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  completeAssist,
  newConversationToken,
  sanitizeHistory,
  MAX_STORED,
  TOKEN_REGEX,
  type IncomingMessage,
} from "@/lib/assist-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 20; // requests
const RATE_WINDOW_MS = 5 * 60 * 1000; // per 5 minutes per IP

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
        .filter((t) => TOKEN_REGEX.test(t))
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
      if (!TOKEN_REGEX.test(clean)) {
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
    const reply = await completeAssist(history);

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
      conversationToken = newConversationToken();
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
