"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  evaluateAll,
  formatSgtNow,
  isGoldenWindowDef,
  type BonusWindowDef,
  type WindowState,
} from "@/lib/windows";
import { useWindows, announcementKey } from "@/lib/dynamic-data";
import { useFreshAnnouncements } from "@/lib/use-fresh-announcements";
import { useNow } from "./live";
import {
  fireNotification,
  getPrefsSnapshot,
  notificationsSupported,
  permissionState,
  requestPermission,
  setPrefs,
  subscribePrefs,
  type NotifyCategory,
  type NotifyPrefs,
} from "@/lib/notify";

/**
 * Modular notifications:
 *  - NotifyEngine  headless: watches window flips + fresh announcements and
 *                  raises browser notifications for opted-in categories
 *  - NotificationsBell  header button + dropdown panel: per-category toggles
 *                  for browser notifications and the Telegram channel
 */

const CATEGORIES: Array<{ id: NotifyCategory; label: string; blurb: string }> = [
  { id: "golden", label: "Golden window", blurb: "when the nightly stack window opens and closes" },
  { id: "windows", label: "All bonus windows", blurb: "peak surcharge, Flash campaign, API promos" },
  { id: "announcements", label: "Announcements", blurb: "new entries the AI sync finds on docs.z.ai" },
];

function useNotifyPrefs(): NotifyPrefs {
  return useSyncExternalStore(subscribePrefs, getPrefsSnapshot, getPrefsSnapshot);
}

/* ------------------------------------------------------------------ */
/* Headless engine                                                     */
/* ------------------------------------------------------------------ */

const ANN_PAGE_RE = /^(\d{4}-\d{2}-\d{2})\s+[—–-]\s+(.+)$/;

export function NotifyEngine() {
  const now = useNow();
  const windows = useWindows();
  const { fresh } = useFreshAnnouncements();
  const prefs = useNotifyPrefs();
  const prevActive = useRef<Map<string, boolean> | null>(null);

  // Window open/close transitions — evaluated on the shared 1s clock.
  useEffect(() => {
    if (now == null) return;
    const states: WindowState[] = evaluateAll(now, windows);
    const nextMap = new Map(states.map((s) => [s.def.id, s.active]));
    const prev = prevActive.current;
    prevActive.current = nextMap;
    if (prev == null) return; // first evaluation after load — never notify

    for (const s of states) {
      const was = prev.get(s.def.id);
      if (was === undefined || was === s.active) continue;
      const def: BonusWindowDef = s.def;
      const until = s.transitionMs != null ? formatSgtNow(s.transitionMs) : null;
      const golden = isGoldenWindowDef(def);
      const category: NotifyCategory | null = golden
        ? prefs.golden
          ? "golden"
          : prefs.windows
            ? "windows"
            : null
        : prefs.windows
          ? "windows"
          : null;
      if (category == null) continue;
      fireNotification({
        category,
        title: s.active ? `${def.name} is open` : `${def.name} closed`,
        body: s.active
          ? `Active now${until ? ` — runs until ${until}` : ""}. ${def.chip} window live.`
          : `The ${def.chip} window just closed. Next opening shows on the radar.`,
        key: `${s.active ? "open" : "close"}:${def.id}:${s.transitionMs ?? "na"}`,
        hash: "#windows",
      });
    }
  }, [now, windows, prefs]);

  // Fresh announcements (mid-session or since your last visit).
  useEffect(() => {
    if (!prefs.announcements) return;
    const batch = fresh.slice(0, 3);
    for (const a of batch) {
      const text = typeof a === "string" ? a : (a?.text ?? "");
      const m = ANN_PAGE_RE.exec(text.trim());
      fireNotification({
        category: "announcements",
        title: m ? m[2].slice(0, 90) : "New from docs.z.ai",
        body: text.trim().slice(0, 180),
        key: `ann:${announcementKey(a)}`,
        hash: "#top",
      });
    }
  }, [fresh, prefs.announcements]);

  return null;
}

