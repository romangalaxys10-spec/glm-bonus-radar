/**
 * Canonical public URL of the portal. Used in Telegram bot copy (the
 * daily-limit handoff sends users here to continue for free) and in the
 * one-click resume deep links that carry a chat token.
 */
export const SITE_URL = "https://zhelp.space-z.ai";

/** Deep link that auto-resumes a stored conversation on the web chat. */
export function webChatLink(token: string): string {
  return `${SITE_URL}/?token=${encodeURIComponent(token)}`;
}
