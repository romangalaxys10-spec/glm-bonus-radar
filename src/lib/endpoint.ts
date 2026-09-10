import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import {
  MAX_STORED,
  newConversationToken,
  loadStoredMessages,
  saveConversationMessages,
  type IncomingMessage,
} from "@/lib/assist-core";

/**
 * Secret IDE endpoint (/endpoint) — lets tools like zcode and Claude Code
 * chat with Z-Assist through OpenAI- and Anthropic-compatible routes.
 *
 * Access model:
 *  - The /endpoint page is gated by a shared password (ENDPOINT_PASSWORD).
 *    Unlocking issues (or returns) the singleton secret API key.
 *  - IDE tools authenticate with that key (Authorization: Bearer or x-api-key)
 *    against /api/endpoint/v1/*.
 *  - Every chat call is answered by the same Z-Assist brain as the web chat
 *    and mirrors the thread into a shared AssistConversation so it can be
 *    continued on the web with the resume token.
 */

export const ENDPOINT_KEY_PREFIX = "za_sk_";

/**
 * The two personas served on the IDE endpoint:
 *  - z-assist: docs-grounded, z.ai support ONLY (portal knowledge base +
 *    hourly docs snapshot; refuses/inherits pointers for everything else)
 *  - z-code:   general all-capable assistant — vision, coding, agentic
 *              planning, general knowledge, all in one
 */
export type ModelPersona = "z-assist" | "z-code";
export const MODEL_IDS: ModelPersona[] = ["z-assist", "z-code"];
export const DEFAULT_PERSONA: ModelPersona = "z-assist";

/** Maps any requested model string to its persona ("…code…" → z-code). */
export function resolvePersona(raw: string | null | undefined): ModelPersona {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("code")) return "z-code";
  return DEFAULT_PERSONA;
}

export function endpointPassword(): string {
  return process.env.ENDPOINT_PASSWORD ?? "q1w2e3r4";
}

/** Constant-time password check. */
export function passwordMatches(input: unknown): boolean {
  if (typeof input !== "string" || input.length === 0) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(endpointPassword()).digest();
  return timingSafeEqual(a, b);
}

/** URL-safe 43-char random secret, prefixed so it is recognizable in env files. */
export function mintEndpointKey(): string {
  return ENDPOINT_KEY_PREFIX + randomBytes(32).toString("base64url");
}

/* ------------------------------ key storage ------------------------------ */

/** Singleton row: unlocking always returns the same key until regenerated. */
export async function getOrCreateEndpointKey() {
  const existing = await db.endpointKey.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return db.endpointKey.create({
    data: { key: mintEndpointKey(), label: "IDE tools" },
  });
}

export async function rotateEndpointKey() {
  const existing = await db.endpointKey.findFirst({ orderBy: { createdAt: "asc" } });
  if (!existing) return getOrCreateEndpointKey();
  return db.endpointKey.update({
    where: { id: existing.id },
    data: { key: mintEndpointKey() },
  });
}

export async function findKeyRow(raw: string | null) {
  if (!raw) return null;
  const clean = raw.trim();
  if (!clean.startsWith(ENDPOINT_KEY_PREFIX) || clean.length < 16 || clean.length > 128) return null;
  return db.endpointKey.findUnique({ where: { key: clean } });
}

/** Accepts `Authorization: Bearer <key>` or `x-api-key: <key>` (either style). */
export function extractApiKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const xKey = req.headers.get("x-api-key");
  if (xKey) return xKey.trim();
  return null;
}

export async function touchKey(id: string, model: string) {
  await db.endpointKey.update({
    where: { id },
    data: { callCount: { increment: 1 }, lastUsedAt: new Date(), lastModel: model },
  });
}

/* ------------------------------ rate limiting ---------------------------- */

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Simple fixed-window limiter (per bucket key). */
export function rateLimited(bucket: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(bucket);
  if (!b || now > b.resetAt) {
    buckets.set(bucket, { count: 1, resetAt: now + windowMs });
    return false;
  }
  b.count += 1;
  return b.count > limit;
}

export function clientIp(req: Request): string {
  const fwd = (req as unknown as { headers: Headers }).headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : null) || "local";
}

/* --------------------------- message normalization ----------------------- */

export const MAX_TOOL_MESSAGE_CHARS = 8000;
const SYSTEM_INJECT_CAP = 1200;
const MAX_IMAGES = 4;
const MAX_IMAGE_CHARS = 5_000_000; // ~3.7 MB binary per image

type RawContent = string | Array<Record<string, unknown>> | null | undefined;

function flattenContent(content: RawContent): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

