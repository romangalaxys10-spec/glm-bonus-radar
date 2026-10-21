import { getZai } from "@/lib/zai";
import { buildGroundingCorpus, type GroundingCorpus } from "@/lib/assist-grounding";

/**
 * Z-Assist verification layer — the anti-hallucination gate.
 *
 * Every docs-grounded reply passes through here BEFORE it is saved/shipped:
 *
 *  1. DETERMINISTIC CLAIM CHECK (instant, zero-cost) — every URL, GLM model
 *     name and $-price stated in the answer must exist in the grounding
 *     corpus (curated KB + hourly-synced official docs) or in the user's own
 *     message. Anything else is an unsupported claim.
 *  2. LLM VERIFIER (one cheap glm-5.3-flash call, 12s cap, fail-open) —
 *     judges whether the answer's factual claims are supported by a
 *     question-focused digest of the corpus.
 *  3. REGENERATION — when issues are found and a `regenerate` callback is
 *     supplied, the answer is regenerated ONCE with the issues injected
 *     ("your draft claimed X; answer strictly from the docs or say the docs
 *     don't cover it"). The retry must pass the same checks to be shipped.
 *  4. FAIL-HONEST — anything that still fails ships marked "flagged" with
 *     an honest banner (and lands in the self-learning queue), never
 *     silently.
 */

export type VerifyStatus = "verified" | "flagged" | "skip";

export interface VerifyResult {
  /** Final text to ship (the refined answer when regeneration passed). */
  text: string;
  status: VerifyStatus;
  /** Up to 3 human-readable issues (for the flag banner / learning queue). */
  issues: string[];
  /** True when the shipped text is the regenerated retry, not the original. */
  refined: boolean;
}

/* ------------------------------ corpus helpers ----------------------------- */

const VERIFY_TIMEOUT_MS = 12_000;

