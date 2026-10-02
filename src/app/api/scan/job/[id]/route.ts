import { NextResponse } from "next/server";
import { getJob } from "@/lib/scanner/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Poll a scan job: { status, pct, stage, etaSec, events, result?, error? }. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job)
    return NextResponse.json(
      { error: "unknown-job", message: "No such scan job (expired or wrong id)." },
      { status: 404, headers: { "cache-control": "no-store" } }
    );
  return NextResponse.json(job, { headers: { "cache-control": "no-store" } });
}
