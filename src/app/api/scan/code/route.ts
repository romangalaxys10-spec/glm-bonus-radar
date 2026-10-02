import { NextResponse } from "next/server";
import { runCodeScan } from "@/lib/scanner/code-review";
import { CODE_PLAN, startJob } from "@/lib/scanner/jobs";
import { clientKey, overRate } from "@/lib/scanner/guard";
import { errorResponse, readJson } from "@/lib/scanner/http";
import { ScanError } from "@/lib/scanner/fetcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (overRate(`scan:${clientKey(req)}`))
      return NextResponse.json({ error: "rate-limited", message: "Slow down — 8 scans per minute." }, { status: 429, headers: { "cache-control": "no-store" } });
    const { code } = await readJson<{ code?: string }>(req);
    if (!code || typeof code !== "string" || !code.trim())
      throw new ScanError("bad-request", "Paste some code to review.");
    if (code.length > 256 * 1024) throw new ScanError("bad-request", "Code sample too large (256 KB max).");
    // Code review is CPU-bound and instant; still run as a job for one
    // uniform progress/ETA protocol across all four scanners.
    const jobId = startJob(CODE_PLAN, async (progress) => {
      progress(0, 1);
      const report = runCodeScan(code);
      progress(1, 1);
      progress(2, 1);
      return report;
    });
    return NextResponse.json({ jobId }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