/* ------------------------------------------------------------------ */
/* Bell + panel                                                        */
/* ------------------------------------------------------------------ */

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const prefs = useNotifyPrefs();
  const supported = notificationsSupported();
  const [perm, setPerm] = useState<NotificationPermission | "unsupported" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setPerm(permissionState()), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  const toggle = useCallback(
    async (id: NotifyCategory, want: boolean) => {
      if (want && supported && Notification.permission !== "granted") {
        setBusy(true);
        const result = await requestPermission();
        setPerm(result);
        setBusy(false);
        if (result !== "granted") return;
      }
      setPrefs({ ...prefs, [id]: want });
    },
    [prefs, supported],
  );

  const nudge = supported && perm === "default" && !anyOn(prefs);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Notification settings"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-8 w-8 place-items-center rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] transition-colors hover:border-[var(--rc-accent)]"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 3a6 6 0 0 0-6 6v3.2l-1.4 2.9a.7.7 0 0 0 .63 1H18.8a.7.7 0 0 0 .62-1L18 12.2V9a6 6 0 0 0-6-6Zm-2 15a2 2 0 0 0 4 0"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {nudge && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--rc-bg)] bg-[var(--rc-accent)]"
          />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[65]" aria-hidden onClick={() => setOpen(false)} />
          <div className="card-surface absolute right-0 top-[calc(100%+10px)] z-[70] max-h-[80vh] w-[300px] overflow-y-auto rounded-xl border p-4 shadow-2xl max-[420px]:fixed max-[420px]:left-3 max-[420px]:right-3 max-[420px]:top-16 max-[420px]:w-auto">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--rc-accent)]">
              alerts
            </p>
            <h3 className="mt-0.5 font-display text-base font-semibold">Get notified</h3>

            {/* Browser notifications */}
            <section className="mt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">This browser</p>
                {supported ? (
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                      perm === "granted"
                        ? "bg-[color-mix(in_srgb,var(--rc-accent)_18%,transparent)] text-[var(--rc-accent)]"
                        : perm === "denied"
                          ? "bg-[var(--rc-surface)] text-[var(--rc-gone)]"
                          : "bg-[var(--rc-surface)] text-[var(--rc-text-dim)]"
                    }`}
                  >
                    {perm === "granted" ? "enabled" : perm === "denied" ? "blocked" : "not enabled"}
                  </span>
                ) : (
                  <span className="font-mono text-[10px] text-[var(--rc-text-dim)]">unsupported</span>
                )}
              </div>
              {perm === "denied" && (
                <p className="mt-1.5 text-xs leading-snug text-[var(--rc-text-dim)]">
                  Notifications are blocked for this site — allow them in your browser&apos;s site settings,
                  then reload.
                </p>
              )}
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1">
                {CATEGORIES.map((c) => (
                  <ToggleRow
                    key={c.id}
                    label={c.label}
                    blurb={c.blurb}
                    on={prefs[c.id]}
                    disabled={!supported || busy || perm === "denied"}
                    onToggle={(v) => void toggle(c.id, v)}
                  />
                ))}
              </div>
            </section>

            <TelegramSection />
          </div>
        </>
      )}
    </div>
  );
}

function anyOn(p: NotifyPrefs): boolean {
  return p.golden || p.windows || p.announcements;
}

function ToggleRow({
  label,
  blurb,
  on,
  disabled,
  onToggle,
}: {
  label: string;
  blurb: string;
  on: boolean;
  disabled?: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--rc-bright)_4%,transparent)]">
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-tight">{label}</p>
        <p className="truncate text-[11px] leading-tight text-[var(--rc-text-dim)]">{blurb}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${label} notifications`}
        disabled={disabled}
        onClick={() => onToggle(!on)}
        className={`relative inline-block h-[18px] w-[34px] shrink-0 rounded-full border transition-colors disabled:opacity-40 ${
          on
            ? "tgl-on border-[var(--rc-accent)] bg-[color-mix(in_srgb,var(--rc-accent)_22%,transparent)]"
            : "border-[var(--rc-border)] bg-[var(--rc-surface)]"
        }`}
      >
        <span
          className={`absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all ${
            on ? "left-[18px] bg-[var(--rc-accent)]" : "left-[2px] bg-[var(--rc-text-dim)]"
          }`}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Telegram section                                                    */
