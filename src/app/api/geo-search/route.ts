import { NextRequest, NextResponse } from "next/server";
import { GeoSearchError, runGeoSearch } from "@/lib/geosearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/geo-search  { query: string }
 * -> GeoSearchPayload (live web results ranked by GEO, each with a rating)
 *
 * Rate limit: 10 searches / 5 min / IP (every hit costs a web search + a
 * model scoring call — tighter than the chat endpoint on purpose).
 */
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 5 * 60 * 1000;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : null) || "local";
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

export async function POST(req: NextRequest) {
  if (rateLimited(clientIp(req))) {
    return NextResponse.json(
      { error: "Rate limit reached — zSearch runs a live web search plus a model scoring pass per query. Try again in a few minutes." },
      { status: 429 },
    );
  }

  let body: { query?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const payload = await runGeoSearch(body.query);
    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof GeoSearchError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[geo-search] search failed:", err);
    return NextResponse.json(
      { error: "zSearch could not reach the live web or the scoring model. Please try again in a moment." },
      { status: 502 },
    );
  }
}
