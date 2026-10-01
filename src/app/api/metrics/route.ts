import { BONUS_WINDOWS, METRICS_WINDOW_ID, evaluateAll } from "@/lib/windows";
import { cnIsoDate, getChinaOps, holidayResumeMs, holidayStartMs } from "@/lib/cn-holidays";

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

  // China ops calendar: 1 while a public holiday likely means reduced staff at
  // China-based teams (z.ai included) — see the "China ops calendar" section.
  const cn = getChinaOps(now);
  lines.push(
    "# HELP zhelp_china_ops_limited 1 while a China public holiday is in progress (reduced support/release pace at China-based teams).",
    "# TYPE zhelp_china_ops_limited gauge",
    `zhelp_china_ops_limited ${cn.active ? 1 : 0}`,
    "# HELP zhelp_china_ops_resume_timestamp_seconds Epoch seconds when normal operations resume after the active holiday (0 when none active).",
    "# TYPE zhelp_china_ops_resume_timestamp_seconds gauge",
    `zhelp_china_ops_resume_timestamp_seconds ${cn.active && cn.resumeMs ? Math.round(cn.resumeMs / 1000) : 0}`,
  );
  if (cn.next) {
    lines.push(
      "# HELP zhelp_china_next_holiday_start_timestamp_seconds Epoch seconds when the next China public holiday starts.",
      "# TYPE zhelp_china_next_holiday_start_timestamp_seconds gauge",
      `zhelp_china_next_holiday_start_timestamp_seconds{holiday="${cn.next.id}"} ${Math.round(holidayStartMs(cn.next) / 1000)}`,
    );
  }
  if (cn.active) {
    lines.push(
      `# source (china-ops/${cn.active.id}): State Council notice 国办发明电, holiday ${cn.active.start}..${cn.active.end}, resume ${cnIsoDate(holidayResumeMs(cn.active))} CST`,
    );
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
