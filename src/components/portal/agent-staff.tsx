"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Z-Assist staff panel — the "staff helps users" half of /agent.
 *
 * Gated by the STAFF_PASSCODE runtime env (checked server-side on every
 * call; the passcode lives in sessionStorage only). Three views:
 *  - Stats: users / chats / messages / feedback / learning counters.
 *  - Queue: pending self-learning entries (from verification flags,
 *    downvotes, unanswered questions) → approve with a docs-cited answer
 *    (source URL required) / edit / reject. Approved answers are injected
 *    into future prompts, so the agent improves with time.
 *  - Chats: recent user threads → open any thread read-only and reply as
 *    Staff; the reply lands in the user's own conversation with a
 *    "staff reply" badge.
 */

interface Stats {
  users: number;
  convos: number;
  messages: number;
  feedbacks: number;
  downvotes: number;
  learnPending: number;
  learnApproved: number;
  learnHits: number;
}

interface RecentConv {
  id: string;
  title: string | null;
  count: number;
  updatedAt: string;
  owner: string | null;
}

interface LearnRow {
  id: string;
  question: string;
  answer: string;
  origin: string;
  status: string;
  sourceUrls: string;
  note: string | null;
  hits: number;
  updatedAt: string;
}

interface ThreadMsg {
  role: "user" | "assistant";
  content: string;
  staff?: boolean;
  verify?: { status: string };
}

type View = "stats" | "queue" | "chats";

const KEY = "br-agent-staff-key";

/* --------------------------------- icons ---------------------------------- */