/* ------------------------------------------------------------------ */

type TgStatus = { configured: boolean; username: string | null; chats: number };

function TelegramSection() {
  const [status, setStatus] = useState<TgStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // token connect form
  const [tokenInput, setTokenInput] = useState("");
  const [showTokenForm, setShowTokenForm] = useState(false);

  // link flow
  const [link, setLink] = useState<{ code: string; botUsername: string | null } | null>(null);
  const [linkedChat, setLinkedChat] = useState<string | null>(null);
  const [tgPrefs, setTgPrefs] = useState<NotifyPrefs | null>(null);
  const [waiting, setWaiting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/telegram?action=status", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as TgStatus);
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void loadStatus(), 80);
    return () => window.clearTimeout(t);
  }, [loadStatus]);

  const connectBot = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-bot", token: tokenInput.trim() }),
      });
      const json = (await res.json()) as { ok?: boolean; username?: string; error?: string };
      if (!res.ok || !json.ok) setError(json.error ?? "Could not verify the token.");
      else {
        setShowTokenForm(false);
        setTokenInput("");
        await loadStatus();
      }
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  const startLink = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link" }),
      });
      const json = (await res.json()) as { code?: string; botUsername?: string | null; error?: string };
      if (!res.ok || !json.code) setError(json.error ?? "Could not start the link flow.");
      else {
        setLink({ code: json.code, botUsername: json.botUsername ?? null });
        setWaiting(true);
        pollLink(json.code, 0);
      }
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  const pollLink = (code: string, attempt: number) => {
    if (attempt > 60) {
      setWaiting(false);
      return;
    }
    window.setTimeout(
      async () => {
        try {
          const res = await fetch(`/api/telegram?action=link-status&code=${encodeURIComponent(code)}`, {
            cache: "no-store",
          });
          const json = (await res.json()) as { pending?: boolean };
          if (json.pending === false) {
            // The bot consumed the code → the chat row now exists (this browser
            // may not know its chatId, so fetch the freshest single-chat prefs).
            const prefsRes = await fetch("/api/telegram?action=status", { cache: "no-store" });
            const st = (await prefsRes.json()) as TgStatus;
            setStatus(st);
            setWaiting(false);
            setLinkedChat("linked");
            return;
          }
        } catch {
          /* keep polling */
        }
        pollLink(code, attempt + 1);
      },
      3000,
    );
  };

  const toggleTg = async (id: NotifyCategory, want: boolean) => {
    if (!tgPrefs) return;
    const next = { ...tgPrefs, [id]: want };
    setTgPrefs(next);
    try {
      await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prefs", chatId: linkedChat === "linked" ? undefined : linkedChat, prefs: next }),
      });
    } catch {
      /* optimistic */
    }
  };

  const loadTgPrefs = async () => {
    // Single-chat deployments: ask the server for the only chat row.
    try {
      const res = await fetch("/api/telegram?action=status", { cache: "no-store" });
      const st = (await res.json()) as TgStatus;
      if (st.chats >= 1) {
        // fetch the chat list via prefs endpoint using the id we get from a
        // minimal listing — reuse status endpoint's chats count + try prefs
        // with the id returned by the link flow when available.
        const listRes = await fetch("/api/telegram?action=prefs-list", { cache: "no-store" });
        if (listRes.ok) {
          const list = (await listRes.json()) as { chats: Array<{ chatId: string; prefs: NotifyPrefs }> };
          if (list.chats?.length) {
            setLinkedChat(list.chats[0].chatId);
            setTgPrefs(list.chats[0].prefs);
          }
        }
      }
    } catch {
      /* offline */
    }
  };

  useEffect(() => {
    if (linkedChat !== "linked") return;
    void loadTgPrefs();
     
  }, [linkedChat]);

  return (
    <section className="mt-4 border-t border-[var(--rc-border)] pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold">
          Telegram <span aria-hidden>→</span>
        </p>
        {status?.configured && (
          <span className="font-mono text-[10px] text-[var(--rc-text-dim)]">
            @{status.username}
          </span>
        )}
      </div>

      {!status ? (
        <p className="mt-1.5 text-xs text-[var(--rc-text-dim)]">checking…</p>
      ) : !status.configured ? (
        showTokenForm ? (
          <div className="mt-2">
            <p className="text-[11px] leading-snug text-[var(--rc-text-dim)]">
              1. Message <span className="font-mono font-semibold">@BotFather</span> on Telegram →{" "}
              <span className="font-mono">/newbot</span>. 2. Paste its token here:
            </p>
            <div className="mt-1.5 flex gap-1.5">
              <input
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="123456789:AA…"
                className="min-w-0 flex-1 rounded-lg border border-[var(--rc-border)] bg-[var(--rc-bg)] px-2 py-1.5 font-mono text-xs outline-none focus:border-[var(--rc-accent)]"
              />
              <button
                type="button"
                onClick={() => void connectBot()}
                disabled={busy || tokenInput.trim().length < 10}
                className="shrink-0 rounded-lg bg-[var(--rc-accent)] px-3 py-1.5 font-mono text-xs font-bold text-[var(--rc-on-accent)] disabled:opacity-40"
              >
                {busy ? "…" : "connect"}
              </button>
            </div>
            {error && <p className="mt-1.5 text-xs text-[var(--rc-gone)]">{error}</p>}
          </div>
        ) : (
          <div className="mt-1.5">
            <p className="text-xs leading-snug text-[var(--rc-text-dim)]">
              Get the same alerts in your pocket. Connect a Telegram bot once — every visitor can then
              link their own chat.
            </p>
            <button
              type="button"
              onClick={() => setShowTokenForm(true)}
              className="mt-2 font-mono text-[11px] font-bold uppercase tracking-wide text-[var(--rc-accent)] underline decoration-dotted underline-offset-4"
            >
              connect a bot
            </button>
          </div>
        )
      ) : link == null ? (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => void startLink()}
            disabled={busy}
            className="font-mono text-[11px] font-bold uppercase tracking-wide text-[var(--rc-accent)] underline decoration-dotted underline-offset-4 disabled:opacity-40"
          >
            {busy ? "…" : "link my telegram"}
          </button>
          {error && <p className="mt-1.5 text-xs text-[var(--rc-gone)]">{error}</p>}
        </div>
      ) : linkedChat == null ? (
        <div className="mt-2 rounded-lg border border-[var(--rc-border)] p-2.5">
          <p className="text-xs leading-snug">
            1. Open{" "}
            <a
              className="font-semibold text-[var(--rc-accent)] underline decoration-dotted underline-offset-2"
              href={`https://t.me/${link.botUsername ?? ""}?start=${link.code}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              t.me/{link.botUsername ?? "your bot"}
            </a>{" "}
            and press <span className="font-semibold">Start</span>.
          </p>
          <p className="mt-1 text-[11px] text-[var(--rc-text-dim)]">
            code <span className="font-mono font-bold text-[var(--rc-bright)]">{link.code}</span>
            {waiting ? " — waiting for your /start…" : ""}
          </p>
        </div>
      ) : (
        <div className="mt-2">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {CATEGORIES.map((c) => (
              <ToggleRow
                key={c.id}
                label={c.label}
                blurb={c.blurb}
                on={tgPrefs ? tgPrefs[c.id] : true}
                disabled={tgPrefs == null}
                onToggle={(v) => void toggleTg(c.id, v)}
              />
            ))}
          </div>
          <p className="mt-1 text-[11px] text-[var(--rc-text-dim)]">
            Alerts arrive even when the radar is closed. Send <span className="font-mono">/stop</span> to the
            bot to unlink.
          </p>
        </div>
      )}
    </section>
  );
}
