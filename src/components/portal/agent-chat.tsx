"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChatShell } from "@/components/portal/agent-shell";
import { CONV_KEY, NAME_KEY, TOKEN_KEY, type AgentUser } from "@/components/portal/agent-storage";

/**
 * Z-Assist full-page chat at /agent — the app shell and onboarding gate.
 *
 * Access flow (per the portal spec): a visitor enters their name, receives a
 * personal access token (ZA-XXXXXX), and from then on the chat UI is theirs —
 * start new chats, continue earlier ones, on any device that holds the token.
 * The token IS the account: no password, no email. Conversations live
 * server-side (Prisma) and are owned by the token; the device keeps a copy in
 * localStorage purely for convenience.
 */

export { TOKEN_KEY, NAME_KEY, CONV_KEY } from "@/components/portal/agent-storage";
export type { AgentUser } from "@/components/portal/agent-storage";

type Phase = "boot" | "gate" | "app";

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

/* ------------------------------ root component ---------------------------- */

export function AgentChatApp() {
  const [phase, setPhase] = useState<Phase>("boot");
  const [user, setUser] = useState<AgentUser | null>(null);

  const saveSession = useCallback((u: AgentUser) => {
    try {
      localStorage.setItem(TOKEN_KEY, u.token);
      localStorage.setItem(NAME_KEY, u.name);
    } catch {
      /* private mode — session stays in memory for this tab */
    }
    setUser(u);
    setPhase("app");
  }, []);

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(NAME_KEY);
      localStorage.removeItem(CONV_KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
    setPhase("gate");
  }, []);

  /* Boot: validate the locally stored token against the server. */
  useEffect(() => {
    let alive = true;
    (async () => {
      let stored: string | null = null;
      let name: string | null = null;
      try {
        stored = localStorage.getItem(TOKEN_KEY);
        name = localStorage.getItem(NAME_KEY);
      } catch {
        /* private mode */
      }
      if (!stored || !/^ZA-[A-Z0-9]{6}$/.test(stored)) {
        if (alive) setPhase("gate");
        return;
      }
      try {
        const res = await fetch("/api/agent/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: stored }),
        });
        if (!res.ok) throw new Error("session invalid");
        const data = (await res.json()) as { name: string; token: string };
        if (alive) {
          setUser({ name: data.name, token: data.token });
          setPhase("app");
        }
      } catch {
        // Network hiccup: fall back to the locally remembered name rather than
        // locking a returning user out; the next chat call re-validates.
        if (alive) {
          if (name) {
            setUser({ name, token: stored });
            setPhase("app");
          } else {
            setPhase("gate");
          }
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (phase === "boot") {
    return (
      <div className="zs flex h-[100dvh] flex-col items-center justify-center bg-canvas text-body">
        <div className="flex h-10 w-10 animate-pulse items-center justify-center rounded-xl border border-azure/40 bg-azure/15 font-mono text-lg font-semibold text-azure2">
          Z
        </div>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
          opening Z-Assist
        </p>
      </div>
    );
  }

  if (phase === "gate") {
    return <Gate onReady={saveSession} />;
  }

  return <ChatShell user={user!} onSignOut={signOut} />;
}

/* ------------------------------ onboarding gate --------------------------- */

function Gate({ onReady }: { onReady: (u: AgentUser) => void }) {
  const [mode, setMode] = useState<"name" | "restore">("name");
  const [name, setName] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<AgentUser | null>(null);
  const [copied, setCopied] = useState(false);

  const register = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/agent/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error ?? "Registration failed."));
      setIssued({ name: data.name, token: data.token });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/agent/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: tokenInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error ?? "Could not restore."));
      onReady({ name: data.name, token: data.token });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore.");
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  /* ---- issued: the one-time token reveal screen ---- */
  if (issued) {
    return (
      <div className="zs flex min-h-[100dvh] flex-col items-center justify-center bg-canvas px-4 py-10 text-body antialiased selection:bg-azure/30">
        <div className="w-full max-w-md rounded-2xl border border-hair/10 bg-surface p-6 sm:p-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
            personal access token
          </p>
          <h1 className="mt-2 text-[22px] font-light tracking-tight text-bright">
            Welcome, {issued.name} — this is your key.
          </h1>
          <button
            type="button"
            onClick={copyToken}
            className="mt-5 flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-azure/50 bg-azure/[0.08] px-4 py-3.5 transition-colors hover:bg-azure/[0.14]"
            aria-label="Copy your personal access token"
          >
            <span className="font-mono text-[20px] font-semibold tracking-[0.12em] text-azure2">
              {issued.token}
            </span>
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
              {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
              {copied ? "copied" : "copy"}
            </span>
          </button>
          <ul className="mt-5 space-y-2 text-[12.5px] leading-relaxed text-dim">
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-azure" />
              Save it now — this token IS your account. It restores your name and every chat on any
              device.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-azure" />
              Chats are stored in the portal database under this token — continue earlier threads
              anytime, start new ones with one click.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-azure" />
              For your privacy there is no password or email — we cannot recover a lost token, so
              keep a copy somewhere safe.
            </li>
          </ul>
          <button
            type="button"
            onClick={() => onReady(issued)}
            className="mt-6 h-10 w-full rounded-full bg-bright text-[13.5px] font-medium text-canvas transition-transform hover:bg-hair active:scale-[0.98]"
          >
            Save &amp; enter chat
          </button>
        </div>
        <Link
          href="/"
          className="mt-6 font-mono text-[11px] text-faint transition-colors hover:text-soft"
        >
          ← back to the portal
        </Link>
      </div>
    );
  }

  /* ---- default: name entry / token restore ---- */
  return (
    <div className="zs flex min-h-[100dvh] flex-col items-center justify-center bg-canvas px-4 py-10 text-body antialiased selection:bg-azure/30">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-azure/40 bg-azure/15 font-mono text-base font-semibold text-azure2">
            Z
          </div>
          <div>
            <p className="text-[15px] font-medium leading-tight text-bright">Z-Assist</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">
              GLM Bonus Radar
            </p>
          </div>
        </div>

        <h1 className="mt-6 text-[26px] font-light leading-tight tracking-tight text-bright sm:text-[30px]">
          Your z.ai support agent.
        </h1>
        <p className="mt-2.5 text-[13.5px] leading-relaxed text-dim">
          Ask anything about GLM models, coding plans, API usage, quotas and bonus windows —
          grounded in the official docs (docs.z.ai), with answers you can interact with.
        </p>

        {mode === "name" ? (
          <form
            className="mt-7"
            onSubmit={(e) => {
              e.preventDefault();
              void register();
            }}
          >
            <label htmlFor="agent-name" className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
              first, what should we call you?
            </label>
            <input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={40}
              autoComplete="given-name"
              className="mt-2 h-11 w-full rounded-xl border border-hair/10 bg-surface px-4 text-[16px] text-body outline-none transition-colors placeholder:text-deep focus:border-azure/60 focus:bg-azure/[0.04]"
            />
            <button
              type="submit"
              disabled={busy || name.trim().length === 0}
              className="mt-3 h-10 w-full rounded-full bg-bright text-[13.5px] font-medium text-canvas transition-transform hover:bg-hair active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "issuing your token…" : "Continue — get my access token"}
            </button>
          </form>
        ) : (
          <form
            className="mt-7"
            onSubmit={(e) => {
              e.preventDefault();
              void restore();
            }}
          >
            <label htmlFor="agent-token" className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
              restore with your personal access token
            </label>
            <input
              id="agent-token"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value.toUpperCase())}
              placeholder="ZA-XXXXXX"
              maxLength={9}
              spellCheck={false}
              autoComplete="off"
              className="mt-2 h-11 w-full rounded-xl border border-hair/10 bg-surface px-4 font-mono text-[16px] tracking-[0.12em] text-body outline-none transition-colors placeholder:text-deep focus:border-azure/60 focus:bg-azure/[0.04]"
            />
            <button
              type="submit"
              disabled={busy || tokenInput.trim().length < 9}
              className="mt-3 h-10 w-full rounded-full bg-bright text-[13.5px] font-medium text-canvas transition-transform hover:bg-hair active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "checking…" : "Restore my chats"}
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[12.5px] leading-relaxed text-alert">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === "name" ? "restore" : "name");
            setError(null);
          }}
          className="mt-4 text-[12.5px] text-dim underline decoration-dotted underline-offset-4 transition-colors hover:text-azure2"
        >
          {mode === "name" ? "Already have a token? Restore your chats →" : "New here? Get a token with your name →"}
        </button>

        <p className="mt-6 font-mono text-[10px] leading-relaxed text-deep">
          Your name + token are stored in the portal DB to keep your chats resumable. No password,
          no email, no tracking. Community portal — not official z.ai support.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block font-mono text-[11px] text-faint transition-colors hover:text-soft"
        >
          ← back to the portal
        </Link>
      </div>
    </div>
  );
}
