"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INVITE_CODE, INVITE_URL } from "@/lib/invite";
import { useFreshAnnouncements } from "@/lib/use-fresh-announcements";

/**
 * Z-Assist — floating live-chat assistant grounded in the official z.ai
 * documentation (docs.z.ai). Answers are generated server-side by
 * /api/assist using a curated knowledge base; this component handles the
 * conversational UI: launcher, panel, suggestion chips, typewriter reveal,
 * markdown-lite rendering and local persistence.
 */

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}

const STORAGE_KEY = "br-zassist-v1";
const OPENED_KEY = "br-zassist-opened";
const TOKEN_KEY = "br-zassist-token";
const TOKENS_KEY = "br-zassist-tokens";
/** Window event fired by the hero link / any CTA to pop the chat open. */
export const ZASSIST_OPEN_EVENT = "zassist:open";

interface HistoryItem {
  token: string;
  title: string | null;
  count: number;
  updatedAt: string;
}

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function loadTokenList(): string[] {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rememberToken(t: string) {
  try {
    const list = loadTokenList().filter((x) => x !== t);
    localStorage.setItem(TOKENS_KEY, JSON.stringify([t, ...list].slice(0, 12)));
  } catch {
    /* ignore */
  }
}

const GREETING: Omit<ChatMsg, "id"> = {
  role: "assistant",
  content:
    "Hi, I'm Z-Assist 👋 I answer questions about z.ai promos, bonus windows, coding plans and API usage — straight from the official docs (docs.z.ai). What would you like to know?",
};

const SUGGESTIONS = [
  "When are off-peak hours and how much do I save?",
  "How does the 10% OFF invite code work?",
  "What's included in the Flash campaign?",
  "How do credits work on the new plans?",
  "Which coding tools are supported?",
  "How do I make my first API call?",
];

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function loadStored(): ChatMsg[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMsg[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.length > 0,
      )
      .slice(-30)
      .map((m) => ({ id: m.id ?? uid(), role: m.role, content: m.content, error: m.error }));
  } catch {
    return [];
  }
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
        <strong key={key} className="font-semibold text-[var(--rc-text)]">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-[var(--rc-bg)] px-1 py-0.5 font-mono text-[11.5px] text-[var(--rc-brand)]"
        >
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
            className="underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--rc-accent)]"
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
          className="font-mono text-[11.5px] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--rc-accent)]"
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
          className="mt-1 overflow-x-auto rounded-lg border border-[var(--rc-border)] bg-[var(--rc-bg)] p-2.5 font-mono text-[11.5px] leading-relaxed"
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
          <p key={`s${k++}`} className="mt-1 font-mono text-[10.5px] text-[var(--rc-text-dim)]">
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

/* --------------------------------- icons --------------------------------- */

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      <path d="M9.5 9.5 12 14l2.5-4.5" strokeWidth="1.8" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

/* ------------------------------- component ------------------------------- */

/** Small CTA that pops the chat open from anywhere on the page. */
export function AskZAssistLink({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(ZASSIST_OPEN_EVENT))}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-full bg-[var(--rc-accent)] px-4 py-2 text-sm font-semibold text-[var(--rc-on-accent)] shadow-md transition-transform hover:scale-[1.03] active:scale-95"
      }
    >
      <ChatIcon className="h-4 w-4" />
      Ask Z-Assist
      <span aria-hidden className="font-mono">
        →
      </span>
    </button>
  );
}

