import { NextResponse } from "next/server";
import { runQaScan } from "@/lib/scanner/qa";
import { URL_PLAN, startJob } from "@/lib/scanner/jobs";
import { cachedScan, clientKey, overRate, withSlot } from "@/lib/scanner/guard";
import { errorResponse, readJson } from "@/lib/scanner/http";
import { ScanError, preflightTarget } from "@/lib/scanner/fetcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (overRate(`scan:${clientKey(req)}`))
      return NextResponse.json({ error: "rate-limited", message: "Slow down — 8 scans per minute." }, { status: 429, headers: { "cache-control": "no-store" } });
    const { url } = await readJson<{ url?: string }>(req);
    if (!url || typeof url !== "string") throw new ScanError("bad-url", "Provide a URL to audit.");
    const target = await preflightTarget(url);
    const jobId = startJob(URL_PLAN, (progress) =>
      withSlot(() =>
        cachedScan(`qa:${target.toLowerCase()}`, () => runQaScan(target, progress)).then(({ value, cached }) => ({
          ...value,
          cached,
        }))
      )
    );
    return NextResponse.json({ jobId }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
