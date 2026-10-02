import { NextResponse } from "next/server";
import { getSnapshotSummary } from "@/lib/scanner/snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Token preflight for the UI compare field: GET /api/scan/snapshot?token=ZSC-…
 * Returns a small summary (scanner, target, score, date) so the user can
 * confirm what a saved token points at BEFORE running the comparison scan.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").slice(0, 80);
  if (!token)
    return NextResponse.json(
      { error: "bad-request", message: "Provide ?token=ZSC-XXXX-XXXX-XXXX-XXXX." },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  try {
    const summary = await getSnapshotSummary(token);
    if (!summary)
      return NextResponse.json(
        { error: "unknown-token", message: "No snapshot for this token — expired after 90 days, or mistyped." },
        { status: 404, headers: { "cache-control": "no-store" } }
      );
    return NextResponse.json(summary, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "storage", message: "Snapshot storage unavailable — try again shortly." },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
}
