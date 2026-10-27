import type { ReactNode } from "react";

/**
 * Blog markdown-lite renderer (server component, zero dependencies).
 *
 * Supported: ## / ### headings, **bold**, *italic*, `inline code`,
 * ``` fenced code blocks, - / 1. lists, > blockquotes, --- rules,
 * [text](https://…) links and bare https:// links.
 *
 * Security: every plain-text span is HTML-escaped by construction —
 * we never dangerouslySetInnerHTML article content, so a misbehaving
 * (or compromised) publishing agent cannot inject markup. Links are
 * forced to https and rel="noopener noreferrer".
 */

/* ------------------------------ inline pass ------------------------------ */

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: links first (so their text isn't double-formatted),
  // then code spans, then bold/italic, then bare URLs.
  const pattern =
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|(https?:\/\/[^\s<>()]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[1] && m[2]) {
      out.push(
        <a key={key} href={m[2]} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--rc-accent)]">
          {m[1]}
        </a>,
      );
    } else if (m[3] !== undefined) {
      out.push(
        <code key={key} className="rounded bg-[color-mix(in_srgb,var(--rc-accent)_10%,var(--rc-bg))] px-1 py-0.5 font-mono text-[0.85em] text-[var(--rc-accent)]">
          {m[3]}
        </code>,
      );
    } else if (m[4] !== undefined) {
      out.push(<strong key={key} className="font-semibold text-[var(--rc-bright)]">{m[4]}</strong>);
    } else if (m[5] !== undefined) {
      out.push(<em key={key}>{m[5]}</em>);
    } else if (m[6]) {
      out.push(
        <a key={key} href={m[6]} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-[0.9em] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--rc-accent)]">
          {m[6]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ------------------------------ block pass ------------------------------- */

export function BlogMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push(
        <div key={key++} className="overflow-hidden rounded-xl border border-[var(--rc-border)] bg-[var(--rc-surface)]">
          {lang ? (
            <p className="border-b border-[var(--rc-border)] px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--rc-tone3)]">
              {lang}
            </p>
          ) : null}
          <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-[var(--rc-text)]">
            <code>{buf.join("\n")}</code>
          </pre>
        </div>,
      );
      continue;
    }

    // Headings
    const h2 = /^##\s+(.*)$/.exec(line);
    const h3 = /^###\s+(.*)$/.exec(line);
    if (h2) {
      blocks.push(
        <h2 key={key++} className="mt-8 border-b border-[var(--rc-border)] pb-1.5 font-display text-xl font-semibold tracking-tight text-[var(--rc-bright)]">
          {renderInline(h2[1], `h${key}`)}
        </h2>,
      );
      i++;
      continue;
    }
    if (h3) {
      blocks.push(
        <h3 key={key++} className="mt-6 font-display text-base font-semibold tracking-tight text-[var(--rc-bright)]">
          {renderInline(h3[1], `h${key}`)}
        </h3>,
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="mt-8 border-[var(--rc-border)]" />);
      i++;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="border-l-2 border-[var(--rc-accent)] pl-3.5 text-[14px] italic leading-relaxed text-[var(--rc-text-dim)]">
          {renderInline(buf.join(" "), `q${key}`)}
        </blockquote>,
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="ml-1 list-disc space-y-1.5 pl-4 text-[14.5px] leading-relaxed marker:text-[var(--rc-accent)]">
          {items.map((it, n) => <li key={n}>{renderInline(it, `ul${key}-${n}`)}</li>)}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="ml-1 list-decimal space-y-1.5 pl-4 text-[14.5px] leading-relaxed marker:font-mono marker:text-[var(--rc-accent)]">
          {items.map((it, n) => <li key={n}>{renderInline(it, `ol${key}-${n}`)}</li>)}
        </ol>,
      );
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph (gather until blank/structural line)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trimStart().startsWith("```") &&
      !/^#{2,3}\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !lines[i].trimStart().startsWith(">") &&
      !/^\s*(---+|\*\*\*+)\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="text-[14.5px] leading-relaxed text-[var(--rc-text-dim)]">
        {renderInline(para.join(" "), `p${key}`)}
      </p>,
    );
  }

  return <div className="space-y-3.5">{blocks}</div>;
}