/** Question-focused digest of the corpus for the LLM verifier. */
function corpusDigest(corpus: GroundingCorpus, question: string, answer: string): string {
  const query = `${question} ${answer}`
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .match(/[a-z0-9][a-z0-9.,+#-]{2,}/g)
    ?.map((t) => t.replace(/[.,]+$/, "")) ?? [];
  const tokens = Array.from(new Set(query)).filter((t) => t.length >= 3);
  if (tokens.length === 0) return corpus.curated.slice(0, 6_000);

  /* Critical tokens = the concrete claims being audited (numbers with a
     comma/decimal, prices, model names). Lines carrying them are ALWAYS
     included, so a correct figure can never be "not found" just because
     the keyword score missed the one table row it lives in. */
  const critical = Array.from(
    new Set(
      (answer.match(/(?:\$\s?\d[\d,]*(?:\.\d+)?|\d[\d,]{1,9}(?:\.\d+)?%?|\b(?:GLM|CogVideoX)[-/ ]?[0-9][0-9A-Za-z.\-]*)/gi) ?? [])
        .map((t) => t.replace(/\s+/g, "").toLowerCase()),
    ),
  );

  const scored: Array<{ line: string; score: number }> = [];
  for (const raw of corpus.combined.split("\n")) {
    const line = raw.trim();
    if (line.length < 24) continue;
    const low = line.toLowerCase();
    let score = 0;
    for (const t of tokens) if (low.includes(t)) score++;
    const carriesClaim = critical.some((c) => low.includes(c));
    if (score >= 2 || carriesClaim) scored.push({ line, score: score + (carriesClaim ? 10 : 0) });
  }
  scored.sort((a, b) => b.score - a.score);
  const lines: string[] = [];
  let size = 0;
  for (const s of scored) {
    if (size + s.line.length > 7_500 || lines.length >= 60) break;
    lines.push(s.line);
    size += s.line.length;
  }
  return lines.join("\n") || corpus.curated.slice(0, 6_000);
}

/* --------------------------- deterministic checks --------------------------- */

/** URLs that are always allowed (portal + official + sponsor properties). */
const URL_ALLOWLIST =
  /^https:\/\/(?:[a-z0-9-]*\.)*(?:docs\.z\.ai|z\.ai|zcode\.z\.ai|zhelp\.space-z\.ai|xshredo\.com|github\.com\/zai-org|api\.z\.ai)(?:[/:?#]|$)/i;

function checkUrls(answer: string, corpusText: string, userText: string): string[] {
  const issues: string[] = [];
  const urls = answer.match(/https?:\/\/[^\s)`\]>]+/g) ?? [];
  const corpusLow = corpusText.toLowerCase();
  const userLow = (userText ?? "").toLowerCase();
  for (const raw of urls) {
    const url = raw.replace(/[.,;:]+$/, "");
    if (URL_ALLOWLIST.test(url)) continue;
    if (corpusLow.includes(url.toLowerCase())) continue;
    if (userLow.includes(url.toLowerCase())) continue;
    issues.push(`unverified link ${url}`);
  }
  return issues;
}

function checkModels(answer: string, corpusText: string, userText: string): string[] {
  const issues: string[] = [];
  // Model tokens require a digit right after the family name so plan names
  // ("GLM Coding Plan") never trip the check.
  const models =
    answer.match(/\b(?:GLM|CogVideoX)[-/ ]?(?=[0-9])[0-9A-Za-z.\-]*\b/gi) ?? [];
  const corpusLow = corpusText.toLowerCase();
  const userLow = (userText ?? "").toLowerCase();
  for (const m of models) {
    const name = m.trim();
    if (corpusLow.includes(name.toLowerCase())) continue;
    if (userLow.includes(name.toLowerCase())) continue;
    issues.push(`model "${name}" is not in the official docs material`);
  }
  return issues;
}

function checkPrices(answer: string, corpusText: string, userText: string): string[] {
  const issues: string[] = [];
  const prices = answer.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) ?? [];
  const corpusLow = corpusText.toLowerCase();
  const userLow = (userText ?? "").toLowerCase();
  for (const p of prices) {
    const norm = p.replace(/\s+/g, "");
    if (corpusLow.includes(norm.toLowerCase().replace("$", "$ "))) continue;
    if (corpusLow.includes(norm.toLowerCase())) continue;
    if (userLow.includes(norm.toLowerCase())) continue;
    issues.push(`price ${norm} is not in the official docs material`);
  }
  return issues;
}

/** All deterministic issues for one answer. */
function deterministicIssues(
  answer: string,
  corpus: GroundingCorpus,
  userText: string,
): string[] {
  const text = corpus.combined;
  return [
    ...checkUrls(answer, text, userText),
    ...checkModels(answer, text, userText),
    ...checkPrices(answer, text, userText),
  ];
}

/* ------------------------------- LLM verifier ------------------------------ */

interface VerifierShape {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/** Runs the cheap verifier model; resolves null on timeout/error (fail-open). */
async function llmVerify(
  question: string,
  answer: string,
  digest: string,
): Promise<{ supported: boolean; issues: string[] } | null> {
  const system = `You are the grounding auditor for a docs-only support agent. You get QUESTION, ANSWER and CONTEXT (digest of official docs material). Decide whether every factual claim in the ANSWER (numbers, prices, dates, quotas, model names, product behavior, URLs) is supported by the CONTEXT or is generic phrasing with no factual content.
Reply with STRICT JSON only, no markdown:
{"supported": true}
or
{"supported": false, "issues": ["<claim 1 not found in context>", "<claim 2 ...>"]}
Rules: flag only concrete unsupported FACTS, never style. If the answer honestly says the docs don't cover something, that is supported. Max 3 issues, each under 120 chars.`;

  const user = `QUESTION: ${question.slice(0, 600)}\n\nANSWER: ${answer.slice(0, 4_000)}\n\nCONTEXT:\n${digest}`;

  try {
    const zai = await getZai();
    const call = zai.chat.completions.create({
      model: "glm-5.3-flash",
      messages: [
        { role: "assistant", content: system },
        { role: "user", content: user },
      ],
      thinking: { type: "disabled" },
    }) as Promise<VerifierShape>;
    const timer = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), VERIFY_TIMEOUT_MS),
    );
    const res = await Promise.race([call, timer]);
    if (!res) return null;
    const raw = res.choices?.[0]?.message?.content?.trim() ?? "";
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { supported?: boolean; issues?: unknown };
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.filter((x): x is string => typeof x === "string").slice(0, 3)
      : [];
    return { supported: parsed.supported !== false, issues };
  } catch {
    return null;
  }
}

/* ------------------------------ orchestration ------------------------------ */

export interface VerifyOptions {
  question: string;
  answer: string;
  /** The user's own message — claims the user made are allowed through. */
  userText?: string;
  /**
   * One-shot regeneration callback. Receives the detected issues; returns a
   * fresh answer that must pass the same checks to be shipped.
   */
  regenerate?: (issues: string[]) => Promise<string>;
}

/**
 * Verifies (and best-effort repairs) a grounded reply. Never throws — on
 * internal failure it returns the original text with status "skip" so the
 * chat never breaks because the auditor hiccuped.
 */
export async function verifyAssistReply(opts: VerifyOptions): Promise<VerifyResult> {
  const { question, answer, userText = "" } = opts;
  try {
    const corpus = await buildGroundingCorpus();

    const det = deterministicIssues(answer, corpus, userText);

    const digest = corpusDigest(corpus, question, answer);
    const llm = await llmVerify(question, answer, digest);

    if (det.length === 0 && (!llm || llm.supported)) {
      return {
        text: answer,
        status: "verified",
        issues: [],
        refined: false,
      };
    }

    const issues = Array.from(new Set([...det, ...(llm?.issues ?? [])])).slice(0, 6);

    if (opts.regenerate) {
      try {
        const refined = await opts.regenerate(issues);
        const text = refined.trim();
        if (text && text !== answer) {
          const det2 = deterministicIssues(text, corpus, userText);
          const digest2 = corpusDigest(corpus, question, text);
          const llm2 = await llmVerify(question, text, digest2);
          if (det2.length === 0 && (!llm2 || llm2.supported)) {
            return { text, status: "verified", issues: [], refined: true };
          }
        }
      } catch {
        /* regeneration failed — ship the original flagged */
      }
    }

    return { text: answer, status: "flagged", issues: issues.slice(0, 3), refined: false };
  } catch (err) {
    console.warn("[assist-verify] pipeline failed (fail-open):", err);
    return { text: answer, status: "skip", issues: [], refined: false };
  }
}
