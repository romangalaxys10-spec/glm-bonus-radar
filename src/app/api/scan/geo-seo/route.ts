import { NextResponse } from "next/server";
import { runGeoSeoScan } from "@/lib/scanner/geoseo";
import { cachedScan, clientKey, overRate, withSlot } from "@/lib/scanner/guard";
import { errorResponse, readJson } from "@/lib/scanner/http";
import { ScanError } from "@/lib/scanner/fetcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (overRate(`scan:${clientKey(req)}`))
      return NextResponse.json({ error: "rate-limited", message: "Slow down — 8 scans per minute." }, { status: 429, headers: { "cache-control": "no-store" } });
    const { url } = await readJson<{ url?: string }>(req);
    if (!url || typeof url !== "string") throw new ScanError("bad-url", "Provide a URL to audit.");
    const { value, cached } = await cachedScan(`geo:${url.toLowerCase()}`, () => withSlot(() => runGeoSeoScan(url)));
    return NextResponse.json({ ...value, cached }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
