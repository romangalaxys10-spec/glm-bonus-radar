/**
 * AI-VPS promo badge for the /scanner page (Task 43).
 * External promo link — must stay self-contained (no globals.css edits),
 * theme-aware via var(--rc-*) only, and honest to the portal's own
 * anti-slop doctrine: no purple/indigo band, no bounce easing, no emoji.
 */
export function AiVpsBadge() {
  return (
    <a
      href="https://xshredo.com/promo/ai-vps"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="AI VPS offer: an AI Agent computer that never sleeps, for less than a cup of coffee"
      className="group relative mb-8 block overflow-hidden rounded-2xl p-px outline-none transition-[background-position,box-shadow] duration-500 bg-[length:220%_100%] bg-[position:0%_0%] hover:bg-[position:100%_0%] hover:shadow-[0_10px_34px_-12px_color-mix(in_srgb,var(--rc-accent)_55%,transparent)] focus-visible:bg-[position:100%_0%] focus-visible:shadow-[0_10px_34px_-12px_color-mix(in_srgb,var(--rc-accent)_55%,transparent)] bg-[linear-gradient(120deg,var(--rc-accent)_0%,color-mix(in_srgb,var(--rc-accent)_30%,var(--rc-border))_50%,var(--rc-accent)_100%)] before:pointer-events-none before:absolute before:inset-0 before:z-10 before:content-[''] before:bg-[linear-gradient(105deg,transparent_42%,rgba(255,255,255,0.22)_50%,transparent_58%)] before:bg-[length:250%_100%] before:bg-[position:-60%_0%] before:bg-no-repeat before:transition-[background-position] before:duration-700 group-hover:before:bg-[position:160%_0%] motion-reduce:before:transition-none motion-reduce:before:bg-[position:200%_0%]"
    >
      <span className="relative flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[15px] bg-[color-mix(in_srgb,var(--rc-surface)_86%,var(--rc-accent))] px-5 py-4">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--rc-border)] bg-[var(--rc-bg)] text-[var(--rc-accent)] transition-transform duration-300 group-hover:rotate-6 group-hover:scale-105 motion-reduce:transition-none"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-5 w-5">
            <path d="M9.5 1.1 3.3 9H7v5.9L13.2 7H9.5V1.1Z" />
          </svg>
        </span>

        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--rc-accent)]">
            ai vps · 24/7 · promo
          </span>
          <span className="mt-0.5 block font-display text-[15px] font-semibold leading-snug tracking-tight text-[var(--rc-text)] md:text-base">
            Need AI Agent computer that never sleeps?
          </span>
          <span className="block text-[13px] leading-snug text-[var(--rc-text-dim)]">
            It cost less than a cup of coffee.
          </span>
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-2.5 max-md:ml-0 max-md:basis-full max-md:justify-end">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="h-6 w-6 text-[var(--rc-accent)] transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:rotate-3 motion-reduce:transition-none"
          >
            <path d="M4 10h11v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5Z" />
            <path d="M15 11h1.6a2.4 2.4 0 0 1 0 4.8H15" />
            <path d="M7.5 7c0-1 .8-1.2.8-2.2M11 7c0-1 .8-1.2.8-2.2" />
          </svg>
          <span className="font-mono text-[12px] font-semibold text-[var(--rc-accent)] transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none">
            grab one →
          </span>
        </span>
      </span>
    </a>
  );
}
