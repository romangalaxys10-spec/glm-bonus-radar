import { NextRequest } from "next/server";
import { findKeyRow, extractApiKey, estimateTokens, normalizeChat } from "@/lib/endpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anthropic-compatible token counting — Claude Code calls this before every
 * completion. Returns the same shape as the official API (estimate).
 */
export async function POST(req: NextRequest) {
  const keyRow = await findKeyRow(extractApiKey(req)).catch(() => null);
  if (!keyRow) {
    return Response.json(
      { type: "error", error: { type: "authentication_error", message: "Invalid API key." } },
      { status: 401 },
    );
  }

  let body: { messages?: unknown; system?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { type: "error", error: { type: "invalid_request_error", message: "Invalid JSON body." } },
      { status: 400 },
    );
  }

  const chat = normalizeChat({ messages: body.messages, system: body.system });
  const chars = chat.history.map((m) => m.content).join("\n") + chat.toolSystem;
  return Response.json({ input_tokens: estimateTokens(chars) });
}
