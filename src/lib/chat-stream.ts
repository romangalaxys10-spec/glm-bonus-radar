/**
 * Client-side consumer for the portal's chat SSE protocol
 * (events: {type:"start"} | {type:"delta",text} | {type:"done",...} |
 *  {type:"error",error}). Shared by the /agent full-page chat and the
 * floating Z-Assist widget. No server imports — safe for client bundles.
 */

export interface ChatStreamHandlers {
  /** First byte arrived — flip "thinking" → live text when you use it. */
  onStart?: () => void;
  /** Append this piece to the streaming bubble. */
  onDelta: (text: string) => void;
  /** Terminal success payload (id/token/title/via/truncated/text). */
  onDone: (data: Record<string, unknown>) => void;
  /** Terminal failure after the stream started. */
  onError: (message: string) => void;
}

/** True when the response is the SSE chat stream we asked for. */
export function isChatStream(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").includes("text/event-stream");
}

/** Reads the SSE body to completion, dispatching handler callbacks. */
export async function consumeChatStream(
  res: Response,
  handlers: ChatStreamHandlers,
): Promise<void> {
  if (!res.body) throw new Error("Streaming is not supported by this browser.");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let started = false;

  const dispatch = (payload: string) => {
    if (!payload || payload === "[DONE]") return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.type === "start") {
      if (!started) {
        started = true;
        handlers.onStart?.();
      }
    } else if (msg.type === "delta" && typeof msg.text === "string") {
      handlers.onDelta(msg.text);
    } else if (msg.type === "done") {
      handlers.onDone(msg);
    } else if (msg.type === "error") {
      handlers.onError(
        typeof msg.error === "string" && msg.error
          ? msg.error
          : "Z-Assist could not reply. Please try again.",
      );
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const event = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of event.split("\n")) {
        if (line.startsWith("data:")) dispatch(line.slice(5).trim());
      }
    }
  }
}

/**
 * While a reply streams in, a trailing partial ```blocks fence (or a fragment
 * like "``b") must not flash as raw text — cut exactly that tail off for
 * display only. Real code fences ("```ts …") keep streaming normally; the
 * final text is re-parsed from the complete reply on done anyway.
 */
const BLOCKS_FENCE = "```blocks";

export function stripStreamingFence(text: string): string {
  for (let len = Math.min(BLOCKS_FENCE.length, text.length); len >= 3; len--) {
    if (text.endsWith(BLOCKS_FENCE.slice(0, len))) return text.slice(0, text.length - len);
  }
  return text;
}
