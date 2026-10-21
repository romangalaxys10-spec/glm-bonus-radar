import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { TOKEN_REGEX, type IncomingMessage } from "@/lib/assist-core";
import { storedMessageCount } from "@/lib/assist-users";
import { questionKey } from "@/lib/assist-learn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Z-Assist staff mode — the "staff helps users" half of /agent.
 *
 * Auth: the passcode arrives in the request body (`staffKey`) and is compared
 * against the STAFF_PASSCODE runtime environment variable. No passcode in the
 * env = staff mode disabled (honest 503, no silent fallback). The passcode is
 * never stored or echoed — the client keeps it in sessionStorage and sends it
 * per request; every action is re-checked server-side.
 *
 * POST body: { staffKey, action, ...payload }
 *  - "overview"        → stats + recent conversations + pending queue snapshot
 *  - "learnings.list"  → review queue (pending + latest resolutions)
 *  - "learnings.save"  → {id?, question, answer, sourceUrls, status} create/approve/edit
 *  - "learnings.reject"→ {id}
 *  - "convs.get"       → {convId} full thread (any user's, read-only help view)
 *  - "conv.reply"      → {convId, text} append a staff reply (role assistant,
 *                        staff:true) into the user's own thread
 *
 * GET → { enabled: boolean } only (never leaks the passcode itself).
 */

const MAX_REPLY = 4000;

function staffEnabled(): boolean {
  return typeof process.env.STAFF_PASSCODE === "string" && process.env.STAFF_PASSCODE.length >= 6;
}

function checkStaffKey(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const expected = process.env.STAFF_PASSCODE ?? "";
  if (!expected) return false;
  const a = Buffer.from(raw.trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
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
      : [];
  } catch {
    return [];
  }
}

export async function GET() {
  return NextResponse.json({ enabled: staffEnabled() });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!staffEnabled()) {
    return NextResponse.json(
      {
        error:
          "Staff mode is disabled — set the STAFF_PASSCODE runtime environment variable (min 6 chars) to enable it.",
      },
      { status: 503 },
    );
  }
  if (!checkStaffKey(body.staffKey)) {
    return NextResponse.json({ error: "Wrong staff passcode." }, { status: 401 });
  }

  const action = typeof body.action === "string" ? body.action : "";

  try {
    switch (action) {
      /* ------------------------------ overview ------------------------------ */
      case "overview": {
        const [users, convos, feedbacks, pending, downvotes] = await Promise.all([
          db.assistUser.count(),
          db.assistConversation.count(),
          db.assistFeedback.count(),
          db.assistLearnEntry.count({ where: { status: "pending" } }),
          db.assistFeedback.count({ where: { rating: "down" } }),
        ]);
        const messagesAgg = await db.assistConversation.findMany({
          select: { messages: true },
          take: 500,
          orderBy: { updatedAt: "desc" },
        });
        const messageCount = messagesAgg.reduce((n, r) => n + storedMessageCount(r.messages), 0);

        const recentRows = await db.assistConversation.findMany({
          orderBy: { updatedAt: "desc" },
          take: 14,
        });
        const owners = await db.assistUser.findMany({
          select: { token: true, name: true },
        });
        const nameByToken = new Map(owners.map((u) => [u.token, u.name]));

        const recent = recentRows.map((r) => ({
          id: r.token,
          title: r.title,
          count: storedMessageCount(r.messages),
          updatedAt: r.updatedAt.toISOString(),
          owner: r.userToken ? nameByToken.get(r.userToken) ?? null : null,
        }));

        const learnPending = await db.assistLearnEntry.count({ where: { status: "pending" } });
        const learnApproved = await db.assistLearnEntry.count({ where: { status: "approved" } });
        const learnHits = await db.assistLearnEntry.aggregate({ _sum: { hits: true } });

        return NextResponse.json({
          stats: {
            users,
            convos,
            messages: messageCount,
            feedbacks,
            downvotes,
            learnPending,
            learnApproved,
            learnHits: learnHits._sum.hits ?? 0,
          },
          recent,
        });
      }

      /* ---------------------------- learn queue ----------------------------- */
      case "learnings.list": {
        const [pending, resolved] = await Promise.all([
          db.assistLearnEntry.findMany({
            where: { status: "pending" },
            orderBy: { updatedAt: "desc" },
            take: 50,
          }),
          db.assistLearnEntry.findMany({
            where: { status: { not: "pending" } },
            orderBy: { updatedAt: "desc" },
            take: 20,
          }),
        ]);
        const clean = (rows: typeof pending) =>
          rows.map((r) => ({
            id: r.id,
            question: r.question,
            answer: r.answer,
            origin: r.origin,
            status: r.status,
            sourceUrls: r.sourceUrls,
            note: r.note,
            hits: r.hits,
            updatedAt: r.updatedAt.toISOString(),
          }));
        return NextResponse.json({ pending: clean(pending), resolved: clean(resolved) });
      }

      case "learnings.save": {
        const question = typeof body.question === "string" ? body.question.trim().slice(0, 600) : "";
        const answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 4000) : "";
        const sourceUrls =
          typeof body.sourceUrls === "string"
            ? body.sourceUrls
                .split(/[\s,]+/)
                .filter((u) => /^https?:\/\//i.test(u))
                .join(" ")
                .slice(0, 1000)
            : "";
        const status = body.status === "approved" ? "approved" : body.status === "pending" ? "pending" : "rejected";
        if (!question || !answer) {
          return NextResponse.json({ error: "question and answer are required." }, { status: 400 });
        }
        if (status === "approved" && !sourceUrls) {
          return NextResponse.json(
            { error: "Approved answers must cite at least one official source URL (docs.z.ai / zcode.z.ai)." },
            { status: 400 },
          );
        }

        if (typeof body.id === "string" && body.id) {
          const updated = await db.assistLearnEntry.update({
            where: { id: body.id },
            data: { question, answer, sourceUrls, status },
          });
          return NextResponse.json({ ok: true, id: updated.id });
        }
        const created = await db.assistLearnEntry.create({
          data: { qKey: questionKey(question), question, answer, sourceUrls, status, origin: "staff" },
        });
        return NextResponse.json({ ok: true, id: created.id });
      }

      case "learnings.reject": {
        if (typeof body.id !== "string" || !body.id) {
          return NextResponse.json({ error: "id is required." }, { status: 400 });
        }
        await db.assistLearnEntry.update({
          where: { id: body.id },
          data: { status: "rejected" },
        });
        return NextResponse.json({ ok: true });
      }

      /* ------------------------------ threads ------------------------------- */
      case "convs.get": {
        const convId = typeof body.convId === "string" ? body.convId.trim().toUpperCase() : "";
        if (!TOKEN_REGEX.test(convId)) {
          return NextResponse.json({ error: "Valid convId required." }, { status: 400 });
        }
        const row = await db.assistConversation.findUnique({ where: { token: convId } });
        if (!row) {
          return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
        }
        const owner = row.userToken
          ? (await db.assistUser.findUnique({ where: { token: row.userToken } }))?.name ?? null
          : null;
        return NextResponse.json({
          id: row.token,
          title: row.title,
          owner,
          messages: parseStored(row.messages),
          updatedAt: row.updatedAt.toISOString(),
        });
      }

      case "conv.reply": {
        const convId = typeof body.convId === "string" ? body.convId.trim().toUpperCase() : "";
        const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_REPLY) : "";
        if (!TOKEN_REGEX.test(convId) || !text) {
          return NextResponse.json({ error: "Valid convId and text are required." }, { status: 400 });
        }
        const row = await db.assistConversation.findUnique({ where: { token: convId } });
        if (!row) {
          return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
        }
        const merged = [
          ...parseStored(row.messages),
          { role: "assistant", content: text, staff: true },
        ].slice(-60);
        await db.assistConversation.update({
          where: { token: convId },
          data: { messages: JSON.stringify(merged) },
        });
        return NextResponse.json({ ok: true, id: convId });
      }

      default:
        return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
    }
  } catch (err) {
    console.error("[agent/staff] action failed:", err);
    return NextResponse.json({ error: "Staff action failed." }, { status: 500 });
  }
}
