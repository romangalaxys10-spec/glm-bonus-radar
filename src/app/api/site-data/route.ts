import { NextResponse } from "next/server";
import { getStoredSiteData } from "@/lib/docs-sync";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current AI-synced site data + freshness metadata for the badge. */
export async function GET() {
  try {
    const data = await getStoredSiteData();
    const lastRun = await db.syncRun.findFirst({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({
      ...data,
      lastSync: lastRun
        ? { at: lastRun.createdAt.toISOString(), status: lastRun.status, summary: lastRun.summary }
        : null,
    });
  } catch (err) {
    console.error("[site-data] read failed:", err);
    return NextResponse.json({ payload: null, changeLog: [], updatedAt: null, lastSync: null });
  }
}
