"use client";

import { ReactNode, useState } from "react";
import { parseAssistReply, type AssistBlock } from "@/lib/assist-blocks";
import { AssistBlocks } from "@/components/portal/assist-blocks";

/**
 * Z-Assist full-page chat — message presentation.
 * Markdown-lite renderer (bold / code / links / bullets / fenced code /
 * source lines), chat bubbles, per-reply copy, empty state + starters.
 * Styled to the portal's xShredo tokens (#050505 canvas, #3b82f6 accent).
 */

export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Generative-UI blocks rendered under the text (OpenIntelligentUI). */
  blocks?: AssistBlock[];
  error?: boolean;
}

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Strips block fences from stored/raw assistant content, keeping validated blocks. */
export function toChatMsg(m: { id?: string; role: "user" | "assistant"; content: string; error?: boolean }): ChatMsg {
  if (m.role !== "assistant") {
    return { id: m.id ?? uid(), role: m.role, content: m.content, error: m.error };
  }
  const parsed = parseAssistReply(m.content);
  return {
    id: m.id ?? uid(),
    role: m.role,
    content: parsed.text,
    ...(parsed.blocks.length > 0 ? { blocks: parsed.blocks } : {}),
    error: m.error,
  };
}

/* ------------------------- markdown-lite renderer ------------------------- */

const INLINE_RE =
  /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s)`\]]+)/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-i${i++}`;
    if (tok.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-bright">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-hair/[0.06] px-1 py-0.5 font-mono text-[12px] text-azure2">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (mm) {
        nodes.push(
          <a
            key={key}
            href={mm[2]}
            target="_blank"
            rel="noopener"
            className="underline decoration-dotted underline-offset-2 transition-colors hover:text-azure2"
          >
            {mm[1]}
          </a>,
        );
      } else nodes.push(tok);
    } else {
      const label = tok.replace(/^https?:\/\//, "").replace(/\/$/, "");
      nodes.push(
        <a
          key={key}
          href={tok}
          target="_blank"
          rel="noopener"
          className="font-mono text-[12px] underline decoration-dotted underline-offset-2 transition-colors hover:text-azure2"
        >
          {label}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderMarkdown(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/```[\w-]*\n?/);
  let k = 0;
  parts.forEach((part, idx) => {
    if (idx % 2 === 1) {
      out.push(
        <pre
          key={`c${k++}`}
          className="mt-1 overflow-x-auto rounded-lg border border-hair/10 bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-body"
        >
          <code>{part.replace(/\n$/, "")}</code>
        </pre>,
      );
      return;
    }
    let list: string[] = [];
    const flush = () => {
      if (list.length) {
        const items = list;
        list = [];
        out.push(
          <ul key={`u${k++}`} className="ml-1 list-outside list-disc space-y-1 pl-3.5">
            {items.map((li, j) => (
              <li key={j}>{renderInline(li, `u${k}-${j}`)}</li>
            ))}
          </ul>,
        );
      }
    };
    part.split("\n").forEach((line, li) => {
      const t = line.trim();
      if (!t) {
        flush();
        return;
      }
      if (/^[-•*] /.test(t)) {
        list.push(t.slice(2));
        return;
      }
      flush();
      if (/^(source|sources):/i.test(t)) {
        out.push(
          <p key={`s${k++}`} className="mt-1 font-mono text-[10.5px] text-faint">
            {renderInline(t, `s${k}`)}
          </p>,
        );
      } else {
        out.push(<p key={`p${k++}`}>{renderInline(t, `p${k}`)}</p>);
      }
    });
    flush();
  });
  return out;
}

/* --------------------------------- icons ---------------------------------- */

export function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect width="13" height="13" rx="2" ry="2" x="9" y="9" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ZAvatar() {
  return (
    <div
      aria-hidden
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-azure/40 bg-azure/15 font-mono text-[13px] font-semibold text-azure2"
    >
      Z
    </div>
  );
}

/* -------------------------------- bubbles --------------------------------- */

export function MessageBubble({ msg, revealText }: { msg: ChatMsg; revealText?: string | null }) {
  const [copied, setCopied] = useState(false);
  const body = revealText ?? msg.content;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-azure/35 bg-azure/15 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-bright sm:max-w-[75%]">
          <p className="whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-2.5">
      <ZAvatar />
      <div className={`min-w-0 max-w-[calc(100%-2.75rem)] flex-1 ${msg.error ? "text-alert" : "text-body"}`}>
        <div className="space-y-1.5 text-[13.5px] leading-relaxed">
          {body.split(/\n{2,}/).map((para, i) => (
            <div key={i}>{renderMarkdown(para)}</div>
          ))}
        </div>
        {msg.blocks && msg.blocks.length > 0 && <AssistBlocks blocks={msg.blocks} />}
        {!revealText && !msg.error && msg.content && (
          <div className="mt-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-faint transition-colors hover:bg-hair/5 hover:text-azure2"
              aria-label="Copy reply"
            >
              {copied ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
              {copied ? "copied" : "copy"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------- thinking + empty state ------------------------- */

export function ThinkingBubble() {
  return (
    <div className="flex gap-2.5" aria-live="polite" aria-label="Z-Assist is thinking">
      <ZAvatar />
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-hair/10 bg-surface px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-azure2"
            style={{ animationDelay: `${i * 140}ms` }}
          />
        ))}
        <span className="ml-1 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
          thinking
        </span>
      </div>
    </div>
  );
}

export interface Starter {
  tag: "explain" | "compare" | "tool" | "steps";
  q: string;
}

export const STARTERS: Starter[] = [
  { tag: "compare", q: "Compare the coding plan tiers and weekly quotas" },
  { tag: "explain", q: "When are off-peak hours and how much do I save?" },
  { tag: "tool", q: "I use ~300M tokens a week, 80% off-peak — will the Pro plan fit?" },
  { tag: "steps", q: "How do I make my first API call?" },
  { tag: "explain", q: "Which GLM model should I pick for coding?" },
  { tag: "explain", q: "How does the 10% OFF invite code work?" },
];

export function EmptyState({ name, onPick }: { name: string; onPick: (q: string) => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-10 text-center sm:py-16">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-azure/40 bg-azure/15 font-mono text-xl font-semibold text-azure2">
        Z
      </div>
      <h2 className="mt-4 text-[19px] font-light tracking-tight text-bright sm:text-[22px]">
        Hi {name} — how can I help?
      </h2>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-dim">
        Ask anything about GLM models, coding plans, API usage, quotas or bonus windows — answers
        come from the official z.ai docs, with tables and live tools you can interact with.
      </p>
      <div className="mt-6 flex w-full flex-col gap-1.5">
        {STARTERS.map((s) => (
          <button
            key={s.q}
            type="button"
            onClick={() => onPick(s.q)}
            className="flex items-baseline gap-2 rounded-xl border border-hair/10 bg-surface px-3.5 py-2.5 text-left text-[12.5px] text-soft transition-colors hover:border-azure/50 hover:bg-azure/[0.07] hover:text-body"
          >
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-azure">
              {s.tag}
            </span>
            <span className="min-w-0">{s.q}</span>
          </button>
        ))}
      </div>
      <p className="mt-5 font-mono text-[10px] leading-relaxed text-deep">
        grounded in docs.z.ai · hourly doc sync · community portal (not official z.ai support)
      </p>
    </div>
  );
}
