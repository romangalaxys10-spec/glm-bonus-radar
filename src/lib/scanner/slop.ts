/**
 * zScanner — Anti AI-Slop Reviewer (scanner kind: "slop").
 *
 * "Would a human designer at a respected studio ever ship this?" (gstack
 * design-review) — asked mechanically across ~50 deterministic detectors.
 *
 * Pipeline: fetch the page (SSRF-guarded), collect its CSS (<style>, style="",
 * same-origin + CDN stylesheets), run the design-tell pack (slop-css.ts),
 * read the visible copy through the sloptrim/gstack wordlists, then score
 * both ways: the standard severity-deduction headline score AND a gstack-style
 * letter-drop AI-Slop grade computed per category (color, typography, layout,
 * visual, motion, copy, imagery). The report ends in the unslop-my-ui shape:
 * slop inventory with quoted evidence, a "what already works" keep-list, an
 * unslop direction, and a dev-agent rewrite prompt (prompts.ts).
 *
 * Deterministic — no AI dependency at report time (portal doctrine).
 */

import { guardedGet, ScanError } from "./fetcher";
import { type Finding, type Inconclusive, type UrlScanReport, gradeFor } from "./types";
import { dedupeFindings, tag, verificationBlock } from "./verify";
import { runDesignDetectors, type CssInput } from "./slop-css";
import { captureSlopShots } from "./slop-shots";
import {
  AI_VOCAB, PROMO_WORDS, CLICHE_PAIRS, THEATER_PHRASES, GENERIC_HERO,
  NOT_X_BUT_Y, CONCLUSION_FORMULA, FILLER_PHRASES, HAPPY_TALK, STAT_PATTERN,
} from "./slop-wordlists";

const MAX_SHEETS = 6;
const SHEET_CAP = 300_000;

/* ------------------------------ text utils ------------------------------ */

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
  return out;
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]{0,2000000}?<\/script>/gi, " ")
    .replace(/<style[\s\S]{0,200000}?<\/style>/gi, " ")
    .replace(/<!--[\s\S]{0,20000}?-->/g, " ")
    .replace(/<[^>]{0,300}>/g, " ")
    .replace(/&[a-z#0-9]{1,8};/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countHits(text: string, re: RegExp): number {
  let n = 0;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    n++;
    if (!m[0]) g.lastIndex++;
    if (n > 2000) break;
  }
  return n;
}

function firstMatch(text: string, res: RegExp[], cap = 2): string[] {
  const out: string[] = [];
  for (const re of res) {
    const m = re.exec(text);
    if (m) out.push(m[0].slice(0, 140));
    if (out.length >= cap) break;
  }
  return out;
}

/* --------------------------- copy detectors ----------------------------- */

