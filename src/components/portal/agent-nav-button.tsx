import Link from "next/link";

/**
 * Highlighted "24x7 agent" menu button (Task 44).
 *
 * The portal menus are otherwise plain mono-text links; this is the single
 * accent pill that stands out — live ping dot, soft accent glow, lift on
 * hover. Links the portal's own promo page /agent ("Powered by xShredo").
 * Theme-aware via var(--rc-*) only; the ping is motion-reduce safe.
 */
export function AgentNavButton() {
  return (
    <Link
      href="/agent"
      aria-label="24x7 Agent — an always-on AI computer, powered by xShredo"
      title="An AI Agent computer that never sleeps — from $5.75/mo"
      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--rc-accent)] px-3 py-1 font-mono text-[12px] font-bold text-[var(--rc-on-accent)] shadow-[0_3px_16px_-4px_color-mix(in_srgb,var(--rc-accent)_65%,transparent)] outline-none transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[0_7px_24px_-6px_color-mix(in_srgb,var(--rc-accent)_80%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--rc-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--rc-bg)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span aria-hidden className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--rc-on-accent)] opacity-75 motion-reduce:hidden" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--rc-on-accent)]" />
      </span>
      24x7 agent
    </Link>
  );
}
