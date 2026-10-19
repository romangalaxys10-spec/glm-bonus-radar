"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { parseAssistReply } from "@/lib/assist-blocks";
import {
  CheckIcon,
  ChatMsg,
  CopyIcon,
  EmptyState,
  MessageBubble,
  ThinkingBubble,
  toChatMsg,
  uid,
} from "@/components/portal/agent-messages";
import { CONV_KEY, MODEL_KEY, type AgentUser } from "@/components/portal/agent-storage";
import { ModeToggle } from "@/components/portal/mode-toggle";

/**
 * Z-Assist chat shell — the chat.z.ai-style workspace: conversation drawer
 * (new chat / resume / delete), model switch (Support ↔ Code), message thread
 * with generative-UI blocks, and a composer with typewriter reveal.
 * Threads persist server-side under the user's ZA- token.
 */

interface ConvSummary {
  id: string;
  title: string | null;
  count: number;
  createdAt: string;
  updatedAt: string;
}

type Model = "assist" | "code";

const MAX_INPUT = 2000;

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* --------------------------------- icons ---------------------------------- */

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden>
      <path d="M12 5v14M5 12h14" />
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

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/* -------------------------------- the shell ------------------------------- */

export function ChatShell({
  user,
  onSignOut,
  onInvalidToken,
}: {
  user: AgentUser;
  onSignOut: () => void;
  /** Called when the server answers "Unknown token" — a redeploy reset the
   *  DB mid-session. The parent re-issues a token (same name) and remounts
   *  this shell with the new identity via key. */
  onInvalidToken: (stale: AgentUser) => void;
}) {
  const [convs, setConvs] = useState<ConvSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [threadBusy, setThreadBusy] = useState(false);
  const [model, setModel] = useState<Model>("assist");
  const [drawer, setDrawer] = useState(false);
  const [reveal, setReveal] = useState<{ id: string; shown: number } | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const refreshConvs = useCallback(async () => {
    setListError(null);
    try {
      const res = await fetch(`/api/agent/conversations?token=${encodeURIComponent(user.token)}`);
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 404 && String(data.error ?? "").startsWith("Unknown token")) {
          onInvalidToken(user);
          return;
        }
        throw new Error(String(data.error ?? "Could not load chats."));
      }
      setConvs((data.conversations as ConvSummary[]) ?? []);
    } catch {
      setConvs([]);
      setListError("Chats list unavailable — you can still chat.");
    }
  }, [user, onInvalidToken]);

  const openConversation = useCallback(
    async (id: string) => {
      setDrawer(false);
      if (id === activeIdRef.current) return;
      setThreadBusy(true);
      try {
        const res = await fetch(
          `/api/agent/conversations?token=${encodeURIComponent(user.token)}&id=${encodeURIComponent(id)}`,
        );
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 404 && String(data.error ?? "").startsWith("Unknown token")) {
            onInvalidToken(user);
            return;
          }
          throw new Error(String(data.error ?? "Could not open that chat."));
        }
        const msgs = (data.messages as Array<{ role: "user" | "assistant"; content: string }>).map(toChatMsg);
        setMessages(msgs);
        setActiveId(id);
        setReveal(null);
        try {
          localStorage.setItem(CONV_KEY, id);
        } catch {
          /* ignore */
        }
      } catch {
        // Thread vanished (or not ours) — drop it from the drawer, stay in draft.
        setConvs((prev) => prev?.filter((c) => c.id !== id) ?? prev);
        setActiveId(null);
        setMessages([]);
      } finally {
        setThreadBusy(false);
      }
    },
    [user, onInvalidToken],
  );

  /* Mount: restore model pref + last open thread, load the drawer. */
  useEffect(() => {
    try {
      const m = localStorage.getItem(MODEL_KEY);
      if (m === "code" || m === "assist") setModel(m);
      const c = localStorage.getItem(CONV_KEY);
      if (c) void openConversation(c);
    } catch {
      /* ignore */
    }
    void refreshConvs();
  }, []);

  /* Abort in-flight chat when the tab closes. */
  useEffect(() => () => abortRef.current?.abort(), []);

  /* Typewriter reveal for the latest reply (reduced-motion safe). */
  useEffect(() => {
    if (!reveal) return;
    const msg = messages.find((m) => m.id === reveal.id);
    if (!msg) {
      setReveal(null);
      return;
    }
    const reduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setReveal(null);
      return;
    }
    const step = Math.max(3, Math.floor(msg.content.length / 140));
    const timer = window.setInterval(() => {
      setReveal((r) => {
        if (!r || r.id !== reveal.id) return r;
        const next = r.shown + step;
        return next >= msg.content.length ? null : { id: r.id, shown: next };
      });
    }, 18);
    return () => window.clearInterval(timer);
  }, [reveal?.id, messages, reveal]);

  /* Keep the thread pinned to the bottom while it grows. */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, reveal?.shown, sending]);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setReveal(null);
    setInput("");
    setDrawer(false);
    try {
      localStorage.removeItem(CONV_KEY);
    } catch {
      /* ignore */
    }
    composerRef.current?.focus();
  }, []);

  const deleteConv = useCallback(
    async (id: string) => {
      try {
        await fetch(
          `/api/agent/conversations?token=${encodeURIComponent(user.token)}&id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
      } catch {
        /* best-effort */
      }
      setConvs((prev) => prev?.filter((c) => c.id !== id) ?? prev);
      if (activeIdRef.current === id) newChat();
    },
    [user.token, newChat],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || threadBusy) return;

    const userMsg: ChatMsg = { id: uid(), role: "user", content: text };
    const wire = [...messages.filter((m) => !m.error), { role: "user" as const, content: text }];
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    const ctl = new AbortController();
    abortRef.current = ctl;

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: user.token, id: activeId, model, messages: wire }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 404 && String(data.error ?? "").includes("Unknown token")) {
          // Dead identity (redeploy reset the DB) — heal instead of dead-ending.
          onInvalidToken(user);
          throw new Error("Your access token went stale — issuing a fresh one for you…");
        }
        throw new Error(String(data.error ?? "Z-Assist could not reply."));
      }

      const parsed = parseAssistReply(String(data.reply ?? ""));
      const replyMsg: ChatMsg = {
        id: uid(),
        role: "assistant",
        content: parsed.text,
        ...(parsed.blocks.length > 0 ? { blocks: parsed.blocks } : {}),
      };
      setMessages((prev) => [...prev, replyMsg]);
      if (parsed.text) setReveal({ id: replyMsg.id, shown: 0 });

      const newId = typeof data.id === "string" ? data.id : null;
      const title = typeof data.title === "string" ? data.title : null;
      if (newId && !activeIdRef.current) {
        setActiveId(newId);
        try {
          localStorage.setItem(CONV_KEY, newId);
        } catch {
          /* ignore */
        }
        setConvs((prev) =>
          [
            {
              id: newId,
              title,
              count: wire.length + 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            ...(prev ?? []).filter((c) => c.id !== newId),
          ].slice(0, 60),
        );
      } else if (newId) {
        setConvs((prev) =>
          (prev ?? []).map((c) =>
            c.id === newId ? { ...c, updatedAt: new Date().toISOString(), title: title ?? c.title } : c,
          ),
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const msgText = err instanceof Error ? err.message : "Z-Assist could not reply.";
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "assistant", content: msgText, error: true },
      ]);
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [input, sending, threadBusy, messages, user, activeId, model, onInvalidToken]);

  const switchModel = (m: Model) => {
    setModel(m);
    try {
      localStorage.setItem(MODEL_KEY, m);
    } catch {
      /* ignore */
    }
  };

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(user.token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const activeTitle = activeId ? convs?.find((c) => c.id === activeId)?.title ?? "Chat" : "New chat";

  const sidebar = (
    <SidebarContent
      user={user}
      convs={convs}
      listError={listError}
      activeId={activeId}
      onNewChat={newChat}
      onOpen={openConversation}
      onDelete={deleteConv}
      onRetryList={refreshConvs}
      onSignOut={onSignOut}
      onCopyToken={copyToken}
      copiedToken={copiedToken}
    />
  );

  return (
    <div className="zs flex h-[100dvh] overflow-hidden bg-canvas text-body antialiased selection:bg-azure/30">
      {/* Desktop sidebar */}
      <aside className="hidden w-[280px] shrink-0 flex-col border-r border-hair/10 bg-surface md:flex">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Chats">
          <button
            type="button"
            aria-label="Close chats menu"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-[320px] flex-col border-r border-hair/10 bg-surface shadow-2xl">
            <button
              type="button"
              onClick={() => setDrawer(false)}
              aria-label="Close"
              className="absolute right-2.5 top-2.5 rounded-lg p-1.5 text-faint hover:bg-hair/5 hover:text-body"
            >
              <XIcon className="h-4 w-4" />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-hair/10 bg-canvas/90 px-3 backdrop-blur-md sm:px-4">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open chats menu"
            className="rounded-lg p-1.5 text-dim transition-colors hover:bg-hair/5 hover:text-body md:hidden"
          >
            <MenuIcon className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-light tracking-tight text-body">{activeTitle}</p>
            <p className="hidden font-mono text-[9px] uppercase tracking-[0.18em] text-deep sm:block">
              {model === "code" ? "Z-Code · general + vision" : "Z-Assist · docs.z.ai + zcode.z.ai"}
            </p>
          </div>
          <ModeToggle className="hidden sm:inline-flex" />
          <div className="flex shrink-0 items-center rounded-full border border-hair/10 bg-surface p-0.5" role="group" aria-label="Agent mode">
            {(
              [
                ["assist", "Support"],
                ["code", "Code"],
              ] as Array<[Model, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => switchModel(id)}
                aria-pressed={model === id}
                title={
                  id === "assist"
                    ? "Z-Assist — z.ai docs-grounded support"
                    : "Z-Code — general-purpose engineering & vision"
                }
                className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                  model === id ? "bg-azure text-onaccent" : "text-faint hover:text-body"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {threadBusy ? (
            <div className="flex h-full items-center justify-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-deep">loading chat…</p>
            </div>
          ) : messages.length === 0 ? (
            <EmptyState name={user.name} onPick={(q) => { setInput(q); composerRef.current?.focus(); }} />
          ) : (
            <div className="mx-auto max-w-3xl space-y-5 px-3 py-5 sm:px-5">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  msg={m}
                  revealText={reveal?.id === m.id ? m.content.slice(0, reveal.shown) : null}
                />
              ))}
              {sending && <ThinkingBubble />}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-hair/10 bg-canvas/95 px-3 pb-3 pt-2.5 sm:px-5">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2 rounded-2xl border border-hair/10 bg-surface px-3 py-2 transition-colors focus-within:border-azure/50">
              <textarea
                ref={composerRef}
                value={input}
                rows={1}
                maxLength={MAX_INPUT}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder={model === "code" ? "Ask Z-Code anything — code, debugging, vision…" : "Ask about GLM models, plans, quotas…"}
                aria-label="Message Z-Assist"
                className="max-h-40 min-h-[24px] w-full resize-none bg-transparent py-1 text-[16px] leading-relaxed text-body outline-none placeholder:text-deep"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || input.trim().length === 0}
                aria-label="Send message"
                className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-azure text-onaccent transition-[transform,opacity] hover:bg-azure2 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <SendIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between px-1">
              <p className="font-mono text-[9.5px] leading-relaxed text-deep">
                Enter to send · Shift+Enter for a new line · answers from official z.ai docs — verify critical details
              </p>
              {input.length > 1800 && (
                <p className="ml-2 shrink-0 font-mono text-[9.5px] text-faint">
                  {input.length}/{MAX_INPUT}
                </p>
              )}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------ sidebar content --------------------------- */

function SidebarContent({
  user,
  convs,
  listError,
  activeId,
  onNewChat,
  onOpen,
  onDelete,
  onRetryList,
  onSignOut,
  onCopyToken,
  copiedToken,
}: {
  user: AgentUser;
  convs: ConvSummary[] | null;
  listError: string | null;
  activeId: string | null;
  onNewChat: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRetryList: () => void;
  onSignOut: () => void;
  onCopyToken: () => void;
  copiedToken: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-4 pt-4">
        <Link href="/" className="flex items-center gap-2.5" aria-label="GLM Bonus Radar home">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-azure/40 bg-azure/15 font-mono text-sm font-semibold text-azure2">
            Z
          </div>
          <div>
            <p className="text-[14px] font-medium leading-tight text-bright">Z-Assist</p>
            <p className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-faint">
              z.ai support agent
            </p>
          </div>
        </Link>
        <button
          type="button"
          onClick={onNewChat}
          className="mt-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-azure text-[12.5px] font-medium text-onaccent transition-colors hover:bg-azure2 active:scale-[0.98]"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          New chat
        </button>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        <p className="px-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-deep">chats</p>
        {listError && (
          <button
            type="button"
            onClick={onRetryList}
            className="mt-1.5 w-full rounded-lg px-1.5 py-1 text-left text-[11px] text-faint underline decoration-dotted hover:text-soft"
          >
            {listError} — retry
          </button>
        )}
        {convs === null && (
          <p className="mt-2 px-1.5 font-mono text-[10px] text-deep">loading…</p>
        )}
        {convs !== null && convs.length === 0 && (
          <p className="mt-2 px-1.5 text-[11.5px] leading-relaxed text-deep">
            No chats yet — start one and it will wait for you here.
          </p>
        )}
        <ul className="mt-1.5 space-y-0.5">
          {(convs ?? []).map((c) => {
            const active = c.id === activeId;
            return (
              <li key={c.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  aria-current={active ? "true" : undefined}
                  className={`w-full rounded-lg px-2.5 py-2 pr-8 text-left transition-colors ${
                    active ? "bg-azure/[0.14] text-bright" : "text-dim hover:bg-hair/[0.05] hover:text-body"
                  }`}
                >
                  <span className="block truncate text-[12.5px] leading-snug">
                    {c.title || "Untitled chat"}
                  </span>
                  <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.14em] text-deep">
                    {relTime(c.updatedAt)} · {c.count} msg{c.count === 1 ? "" : "s"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(c.id)}
                  aria-label={`Delete chat: ${c.title || "Untitled chat"}`}
                  className="absolute right-1.5 top-2 rounded-md p-1 text-deep opacity-0 transition-opacity hover:bg-hair/5 hover:text-alert focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="shrink-0 border-t border-hair/10 px-3 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hair/10 bg-hair/[0.06] text-[12px] font-semibold uppercase text-body">
            {user.name.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] leading-tight text-body">{user.name}</p>
            <button
              type="button"
              onClick={onCopyToken}
              title="Copy your personal access token"
              className="inline-flex items-center gap-1 font-mono text-[9.5px] tracking-[0.1em] text-faint transition-colors hover:text-azure2"
            >
              {copiedToken ? <CheckIcon className="h-2.5 w-2.5" /> : <CopyIcon className="h-2.5 w-2.5" />}
              {user.token}
            </button>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            title="Forget this device (chats stay safe under your token)"
            aria-label="Forget this device"
            className="rounded-lg p-1.5 text-faint transition-colors hover:bg-hair/5 hover:text-body"
          >
            <LogoutIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        <Link
          href="/agent-vps"
          className="mt-2.5 block rounded-xl border border-hair/10 bg-canvas px-3 py-2 transition-colors hover:border-azure/40"
        >
          <p className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-deep">
            sponsored · xshredo
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-soft">
            24x7 Agent VPS — run AI agents around the clock, from $5.75/mo →
          </p>
        </Link>
      </div>
    </div>
  );
}
