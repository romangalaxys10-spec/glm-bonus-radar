import { BONUS_WINDOWS, METRICS_WINDOW_ID, evaluateAll } from "@/lib/windows";

export const dynamic = "force-dynamic";

/**
 * Prometheus-compatible endpoint, wire-compatible with the original tracker
 * at bonus.inference.blinkinglights.org plus an extra window and discount gauge.
 */
export async function GET() {
  const now = Date.now();
  const states = evaluateAll(now);

  const lines: string[] = [
    "# HELP bonus_inference_active 1 while this vendor window is in effect right now.",
    "# TYPE bonus_inference_active gauge",
  ];

  for (const s of states) {
    const id = METRICS_WINDOW_ID[s.def.id];
    lines.push(`bonus_inference_active{vendor="${s.def.vendor}",window="${id}"} ${s.active ? 1 : 0}`);
  }

  lines.push(
    "# HELP bonus_inference_transition_seconds Seconds until bonus_inference_active flips for this window (open or close; 0 once a bounded event is over).",
    "# TYPE bonus_inference_transition_seconds gauge",
  );
  for (const s of states) {
    const id = METRICS_WINDOW_ID[s.def.id];
    const transition =
      s.ended || s.transitionMs == null ? 0 : Math.max(0, Math.round((s.transitionMs - now) / 1000));
    lines.push(`bonus_inference_transition_seconds{vendor="${s.def.vendor}",window="${id}"} ${transition}`);
  }

  lines.push(
    "# HELP bonus_inference_end_timestamp_seconds Epoch seconds when a bounded event ends (only for type=event windows).",
    "# TYPE bonus_inference_end_timestamp_seconds gauge",
  );
  for (const s of states) {
    if (s.def.kind !== "event" || s.endMs == null) continue;
    const id = METRICS_WINDOW_ID[s.def.id];
    lines.push(`bonus_inference_end_timestamp_seconds{vendor="${s.def.vendor}",window="${id}"} ${Math.round(s.endMs / 1000)}`);
  }

  // Extra: discount ratio while a window is active (1 = none, 0.5 = half price, 0 = free/unlimited).
  lines.push(
    "# HELP bonus_inference_discount_ratio Discount ratio while the window is active (1 = no bonus, 0 = free/unlimited).",
    "# TYPE bonus_inference_discount_ratio gauge",
  );
  for (const s of states) {
    const id = METRICS_WINDOW_ID[s.def.id];
    const ratio = s.def.id === "flash-campaign" ? 0 : s.def.id === "flash-api-50" ? 0.5 : 1;
    lines.push(`bonus_inference_discount_ratio{vendor="${s.def.vendor}",window="${id}"} ${s.active ? ratio : 1}`);
  }

  lines.push("");
  for (const def of BONUS_WINDOWS) {
    lines.push(`# source (${def.vendor}/${METRICS_WINDOW_ID[def.id]}): ${def.docsUrl}`);
  }

  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
