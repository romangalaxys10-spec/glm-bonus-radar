import type { Metadata } from "next";
import Link from "next/link";
import { getStoredSiteData } from "@/lib/docs-sync";
import { db } from "@/lib/db";
import { JournalLive } from "@/components/portal/journal-live";

/**
 * AI changelog — the always-updating audit trail of the hourly doc-sync bot.
 * EVERY check lands here the moment it runs: applied changes as full cards
 * (what changed, which sections, what triggered it) and the quiet "no
 * changes" sweeps as dim one-liners, so the trail moves even when the docs
 * don't. Server-rendered straight from the SyncRun journal; a tiny client
 * component refreshes it every minute.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI changelog — GLM Bonus Radar",
  description:
    "Every check the GLM Bonus Radar AI bot runs against the official z.ai docs lands here — applied changes in full, quiet hourly sweeps as one-liners. Always current, straight from the sync journal.",
};

const JOURNAL_TAKE = 40;
const sgt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Singapore",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function fmt(iso: string): string {
  return `${sgt.format(new Date(iso))} SGT`;
}

function rel(iso: string): string {
  const diff = Math.max(0, Date.now() - Date.parse(iso));
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const TRIGGER_STYLE: Record<string, string> = {
  hourly: "border-[var(--rc-border)] text-[var(--rc-text-dim)]",
  boot: "border-[var(--rc-tone2)] text-[var(--rc-tone2)]",
  manual: "border-[var(--rc-accent)] text-[var(--rc-accent)]",
};

/** Legacy rows predate the trigger column (default "hourly") and embed the
 * real trigger as a summary prefix ("manual: …"). Recover it for display. */
const KNOWN_TRIGGERS = ["boot", "hourly", "manual"] as const;
function inferTrigger(summary: string | null, trigger: string): { trigger: string; text: string } {
  const s = summary ?? "";
  for (const t of KNOWN_TRIGGERS) {
    if (s.startsWith(`${t}: `)) return { trigger: t, text: s.slice(t.length + 2) };
  }
  return { trigger, text: s };
}