export function runCopyDetectors(text: string, push: (f: Finding) => void): { words: number; vocabHits: number; vocabDistinct: number } {
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;
  const per1k = (n: number) => (words > 0 ? (n * 1000) / words : 0);

  // --- AI vocabulary cluster (sloptrim doctrine: only density fires) ---
  const vocabFound: string[] = [];
  let vocabHits = 0;
  for (const w of AI_VOCAB) {
    const re = w.includes(" ") ? new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const hits = countHits(lower, re);
    if (hits > 0) {
      vocabFound.push(`${w}×${hits}`);
      vocabHits += hits;
    }
  }
  const vocabDistinct = vocabFound.length;
  if (vocabDistinct >= 6 || per1k(vocabHits) >= 14) {
    push({
      id: "slop-ai-vocab",
      severity: "high",
      title: `Dense AI vocabulary — ${vocabDistinct} distinct tells, ${vocabHits} hits (${per1k(vocabHits).toFixed(1)}/1000 words)`,
      detail: "sloptrim's doctrine: individual words are common in human prose, but this cluster density is the lexicon of generated copy (delve/tapestry/seamless/leverage/unlock class). Readers feel it even when they cannot name it.",
      fix: "Replace every flagged word with a concrete claim: a number, a noun, a name. If a sentence survives only on these words, cut the sentence.",
      evidence: vocabFound.slice(0, 14).join(", "),
    });
  } else if (vocabDistinct >= 3 || per1k(vocabHits) >= 6) {
    push({
      id: "slop-ai-vocab",
      severity: "medium",
      title: `AI vocabulary cluster (${vocabDistinct} distinct, ${vocabHits} hits)`,
      detail: "Several generated-register words in visible copy. Below cluster-density, this is a style smell rather than a verdict — but it is where slop starts.",
      fix: "Swap for specific language; keep at most one of these words in the whole page.",
      evidence: vocabFound.slice(0, 10).join(", "),
    });
  } else if (vocabDistinct > 0) {
    push({ id: "slop-ai-vocab", severity: "low", title: `Isolated AI-register words (${vocabFound.slice(0, 6).join(", ")})`, detail: "Single hits are common in human prose — noted, not judged. Watch the trend across pages." });
  }

  // --- theater phrases / generic hero copy ---
  const theater = firstMatch(text, THEATER_PHRASES, 3);
  if (theater.length) {
    push({
      id: "slop-theater-phrase",
      severity: "high",
      title: `Generated-essay openers (${theater.length}+)`,
      detail: '"In today\'s fast-paced digital landscape…" class openers are gstack\'s theater-phrase tell: words that sound like content while carrying none.',
      fix: "Open with the product fact. Delete the weather report about the industry.",
      evidence: theater.join("  ·  "),
    });
  }
  const hero = firstMatch(text, GENERIC_HERO, 3);
  if (hero.length) {
    push({
      id: "slop-generic-hero",
      severity: "high",
      title: "Generic hero/CTA copy",
      detail: '"Your all-in-one solution", "Unlock the power of", "Supercharge your…" — the gstack blacklist hero lines every generator emits. They describe no product.',
      fix: 'Name the outcome and the buyer: what changes for whom, in numbers if you have them. "Get started" is not a value proposition.',
      evidence: hero.join("  ·  "),
    });
  }

  // --- not-X-but-Y cadence (the signature turn) ---
  const nxy = firstMatch(text, NOT_X_BUT_Y, 2);
  if (nxy.length) {
    push({
      id: "slop-not-x-but-y",
      severity: "medium",
      title: '"Not X — but Y" cadence',
      detail: "The aphoristic negation-pivot is the most imitation-prone construction in generated copy (Gesso's not-x-but-y-cadence, sloptrim #18). One use is style; repetition is a fingerprint.",
      fix: "State the claim directly. Contrast is stronger when the reader supplies it.",
      evidence: nxy.join("  ·  "),
    });
  }

  // --- promotional language ---
  const promoFound = PROMO_WORDS.filter((w) => lower.includes(w));
  if (promoFound.length >= 3) {
    push({
      id: "slop-promo-language",
      severity: "medium",
      title: `Travel-brochure register (${promoFound.length} promotional words)`,
      detail: '"Breathtaking, nestled, world-class, unparalleled" — sloptrim\'s promotional cluster. It inflates significance while multiplying information by zero.',
      fix: "Trade each adjective for the fact it is hiding: which award, which number, which place.",
      evidence: promoFound.slice(0, 10).join(", "),
    });
  }

  // --- cliché hyphen pairs ---
  const clicheFound = CLICHE_PAIRS.filter((w) => lower.includes(w));
  if (clicheFound.length >= 3) {
    push({
      id: "slop-cliche-pairs",
      severity: "medium",
      title: `Marketing hyphen-pair pileup (${clicheFound.length})`,
      detail: '"Enterprise-grade, battle-tested, best-in-class" — the compound-modifier costume of generated B2B copy (sloptrim #4; gstack marketing-buzzword).',
      fix: "Keep at most one. Prove the others with specifics instead.",
      evidence: clicheFound.slice(0, 10).join(", "),
    });
  }

  // --- filler phrases ---
  const fillerFound = FILLER_PHRASES.filter((w) => lower.includes(w));
  if (fillerFound.length >= 3) {
    push({
      id: "slop-filler-phrases",
      severity: "low",
      title: `Wordiness scaffolding (${fillerFound.length} filler phrases)`,
      detail: '"When it comes to", "it is important to note" — throat-clearing that survives every draft (sloptrim #19).',
      fix: "Apply the deletion test: if the sentence means the same without the phrase, delete the phrase.",
      evidence: fillerFound.slice(0, 8).join(", "),
    });
  }

  // --- happy talk ---
  const happy = firstMatch(text, HAPPY_TALK, 2);
  if (happy.length) {
    push({
      id: "slop-happy-talk",
      severity: "medium",
      title: "Happy talk / self-congratulation",
      detail: 'gstack\'s happy-talk rule: if you can hear "blah blah blah", cut it. Welcome mats and mission speeches delay every user task.',
      fix: "Delete the welcome paragraph; keep the first useful sentence.",
      evidence: happy.join("  ·  "),
    });
  }

  // --- conclusion formula ---
  const concls = firstMatch(text, CONCLUSION_FORMULA, 2);
  if (concls.length >= 1 && words > 350) {
    push({
      id: "slop-conclusion-formula",
      severity: "low",
      title: "Compulsive summary conclusion",
      detail: 'sloptrim #38: "In conclusion, Overall, In essence" — the reflex to restate everything the page just said.',
      fix: "End on the strongest fact or the next action. Never on a recap.",
      evidence: concls.join("  ·  "),
    });
  }

  // --- rule of three / em-dash rhythm ---
  const triads = countHits(text, /, and /g) + countHits(text, /, or /g);
  if (words > 200 && per1k(triads) >= 6) {
    push({
      id: "slop-rule-of-three",
      severity: "low",
      title: `Triad-heavy rhythm (${triads} "X, Y, and Z" joins)`,
      detail: "Rule-of-three cadence is sloptrim #7: generated copy arranges everything in threes until every paragraph has the same heartbeat.",
      fix: "Vary list lengths. Two or four items are allowed; so is one.",
    });
  }
  const emdash = countHits(text, /—|–/g);
  if (words > 150 && per1k(emdash) >= 7) {
    push({
      id: "slop-em-dash",
      severity: "low",
      title: `Em-dash per second (${emdash} dashes, ${per1k(emdash).toFixed(1)}/1000 words)`,
      detail: "Gesso's em-dash-copy tell: the AI sentence rhythm leans on dashes where a period or comma would do.",
      fix: "Halve it. Most dashes are commas in costume; some are two sentences.",
    });
  }

  // --- generic CTAs (distinct labels; contextual "learn more" links are style, the tell is a page whose whole CTA vocabulary is template verbs) ---
  const ctaMatches = text.match(/\b(?:get started(?: free| today)?|learn more|sign up(?: free)?|discover more|read more|try (?:it )?(?:for )?free|request a demo|contact us)\b/gi) ?? [];
  const ctaDistinct = [...new Set(ctaMatches.map((c) => c.toLowerCase()))];
  if (ctaDistinct.length >= 3) {
    push({
      id: "slop-generic-cta",
      severity: ctaDistinct.length >= 5 ? "high" : "medium",
      title: `CTA vocabulary is all template verbs (${ctaDistinct.length} distinct)`,
      detail: '"Get Started", "Learn More" as the only calls to action is gstack\'s judgment tell: name the outcome the click buys, not the tutorial-default verb.',
      fix: 'Rewrite CTAs as the outcome: "Start my first scan", "See pricing", "Download the pack".',
      evidence: ctaDistinct.slice(0, 6).join(", "),
    });
  }

  // --- lorem / placeholder / coming soon ---
  if (/lorem ipsum/i.test(text)) {
    push({
      id: "slop-lorem",
      severity: "critical",
      title: "Lorem ipsum visible on the page",
      detail: "Placeholder Latin shipped to production means nobody read the page. It also poisons search and AI indexing.",
      fix: "Write the real copy or remove the section.",
    });
  }
  const placeholderish = countHits(lower, /\b(?:todo|tbd|fixme|xxx|lorem|placeholder text|sample text|under construction|dummy content)\b/g);
  if (placeholderish >= 2) {
    push({
      id: "slop-placeholder-copy",
      severity: placeholderish >= 4 ? "high" : "medium",
      title: `${placeholderish} placeholder/unfinished copy markers`,
      detail: "TODO/TBD/unfinished-draft strings in visible content — the page is a draft wearing production clothes.",
      fix: "Finish or hide. Draft copy indexed by search engines is permanent.",
      evidence: [...new Set(lower.match(/\b(?:todo|tbd|fixme|xxx|lorem|placeholder text|sample text|under construction|dummy content)\b/g) ?? [])].join(", "),
    });
  }

  // --- template stat row ---
  const stats = [...new Set((text.match(STAT_PATTERN) ?? []).map((s) => s.toLowerCase()))];
  if (stats.length >= 3) {
    push({
      id: "slop-stat-row",
      severity: "low",
      title: `Stat-fabric row (${stats.length} big-number claims)`,
      detail: "Three big numbers under the hero is gstack's tell — 'the template counts, not the product'. Unverifiable precision (\u201c10k+ users\u201d, \u201c99.9% uptime\u201d) reads as invented.",
      fix: "Keep stats you can cite and date; link the source. Cut the rest.",
      evidence: stats.slice(0, 6).join(", "),
    });
  }

  // --- stock testimonial row ---
  const stars = countHits(text, /★{3,}|⭐{3,}/g);
  const testimonialish = /testimonial|what (?:our |they say|people say)|loved by|trusted by/i.test(text);
  if (stars >= 2 && testimonialish) {
    push({
      id: "slop-testimonial-row",
      severity: "medium",
      title: "Five-star testimonial costume",
      detail: "gstack's judgment tell: avatars, five stars and quotes nobody said. Nobody is convinced; everybody recognizes the template.",
      fix: "Real names with checkable claims and a link, or no testimonial section.",
    });
  }

  return { words, vocabHits, vocabDistinct };
}

