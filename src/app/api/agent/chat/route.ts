import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  buildAssistMessages,
  buildCodeMessages,
  completeAssist,
  completeGeneral,
  llmLadderStream,
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

const MODEL_ERROR =
  "Z-Assist hit a snag reaching the model. Please try again in a moment — or browse the docs at docs.z.ai meanwhile.";

/**
 * POST /api/agent/chat — the /agent full-page chat.
 *
 * Body: { token: "ZA-XXXXXX", id?: conversation token, messages: [...],
 *         model?: "assist" | "code", stream?: boolean }
 *
 * - "assist" (default) → Z-Assist: docs-grounded z.ai support persona.
 * - "code"             → Z-Code: general-purpose engineering/vision sibling.
 * - stream: true       → SSE reply ({start|delta|done|error} events) instead
 *                        of one blocking JSON payload, so words land as the
 *                        model generates them.
 *
 * Every completion runs through the multi-model streaming ladder
 * (assist-core llmLadderStream): a slow/queued/rate-limited rung is skipped
 * for the next model instead of leaving the user hanging.
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

  let body: { token?: unknown; id?: unknown; messages?: unknown; model?: unknown; stream?: unknown };
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
  const wantsStream = body.stream === true;

  try {
    const user = await authUser(userToken);
    if (!user) {
      return NextResponse.json({ error: "Unknown token — register again at /agent." }, { status: 404 });
    }

    /* ---------------------------- streaming mode --------------------------- */
    if (wantsStream) {
      const encoder = new TextEncoder();
      const sse = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            const messages =
              model === "code" ? buildCodeMessages(history) : await buildAssistMessages(history);
            controller.enqueue(sse({ type: "start" }));

            const gen = llmLadderStream(messages);
            let full = "";
            let next = await gen.next();
            while (!next.done) {
              full += next.value;
              controller.enqueue(sse({ type: "delta", text: next.value }));
              next = await gen.next();
            }
            const meta = next.value;
            if (!full.trim()) throw new Error("Empty completion");

            const finalText = meta.truncated
              ? `${full}\n\n_(reply cut short by a connection hiccup — send again to continue)_`
              : full;
            const saved = await persistReply(userToken, body, history, finalText, model);
            controller.enqueue(
              sse({
                type: "done",
                ...saved,
                text: finalText,
                model,
                via: meta.via,
                truncated: meta.truncated,
              }),
            );
          } catch (err) {
            console.error("[agent/chat] stream failed:", err);
            controller.enqueue(sse({ type: "error", error: MODEL_ERROR }));
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        },
      });
    }

    /* ------------------------- blocking JSON mode -------------------------- */
    const reply =
      model === "code" ? await completeGeneral(history) : await completeAssist(history);
    const saved = await persistReply(userToken, body, history, reply, model);
    return NextResponse.json({ reply, ...saved, model });
  } catch (err) {
    console.error("[agent/chat] completion failed:", err);
    return NextResponse.json({ error: MODEL_ERROR }, { status: 502 });
  }
}

/** Extends the user's owned thread (or creates one) with the final reply. */
async function persistReply(
  userToken: string,
  body: { id?: unknown },
  history: IncomingMessageLike[],
  reply: string,
  model: "assist" | "code",
): Promise<{ id: string; title: string | null }> {
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

  return { id: conversationToken, title };
}

type IncomingMessageLike = { role: "user" | "assistant"; content: string };
