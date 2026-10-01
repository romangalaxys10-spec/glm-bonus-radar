import type { Metadata } from "next";
import Link from "next/link";
import { EndpointClient } from "./endpoint-client";

/**
 * SECRET section — the Z-Assist IDE endpoint console. Reachable only by URL
 * (no nav links, noindex) and gated by a shared password; unlocking reveals
 * the API key + setup snippets that let IDE tools (zcode, Claude Code) chat
 * with Z-Assist through the OpenAI- and Anthropic-compatible routes.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Z-Assist IDE endpoint — GLM Bonus Radar",
  description: "Secret endpoint console for chatting with Z-Assist from IDE tools.",
  robots: { index: false, follow: false },
};

export default function EndpointPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 pt-10 pb-32 md:px-8 md:pb-20">
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/"
          className="font-mono text-xs text-[var(--rc-text-dim)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
        >
          ← back to the radar
        </Link>
        <span className="rounded-full border border-[var(--rc-accent)] px-2.5 py-1 font-mono text-[10px] tracking-widest text-[var(--rc-accent)] uppercase">
          secret
        </span>
      </header>
      <EndpointClient />
    </div>
  );
}
