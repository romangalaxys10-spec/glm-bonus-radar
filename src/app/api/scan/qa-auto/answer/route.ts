import { NextResponse } from "next/server";
import { submitJobAnswer } from "@/lib/scanner/jobs";
import { clientKey, overRate } from "@/lib/scanner/guard";
import { errorResponse, readJson } from "@/lib/scanner/http";
import { ScanError } from "@/lib/scanner/fetcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Step 3 (mid-run): answer a question the auditor asked. */
export async function POST(req: Request) {
  try {
    if (overRate(`qa-answer:${clientKey(req)}`))
      return NextResponse.json({ error: "rate-limited", message: "Too many answers — slow down." }, { status: 429, headers: { "cache-control": "no-store" } });
    const { jobId, answerId, value } = await readJson<{ jobId?: string; answerId?: string; value?: string }>(req, 20_000);
    if (!jobId || typeof jobId !== "string" || !answerId || typeof answerId !== "string")
      throw new ScanError("bad-request", "jobId and answerId are required.");
    const delivered = submitJobAnswer(jobId, answerId, (value ?? "").slice(0, 2000));
    return NextResponse.json({ delivered }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