/* ----------------------------- grading ---------------------------------- */

const GRADE_POINTS: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
const POINT_LETTER = (p: number): string => (p >= 3.75 ? "A" : p >= 2.75 ? "B" : p >= 1.75 ? "C" : p >= 0.75 ? "D" : "F");

type Category = "color" | "typography" | "layout" | "visual" | "motion" | "copy" | "imagery";

const CATEGORY_IDS: Record<Category, string[]> = {
  color: ["slop-gradient-text", "slop-purple-gradient", "slop-indigo-accent", "slop-gradient-fill", "slop-cream-wash", "slop-dark-glow", "slop-radial-halo", "slop-gray-contrast"],
  typography: ["slop-overused-font", "slop-emoji-icon", "slop-all-caps-body", "slop-crushed-tracking", "slop-tiny-body", "slop-hollow-text", "slop-monospace-body"],
  layout: ["slop-3col-icon-grid", "slop-icon-tiles", "slop-centered-everything", "slop-eyebrow-chips", "slop-numbered-markers", "slop-uniform-cards", "slop-zindex-soup"],
  visual: ["slop-heavy-shadow", "slop-gradient-border", "slop-edge-stripe", "slop-ghost-card", "slop-over-rounded", "slop-fake-dot-viz"],
  motion: ["slop-bounce-easing", "slop-transition-all", "slop-layout-anim", "slop-hover-scale", "slop-logo-marquee"],
  copy: ["slop-ai-vocab", "slop-theater-phrase", "slop-generic-hero", "slop-not-x-but-y", "slop-promo-language", "slop-cliche-pairs", "slop-filler-phrases", "slop-happy-talk", "slop-conclusion-formula", "slop-rule-of-three", "slop-em-dash", "slop-generic-cta", "slop-lorem", "slop-placeholder-copy", "slop-stat-row", "slop-testimonial-row"],
  imagery: ["slop-missing-alt", "slop-placeholder-image", "slop-broken-image", "slop-missing-lang"],
};