export function ZAssist() {
  const [open, setOpen] = useState(false);
  const [teaser, setTeaser] = useState(false);

  /* Mirror floating-chrome state so other fixed widgets (the install badge)
     can dodge the chat panel / teaser bubble instead of stacking over them. */
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("zassist:chrome", { detail: { open, teaser } }));
  }, [open, teaser]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [reveal, setReveal] = useState<{ id: string; len: number } | null>(null);
  const [buzz, setBuzz] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [resumeValue, setResumeValue] = useState("");
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  /* mid-session announcement news — badge the teaser/launcher so the
     visitor notices the strip update and the assistant at the same time */
  const { active: freshAnn, fresh } = useFreshAnnouncements();
  const annBadge = freshAnn && !open;

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seededRef = useRef(false);

  /* hydrate from storage + schedule teaser */
  useEffect(() => {
    const stored = loadStored();
    if (stored.length > 0) setMessages(stored);
    setToken(loadToken());
    const openedBefore = localStorage.getItem(OPENED_KEY) === "1";
    if (!openedBefore) {
      const t = setTimeout(() => setTeaser(true), 2600);
      return () => clearTimeout(t);
    }
  }, []);

  /* persist conversation */
  useEffect(() => {
    if (!seededRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    } catch {
      /* storage full/blocked — non-fatal */
    }
  }, [messages]);

  /* typewriter reveal */
  useEffect(() => {
    if (!reveal) return;
    const msg = messages.find((m) => m.id === reveal.id);
    if (!msg) {
      setReveal(null);
      return;
    }
    if (reveal.len >= msg.content.length) {
      setReveal(null);
      return;
    }
    const chunk = Math.max(2, Math.ceil(msg.content.length / 320));
    const t = setTimeout(() => {
      setReveal((r) => (r && r.id === reveal.id ? { id: r.id, len: r.len + chunk } : r));
    }, 14);
    return () => clearTimeout(t);
  }, [reveal, messages]);

  /* autoscroll */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking, reveal, open]);

  /* escape closes */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const fetchHistory = useCallback(async () => {
    const tokens = loadTokenList();
    if (tokens.length === 0) {
      setHistoryItems([]);
      return;
    }
    try {
      const res = await fetch(`/api/assist?tokens=${encodeURIComponent(tokens.join(","))}`);
      if (!res.ok) return;
      const data = (await res.json()) as { conversations?: HistoryItem[] };
      setHistoryItems(Array.isArray(data.conversations) ? data.conversations : []);
    } catch {
      /* keep previous list */
    }
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    setTeaser(false);
    try {
      localStorage.setItem(OPENED_KEY, "1");
    } catch {
      /* ignore */
    }
    const currentToken = loadToken();
    if (!seededRef.current && messages.length === 0) {
      seededRef.current = true;
      setMessages([{ id: uid(), ...GREETING }]);
    }
    // Restore the server thread (covers cross-device + multi-tab resume).
    if (currentToken) {
      void (async () => {
        try {
          const res = await fetch(`/api/assist?token=${encodeURIComponent(currentToken)}`);
          if (!res.ok) return;
          const data = (await res.json()) as {
            messages?: Array<{ role: "user" | "assistant"; content: string }>;
          };
          if (Array.isArray(data.messages) && data.messages.length > 0) {
            seededRef.current = true;
            setMessages(data.messages.map((m) => ({ id: uid(), role: m.role, content: m.content })));
          }
        } catch {
          /* offline — local copy still shown */
        }
      })();
    }
    void fetchHistory();
    setTimeout(() => inputRef.current?.focus(), 240);
  }, [messages.length, fetchHistory]);

  /* external open requests (hero link, CTAs) */
  useEffect(() => {
    const onOpen = () => openPanel();
    window.addEventListener(ZASSIST_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ZASSIST_OPEN_EVENT, onOpen);
  }, [openPanel]);

  const send = useCallback(
    async (raw: string) => {
      const content = raw.trim();
      if (!content || thinking) return;
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";

      const userMsg: ChatMsg = { id: uid(), role: "user", content };
      const historyForApi = [...messages, userMsg]
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userMsg]);
      setThinking(true);

      try {
        const res = await fetch("/api/assist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: historyForApi, token }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          reply?: string;
          token?: string;
          error?: string;
        };
        if (!res.ok || !data.reply) {
          throw new Error(data.error || "Z-Assist could not reach the model. Please try again.");
        }
        if (data.token) {
          setToken(data.token);
          saveToken(data.token);
          rememberToken(data.token);
        }
        const id = uid();
        setMessages((prev) => [...prev, { id, role: "assistant", content: data.reply as string }]);
        setReveal({ id, len: 0 });
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "assistant",
            content:
              err instanceof Error
                ? err.message
                : "Something went wrong. Please try again in a moment.",
            error: true,
          },
        ]);
      } finally {
        setThinking(false);
        setBuzz(true);
        setTimeout(() => setBuzz(false), 500);
      }
    },
    [messages, thinking, token],
  );

  const clearChat = useCallback(() => {
    seededRef.current = true;
    setMessages([{ id: uid(), ...GREETING }]);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    } catch {
      /* ignore */
    }
  }, []);

  /** Start a fresh thread: clears the active token so the next reply issues a new one. */
  const startNewChat = useCallback(() => {
    setToken(null);
    saveToken(null);
    setHistoryOpen(false);
    setMessages([{ id: uid(), ...GREETING }]);
    seededRef.current = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    } catch {
      /* ignore */
    }
  }, []);

  /** Resume a past conversation by its chat token. */
  const resumeByToken = useCallback(async (raw: string) => {
    const clean = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(clean)) {
      setResumeError("Tokens look like 8 letters/digits, e.g. K7M2Q9ZX.");
      return;
    }
    setResumeError(null);
    try {
      const res = await fetch(`/api/assist?token=${encodeURIComponent(clean)}`);
      if (res.status === 404) {
        setResumeError(`No conversation found for token ${clean}.`);
        return;
      }
      if (!res.ok) {
        setResumeError("Could not load that conversation — try again in a moment.");
        return;
      }
      const data = (await res.json()) as {
        messages?: Array<{ role: "user" | "assistant"; content: string }>;
      };
      if (!Array.isArray(data.messages) || data.messages.length === 0) {
        setResumeError("That conversation is empty.");
        return;
      }
      setToken(clean);
      saveToken(clean);
      rememberToken(clean);
      seededRef.current = true;
      setMessages(data.messages.map((m) => ({ id: uid(), role: m.role, content: m.content })));
      setHistoryOpen(false);
      setResumeValue("");
      void fetchHistory();
    } catch {
      setResumeError("Network hiccup — please try again.");
    }
  }, [fetchHistory]);

  const copyToken = useCallback(async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  }, [token]);

  const resetHeight = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, []);

  const showSuggestions = messages.length <= 1;
  const visible = useMemo(
    () =>
      messages.map((m) =>
        reveal && reveal.id === m.id ? { ...m, content: m.content.slice(0, reveal.len) } : m,
      ),
    [messages, reveal],
  );

  if (!open) {
    return (
      <div className="fixed bottom-5 right-5 z-[60] md:bottom-6 md:right-6">
        {/* teaser bubble */}
        {teaser && (
          <div className="zassist-in absolute bottom-2 right-[4.4rem] hidden w-56 items-start gap-1 sm:flex">
            <button
              type="button"
              onClick={openPanel}
              className={`grow rounded-2xl rounded-br-md border bg-[var(--rc-surface)] px-3.5 py-2.5 text-left text-[12.5px] leading-snug shadow-lg transition-colors hover:border-[var(--rc-accent)] ${
                annBadge
                  ? "border-[var(--rc-bright)] announce-strip--pulse"
                  : "border-[var(--rc-border)]"
              }`}
            >
              Ask me anything about z.ai promos, bonus windows &amp; plans{" "}
              <span className="text-[var(--rc-accent)]">✦</span>
              {annBadge && (
                <span className="announce-new-chip mt-1.5 flex w-fit items-center gap-1 rounded-full bg-[var(--rc-bright)] px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide text-[var(--rc-bg)]">
                  {fresh.length} new announcement{fresh.length > 1 ? "s" : ""}
                </span>
              )}
            </button>
            <button
              type="button"
              aria-label="Dismiss Z-Assist teaser"
              onClick={() => setTeaser(false)}
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] text-[11px] text-[var(--rc-text-dim)] transition-colors hover:text-[var(--rc-text)]"
            >
              ×
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={openPanel}
          aria-label="Open Z-Assist chat"
          className="group relative flex h-14 w-14 items-center justify-center"
        >
          <span
            className="absolute inset-0 rounded-2xl bg-[var(--rc-accent)] opacity-40 group-hover:animate-none"
            style={{ animation: "glowpulse 2.4s ease-in-out infinite" }}
            aria-hidden
          />
          <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-[var(--rc-accent)] text-[var(--rc-on-accent)] shadow-xl transition-transform duration-150 group-hover:scale-105 group-active:scale-95">
            <ChatIcon className="h-6 w-6" />
            {annBadge && (
              <span
                aria-label={`${fresh.length} new announcement${fresh.length > 1 ? "s" : ""}`}
                className="announce-new-chip absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-[var(--rc-bg)] bg-[var(--rc-bright)] px-1 font-mono text-[10px] font-bold text-[var(--rc-bg)]"
              >
                {fresh.length}
              </span>
            )}
          </span>
          <span className="pointer-events-none absolute right-[4.3rem] top-1/2 hidden -translate-y-1/2 whitespace-nowrap rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] px-3 py-1.5 font-mono text-[11px] font-semibold tracking-wide shadow-md transition-opacity duration-200 group-hover:opacity-0 sm:block">
            Z-Assist
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Z-Assist chat"
      className="zassist-in fixed bottom-3 right-3 z-[60] flex h-[min(72dvh,600px)] w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-bg)] shadow-2xl sm:bottom-5 sm:right-5 sm:w-[400px] md:bottom-6 md:right-6"
    >
      {/* header */}
      <div className="flex items-center gap-3 border-b border-[var(--rc-border)] bg-[color-mix(in_srgb,var(--rc-surface)_75%,var(--rc-accent)_6%)] px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--rc-accent)] font-display text-lg font-bold italic text-[var(--rc-on-accent)]">
          Z
        </span>
        <div className="min-w-0 grow">
          <p className="flex items-center gap-2 font-display text-[15px] font-semibold leading-tight">
            Z-Assist
            <span className="inline-flex items-center gap-1 font-mono text-[10px] font-normal uppercase tracking-[0.1em] text-[var(--rc-tone3)]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              online
            </span>
          </p>
          <p className="truncate font-mono text-[10.5px] text-[var(--rc-text-dim)]">
            grounded in official docs.z.ai
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setHistoryOpen((v) => !v);
            setResumeError(null);
            void fetchHistory();
          }}
          title="Chat history & resume token"
          aria-label="Chat history and resume token"
          className={`grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-[var(--rc-surface)] hover:text-[var(--rc-text)] ${historyOpen ? "bg-[var(--rc-surface)] text-[var(--rc-accent)]" : "text-[var(--rc-text-dim)]"}`}
        >
          <HistoryIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={clearChat}
          title="Clear conversation"
          aria-label="Clear conversation"
          className="grid h-8 w-8 place-items-center rounded-lg text-[var(--rc-text-dim)] transition-colors hover:bg-[var(--rc-surface)] hover:text-[var(--rc-text)]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          title="Close chat (Esc)"
          aria-label="Close Z-Assist chat"
          className="grid h-8 w-8 place-items-center rounded-lg text-[var(--rc-text-dim)] transition-colors hover:bg-[var(--rc-surface)] hover:text-[var(--rc-text)]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* messages + history overlay */}
      <div className="relative grow overflow-hidden">
        <div ref={scrollRef} className="zassist-scroll flex h-full flex-col gap-2.5 overflow-y-auto px-3.5 py-3.5">
        {visible.map((m) =>
          m.role === "user" ? (
            <div
              key={m.id}
              className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-[var(--rc-accent)] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[var(--rc-on-accent)]"
            >
              {m.content}
            </div>
          ) : (
            <div
              key={m.id}
              className={`max-w-[92%] self-start rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                m.error
                  ? "border-[var(--rc-gone)] bg-[color-mix(in_srgb,var(--rc-gone)_8%,var(--rc-surface))] text-[var(--rc-gone)]"
                  : "border-[var(--rc-border)] bg-[var(--rc-surface)]"
              }`}
            >
              <div className="space-y-1.5 break-words text-[var(--rc-text)]">
                {renderMarkdown(m.content)}
              </div>
              {!m.error && m.content.includes(INVITE_CODE) && (
                <a
                  href={INVITE_URL}
                  target="_blank"
                  rel="noopener"
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-[var(--rc-accent)] px-3.5 py-1.5 font-mono text-[11px] font-semibold text-[var(--rc-on-accent)] transition-opacity hover:opacity-90"
                >
                  claim 10% OFF →
                </a>
              )}
            </div>
          ),
        )}

        {thinking && (
          <div className="max-w-[70%] self-start rounded-2xl rounded-bl-md border border-[var(--rc-border)] bg-[var(--rc-surface)] px-4 py-3.5">
            <div className="flex gap-1.5">
              <span className="zassist-dot h-1.5 w-1.5 rounded-full bg-[var(--rc-accent)]" />
              <span className="zassist-dot h-1.5 w-1.5 rounded-full bg-[var(--rc-accent)]" />
              <span className="zassist-dot h-1.5 w-1.5 rounded-full bg-[var(--rc-accent)]" />
            </div>
          </div>
        )}

        {showSuggestions && !thinking && (
          <div className="mt-1.5 grid gap-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--rc-tone3)]">
              try asking
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-xl border border-[var(--rc-border)] bg-[var(--rc-surface)] px-3 py-2 text-left text-[12.5px] leading-snug text-[var(--rc-text-dim)] transition-colors hover:border-[var(--rc-accent)] hover:text-[var(--rc-text)]"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        </div>

        {/* history overlay */}
        {historyOpen && (
          <div className="zassist-in absolute inset-0 flex flex-col gap-3 overflow-y-auto bg-[var(--rc-bg)] p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--rc-tone3)]">
                your chats
              </p>
              <button
                type="button"
                onClick={startNewChat}
                className="rounded-full border border-[var(--rc-border)] px-3 py-1 font-mono text-[10.5px] font-semibold text-[var(--rc-accent)] transition-colors hover:border-[var(--rc-accent)]"
              >
                + new chat
              </button>
            </div>

            {token && (
              <div className="rounded-xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--rc-tone3)]">
                  current chat token
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="font-mono text-[15px] font-bold tracking-[0.14em] text-[var(--rc-bright)]">
                    {token}
                  </span>
                  <button
                    type="button"
                    onClick={copyToken}
                    className="rounded-lg bg-[var(--rc-accent)] px-3 py-1.5 font-mono text-[10.5px] font-bold text-[var(--rc-on-accent)] transition-opacity hover:opacity-90"
                  >
                    {copiedToken ? "copied ✓" : "copy"}
                  </button>
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--rc-text-dim)]">
                  Save this token — enter it on any device to reopen this exact conversation and keep chatting.
                </p>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void resumeByToken(resumeValue);
              }}
              className="grid gap-1.5"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--rc-tone3)]">
                resume with a token
              </p>
              <div className="flex gap-2">
                <input
                  value={resumeValue}
                  onChange={(e) => setResumeValue(e.target.value.toUpperCase())}
                  placeholder="e.g. K7M2Q9ZX"
                  maxLength={12}
                  className="grow rounded-xl border border-[var(--rc-border)] bg-[var(--rc-surface)] px-3 py-2 font-mono text-[13px] tracking-[0.12em] text-[var(--rc-text)] outline-none placeholder:tracking-normal placeholder:text-[var(--rc-tone3)] focus:border-[var(--rc-accent)]"
                />
                <button
                  type="submit"
                  disabled={!resumeValue.trim()}
                  className={`rounded-xl px-3.5 font-mono text-[11px] font-semibold transition-colors ${
                    resumeValue.trim()
                      ? "bg-[var(--rc-accent)] text-[var(--rc-on-accent)] hover:opacity-90"
                      : "cursor-not-allowed bg-[var(--rc-surface)] text-[var(--rc-tone3)]"
                  }`}
                >
                  resume
                </button>
              </div>
              {resumeError && <p className="text-[11.5px] text-[var(--rc-gone)]">{resumeError}</p>}
            </form>

            <div className="grid gap-1.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--rc-tone3)]">
                recent chats on this device
              </p>
              {historyItems.length === 0 ? (
                <p className="text-[12.5px] text-[var(--rc-text-dim)]">
                  Nothing here yet — your conversations will appear once you start chatting.
                </p>
              ) : (
                historyItems.map((h) => (
                  <button
                    key={h.token}
                    type="button"
                    onClick={() => void resumeByToken(h.token)}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:border-[var(--rc-accent)] ${
                      h.token === token
                        ? "border-[var(--rc-accent)] bg-[color-mix(in_srgb,var(--rc-accent)_8%,var(--rc-surface))]"
                        : "border-[var(--rc-border)] bg-[var(--rc-surface)]"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] text-[var(--rc-text)]">
                        {h.title ?? "Untitled chat"}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-[var(--rc-tone3)]">
                        {h.token} · {h.count} msg · {new Date(h.updatedAt).toLocaleString()}
                      </span>
                    </span>
                    {h.token === token && (
                      <span className="shrink-0 font-mono text-[9.5px] font-bold uppercase tracking-wide text-[var(--rc-accent)]">
                        active
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* input */}
      <div className="border-t border-[var(--rc-border)] bg-[var(--rc-surface)] px-3 py-2.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            maxLength={2000}
            placeholder="Ask about promos, plans, usage…"
            onChange={(e) => {
              setInput(e.target.value);
              resetHeight(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            className="zassist-scroll max-h-28 grow resize-none rounded-xl border border-[var(--rc-border)] bg-[var(--rc-bg)] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-tone3)] focus:border-[var(--rc-accent)]"
          />
          <button
            type="submit"
            disabled={thinking || !input.trim()}
            aria-label="Send message"
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-all ${
              thinking || !input.trim()
                ? "cursor-not-allowed bg-[var(--rc-surface)] text-[var(--rc-tone3)]"
                : `bg-[var(--rc-accent)] text-[var(--rc-on-accent)] shadow-md hover:opacity-90 ${buzz ? "scale-90" : "active:scale-90"}`
            }`}
          >
            <SendIcon className="h-4.5 w-4.5" />
          </button>
        </form>
        {token && (
          <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5 font-mono text-[10px] text-[var(--rc-tone3)]">
            <button
              type="button"
              onClick={copyToken}
              title="Copy your chat token — use it to resume this chat on any device"
              className="transition-colors hover:text-[var(--rc-accent)]"
            >
              token <span className="font-bold tracking-[0.1em] text-[var(--rc-text-dim)]">{token}</span>
              {copiedToken ? " · copied ✓" : " · copy ⧉"}
            </button>
            <button
              type="button"
              onClick={startNewChat}
              className="shrink-0 transition-colors hover:text-[var(--rc-accent)]"
            >
              new chat +
            </button>
          </div>
        )}
        <p className="mt-1.5 flex items-center justify-between gap-2 px-0.5 font-mono text-[10px] text-[var(--rc-tone3)]">
          <span>
            grounded in{" "}
            <a
              href="https://docs.z.ai/guides/overview/quick-start"
              target="_blank"
              rel="noopener"
              className="underline decoration-dotted underline-offset-2 hover:text-[var(--rc-accent)]"
            >
              docs.z.ai
            </a>{" "}
            · may err, verify there
          </span>
          <a
            href={INVITE_URL}
            target="_blank"
            rel="noopener"
            className="shrink-0 font-semibold text-[var(--rc-accent)] hover:underline"
          >
            10% OFF first sub →
          </a>
        </p>
      </div>
    </div>
  );
}
