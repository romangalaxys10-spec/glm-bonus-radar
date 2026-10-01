import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_PERSONA,
  resolvePersona,
  findKeyRow,
  extractApiKey,
  rateLimited,
  normalizeChat,
  mirrorThread,
  touchKey,
  sseHeaders,
  chunkReply,
  anthropicMessagePayload,
  estimateTokens,
} from "@/lib/endpoint";
import { completeAssist, completeGeneral } from "@/lib/assist-core";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anthropic-compatible Messages API — the dialect Claude Code speaks.
 * Point Claude Code at this portal with:
 *   ANTHROPIC_BASE_URL=<portal>/api/endpoint
 *   ANTHROPIC_AUTH_TOKEN=<endpoint key>
 * and it will POST /api/endpoint/v1/messages with `x-api-key` or Bearer auth.
 *
 * Same shared Z-Assist brain as the web chat; the newest turn is mirrored
 * into the key's AssistConversation thread (web-continuable via token).
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function anthError(status: number, type: string, message: string) {
  return Response.json({ type: "error", error: { type, message } }, { status });
}

export async function POST(req: NextRequest) {
  const keyRow = await findKeyRow(extractApiKey(req)).catch(() => null);
  if (!keyRow) {
    return anthError(401, "authentication_error", "Invalid API key — grab yours from the secret /endpoint section.");
  }

  if (rateLimited(`endpoint-chat:${keyRow.id}`, 60, 5 * 60 * 1000)) {
    return anthError(429, "rate_limit_error", "Rate limit reached (60 requests / 5 min). Give Z-Assist a breather.");
  }

  let body: { model?: unknown; system?: unknown; messages?: unknown; stream?: unknown; max_tokens?: unknown };
  try {
    body = await req.json();
  } catch {
    return anthError(400, "invalid_request_error", "Invalid JSON body.");
  }

  const chat = normalizeChat({ messages: body.messages, system: body.system });
  if (chat.history.length === 0 || !chat.lastUser) {
    return anthError(400, "invalid_request_error", "Send at least one user message in `messages`.");
  }

  const requestedModel = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 64) : DEFAULT_PERSONA;
  const persona = resolvePersona(requestedModel);
  const id = `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const promptTokens = estimateTokens(chat.history.map((m) => m.content).join("\n") + chat.toolSystem);

  try {
    const reply =
      persona === "z-code"
        ? await completeGeneral(chat.history, { extraSystem: chat.toolSystem, images: chat.images })
        : await completeAssist(chat.history, { extraSystem: chat.toolSystem });

    const mirrored = await mirrorThread(keyRow.conversationToken, { lastUser: chat.lastUser, reply }).catch(() => null);
    if (mirrored && mirrored !== keyRow.conversationToken) {
      await db.endpointKey
        .update({ where: { id: keyRow.id }, data: { conversationToken: mirrored } })
        .catch(() => undefined);
    }
    await touchKey(keyRow.id, persona).catch(() => undefined);

    if (body.stream === true) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const event = (name: string, data: unknown) =>
            controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
          try {
            event("message_start", {
              type: "message_start",
              message: {
                id,
                type: "message",
                role: "assistant",
                model: requestedModel,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: promptTokens, output_tokens: 0 },
              },
            });
            event("content_block_start", {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            });
            await sleep(30);
            for (const piece of chunkReply(reply)) {
              event("content_block_delta", {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: piece },
              });
              await sleep(15);
            }
            event("content_block_stop", { type: "content_block_stop", index: 0 });
            event("message_delta", {
              type: "message_delta",
              delta: { stop_reason: "end_turn", stop_sequence: null },
              usage: { output_tokens: estimateTokens(reply) },
            });
            event("message_stop", { type: "message_stop" });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, { headers: sseHeaders() });
    }

    return Response.json(anthropicMessagePayload(id, requestedModel, reply, promptTokens));
  } catch (err) {
    console.error("[endpoint:messages] completion failed:", err);
    return anthError(502, "api_error", "Z-Assist hit a snag reaching the model. Try again in a moment.");
  }
}
