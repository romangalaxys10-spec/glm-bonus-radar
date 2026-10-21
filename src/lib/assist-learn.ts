import { db } from "@/lib/db";

/**
 * Z-Assist self-learning store.
 *
 * The loop, end to end:
 *  1. CAPTURE — a question lands here (status "pending") when the engine says
 *     "not in the docs", when verification flags the answer, or when a user
 *     thumbs-downs a reply.
 *  2. REVIEW — staff approve/edit/reject entries in the /agent staff panel.
 *     Approved answers must cite official pages (docs.z.ai / zcode.z.ai).
 *  3. REINFORCE — approved entries are matched against new questions and
 *     injected into the system prompt as high-trust context, so the same
 *     question gets a better (and stable) answer next time. `hits` tracks
 *     how much each approved entry is actually used.
 *
 * Nothing here ever invents facts: entries are only *retrieved* context —
 * the grounding rules and the verification layer still apply to them.
 */

/** Stopwords stripped when fingerprinting a question. */
const STOPWORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being","do","does","did",
  "can","could","should","would","will","shall","may","might","must","i","me",
  "my","we","our","you","your","it","its","this","that","these","those","of",
  "in","on","at","to","for","with","about","as","by","from","or","and","if",
  "how","what","when","where","which","who","whom","why","does","please","tell",
  "explain","know","get","got","hi","hello","hey","there","any","am","pm",
]);

/** Tokenizes + fingerprints a question into a comparable key. */
export function questionKey(question: string): string {
  const tokens = question
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff\u0400-\u04ff\u0600-\u06ff\u3040-\u30ff\uac00-\ud7af]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return Array.from(new Set(tokens)).slice(0, 14).join(" ");
}

/** Content tokens used for similarity scoring. */
function tokensOf(qKey: string): Set<string> {
  return new Set(qKey.split(" ").filter(Boolean));
}

/** Jaccard similarity between two question fingerprints (0..1). */
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface ApprovedLearning {
  id: string;
  question: string;
  answer: string;
  sourceUrls: string;
  score: number;
}

/**
 * Approved entries relevant to `question`, best first. `minScore` filters out
 * noise; the caller injects them as high-trust prompt context.
 */
export async function findApprovedLearnings(
  question: string,
  opts?: { limit?: number; minScore?: number },
): Promise<ApprovedLearning[]> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 3, 5));
  const minScore = opts?.minScore ?? 0.34;
  const key = questionKey(question);
  const probe = tokensOf(key);
  if (probe.size === 0) return [];

  try {
    const rows = await db.assistLearnEntry.findMany({
      where: { status: "approved" },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    const scored = rows
      .map((r) => ({ r, score: similarity(probe, tokensOf(r.qKey)) }))
      .filter((x) => x.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Fire-and-forget usage tracking — never blocks the reply.
    if (scored.length > 0) {
      void db.assistLearnEntry
        .updateMany({
          where: { id: { in: scored.map((s) => s.r.id) } },
          data: { hits: { increment: 1 }, lastHitAt: new Date() },
        })
        .catch(() => undefined);
    }

    return scored.map((s) => ({
      id: s.r.id,
      question: s.r.question,
      answer: s.r.answer,
      sourceUrls: s.r.sourceUrls,
      score: s.score,
    }));
  } catch {
    return [];
  }
}

/** Renders approved learnings as a prompt block ("" when none match). */
export function renderLearningsBlock(learnings: ApprovedLearning[]): string {
  if (learnings.length === 0) return "";
  const items = learnings
    .map((l) => {
      const src = l.sourceUrls.trim();
      return [
        `Q: ${l.question.slice(0, 300)}`,
        `A (staff-approved, cite ${src || "the official docs"}): ${l.answer.slice(0, 900)}`,
      ].join("\n");
    })
    .join("\n\n");
  return `

--- STAFF-APPROVED LEARNED ANSWERS (questions this agent previously missed, now answered and reviewed by staff; treat them as docs-backed and PREFER them when they match the user's question) ---

${items}
=== END LEARNED ANSWERS ===`;
}

export interface LearnEntryInput {
  question: string;
  answer?: string;
  origin?: "auto" | "feedback" | "staff";
  sourceUrls?: string;
  note?: string;
}

/**
 * Captures a question into the learning queue. Deduped on the question
 * fingerprint while the previous entry is still pending (its note grows
 * instead of the queue flooding with duplicates). Fire-and-forget friendly:
 * never throws.
 */
export async function captureLearnEntry(input: LearnEntryInput): Promise<void> {
  try {
    const question = input.question.trim().slice(0, 600);
    if (question.length < 3) return;
    const qKey = questionKey(question);
    if (!qKey) return;

    const existing = await db.assistLearnEntry.findFirst({
      where: { qKey, status: "pending" },
      orderBy: { updatedAt: "desc" },
    });

    if (existing) {
      await db.assistLearnEntry.update({
        where: { id: existing.id },
        data: {
          note: [existing.note, input.note].filter(Boolean).join(" | ").slice(0, 500) || null,
          ...(input.answer && !existing.answer
            ? { answer: input.answer.slice(0, 4000) }
            : {}),
          ...(input.origin === "feedback" ? { origin: "feedback" } : {}),
        },
      });
      return;
    }

    await db.assistLearnEntry.create({
      data: {
        qKey,
        question,
        answer: input.answer?.slice(0, 4000) ?? "",
        origin: input.origin ?? "auto",
        note: input.note?.slice(0, 500) ?? null,
      },
    });
  } catch (err) {
    console.warn("[assist-learn] capture failed:", err);
  }
}

/** Refusal phrasings the engine uses when the docs don't cover a question. */
const REFUSAL_RE =
  /not covered in (the )?(docs|official|knowledge)|not (mentioned|covered) (in|by) the official|couldn'?t find (it |this |that )?in (the )?(official )?docs|don'?t have (that |this )?(information|detail)s? (in|from) the docs|docs don'?t cover|not (something )?the (official )?docs (cover|address)|outside (of )?the (official )?docs/i;

/** True when an assistant reply is an honest "not in the docs" answer. */
export function looksLikeRefusal(reply: string): boolean {
  return REFUSAL_RE.test(reply);
}
