/**
 * Hourly AI doc-sync scheduler.
 *
 * Runs inside the Next.js server process (instrumentation hook):
 *  - first check ~20s after boot
 *  - then every 60 minutes ("if any changes occur" the badge updates;
 *    unchanged runs leave the page data untouched)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const g = globalThis as typeof globalThis & { __bonusRadarScheduler?: boolean };
  if (g.__bonusRadarScheduler) return;
  g.__bonusRadarScheduler = true;

  const HOUR_MS = 60 * 60 * 1000;
  let busy = false;

  async function tick(trigger: "boot" | "hourly") {
    if (busy) return;
    busy = true;
    try {
      const { runSync } = await import("@/lib/docs-sync");
      const result = await runSync(trigger);
      if (result.status !== "changed") {
        console.log(`[docs-sync] ${trigger} check: ${result.summary}`);
      }
    } catch (err) {
      console.error("[docs-sync] scheduler tick failed:", err);
    } finally {
      busy = false;
    }
  }

  const { checkWindowFlips } = await import("@/lib/alerts");
  const { pollTelegramUpdates } = await import("@/lib/telegram");
  const { pollAssistBots } = await import("@/lib/assist-telegram");

  setTimeout(() => void tick("boot"), 20_000).unref?.();
  setInterval(() => void tick("hourly"), HOUR_MS).unref?.();

  // Telegram: read bot updates (link codes, /stop) + watch window transitions.
  // Both no-op cheaply while no bot token is configured.
  setInterval(() => void pollTelegramUpdates().catch(() => {}), 5_000).unref?.();
  setInterval(() => void checkWindowFlips().catch(() => {}), 60_000).unref?.();

  // Paired visitor bots: /start codes, questions (5/day), commands.
  setInterval(() => void pollAssistBots().catch(() => {}), 4_000).unref?.();
  // NOTE: dynamic import caches the module per process — server restarts pick
  // up contract changes (e.g. announcements string[] -> {text, source}).
}
