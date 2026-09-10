"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client console for the secret /endpoint section: password gate, endpoint
 * key management, copy-paste setup snippets for Claude Code / zcode, and a
 * tiny live test chat that proves the endpoint works end-to-end.
 */

const STORAGE_KEY = "br-endpoint-key";

interface KeyInfo {
  key: string;
  callCount: number;
  conversationToken: string | null;
  lastUsedAt?: string | null;
  createdAt?: string;
}

type Status = "checking" | "locked" | "unlocked";

function maskKey(key: string): string {
  return key.length > 20 ? `${key.slice(0, 12)}…${key.slice(-4)}` : key;
}

function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-lg border border-[var(--rc-border)] px-2.5 py-1 font-mono text-[11px] text-[var(--rc-text-dim)] transition-colors hover:border-[var(--rc-accent)] hover:text-[var(--rc-accent)]"
    >
      {done ? "copied ✓" : label}
    </button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-4 pr-20 font-mono text-[12px] leading-relaxed text-[var(--rc-text)]">
        {code}
      </pre>
      <div className="absolute top-3 right-3">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

export function EndpointClient() {
  const [status, setStatus] = useState<Status>("checking");
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [origin, setOrigin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"claude" | "zcode" | "curl">("claude");
  const [revealed, setRevealed] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setStatus("locked");
      return;
    }
    fetch(`/api/endpoint/auth?key=${encodeURIComponent(stored)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("stale");
        const data = await res.json();
        setInfo(data);
        setStatus("unlocked");
      })
      .catch(() => {
        localStorage.removeItem(STORAGE_KEY);
        setStatus("locked");
      });
  }, []);

  const unlock = useCallback(
    async (pwd: string, regenerate = false) => {
      if (!pwd) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/endpoint/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: pwd, ...(regenerate ? { action: "regenerate" } : {}) }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Unlock failed.");
          return;
        }
        setInfo(data);
        localStorage.setItem(STORAGE_KEY, data.key);
        setStatus("unlocked");
        setPassword("");
        setRevealed(false);
      } catch {
        setError("Network error — try again.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const regenerate = useCallback(() => {
    const pwd = window.prompt("Confirm with the section password to rotate the key.\nThe old key stops working immediately.");
    if (pwd) void unlock(pwd, true);
  }, [unlock]);

  const ask = useCallback(async () => {
    if (!info || !question.trim() || asking) return;
    setAsking(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/endpoint/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${info.key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "z-assist",
          messages: [{ role: "user", content: question.trim() }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAnswer(`✗ ${data?.error?.message ?? `HTTP ${res.status}`}`);
        return;
      }
      setAnswer(data.choices?.[0]?.message?.content ?? "(empty reply)");
      const token = info.conversationToken;
      if (!token) {
        // first call mints the mirrored web thread — refresh quietly
        const fresh = await fetch(`/api/endpoint/auth?key=${encodeURIComponent(info.key)}`);
        if (fresh.ok) setInfo(await fresh.json());
      }
    } catch {
      setAnswer("✗ Network error.");
    } finally {
      setAsking(false);
    }
  }, [info, question, asking]);

  /* ------------------------------- locked ------------------------------- */

  if (status === "checking") {
    return (
      <p className="mt-24 text-center font-mono text-sm text-[var(--rc-text-dim)]">checking access…</p>
    );
  }

  if (status === "locked") {
    return (
      <div className="mt-16 flex justify-center">
        <div className="w-full max-w-sm rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-7 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--rc-border)] text-lg" aria-hidden>
              🔒
            </span>
            <div>
              <h1 className="font-semibold text-[var(--rc-text)]">Z-Assist · IDE endpoint</h1>
              <p className="text-xs text-[var(--rc-text-dim)]">Private section — password required</p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock(password);
            }}
            className="space-y-3"
          >
            <input
              ref={pwRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="section password"
              autoFocus
              className="w-full rounded-xl border border-[var(--rc-border)] bg-[var(--rc-bg)] px-4 py-2.5 font-mono text-sm text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)]"
            />
            <button
              type="submit"
              disabled={busy || !password}
              className="w-full rounded-xl bg-[var(--rc-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--rc-on-accent)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "unlocking…" : "Unlock"}
            </button>
          </form>
          {error ? <p className="mt-3 font-mono text-xs text-red-500">{error}</p> : null}
          <p className="mt-5 border-t border-[var(--rc-border)] pt-4 text-[11px] leading-relaxed text-[var(--rc-text-dim)]">
            This console issues the secret key that lets IDE tools (zcode, Claude Code) chat with
            Z-Assist over an OpenAI/Anthropic-compatible endpoint. Keep it to yourself.
          </p>
        </div>
      </div>
    );
  }

  /* ------------------------------ unlocked ------------------------------ */

  const key = info?.key ?? "";
  const base = origin;
  const snippets = {
    claude: `# 1) point Claude Code at Z-Assist
export ANTHROPIC_BASE_URL="${base}/api/endpoint"
export ANTHROPIC_AUTH_TOKEN="${key}"
export ANTHROPIC_MODEL="z-assist"
export ANTHROPIC_SMALL_FAST_MODEL="z-assist"

# 2) chat — answers come from the docs-grounded Z-Assist brain
claude "when is the next bonus window?"`,
    zcode: `# Any tool that accepts a custom OpenAI-compatible base URL
# (zcode, Cline, Continue, aider, …)
export OPENAI_BASE_URL="${base}/api/endpoint/v1"
export OPENAI_API_KEY="${key}"

# model id: z-assist
# endpoint: POST ${base}/api/endpoint/v1/chat/completions`,
    curl: `# OpenAI dialect
curl -s ${base}/api/endpoint/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"z-assist","messages":[{"role":"user","content":"When is the next bonus window?"}]}'

# Anthropic dialect (what Claude Code speaks)
curl -s ${base}/api/endpoint/v1/messages \\
  -H "x-api-key: ${key}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"z-assist","max_tokens":1024,"messages":[{"role":"user","content":"What is the current credit phase?"}]}'`,
  };

  return (
    <div className="mt-8 space-y-6">
      {/* intro */}
      <section>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--rc-text)] md:text-3xl">
          Z-Assist IDE endpoint
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--rc-text-dim)]">
          Chat with Z-Assist from your IDE. Tools speak either the OpenAI- or the
          Anthropic-compatible dialect below — both are answered by the same docs-grounded brain as
          the web chat, and every thread is mirrored to the web so you can continue it there.
        </p>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--rc-text-dim)]">
          <span className="font-semibold text-[var(--rc-text)]">Unlimited questions</span> — the
          daily 5-question cap only applies to the Telegram bot. This endpoint has no daily limit,
          just a 60 req / 5 min fair-use guard.
        </p>
      </section>

      {/* secret key */}
      <section className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] tracking-widest text-[var(--rc-text-dim)] uppercase">
              endpoint key
            </p>
            <p className="mt-1 truncate font-mono text-sm text-[var(--rc-text)]" title={revealed ? key : undefined}>
              {revealed ? key : maskKey(key)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className="rounded-lg border border-[var(--rc-border)] px-2.5 py-1 font-mono text-[11px] text-[var(--rc-text-dim)] transition-colors hover:border-[var(--rc-accent)] hover:text-[var(--rc-accent)]"
            >
              {revealed ? "hide" : "reveal"}
            </button>
            <CopyButton text={key} label="copy key" />
            <button
              type="button"
              onClick={regenerate}
              className="rounded-lg border border-red-500/40 px-2.5 py-1 font-mono text-[11px] text-red-500 transition-colors hover:border-red-500 hover:bg-red-500/10"
            >
              rotate
            </button>
          </div>
        </div>
        <p className="mt-3 border-t border-[var(--rc-border)] pt-3 text-[11px] text-[var(--rc-text-dim)]">
          Rotating kills the old key immediately — update your IDE env after rotating.
        </p>
      </section>

      {/* endpoints */}
      <section className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5">
        <p className="font-mono text-[11px] tracking-widest text-[var(--rc-text-dim)] uppercase">endpoints</p>
        <ul className="mt-3 space-y-2">
          {[
            { method: "POST", url: `${base}/api/endpoint/v1/chat/completions`, note: "OpenAI-compatible — zcode & friends" },
            { method: "POST", url: `${base}/api/endpoint/v1/messages`, note: "Anthropic-compatible — Claude Code" },
            { method: "GET", url: `${base}/api/endpoint/v1/models`, note: "model list (z-assist)" },
          ].map((row) => (
            <li key={row.url} className="flex items-center gap-3 rounded-xl border border-[var(--rc-border)] px-3 py-2.5">
              <span
                className={`w-11 shrink-0 rounded-md px-1.5 py-0.5 text-center font-mono text-[10px] font-bold ${
                  row.method === "POST"
                    ? "bg-[var(--rc-accent)] text-[var(--rc-on-accent)]"
                    : "border border-[var(--rc-border)] text-[var(--rc-text-dim)]"
                }`}
              >
                {row.method}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs text-[var(--rc-text)]">{row.url}</p>
                <p className="text-[11px] text-[var(--rc-text-dim)]">{row.note}</p>
              </div>
              <CopyButton text={row.url} />
            </li>
          ))}
        </ul>
      </section>

      {/* models */}
      <section className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5">
        <p className="font-mono text-[11px] tracking-widest text-[var(--rc-text-dim)] uppercase">models</p>
        <ul className="mt-3 space-y-2">
          <li className="flex items-center gap-3 rounded-xl border border-[var(--rc-accent)] px-3 py-2.5">
            <span className="w-11 shrink-0 rounded-md bg-[var(--rc-accent)] px-1.5 py-0.5 text-center font-mono text-[10px] font-bold text-[var(--rc-on-accent)]">
              main
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs text-[var(--rc-text)]">z-assist</p>
              <p className="text-[11px] text-[var(--rc-text-dim)]">
                the docs-grounded Z-Assist brain — put this exact model id in your coding tool
              </p>
            </div>
            <CopyButton text="z-assist" label="copy id" />
          </li>
        </ul>
        <p className="mt-3 border-t border-[var(--rc-border)] pt-3 text-[11px] leading-relaxed text-[var(--rc-text-dim)]">
          Any model string is accepted — tools that hardcode e.g.{" "}
          <span className="font-mono">claude-*</span> or <span className="font-mono">gpt-*</span>{" "}
          keep working untouched, because every call is answered by Z-Assist regardless of the
          requested model. The full list is also served at{" "}
          <span className="font-mono">GET /api/endpoint/v1/models</span>.
        </p>
      </section>

      {/* setup snippets */}
      <section className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5">
        <p className="font-mono text-[11px] tracking-widest text-[var(--rc-text-dim)] uppercase">setup</p>
        <div className="mt-3 flex gap-2">
          {(
            [
              ["claude", "Claude Code"],
              ["zcode", "zcode / OpenAI tools"],
              ["curl", "curl"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-lg px-3 py-1.5 font-mono text-xs transition-colors ${
                tab === id
                  ? "bg-[var(--rc-accent)] text-[var(--rc-on-accent)]"
                  : "border border-[var(--rc-border)] text-[var(--rc-text-dim)] hover:border-[var(--rc-accent)] hover:text-[var(--rc-accent)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <CodeBlock code={snippets[tab]} />
        </div>
        <p className="mt-3 text-[11px] text-[var(--rc-text-dim)]">
          Snippets auto-fill the origin this page is served from — on the deployed site that is{" "}
          <span className="font-mono">zhelp.space-z.ai</span>. Auth accepts{" "}
          <span className="font-mono">Authorization: Bearer</span> or{" "}
          <span className="font-mono">x-api-key</span>.
        </p>
      </section>

      {/* test console */}
      <section className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5">
        <p className="font-mono text-[11px] tracking-widest text-[var(--rc-text-dim)] uppercase">
          live test · openai dialect
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask Z-Assist something… e.g. “when is the next golden window?”"
            className="min-w-0 flex-1 rounded-xl border border-[var(--rc-border)] bg-[var(--rc-bg)] px-4 py-2.5 text-sm text-[var(--rc-text)] outline-none transition-colors placeholder:text-[var(--rc-text-dim)] focus:border-[var(--rc-accent)]"
          />
          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="shrink-0 rounded-xl bg-[var(--rc-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--rc-on-accent)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {asking ? "…" : "ask"}
          </button>
        </form>
        {answer ? (
          <div className="mt-4 rounded-xl border border-[var(--rc-border)] bg-[var(--rc-bg)] p-4">
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--rc-text)]">{answer}</p>
          </div>
        ) : null}
      </section>

      {/* usage + web continuation */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5">
          <p className="font-mono text-[11px] tracking-widest text-[var(--rc-text-dim)] uppercase">usage</p>
          <p className="mt-2 text-2xl font-bold text-[var(--rc-text)]">
            {info?.callCount ?? 0}
            <span className="ml-2 text-xs font-normal text-[var(--rc-text-dim)]">calls</span>
          </p>
          <p className="mt-1 text-[11px] text-[var(--rc-text-dim)]">
            {info?.lastUsedAt ? `last used ${new Date(info.lastUsedAt).toLocaleString()}` : "not used yet"}
            {" · 60 req / 5 min fair-use · no daily question cap"}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5">
          <p className="font-mono text-[11px] tracking-widest text-[var(--rc-text-dim)] uppercase">
            continue on the web
          </p>
          {info?.conversationToken ? (
            <>
              <p className="mt-2 font-mono text-lg font-bold text-[var(--rc-text)]">{info.conversationToken}</p>
              <div className="mt-1 flex items-center gap-2">
                <a
                  href={`${base}/?token=${info.conversationToken}`}
                  className="font-mono text-xs text-[var(--rc-accent)] underline decoration-dotted underline-offset-4"
                >
                  open thread in web chat ↗
                </a>
                <CopyButton text={info.conversationToken} label="copy token" />
              </div>
            </>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--rc-text-dim)]">
              After the first IDE call, the thread&apos;s resume token appears here — open it on the
              web chat to continue the exact same conversation, free.
            </p>
          )}
        </div>
      </section>

      <p className="pt-2 text-center font-mono text-[11px] text-[var(--rc-text-dim)]">
        🔒 secret section — noindex, not linked anywhere in the portal
      </p>
    </div>
  );
}