const CATEGORY_WEIGHT: Record<Category, number> = {
  copy: 0.25, color: 0.2, layout: 0.2, typography: 0.15, visual: 0.1, motion: 0.05, imagery: 0.05,
};

const SEV_DROP: Record<string, number> = { critical: 2, high: 1, medium: 0.5, low: 0 };

/** gstack letter-drop method: category starts at A; critical −2, high −1, medium −0.5. */
export function slopGrade(findings: Finding[]): { letter: string; perCategory: { label: string; letter: string; points: number; weight: number }[]; worst: Category | null } {
  const perCategory: { label: string; letter: string; points: number; weight: number }[] = [];
  let weighted = 0;
  let worst: Category | null = null;
  let worstPoints = 5;
  for (const cat of Object.keys(CATEGORY_IDS) as Category[]) {
    let points = 4;
    for (const f of findings) {
      if (!CATEGORY_IDS[cat].includes(f.id)) continue;
      const drop = SEV_DROP[f.severity] ?? 0;
      if (drop) points = Math.max(0, points - drop);
    }
    const letter = POINT_LETTER(points);
    perCategory.push({ label: cat, letter, points, weight: CATEGORY_WEIGHT[cat] });
    weighted += points * CATEGORY_WEIGHT[cat];
    if (points < worstPoints) {
      worstPoints = points;
      worst = cat;
    }
  }
  return { letter: POINT_LETTER(weighted), perCategory, worst };
}