/** Pulls data-URI images out of either dialect's content parts. */
function extractImages(content: RawContent, images: string[]): void {
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (!part || typeof part !== "object" || images.length >= MAX_IMAGES) return;
    const type = (part as { type?: unknown }).type;
    if (type === "image_url") {
      const url = (part as { image_url?: { url?: unknown } }).image_url?.url;
      if (typeof url === "string" && /^(data:image|https:\/\/)/.test(url) && url.length <= MAX_IMAGE_CHARS) {
        images.push(url);
      }
    } else if (type === "image") {
      const source = (part as { source?: Record<string, unknown> }).source;
      if (source && source.type === "base64" && typeof source.data === "string" && typeof source.media_type === "string") {
        const uri = `data:${source.media_type};base64,${source.data}`;
        if (uri.length <= MAX_IMAGE_CHARS) images.push(uri);
      } else if (source && source.type === "url" && typeof source.url === "string") {
        const uri = source.url;
        if (/^(data:image|https:\/\/)/.test(uri) && uri.length <= MAX_IMAGE_CHARS) images.push(uri);
      }
    }
  }
}

export interface NormalizedChat {
  history: IncomingMessage[];
  /** Trimmed client system prompt(s), merged — passed to the brain as tool context. */
  toolSystem: string;
  /** Last user message (used for the mirrored thread + title). */
  lastUser: string | null;
  /** Data-URI images extracted from OpenAI/Anthropic content parts (vision). */
  images: string[];
}

/**
 * Normalizes either API dialect (OpenAI `messages` or Anthropic `messages`
 * + `system`) into the shared Z-Assist history format. The Z-Assist
 * persona/grounding always stays primary; the calling tool's system prompt
 * is carried along as a small, clearly-labeled context block.
 */
export function normalizeChat(input: {
  messages: unknown;
  system?: unknown;
}): NormalizedChat {
  const raw = Array.isArray(input.messages) ? input.messages : [];
  const history: IncomingMessage[] = [];
  const images: string[] = [];

  const systemParts: string[] = [];
  if (typeof input.system === "string" && input.system.trim()) {
    systemParts.push(input.system);
  } else if (Array.isArray(input.system)) {
    const merged = flattenContent(input.system as Array<{ type?: string; text?: unknown }>);
    if (merged) systemParts.push(merged);
  }

  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: unknown }).role;
    const content = flattenContent((m as { content?: RawContent }).content);
    if (!content) continue;
    if (role === "system" || role === "developer") {
      systemParts.push(content);
    } else if (role === "user" || role === "assistant") {
      extractImages((m as { content?: RawContent }).content, images);
      history.push({ role, content: content.slice(0, MAX_TOOL_MESSAGE_CHARS) });
    }
    // tool / function roles: skipped — Z-Assist is a pure chat persona here.
  }

  const toolSystem = systemParts
    .join("\n\n")
    .replace(/\s+\n/g, "\n")
    .slice(0, SYSTEM_INJECT_CAP)
    .trim();

  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? null;
  return { history, toolSystem, lastUser, images };
}

/* ------------------------- mirrored web conversation --------------------- */

/**
 * Appends the latest turn of the IDE thread to a shared AssistConversation
 * (created on first use) so the chat can continue in the web panel via
 * the resume token. The IDE client stays stateless and authoritative for
 * its own request; only the newest turn is mirrored per call.
 */
export async function mirrorThread(keyConversationToken: string | null, turn: { lastUser: string; reply: string }) {
  try {
    const token = keyConversationToken ?? newConversationToken();
    const stored = await loadStoredMessages(token);
    const merged = [
      ...stored,
      { role: "user" as const, content: turn.lastUser.slice(0, MAX_TOOL_MESSAGE_CHARS) },
      { role: "assistant" as const, content: turn.reply },
    ].slice(-MAX_STORED);
    await saveConversationMessages(token, merged, turn.lastUser);
    return token;
  } catch {
    // Mirroring is best-effort — never fail the chat over it.
    return keyConversationToken ?? null;
  }
}

/* ------------------------------- SSE helpers ----------------------------- */

export function sseHeaders(extra: Record<string, string> = {}): Headers {
  const h = new Headers({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    ...extra,
  });
  return h;
}

const ts = () => Math.floor(Date.now() / 1000);

/** Rough token estimate (good enough for usage telemetry, not billing). */
export const estimateTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

/**
 * Splits text into word-boundary chunks (~4-6 words each) so the simulated
 * stream reads naturally instead of dumping one giant frame.
 */
export function chunkReply(text: string): string[] {
  const words = text.split(/(?<=\s)/);
  const chunks: string[] = [];
  let buf = "";
  for (const w of words) {
    buf += w;
    if (buf.length >= 28) {
      chunks.push(buf);
      buf = "";
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [text];
}

export function openAiChunkBase(id: string, model: string) {
  return { id, object: "chat.completion.chunk" as const, created: ts(), model };
}

export function openAiCompletionPayload(id: string, model: string, content: string, promptTokens: number) {
  return {
    id,
    object: "chat.completion" as const,
    created: ts(),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content },
        finish_reason: "stop" as const,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: estimateTokens(content),
      total_tokens: promptTokens + estimateTokens(content),
    },
  };
}

export function anthropicMessagePayload(id: string, model: string, content: string, promptTokens: number) {
  return {
    id,
    type: "message" as const,
    role: "assistant" as const,
    model,
    content: [{ type: "text" as const, text: content }],
    stop_reason: "end_turn" as const,
    stop_sequence: null,
    usage: {
      input_tokens: promptTokens,
      output_tokens: estimateTokens(content),
    },
  };
}
