import { NextRequest, NextResponse } from "next/server";
import { authUser, normalizeUserToken } from "@/lib/assist-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent/session — resume a Z-Assist identity on this device.
 * Body: { token: "ZA-XXXXXX" } — returns { name, token } when the token is
 * live, 404 when unknown. Used by the "I already have a token" restore flow.
 */
export async function POST(req: NextRequest) {
  let body: { token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const token = normalizeUserToken(body.token);
  if (!token) {
    return NextResponse.json(
      { error: "That doesn't look like a Z-Assist token — expected ZA-XXXXXX." },
      { status: 400 },
    );
  }

  try {
    const user = await authUser(token);
    if (!user) {
      return NextResponse.json(
        { error: "No Z-Assist account found for that token." },
        { status: 404 },
      );
    }
    return NextResponse.json({ name: user.name, token: user.token });
  } catch (err) {
    console.error("[agent/session] failed:", err);
    return NextResponse.json(
      { error: "Could not check that token right now — please try again." },
      { status: 500 },
    );
  }
}