/** The unslop direction block — deterministic read of what to move toward. */
function unslopDirection(findings: Finding[], grade: { letter: string; worst: Category | null }): string {
  const ids = new Set(findings.filter((f) => f.severity !== "pass").map((f) => f.id));
  const moves: string[] = [];
  if (ids.has("slop-purple-gradient") || ids.has("slop-gradient-fill") || ids.has("slop-indigo-accent") || ids.has("slop-gradient-text"))
    moves.push("Color: one owned accent on solid fills; ban the indigo band (235–320°) and gradient fills on text, buttons and cards");
  if (ids.has("slop-overused-font") || ids.has("slop-hollow-text") || ids.has("slop-monospace-body"))
    moves.push("Type: a display face with a point of view for headings + a workhorse body face; ban Inter/Roboto/system-ui as the brand voice");
  if (ids.has("slop-3col-icon-grid") || ids.has("slop-uniform-cards") || ids.has("slop-centered-everything"))
    moves.push("Layout: break the symmetric card grid — uneven spans, left-aligned defaults, composition instead of clones");
  if (ids.has("slop-ghost-card") || ids.has("slop-heavy-shadow") || ids.has("slop-dark-glow"))
    moves.push("Depth: solid surfaces, one shadow token; blur and glow only where they explain something");
  if (ids.has("slop-bounce-easing") || ids.has("slop-hover-scale") || ids.has("slop-transition-all") || ids.has("slop-layout-anim"))
    moves.push("Motion: one authored moment per page; ease-out 150–300ms; animate transform/opacity only");
  if (ids.has("slop-ai-vocab") || ids.has("slop-theater-phrase") || ids.has("slop-generic-hero") || ids.has("slop-not-x-but-y"))
    moves.push("Copy: concrete nouns and numbers replace the generated lexicon; open with the product fact, not the industry weather");
  if (ids.has("slop-eyebrow-chips") || ids.has("slop-numbered-markers") || ids.has("slop-emoji-icon"))
    moves.push("Trim the costume: eyebrow chips, 01/02/03 markers, emoji icons — decoration is not information");
  if (!moves.length) moves.push("Hold the line: the page already reads intentional — keep the audit in review for the next pass");
  return `Slop grade ${grade.letter}${grade.worst ? ` (weakest: ${grade.worst})` : ""}. Direction, in priority order: ${moves.join("; ")}.`;
}

/* ----------------------------- main scan -------------------------------- */

