import { NextResponse } from "next/server";
import { runSlopScan } from "@/lib/scanner/slop";
import { SLOP_PLAN, startJob } from "@/lib/scanner/jobs";
import { cachedScan, clientKey, overRate, withSlot } from "@/lib/scanner/guard";
import { errorResponse, readJson } from "@/lib/scanner/http";
import { ScanError, preflightTarget } from "@/lib/scanner/fetcher";
import { finishScan } from "@/lib/scanner/snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (overRate(`scan:${clientKey(req)}`))
      return NextResponse.json({ error: "rate-limited", message: "Slow down — 8 scans per minute." }, { status: 429, headers: { "cache-control": "no-store" } });
    const { url, compareToken } = await readJson<{ url?: string; compareToken?: string }>(req);
    if (!url || typeof url !== "string") throw new ScanError("bad-url", "Provide a URL to review.");
    const target = await preflightTarget(url);
    const prev = typeof compareToken === "string" ? compareToken.slice(0, 80) : undefined;
    const jobId = startJob(SLOP_PLAN, (progress) =>
      withSlot(() =>
        cachedScan(`slop:${target.toLowerCase()}`, () => runSlopScan(target, progress)).then(({ value, cached }) =>
          finishScan({ report: { ...value, cached }, compareToken: prev })
        )
      )
    );
    return NextResponse.json({ jobId }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