function parseSections(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export default async function ChangelogPage() {
  let runs: Array<{
    id: string;
    status: string;
    summary: string | null;
    trigger: string;
    sections: string[];
    createdAt: Date;
  }> = [];
  let updatedAt: string | null = null;
  let total14d: number | null = null;
  let dbError = false;

  try {
    const stored = await getStoredSiteData();
    updatedAt = stored?.updatedAt ?? null;
    const [rows, count] = await Promise.all([
      db.syncRun.findMany({ orderBy: { createdAt: "desc" }, take: JOURNAL_TAKE }),
      db.syncRun.count({
        where: { createdAt: { gte: new Date(Date.now() - 14 * 24 * 3600 * 1000) } },
      }),
    ]);
    runs = rows.map((r) => ({
      id: r.id,
      status: r.status,
      summary: r.summary,
      trigger: r.trigger,
      sections: parseSections(r.sections),
      createdAt: r.createdAt,
    }));
    total14d = count;
  } catch {
    dbError = true;
  }

  const changedCount = runs.filter((r) => r.status === "changed").length;
  const errorCount = runs.filter((r) => r.status === "error").length;
  const newest = runs[0];

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pt-10 pb-32 md:px-8 md:pb-20">
      <header>
        <Link
          href="/"
          className="font-mono text-xs text-[var(--rc-text-dim)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
        >
          ← back to the radar
        </Link>
        <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-gradient md:text-4xl">
          AI changelog
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--rc-text-dim)]">
          An AI bot re-reads the official z.ai docs every hour — and every check lands in this
          journal the moment it runs. Applied changes are written out in full; the quiet sweeps
          where nothing changed are logged as dim one-liners, so the trail always shows the radar
          breathing. Subscribe to new announcements via{" "}
          <a
            href="/api/announcements"
            className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
          >
            the Atom feed
          </a>
          .
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          {updatedAt && (
            <p
              title="Only real data changes move this badge — quiet checks don't."
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--rc-accent)] bg-[color-mix(in_srgb,var(--rc-accent)_12%,var(--rc-bg))] px-3 py-1 font-mono text-[11px] font-semibold text-[var(--rc-accent)]"
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--rc-accent)]" />
              Data has been updated on {fmt(updatedAt)}
            </p>
          )}
          {total14d != null && total14d > 0 && (
            <p className="font-mono text-[11px] text-[var(--rc-text-dim)]">
              {total14d} checks in the last 14 days
              {changedCount > 0 ? ` · ${changedCount} applied changes on this page` : ""}
              {errorCount > 0 ? ` · ${errorCount} errors` : ""}
            </p>
          )}
        </div>
        {newest && (
          <p className="mt-2 font-mono text-[11px] text-[var(--rc-text-dim)]">
            newest entry {rel(newest.createdAt.toISOString())}
          </p>
        )}
        <JournalLive />
      </header>

      {dbError ? (
        <p className="mt-8 rounded-xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-4 text-sm text-[var(--rc-text-dim)]">
          The audit trail is temporarily unavailable (storage offline). The hourly sync keeps
          running in the background — check back shortly.
        </p>
      ) : runs.length === 0 ? (
        <p className="mt-8 rounded-xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-4 text-sm text-[var(--rc-text-dim)]">
          The journal is empty — the first sync runs shortly after boot. From then on every hourly
          check lands here, changed or not.
        </p>
      ) : (
        <ol className="mt-8 space-y-2" aria-label="Sync journal, newest first">
          {runs.map((r) => {
            if (r.status === "changed") {
              const { trigger, text } = inferTrigger(r.summary, r.trigger);
              return (
                <li
                  key={r.id}
                  className="relative overflow-hidden rounded-xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-4 pl-5"
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-1 bg-[var(--rc-bright)]"
                  />
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                    <span className="font-semibold text-[var(--rc-text)]">
                      {fmt(r.createdAt.toISOString())}
                    </span>
                    <span
                      className={`rounded border px-1.5 py-0.5 uppercase tracking-wider ${
                        TRIGGER_STYLE[trigger] ?? TRIGGER_STYLE.hourly
                      }`}
                    >
                      {trigger}
                    </span>
                    {r.sections.map((s) => (
                      <span
                        key={s}
                        className="rounded-full bg-[color-mix(in_srgb,var(--rc-accent)_10%,transparent)] px-2 py-0.5 text-[10px] text-[var(--rc-accent)]"
                      >
                        {s}
                      </span>
                    ))}
                    <span className="ml-auto text-[var(--rc-text-dim)]">
                      {rel(r.createdAt.toISOString())}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-snug text-[var(--rc-text)]">
                    {text || "applied changes"}
                  </p>
                </li>
              );
            }
            const isError = r.status === "error";
            return (
              <li
                key={r.id}
                className="flex items-start gap-2.5 rounded-lg px-3 py-1.5 font-mono text-[11px] leading-snug"
              >
                <span
                  aria-hidden
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    isError ? "bg-[var(--rc-gone)]" : "bg-[var(--rc-tone3)]"
                  }`}
                />
                <span className="shrink-0 text-[var(--rc-text-dim)]">
                  {fmt(r.createdAt.toISOString())}
                </span>
                <span className={isError ? "text-[var(--rc-gone)]" : "text-[var(--rc-text-dim)]"}>
                  {r.summary ?? r.status}
                  <span className="text-[var(--rc-text-dim)] opacity-70">
                    {" "}
                    · {rel(r.createdAt.toISOString())}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <footer className="mt-10 border-t border-[var(--rc-border)] pt-5 font-mono text-[11px] leading-relaxed text-[var(--rc-text-dim)]">
        Developed by{" "}
        <a
          href="https://rommark.dev"
          target="_blank"
          rel="noopener"
          className="font-semibold text-[var(--rc-text)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
        >
          Rommark.Dev
        </a>{" "}
        <span aria-hidden>·</span>{" "}
        <a
          href="https://github.com/romangalaxys10-spec/glm-bonus-radar"
          target="_blank"
          rel="noopener"
          className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
        >
          GitHub ↗
        </a>{" "}
        <span aria-hidden>·</span>{" "}
        <a
          href="https://t.me/VibeCodePrompterSystem"
          target="_blank"
          rel="noopener"
          className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
        >
          Telegram ↗
        </a>{" "}
        <span aria-hidden>·</span>{" "}
        <a
          href="https://www.linkedin.com/in/rоman-m-793b3310?utm_source=share_via&utm_content=profile&utm_medium=member_android"
          target="_blank"
          rel="noopener"
          className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
        >
          LinkedIn ↗
        </a>
      </footer>
    </div>
  );
}
