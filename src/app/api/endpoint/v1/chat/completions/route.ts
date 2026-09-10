import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import {
  MODEL_ID,
  findKeyRow,
  extractApiKey,
  rateLimited,
  normalizeChat,
  mirrorThread,
  touchKey,
  sseHeaders,
  chunkReply,
  openAiChunkBase,
  openAiCompletionPayload,
  estimateTokens,
} from "@/lib/endpoint";
import { completeAssist } from "@/lib/assist-core";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OpenAI-compatible chat completions — the dialect zcode & most IDE tools
 * speak. POST /api/endpoint/v1/chat/completions with
 * `Authorization: Bearer <endpoint key>`.
 *
 * Every request is answered by the shared Z-Assist brain (docs-grounded);
 * the newest turn is mirrored into the key's AssistConversation thread so
 * it can be continued free on the web chat.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function oaiError(status: number, message: string, type = "invalid_request_error") {
  return Response.json({ error: { message, type, param: null, code: null } }, { status });
}

export async function POST(req: NextRequest) {
  const keyRow = await findKeyRow(extractApiKey(req)).catch(() => null);
  if (!keyRow) {
    return oaiError(401, "Invalid API key — grab yours from the secret /endpoint section.", "authentication_error");
  }

  if (rateLimited(`endpoint-chat:${keyRow.id}`, 60, 5 * 60 * 1000)) {
    return oaiError(429, "Rate limit reached (60 requests / 5 min). Give Z-Assist a breather.", "rate_limit_error");
  }

  let body: { model?: unknown; messages?: unknown; stream?: unknown };
  try {
    body = await req.json();
  } catch {
    return oaiError(400, "Invalid JSON body.");
  }

  const chat = normalizeChat({ messages: body.messages });
  if (chat.history.length === 0 || !chat.lastUser) {
    return oaiError(400, "Send at least one user message in `messages`.");
  }

  const requestedModel = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 64) : MODEL_ID;
  const id = `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const promptTokens = estimateTokens(chat.history.map((m) => m.content).join("\n") + chat.toolSystem);

  try {
    const reply = await completeAssist(chat.history, { extraSystem: chat.toolSystem });

    const mirrored = await mirrorThread(keyRow.conversationToken, { lastUser: chat.lastUser, reply }).catch(() => null);
    if (mirrored && mirrored !== keyRow.conversationToken) {
      await db.endpointKey
        .update({ where: { id: keyRow.id }, data: { conversationToken: mirrored } })
        .catch(() => undefined);
    }
    await touchKey(keyRow.id, requestedModel).catch(() => undefined);

    if (body.stream === true) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (obj: unknown) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          try {
            // Leading role delta keeps strict OpenAI clients happy.
            send({
              ...openAiChunkBase(id, requestedModel),
              choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
            });
            await sleep(30);
            for (const piece of chunkReply(reply)) {
              send({
                ...openAiChunkBase(id, requestedModel),
                choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
              });
              await sleep(15);
            }
            send({
              ...openAiChunkBase(id, requestedModel),
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, { headers: sseHeaders() });
    }

    return Response.json(openAiCompletionPayload(id, requestedModel, reply, promptTokens));
  } catch (err) {
    console.error("[endpoint:chat/completions] completion failed:", err);
    return oaiError(502, "Z-Assist hit a snag reaching the model. Try again in a moment.", "api_error");
  }
}
