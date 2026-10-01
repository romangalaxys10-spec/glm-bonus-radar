import { BONUS_WINDOWS, evaluateAll, formatSgtNow, isGoldenWindowDef } from "@/lib/windows";
import { getStoredSiteData } from "@/lib/docs-sync";
import { broadcast } from "@/lib/telegram";

/**
 * Server-side window-flip watcher feeding the Telegram channel.
 *
 * Runs once a minute from the instrumentation scheduler. Compares the live
 * open/closed state of every synced window against the previous tick and
 * broadcasts each transition to linked Telegram chats (per-category prefs).
 * The first tick after boot only records a baseline — never notifies.
 */

const g = globalThis as typeof globalThis & {
  __brWinStates?: Map<string, boolean>;
  __brAlertsBusy?: boolean;
};

export async function checkWindowFlips(): Promise<void> {
  if (g.__brAlertsBusy) return;
  g.__brAlertsBusy = true;
  try {
    let defs = BONUS_WINDOWS;
    try {
      const stored = await getStoredSiteData();
      if (stored?.payload?.windows && stored.payload.windows.length > 0) defs = stored.payload.windows;
    } catch {
      /* DB offline — fall back to the static schedule */
    }

    const states = evaluateAll(Date.now(), defs);
    const next = new Map(states.map((s) => [s.def.id, s.active] as const));
    const prev = g.__brWinStates;
    g.__brWinStates = next;
    if (!prev) return;

    for (const s of states) {
      const was = prev.get(s.def.id);
      if (was === undefined || was === s.active) continue;
      const golden = isGoldenWindowDef(s.def);
      const until = s.transitionMs != null ? formatSgtNow(s.transitionMs) : null;
      const text = s.active
        ? golden
          ? `Golden window is OPEN now${until ? ` — runs until ${until}` : ""}.\n\nUnlimited GLM-5.3-Flash in ZCode plus off-peak credit rates, stacked all night.`
          : `Bonus window OPEN — ${s.def.name}${until ? ` (until ${until})` : ""}.`
        : golden
          ? "Golden window just closed.\n\nOff-peak rates continue — the radar shows the next opening."
          : `Window closed — ${s.def.name}.`;
      try {
        await broadcast(golden ? "golden" : "windows", text);
      } catch {
        /* telegram unreachable — never break the watcher */
      }
    }
  } finally {
    g.__brAlertsBusy = false;
  }
}
