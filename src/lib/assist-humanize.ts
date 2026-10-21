/**
 * Z-Assist humanizer — a deterministic tone pass over the final reply.
 *
 * Scope discipline (why pure string transforms, no LLM):
 *  - Runs AFTER verification, so it can never smuggle in a new claim;
 *  - It only rewrites style: stiff connectors → natural speech, boilerplate
 *    AI disclaimers → gone, formal contractions loosened;
 *  - Code fences, inline code, URLs and numbers are protected spans —
 *    the humanizer never edits anything inside them.
 */

/** Split into protected spans (fenced code, inline code, bare URLs) and prose. */
function segment(text: string): Array<{ protectedSpan: boolean; value: string }> {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`|https?:\/\/\S+)/g);
  return parts
    .filter((p) => p.length > 0)
    .map((p) => ({
      protectedSpan: /^(```|`|https?:\/\/)/.test(p),
      value: p,
    }));
}

/** Ordered replacements (first match wins per pattern). */
type Replacement = string | ((m: string) => string);
const PHRASE_MAP: Array<[RegExp, Replacement]> = [
  // AI boilerplate — always noise in a support chat
  [/\bAs an AI(?:\s+language)?\s+model,?\s*/gi, ""],
  [/\bI(?:'m| am) (?:just )?an AI(?:\s+\w+)*,?(?: so)?\s*/gi, ""],
  [/\bI don't have personal (?:opinions|preferences)[^.]*\./gi, ""],
  [/\bI(?:'m| am) not able to\b/gi, "I can't"],
  [/\bI am unable to\b/gi, "I can't"],
  [/\bI would like to (?:inform|point out|mention)\b/gi, "Quick heads-up:"],
  [/\bPlease be advised that\s*/gi, ""],
  [/\bPlease note that\s*/gi, ""],
  [/\bIt (?:is|should be) worth noting that\s*/gi, "Worth noting: "],
  [/\bIt is important to (?:note|remember) that\s*/gi, "Keep in mind: "],
  [/\bIn conclusion,?\s*/gi, "Bottom line: "],
  [/\bFurthermore,?\s*/gi, "Also, "],
  [/\bMoreover,?\s*/gi, "Plus, "],
  [/\bAdditionally,?\s*/gi, "Also, "],
  [/\bIn order to\b/gi, "to"],
  [/\bDue to the fact that\b/gi, "because"],
  [/\bAt this (?:point in )?time\b/gi, "right now"],
  [/\butilize[sd]?\b/gi, (m) => (/[sd]$/i.test(m) ? "used" : "use")],
  [/\bcommence[sd]?\b/gi, (m) => (/[sd]$/i.test(m) ? "started" : "start")],
  [/\bterminate[sd]?\b/gi, (m) => (/[sd]$/i.test(m) ? "ended" : "end")],
  [/\binquire\b/gi, "ask"],
  [/\bassistance\b/gi, "help"],
  [/\bKindly\b/g, "please"],
  [/\bupon (?:successful )?completion of\b/gi, "after"],
  [/\bprior to\b/gi, "before"],
  [/\bsubsequently\b/gi, "then"],
  [/\bendeavor\b/gi, "try"],
  [/\bnumerous\b/gi, "plenty of"],
  [/\bfacilitate\b/gi, "help with"],
];

/** Formal → conversational contractions (word-bounded, lowercase-safe). */
const CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bcannot\b/g, "can't"],
  [/\bdo not\b/g, "don't"],
  [/\bdoes not\b/g, "doesn't"],
  [/\bdid not\b/g, "didn't"],
  [/\bis not\b/g, "isn't"],
  [/\bare not\b/g, "aren't"],
  [/\bwas not\b/g, "wasn't"],
  [/\bwere not\b/g, "weren't"],
  [/\bwill not\b/g, "won't"],
  [/\bwould not\b/g, "wouldn't"],
  [/\bshould not\b/g, "shouldn't"],
  [/\bcould not\b/g, "couldn't"],
  [/\bhas not\b/g, "hasn't"],
  [/\bhave not\b/g, "haven't"],
  [/\bit is\b/g, "it's"],
  [/\bThat is\b/g, "That's"],
  [/\bthat is\b/g, "that's"],
  [/\bYou are\b/g, "You're"],
  [/\byou are\b/g, "you're"],
  [/\bYou will\b/g, "You'll"],
  [/\byou will\b/g, "you'll"],
  [/\bLet us\b/g, "Let's"],
  [/\blet us\b/g, "let's"],
];

function humanizeSegment(text: string): string {
  let out = text;
  for (const [re, rep] of PHRASE_MAP) {
    out = typeof rep === "function" ? out.replace(re, rep) : out.replace(re, rep);
  }
  for (const [re, rep] of CONTRACTIONS) {
    out = out.replace(re, rep);
  }
  // Punctuation hygiene — never inside protected spans (segments guarantee it).
  out = out
    .replace(/!{2,}/g, "!")
    .replace(/\?{2,}/g, "?")
    .replace(/,{2,}/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,!?;:])/g, "$1")
    .replace(/([!?])\./g, "$1");
  return out;
}

/**
 * Applies the tone pass to a markdown reply. Idempotent, pure, synchronous.
 * Protects fenced code blocks, inline code and URLs from every rewrite.
 */
export function humanize(text: string): string {
  if (!text) return text;
  return segment(text)
    .map((seg) => (seg.protectedSpan ? seg.value : humanizeSegment(seg.value)))
    .join("");
}