export async function runSlopScan(target: string, progress: (i: number, f: number, note?: string) => void): Promise<UrlScanReport> {
  const started = Date.now();
  const inconclusive: Inconclusive[] = [];
  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);

  // --- stage 1: fetch page + stylesheets ---
  progress(0, 0.1, "fetching page");
  const page = await guardedGet(target, { bodyCap: 2_000_000 });
  if (page.status >= 400) throw new ScanError("fetch-status", `Target responded HTTP ${page.status}.`);
  const html = page.body;
  progress(0, 0.5, "collecting stylesheets");

  // inline CSS
  const styleBlocks = html.match(/<style\b[^>]{0,200}>[\s\S]{0,200000}?<\/style>/gi) ?? [];
  let css = styleBlocks.join("\n");
  const styleAttrRe = /style\s*=\s*"([^"]{2,400})"|style\s*=\s*'([^']{2,400})'/g;
  let sm: RegExpExecArray | null;
  const inlineStyles: string[] = [];
  while ((sm = styleAttrRe.exec(html))) {
    inlineStyles.push(sm[1] ?? sm[2] ?? "");
    if (inlineStyles.length >= 3000) break;
  }
  css += `\n${inlineStyles.join("\n")}`;

  // external stylesheets: same-origin first, then CDN (fonts.google etc.)
  const linkTags = html.match(/<link\b[^>]{0,300}>/gi) ?? [];
  const sheetUrls: string[] = [];
  for (const t of linkTags) {
    const a = attrs(t);
    const rel = (a.rel ?? "").toLowerCase();
    const href = a.href ?? "";
    if (!href || !(rel.includes("stylesheet") || (rel.includes("preload") && a.as === "style"))) continue;
    try {
      const u = new URL(href, page.finalUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") continue;
      sheetUrls.push(u.toString());
    } catch {
      /* ignore malformed hrefs */
    }
  }
  const ordered = [...sheetUrls.filter((u) => u.startsWith(new URL(page.finalUrl).origin)), ...sheetUrls.filter((u) => !u.startsWith(new URL(page.finalUrl).origin))].slice(0, MAX_SHEETS);
  let sheetsFetched = 0;
  const settled = await Promise.allSettled(
    ordered.map((u) => guardedGet(u, { bodyCap: SHEET_CAP, validateDns: u.startsWith("http") }))
  );
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value.status < 400) {
      css += `\n${r.value.body}`;
      sheetsFetched++;
    }
  }
  if (!css.trim().replace(/\s/g, "").length)
    inconclusive.push({ id: "slop-css", what: "stylesheets", why: "no CSS could be collected — design detectors ran on DOM structure only" });
  progress(0, 1, `${sheetsFetched} stylesheet(s), ${(css.length / 1024).toFixed(0)} KB of CSS`);

  // --- stage 2: design detectors ---
  progress(1, 0.2, "running design-tell detectors");
  runDesignDetectors({ css, html, sheets: sheetsFetched, cssBytes: css.length } satisfies CssInput, push);
  progress(1, 1, `${findings.length} design tell(s) so far`);

  // --- stage 3: copy detectors ---
  progress(2, 0.3, "reading the copy");
  const text = visibleText(html).slice(0, 400_000);
  const copyStats = runCopyDetectors(text, push);
  progress(2, 1, `${copyStats.words} words read`);

  // --- stage 4: score, grade, verdict ---
  progress(3, 0.3, "scoring");
  tag(findings, "presence");
  const dedup = dedupeFindings(findings);

  // Dual grade (gstack method): categories start at A and lose letters per
  // finding; the weighted letter points ARE the 0–100 headline score, so the
  // number, the letter grade and the category bars can never disagree.
  const slop = slopGrade(dedup.findings);
  const points = slop.perCategory.reduce((s, c) => s + c.points * c.weight, 0);
  const score = Math.round((points / 4) * 100);
  const grade = gradeFor(score);

  // breakdown bars (0–100 per category, pillar-style) for the UI
  const SEV_PILLAR: Record<string, number> = { critical: 0, high: 15, medium: 45, low: 70, info: 85, pass: 100 };
  const breakdown = (Object.keys(CATEGORY_IDS) as Category[])
    .map((cat) => {
      const own = dedup.findings.filter((f) => CATEGORY_IDS[cat].includes(f.id));
      if (!own.length) return null;
      const pts = own.map((f) => SEV_PILLAR[f.severity] ?? 70);
      return { label: `${cat[0].toUpperCase()}${cat.slice(1)}`, score: Math.round(pts.reduce((a, b) => a + b, 0) / pts.length) };
    })
    .filter((x): x is { label: string; score: number } => x !== null);

  // verdict — assembled from the highest-severity tells
  const highTells = dedup.findings.filter((f) => f.severity === "critical" || f.severity === "high");
  const mediumTells = dedup.findings.filter((f) => f.severity === "medium");
  const topTitles = [...highTells, ...mediumTells].slice(0, 4).map((f) => f.title.replace(/\s*\(.*?\)$/, ""));
  const opener =
    highTells.length >= 3
      ? "Reads as generated"
      : highTells.length >= 1
        ? "Has clear generated tells"
        : mediumTells.length >= 2
          ? "Template-worn in places"
          : score >= 85
            ? "Reads intentional"
            : "Mostly clean";
  const summary = `${opener}: ${topTitles.length ? topTitles.join(" · ") : "no high-impact slop found"}. ${unslopDirection(dedup.findings, slop)}`;

  // keep-list — genuine positives (unslop "what to keep")
  const positives: string[] = [];
  const passTitles = dedup.findings.filter((f) => f.severity === "pass").map((f) => f.title);
  void passTitles;
  const ids = new Set(dedup.findings.filter((f) => f.severity !== "pass").map((f) => f.id));
  if (!ids.has("slop-purple-gradient") && !ids.has("slop-indigo-accent") && !ids.has("slop-gradient-fill")) positives.push("no gradient circus — palette holds to owned fills");
  if (!ids.has("slop-overused-font")) positives.push("type program does not lean on a default face");
  if (!ids.has("slop-3col-icon-grid") && !ids.has("slop-uniform-cards")) positives.push("layout is composed, not a clone grid");
  if (!ids.has("slop-gray-contrast")) positives.push("text contrast holds");
  if (!ids.has("slop-ai-vocab") && !ids.has("slop-theater-phrase") && !ids.has("slop-generic-hero")) positives.push("copy stays concrete — no generated lexicon");
  if (!ids.has("slop-bounce-easing") && !ids.has("slop-hover-scale")) positives.push("motion is quiet");
  if (!positives.length) positives.push("the audit found structure to build on — fix critical/high first, keep what survives");

  const metrics = [
    { label: "AI-slop grade", value: `${slop.letter} — ${slop.perCategory.map((c) => `${c.label} ${c.letter}`).join(" · ")}` },
    { label: "detectors run", value: String(Object.values(CATEGORY_IDS).reduce((s, ids2) => s + ids2.length, 0)) },
    { label: "design tells", value: String(dedup.findings.filter((f) => f.id.startsWith("slop-") && !CATEGORY_IDS.copy.includes(f.id) && f.severity !== "pass").length) },
    { label: "copy tells", value: String(dedup.findings.filter((f) => CATEGORY_IDS.copy.includes(f.id) && f.severity !== "pass").length) },
    { label: "copy volume", value: `${copyStats.words} words` },
    { label: "css analyzed", value: `${(css.length / 1024).toFixed(0)} KB · ${sheetsFetched} sheet(s)` },
  ];

  progress(3, 1, "report ready");

  // --- stage 5: visual evidence (browser screenshots of the top tells) ---
  // Evidence only — shots never touch score/grade/severity. Best effort:
  // every failure mode degrades to a note, the report always ships.
  const report: UrlScanReport = {
    scanner: "slop",
    target,
    finalUrl: page.finalUrl,
    durationMs: Date.now() - started,
    cached: false,
    scannedAt: new Date().toISOString(),
    score,
    grade,
    summary,
    breakdown,
    metrics,
    positives: positives.slice(0, 6),
    findings: dedup.findings,
    inconclusive: inconclusive.length ? inconclusive : undefined,
    verification: verificationBlock(dedup.findings, dedup.deduped, { tokenUsed: false }),
  };

  progress(4, 0.05, "capturing visual evidence");
  try {
    const outcome = await captureSlopShots(page.finalUrl, dedup.findings, (frac, note) => progress(4, Math.max(0.05, Math.min(1, frac)), note));
    if (outcome.shots.length) {
      report.metrics = [...(report.metrics ?? []), { label: "visual evidence", value: `${outcome.shots.length} screenshot${outcome.shots.length === 1 ? "" : "s"}` }];
      report.shots = outcome.shots;
    } else if (outcome.note) {
      report.shotsNote = outcome.note;
    }
  } catch {
    report.shotsNote = "the visual-evidence stage failed unexpectedly — the audit above is complete without it";
  }
  progress(4, 1, "visual evidence ready");

  return report;
}
