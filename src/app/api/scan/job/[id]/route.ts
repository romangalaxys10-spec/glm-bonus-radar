import { NextResponse } from "next/server";
import { getJob } from "@/lib/scanner/jobs";
import { qaQueueViewFor } from "@/lib/scanner/qaqueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Poll a scan job: { status, pct, stage, etaSec, events, result?, error? }.
 * v5.1 — queued QA runs additionally carry
 * { queue: { position, waiting, etaSec } } and runStartedAt once granted.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job)
    return NextResponse.json(
      { error: "unknown-job", message: "No such scan job (expired or wrong id)." },
      { status: 404, headers: { "cache-control": "no-store" } }
    );
  const queue = qaQueueViewFor(id);
  return NextResponse.json(
    queue ? { ...job, queue, etaSec: queue.etaSec } : job,
    { headers: { "cache-control": "no-store" } }
  );
}
