import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStoredSiteData, runSync } from "@/lib/docs-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_MANUAL_INTERVAL_MS = 5 * 60 * 1000;
const lastManual = { at: 0 };

/** Status of the AI doc-sync: stored data freshness + recent runs. */
export async function GET() {
  const [stored, runs] = await Promise.all([
    getStoredSiteData(),
    db.syncRun.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  return NextResponse.json({
    updatedAt: stored?.updatedAt ?? null,
    changeLog: stored?.changeLog ?? [],
    runs: runs.map((r) => {
      let sections: string[] = [];
      try {
        const parsed = JSON.parse(r.sections) as unknown;
        if (Array.isArray(parsed)) sections = parsed.filter((s): s is string => typeof s === "string");
      } catch {
        /* legacy row without sections */
      }
      return {
        at: r.createdAt.toISOString(),
        status: r.status,
        summary: r.summary,
        trigger: r.trigger,
        sections,
      };
    }),
  });
}

/** Manual sync trigger (in addition to the hourly scheduler). */
export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && Date.now() - lastManual.at < MIN_MANUAL_INTERVAL_MS) {
    return NextResponse.json(
      { error: "A manual sync ran recently. The scheduler checks hourly; wait a few minutes or use ?force=1." },
      { status: 429 },
    );
  }
  lastManual.at = Date.now();
  const result = await runSync("manual");
  return NextResponse.json(result, { status: result.status === "error" ? 502 : 200 });
}
