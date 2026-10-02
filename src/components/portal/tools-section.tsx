import Link from "next/link";
import { TOOLS, type Tool, type ToolIcon } from "@/lib/tools";

/**
 * Useful tools — link-out cards for the toolkit behind / around this portal.
 * Server component: no live state, fully crawler-readable in the SSR HTML.
 *
 * Icons: GitHub octicon (MIT) + Feather-style strokes (MIT), all
 * currentColor so they follow the theme tokens automatically.
 */

function ToolIconGlyph({ icon }: { icon: ToolIcon }) {
  switch (icon) {
    case "github":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className="h-4 w-4">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
      );
    case "layers":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-4 w-4"
        >
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      );
    case "terminal":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-4 w-4"
        >
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      );
    case "scan":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-4 w-4"
        >
          <path d="M3 7V5a2 2 0 0 1 2-2h2" />
          <path d="M17 3h2a2 2 0 0 1 2 2v2" />
          <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
          <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          <line x1="7" y1="12" x2="17" y2="12" />
        </svg>
      );
    case "article":
    default:
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-4 w-4"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
  }
}

function KindPill({ kind }: { kind: Tool["kind"] }) {
  const branded = kind === "open source";
  const builtin = kind === "built-in";
  const cls = builtin
    ? "border-[color-mix(in_srgb,var(--rc-accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--rc-accent)_12%,transparent)] text-[var(--rc-accent)]"
    : branded
      ? "border-[color-mix(in_srgb,var(--rc-brand)_55%,transparent)] bg-[color-mix(in_srgb,var(--rc-brand)_12%,transparent)] text-[var(--rc-brand)]"
      : "border-[var(--rc-border)] bg-[var(--rc-bg)] text-[var(--rc-text-dim)]";
  return (
    <span
      className={`inline-flex shrink-0 cursor-default select-none items-center rounded-full border px-2.5 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] ${cls}`}
    >
      {kind}
    </span>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--rc-border)] bg-[color-mix(in_srgb,var(--rc-accent)_8%,transparent)] text-[var(--rc-accent)]">
          <ToolIconGlyph icon={tool.icon} />
        </span>
        <KindPill kind={tool.kind} />
      </div>
      <h3 className="mt-4 font-display text-lg font-semibold tracking-tight transition-colors group-hover:text-[var(--rc-accent)]">
        {tool.name}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--rc-text-dim)]">{tool.tagline}</p>
      <span className="mt-auto flex items-center justify-between gap-3 pt-4 font-mono text-[11px] text-[var(--rc-text-dim)]">
        <span className="truncate">
          {tool.host}
          <span aria-hidden> · </span>
          {tool.id}
        </span>
        <span
          aria-hidden
          className="shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--rc-accent)]"
        >
          {tool.internal ? "→" : "↗"}
        </span>
      </span>
    </>
  );
  const cls = "group flex flex-col rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5 transition-colors hover:border-[var(--rc-accent)]";
  return tool.internal ? (
    <Link href={tool.url} className={cls}>
      {inner}
    </Link>
  ) : (
    <a href={tool.url} target="_blank" rel="noopener" className={cls}>
      {inner}
    </a>
  );
}

export function ToolsSection() {
  const featured = TOOLS.filter((t) => t.featured);
  const rest = TOOLS.filter((t) => !t.featured);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {featured.map((t) => (
          <ToolCard key={t.id} tool={t} />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {rest.map((t) => (
          <ToolCard key={t.id} tool={t} />
        ))}
      </div>
    </div>
  );
}
