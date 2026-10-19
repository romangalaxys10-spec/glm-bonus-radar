import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  completeAssist,
  completeGeneral,
  newConversationToken,
  sanitizeHistory,
  MAX_STORED,
  TOKEN_REGEX,
} from "@/lib/assist-core";
import { authUser, normalizeUserToken, pruneConversations } from "@/lib/assist-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 20; // requests
const RATE_WINDOW_MS = 5 * 60 * 1000; // per 5 minutes per IP

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : null) || "local";
}

/**
 * POST /api/agent/chat — the /agent full-page chat.
 *
 * Body: { token: "ZA-XXXXXX", id?: conversation token, messages: [...],
 *         model?: "assist" | "code" }
 *
 * - "assist" (default) → Z-Assist: docs-grounded z.ai support persona.
 * - "code"             → Z-Code: general-purpose engineering/vision sibling.
 *
 * When `id` is omitted or unknown, a NEW conversation is created server-side
 * (title from the first user message) and its token is returned — that is
 * how "start a new chat" becomes a real, resumable thread. Every thread is
 * owned by the ZA- token, so it resumes on any device.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Rate limit reached — give Z-Assist a breather and try again in a few minutes." },
      { status: 429 },
    );
  }

  let body: { token?: unknown; id?: unknown; messages?: unknown; model?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const userToken = normalizeUserToken(body.token);
  if (!userToken) {
    return NextResponse.json({ error: "A valid ZA- token is required." }, { status: 401 });
  }

  const history = sanitizeHistory(body.messages);
  if (history.length === 0) {
    return NextResponse.json({ error: "Send at least one user message." }, { status: 400 });
  }
  if (history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "The last message must come from the user." }, { status: 400 });
  }

  const model = body.model === "code" ? "code" : "assist";

  try {
    const user = await authUser(userToken);
    if (!user) {
      return NextResponse.json({ error: "Unknown token — register again at /agent." }, { status: 404 });
    }

    const reply =
      model === "code" ? await completeGeneral(history) : await completeAssist(history);

    // Persist under the user's account: extend the owned thread, or create one.
    let conversationToken =
      typeof body.id === "string" && TOKEN_REGEX.test(body.id.trim().toUpperCase())
        ? body.id.trim().toUpperCase()
        : null;
    let title: string | null = null;

    if (conversationToken) {
      const existing = await db.assistConversation.findUnique({ where: { token: conversationToken } });
      if (!existing || existing.userToken !== userToken) {
        // Not ours (or legacy) — silently start a fresh owned thread instead of failing.
        conversationToken = null;
      }
    }

    const merged = [...history, { role: "assistant" as const, content: reply }].slice(-MAX_STORED);

    if (conversationToken) {
      await db.assistConversation.update({
        where: { token: conversationToken },
        data: { messages: JSON.stringify(merged) },
      });
    } else {
      conversationToken = newConversationToken();
      title = history.find((m) => m.role === "user")?.content.slice(0, 60) ?? "New chat";
      await db.assistConversation.create({
        data: {
          token: conversationToken,
          userToken,
          title,
          messages: JSON.stringify(merged),
        },
      });
      void pruneConversations(userToken).catch(() => undefined);
    }

    return NextResponse.json({ reply, id: conversationToken, title, model });
  } catch (err) {
    console.error("[agent/chat] completion failed:", err);
    return NextResponse.json(
      {
        error:
          "Z-Assist hit a snag reaching the model. Please try again in a moment — or browse the docs at docs.z.ai meanwhile.",
      },
      { status: 502 },
    );
  }
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
