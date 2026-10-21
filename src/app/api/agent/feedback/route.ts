import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authUser, normalizeUserToken } from "@/lib/assist-users";
import { TOKEN_REGEX } from "@/lib/assist-core";
import { captureLearnEntry } from "@/lib/assist-learn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent/feedback — the trust loop's user side.
 *
 * Body: { token: "ZA-…", id?: conversation token, rating: "up"|"down",
 *         question, answer, reason?, verdict? }
 *
 * Every rating is stored (AssistFeedback). A thumbs-down ALSO seeds the
 * self-learning queue (AssistLearnEntry, origin "feedback") so staff see
 * exactly which answers disappointed users and can fix them with a
 * docs-cited reply — that is how the agent improves with time.
 */
export async function POST(req: NextRequest) {
  let body: {
    token?: unknown;
    id?: unknown;
    rating?: unknown;
    question?: unknown;
    answer?: unknown;
    reason?: unknown;
    verdict?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rating = body.rating === "up" || body.rating === "down" ? body.rating : null;
  if (!rating) {
    return NextResponse.json({ error: "rating must be \"up\" or \"down\"." }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim().slice(0, 2000) : "";
  const answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 6000) : "";
  if (!question || !answer) {
    return NextResponse.json({ error: "question and answer are required." }, { status: 400 });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;
  const verdict =
    typeof body.verdict === "string" && ["verified", "flagged", "skip"].includes(body.verdict)
      ? body.verdict
      : null;

  const conversationToken =
    typeof body.id === "string" && TOKEN_REGEX.test(body.id.trim().toUpperCase())
      ? body.id.trim().toUpperCase()
      : null;

  let userToken: string | null = null;
  const candidate = normalizeUserToken(body.token);
  if (candidate) {
    try {
      const user = await authUser(candidate);
      if (user) userToken = candidate;
    } catch {
      /* anonymous feedback still allowed */
    }
  }

  try {
    await db.assistFeedback.create({
      data: {
        userToken,
        conversationToken,
        rating,
        question,
        answer,
        reason,
        verdict,
      },
    });

    if (rating === "down") {
      await captureLearnEntry({
        question,
        answer,
        origin: "feedback",
        note: reason ? `user downvoted: ${reason}` : "user downvoted this answer",
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[agent/feedback] failed:", err);
    return NextResponse.json({ error: "Could not record feedback." }, { status: 500 });
  }
}
