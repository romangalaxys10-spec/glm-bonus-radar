import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { newUserToken, sanitizeName } from "@/lib/assist-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 8; // registrations
const RATE_WINDOW_MS = 30 * 60 * 1000; // per 30 minutes per IP

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : null) || "local";
}

/**
 * POST /api/agent/register — issue a Z-Assist personal access token.
 * Body: { name: string } (a display name, 1–40 chars).
 * Returns: { name, token } — the token IS the account; shown once with a
 * save-it-now screen, restorable on any device.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
  } else {
    bucket.count += 1;
    if (bucket.count > RATE_LIMIT) {
      return NextResponse.json(
        { error: "Too many tokens from this network — try again in a bit." },
        { status: 429 },
      );
    }
  }

  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = sanitizeName(body.name);
  if (!name) {
    return NextResponse.json(
      { error: "Tell me your name first — 1 to 40 characters." },
      { status: 400 },
    );
  }

  try {
    const token = newUserToken();
    await db.assistUser.create({ data: { name, token } });
    return NextResponse.json({ name, token });
  } catch (err) {
    console.error("[agent/register] failed:", err);
    return NextResponse.json(
      { error: "Could not issue a token right now — please try again." },
      { status: 500 },
    );
  }
}
