import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authUser, normalizeUserToken, storedMessageCount } from "@/lib/assist-users";
import { TOKEN_REGEX, type IncomingMessage } from "@/lib/assist-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Z-Assist conversation drawer, scoped to a personal access token.
 *
 * GET    /api/agent/conversations?token=ZA-XXXXXX            -> list (newest first)
 * GET    /api/agent/conversations?token=ZA-…&id=CONVTOKEN    -> one conversation, full messages
 * DELETE /api/agent/conversations?token=ZA-…&id=CONVTOKEN    -> delete it
 *
 * Ownership: the id must belong to the token — legacy threads (userToken
 * null) and other users' threads are invisible here.
 */

async function ownedConversation(userToken: string, id: string) {
  if (!TOKEN_REGEX.test(id)) return null;
  const row = await db.assistConversation.findUnique({ where: { token: id } });
  if (!row || row.userToken !== userToken) return null;
  return row;
}

function parseStored(raw: string): IncomingMessage[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (m): m is IncomingMessage =>
            !!m &&
            typeof m === "object" &&
            ((m as IncomingMessage).role === "user" || (m as IncomingMessage).role === "assistant") &&
            typeof (m as IncomingMessage).content === "string",
        )
          // Preserve additive flags (staff replies, verification badges) —
          // legacy rows without them keep working untouched.
          .map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.staff === true ? { staff: true } : {}),
            ...(m.verify && typeof m.verify === "object" && typeof m.verify.status === "string"
              ? { verify: { status: m.verify.status, ...(Array.isArray(m.verify.issues) ? { issues: m.verify.issues.slice(0, 3) } : {}) } }
              : {}),
          }))
      : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const token = normalizeUserToken(req.nextUrl.searchParams.get("token"));
  if (!token) {
    return NextResponse.json({ error: "A valid ZA- token is required." }, { status: 400 });
  }
  const id = req.nextUrl.searchParams.get("id");

  try {
    const user = await authUser(token);
    if (!user) {
      return NextResponse.json({ error: "Unknown token." }, { status: 404 });
    }

    if (id) {
      const row = await ownedConversation(token, id.trim().toUpperCase());
      if (!row) {
        return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
      }
      return NextResponse.json({
        id: row.token,
        title: row.title,
        messages: parseStored(row.messages),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    }

    const rows = await db.assistConversation.findMany({
      where: { userToken: token },
      orderBy: { updatedAt: "desc" },
      take: 60,
    });
    return NextResponse.json({
      conversations: rows.map((r) => ({
        id: r.token,
        title: r.title,
        count: storedMessageCount(r.messages),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[agent/conversations] GET failed:", err);
    return NextResponse.json({ error: "Could not load conversations." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const token = normalizeUserToken(req.nextUrl.searchParams.get("token"));
  const id = req.nextUrl.searchParams.get("id");
  if (!token) {
    return NextResponse.json({ error: "A valid ZA- token is required." }, { status: 400 });
  }
  if (!id) {
    return NextResponse.json({ error: "Which conversation? Pass ?id=." }, { status: 400 });
  }

  try {
    const user = await authUser(token);
    if (!user) {
      return NextResponse.json({ error: "Unknown token." }, { status: 404 });
    }
    const row = await ownedConversation(token, id.trim().toUpperCase());
    if (!row) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }
    await db.assistConversation.delete({ where: { token: row.token } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[agent/conversations] DELETE failed:", err);
    return NextResponse.json({ error: "Could not delete that conversation." }, { status: 500 });
  }
}