function IconStats({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

function IconQueue({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9 12h6M9 8h6M9 16h4" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function IconChats({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" />
    </svg>
  );
}

/* ------------------------------- api helper -------------------------------- */

async function staffApi<T>(staffKey: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/agent/staff", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ staffKey, ...payload }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(String(data.error ?? "Staff request failed."));
  return data;
}

/* ------------------------------ passcode gate ------------------------------ */

function Gate({ onUnlock }: { onUnlock: (key: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await staffApi(value.trim(), { action: "overview" });
      sessionStorage.setItem(KEY, value.trim());
      onUnlock(value.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wrong passcode.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-hair/10 bg-surface p-6">
        <h2 className="text-[16px] font-light tracking-tight text-bright">Staff access</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-dim">
          Enter the staff passcode to review the learning queue, stats and help users directly.
        </p>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="Staff passcode"
          aria-label="Staff passcode"
          className="mt-4 w-full rounded-xl border border-hair/10 bg-canvas px-3.5 py-2.5 text-[13px] text-bright outline-none transition-colors focus:border-azure/60"
          autoFocus
        />
        {error && <p className="mt-2 text-[12px] text-alert">{error}</p>}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !value.trim()}
          className="mt-3 w-full rounded-xl border border-azure/40 bg-azure/15 px-4 py-2.5 text-[13px] font-medium text-azure2 transition-colors hover:bg-azure/25 disabled:opacity-50"
        >
          {busy ? "Checking…" : "Unlock staff panel"}
        </button>
        <p className="mt-3 font-mono text-[10px] leading-relaxed text-deep">
          passcode lives in the STAFF_PASSCODE runtime env — never in code, never in chat
        </p>
      </div>
    </div>
  );
}

/* ------------------------------- queue view -------------------------------- */

function QueueView({ staffKey, onChanged }: { staffKey: string; onChanged?: () => void }) {
  const [rows, setRows] = useState<LearnRow[]>([]);
  const [resolved, setResolved] = useState<LearnRow[]>([]);
  const [editing, setEditing] = useState<LearnRow | null>(null);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [draftSources, setDraftSources] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await staffApi<{ pending: LearnRow[]; resolved: LearnRow[] }>(staffKey, {
        action: "learnings.list",
      });
      setRows(data.pending ?? []);
      setResolved(data.resolved ?? []);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the queue.");
    }
  }, [staffKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (row: LearnRow) => {
    setEditing(row);
    setDraftAnswer(row.answer);
    setDraftSources(row.sourceUrls);
    setError(null);
  };

  const save = async (status: "approved" | "pending") => {
    if (!editing || busyId) return;
    setBusyId(editing.id);
    setError(null);
    try {
      await staffApi(staffKey, {
        action: "learnings.save",
        id: editing.id,
        question: editing.question,
        answer: draftAnswer,
        sourceUrls: draftSources,
        status,
      });
      setEditing(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (row: LearnRow) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      await staffApi(staffKey, { action: "learnings.reject", id: row.id });
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reject.");
    } finally {
      setBusyId(null);
    }
  };

  const inputCls =
    "w-full rounded-xl border border-hair/10 bg-canvas px-3 py-2 text-[12.5px] text-bright outline-none transition-colors focus:border-azure/60";

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg border border-alert/30 bg-alert/10 px-3 py-2 text-[12px] text-alert">{error}</p>}
      {!loaded && <p className="px-1 py-6 text-center font-mono text-[11px] text-faint">loading queue…</p>}
      {loaded && rows.length === 0 && (
        <p className="px-1 py-6 text-center text-[12.5px] text-dim">
          Queue is empty — nothing to review right now.
        </p>
      )}
      {rows.map((row) => (
        <div key={row.id} className="rounded-xl border border-hair/10 bg-surface p-3.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-amber-300">
              {row.origin}
            </span>
            {row.hits > 0 && (
              <span className="font-mono text-[9.5px] text-faint">{row.hits} hits</span>
            )}
          </div>
          <p className="mt-2 text-[13px] font-medium leading-relaxed text-bright">{row.question}</p>
          {row.answer && (
            <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[12px] leading-relaxed text-dim">{row.answer}</p>
          )}
          {row.note && <p className="mt-1 font-mono text-[10.5px] text-faint">{row.note}</p>}

          {editing?.id === row.id ? (
            <div className="mt-3 space-y-2">
              <textarea
                value={draftAnswer}
                onChange={(e) => setDraftAnswer(e.target.value)}
                rows={5}
                placeholder="Approved answer (facts only, from official docs)"
                aria-label="Approved answer"
                className={inputCls}
              />
              <input
                value={draftSources}
                onChange={(e) => setDraftSources(e.target.value)}
                placeholder="Source URLs (docs.z.ai / zcode.z.ai) — required to approve"
                aria-label="Source URLs"
                className={`${inputCls} font-mono text-[11.5px]`}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void save("approved")}
                  disabled={busyId === row.id}
                  className="rounded-lg border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-[12px] font-medium text-emerald-300 transition-colors hover:bg-emerald-400/25 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void save("pending")}
                  disabled={busyId === row.id}
                  className="rounded-lg border border-hair/20 px-3 py-1.5 text-[12px] text-soft transition-colors hover:bg-hair/5 disabled:opacity-50"
                >
                  Save draft
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-lg px-3 py-1.5 text-[12px] text-faint transition-colors hover:text-body"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => startEdit(row)}
                className="rounded-lg border border-azure/40 bg-azure/10 px-3 py-1.5 text-[12px] text-azure2 transition-colors hover:bg-azure/20"
              >
                Review &amp; approve
              </button>
              <button
                type="button"
                onClick={() => void reject(row)}
                disabled={busyId === row.id}
                className="rounded-lg border border-hair/20 px-3 py-1.5 text-[12px] text-faint transition-colors hover:bg-hair/5 hover:text-alert disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      ))}

      {resolved.length > 0 && (
        <div className="pt-2">
          <p className="px-1 pb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            recently resolved
          </p>
          {resolved.slice(0, 6).map((row) => (
            <div key={row.id} className="mb-1.5 rounded-lg border border-hair/10 px-3 py-2">
              <p className="text-[12px] text-soft">{row.question}</p>
              <p className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
                {row.status}
                {row.status === "approved" && row.hits > 0 ? ` · used ${row.hits}x` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- chats view -------------------------------- */

function ChatsView({ staffKey }: { staffKey: string }) {
  const [recent, setRecent] = useState<RecentConv[]>([]);
  const [open, setOpen] = useState<{ id: string; title: string | null; owner: string | null; messages: ThreadMsg[] } | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await staffApi<{ recent: RecentConv[] }>(staffKey, { action: "overview" });
      setRecent(data.recent ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load chats.");
    }
  }, [staffKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const openConv = async (id: string) => {
    setError(null);
    try {
      const data = await staffApi<{
        id: string;
        title: string | null;
        owner: string | null;
        messages: ThreadMsg[];
      }>(staffKey, { action: "convs.get", convId: id });
      setOpen(data);
      setReply("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the thread.");
    }
  };

  const sendReply = async () => {
    if (!open || !reply.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await staffApi(staffKey, { action: "conv.reply", convId: open.id, text: reply.trim() });
      await openConv(open.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the staff reply.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg border border-alert/30 bg-alert/10 px-3 py-2 text-[12px] text-alert">{error}</p>}
      {open ? (
        <div>
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="mb-2 rounded-lg border border-hair/20 px-3 py-1.5 text-[12px] text-soft transition-colors hover:bg-hair/5"
          >
            ← All chats
          </button>
          <div className="rounded-xl border border-hair/10 bg-surface p-3.5">
            <p className="text-[13px] font-medium text-bright">{open.title ?? "Untitled thread"}</p>
            {open.owner && <p className="mt-0.5 font-mono text-[10px] text-faint">user: {open.owner}</p>}
            <div className="mt-3 max-h-[46vh] space-y-2.5 overflow-y-auto pr-1">
              {open.messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "text-right" : ""}>
                  <div
                    className={`inline-block max-w-[88%] rounded-xl px-3 py-2 text-left text-[12.5px] leading-relaxed ${
                      m.role === "user"
                        ? "border border-azure/30 bg-azure/10 text-bright"
                        : m.staff
                          ? "border border-emerald-400/40 bg-emerald-400/10 text-bright"
                          : "border border-hair/15 text-soft"
                    }`}
                  >
                    {m.staff && (
                      <span className="mb-0.5 block font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-300">
                        staff
                      </span>
                    )}
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                placeholder="Reply as Staff — lands in the user's own chat with a staff badge"
                aria-label="Staff reply"
                className="w-full rounded-xl border border-hair/10 bg-canvas px-3 py-2 text-[12.5px] text-bright outline-none transition-colors focus:border-azure/60"
              />
              <button
                type="button"
                onClick={() => void sendReply()}
                disabled={busy || !reply.trim()}
                className="rounded-lg border border-emerald-400/40 bg-emerald-400/15 px-3.5 py-2 text-[12px] font-medium text-emerald-300 transition-colors hover:bg-emerald-400/25 disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send staff reply"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        recent.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => void openConv(c.id)}
            className="flex w-full items-center gap-3 rounded-xl border border-hair/10 bg-surface px-3.5 py-3 text-left transition-colors hover:border-azure/40"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-bright">{c.title ?? "Untitled thread"}</p>
              <p className="mt-0.5 font-mono text-[10px] text-faint">
                {c.owner ?? "unknown user"} · {c.count} msg · {new Date(c.updatedAt).toLocaleDateString()}
              </p>
            </div>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-azure">open</span>
          </button>
        ))
      )}
    </div>
  );
}

/* --------------------------------- panel ----------------------------------- */

export function AgentStaffPanel({ onExit }: { onExit: () => void }) {
  const [staffKey, setStaffKey] = useState<string | null>(() => {
    try {
      return typeof window !== "undefined" ? sessionStorage.getItem(KEY) : null;
    } catch {
      return null;
    }
  });
  const [view, setView] = useState<View>("stats");
  const [stats, setStats] = useState<Stats | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/agent/staff")
      .then((r) => r.json())
      .then((d: { enabled?: boolean }) => {
        if (alive) setEnabled(Boolean(d.enabled));
      })
      .catch(() => {
        if (alive) setEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const loadStats = useCallback(async (key: string) => {
    try {
      const data = await staffApi<{ stats: Stats }>(key, { action: "overview" });
      setStats(data.stats);
    } catch {
      setStats(null);
    }
  }, []);

  if (enabled === false && !staffKey) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="w-full max-w-sm rounded-2xl border border-hair/10 bg-surface p-6 text-center">
          <p className="text-[13.5px] text-bright">Staff mode is disabled</p>
          <p className="mt-2 text-[12px] leading-relaxed text-dim">
            Set the <code className="font-mono text-azure2">STAFF_PASSCODE</code> runtime environment
            variable (min 6 chars) and redeploy to enable the staff panel.
          </p>
          <button
            type="button"
            onClick={onExit}
            className="mt-4 rounded-lg border border-hair/20 px-4 py-2 text-[12px] text-soft transition-colors hover:bg-hair/5"
          >
            Back to chat
          </button>
        </div>
      </div>
    );
  }

  if (!staffKey) {
    return (
      <Gate
        onUnlock={(key) => {
          setStaffKey(key);
          void loadStats(key);
        }}
      />
    );
  }

  const statCards: Array<[string, number | string]> = stats
    ? [
        ["users", stats.users],
        ["chats", stats.convos],
        ["messages", stats.messages],
        ["downvotes", stats.downvotes],
        ["queue", stats.learnPending],
        ["learned", stats.learnApproved],
        ["learn hits", stats.learnHits],
        ["feedback", stats.feedbacks],
      ]
    : [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-light tracking-tight text-bright">Staff panel</h1>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            Z-Assist trust loop · review · coach · learn
          </p>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="rounded-lg border border-hair/20 px-3 py-1.5 text-[12px] text-soft transition-colors hover:bg-hair/5"
        >
          Exit staff
        </button>
      </div>

      <div className="mt-4 flex gap-1 rounded-xl border border-hair/10 bg-surface p-1" role="tablist" aria-label="Staff views">
        {(
          [
            ["stats", "Stats", IconStats],
            ["queue", `Queue${stats ? ` (${stats.learnPending})` : ""}`, IconQueue],
            ["chats", "Chats", IconChats],
          ] as Array<[View, string, (p: { className?: string }) => React.JSX.Element]>
        ).map(([v, label, Icon]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => {
              setView(v);
              if (v === "stats" && staffKey) void loadStats(staffKey);
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] transition-colors ${
              view === v ? "bg-azure/15 text-azure2" : "text-faint hover:text-body"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {view === "stats" && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {statCards.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-hair/10 bg-surface px-3.5 py-3">
                <p className="font-mono text-[19px] font-light text-bright">{value}</p>
                <p className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">{label}</p>
              </div>
            ))}
            {stats && stats.learnPending > 0 && (
              <button
                type="button"
                onClick={() => setView("queue")}
                className="col-span-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3.5 py-3 text-left transition-colors hover:bg-amber-400/20 sm:col-span-4"
              >
                <p className="text-[12.5px] text-amber-200">
                  {stats.learnPending} question{stats.learnPending === 1 ? "" : "s"} waiting for review —
                  approve docs-cited answers and the agent gets smarter immediately.
                </p>
              </button>
            )}
          </div>
        )}
        {view === "queue" && <QueueView staffKey={staffKey} onChanged={() => void loadStats(staffKey)} />}
        {view === "chats" && <ChatsView staffKey={staffKey} />}
      </div>
    </div>
  );
}
