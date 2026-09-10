import { NextRequest, NextResponse } from "next/server";
import {
  passwordMatches,
  getOrCreateEndpointKey,
  rotateEndpointKey,
  findKeyRow,
  rateLimited,
  clientIp,
} from "@/lib/endpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Password gate for the secret /endpoint section.
 *
 * POST { password }                       -> unlock: returns the singleton key
 * POST { password, action: "regenerate" } -> rotates the key (old one dies)
 * GET  ?key=za_sk_...                     -> key status (dashboard restore)
 *
 * Unlock attempts are IP-limited (10/hour) to blunt brute-force guesses.
 */
export async function POST(req: NextRequest) {
  if (rateLimited(`endpoint-auth:${clientIp(req)}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in an hour." },
      { status: 429 },
    );
  }

  let body: { password?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!passwordMatches(body.password)) {
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }

  try {
    const row =
      body.action === "regenerate" ? await rotateEndpointKey() : await getOrCreateEndpointKey();
    return NextResponse.json({
      key: row.key,
      label: row.label,
      callCount: row.callCount,
      conversationToken: row.conversationToken,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("[endpoint:auth] key operation failed:", err);
    return NextResponse.json({ error: "Key operation failed. Try again." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const row = await findKeyRow(key).catch(() => null);
  if (!row) {
    return NextResponse.json({ valid: false }, { status: 404 });
  }
  return NextResponse.json({
    valid: true,
    key: row.key,
    label: row.label,
    callCount: row.callCount,
    conversationToken: row.conversationToken,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}
