/**
 * zScanner — Anti AI-Slop Reviewer: wordlists & phrase rules.
 *
 * Sources distilled into deterministic lists (research ledger, Task 39):
 *  - gstack design-review SKILL.md (garrytan/gstack): the 11 AI-slop blacklist
 *    patterns, marketing-buzzword / aphoristic-cadence / theater-phrase tells,
 *    "would a human designer ship this?" framing, dual Design + AI-Slop grades.
 *  - aiuxplayground.com "Unslop my UI": slop definition (purple gradients,
 *    Inter everywhere, cream premium default, identical card grids, bounce
 *    easing, failing gray contrast) + report shape (inventory / keep /
 *    direction / rewrite plan).
 *  - Gesso-Build/skills @gessobuild/anti-slop (MIT): 73 executable guards —
 *    indigo-accent, gradient-text, cream-default-wash, edge-stripe, ghost-card,
 *    fake-dot-viz, bounce-easing, not-x-but-y-cadence, benefit-speak…
 *  - seyedehsanhadi/sloptrim (Apache-2.0): AI-vocabulary + model-dialect +
 *    promotional-language clusters, filler phrases, compulsive conclusions —
 *    density-scored ("individual words are common in human prose; only a
 *    dense cluster affects the score").
 */

/** sloptrim #1 AI vocabulary — dense clusters only, per-1000-words density. */
export const AI_VOCAB: string[] = [
  "delve", "tapestry", "pivotal", "meticulous", "testament", "underscores",
  "underscore", "intricate", "interplay", "garner", "bolster", "foster",
  "holistic", "paradigm", "transformative", "unprecedented", "myriad",
  "plethora", "seamless", "seamlessly", "embark", "harness", "leverage",
  "leveraging", "utilize", "utilizing", "facilitate", "encompass",
  "navigate the", "in the realm of", "captures the essence", "ever-evolving",
  "game-changer", "game-changing", "supercharge", "revolutionize",
  "revolutionizing", "revolutionary", "unlock the", "unleash", "elevate your",
  "take it to the next level", "next-generation", "next-gen",
  "state-of-the-art", "cutting-edge", "dive deep", "dive deeper",
  "at the forefront", "the future of", "empower", "empowering",
];

/** sloptrim #3 promotional language — travel-brochure register. */
export const PROMO_WORDS: string[] = [
  "breathtaking", "stunning", "picturesque", "charming", "nestled",
  "in the heart of", "must-visit", "unparalleled", "unrivaled", "premier",
  "top-tier", "world-class", "renowned", "esteemed", "beacon of",
  "rich heritage", "boasts", "vibrant community", "hidden gem",
];

/** sloptrim #4 cliché hyphenated marketing pairs (technical compounds excluded). */
export const CLICHE_PAIRS: string[] = [
  "mission-critical", "battle-tested", "out-of-the-box", "enterprise-grade",
  "best-of-breed", "plug-and-play", "industry-leading", "purpose-built",
  "bleeding-edge", "turn-key", "value-added", "laser-focused",
  "tried-and-true", "best-in-class", "future-proof", "customer-centric",
  "results-driven", "lightning-fast", "blazing-fast", "rocket-fast",
  "hassle-free", "feature-rich", "cost-effective", "user-friendly",
];

/** gstack theater-phrase / generic-hero copy — the generated-landing-page tells. */
export const THEATER_PHRASES: RegExp[] = [
  /in today'?s (?:fast-paced|digital|modern|hyper-?connected)/gi,
  /in the ever-?(?:evolving|changing|expanding)/gi,
  /fast-?paced (?:digital|world|landscape|environment)/gi,
  /look(?:ing)? no further/gi,
  /at the (?:heart|forefront|center) of/gi,
  /welcome to the future/gi,
  /the (?:world|future|power) of [a-z]{2,20} (?:is here|at your fingertips|in your hands)/gi,
  /whether you'?re a[n]? [^.!?]{3,60}, (?:we|our)/gi,
  /in a world where/gi,
  /the digital landscape/gi,
];

export const GENERIC_HERO: RegExp[] = [
  /your (?:all-in-one|ultimate|complete) (?:solution|platform|destination|toolkit|suite)/gi,
  /unlock the (?:power|full potential|potential) of/gi,
  /the (?:ultimate|premier|leading) (?:platform|solution|destination) for/gi,
  /one-?stop (?:shop|solution|destination)/gi,
  /welcome to [A-Z][A-Za-z0-9 ]{2,40}[.!]/g,
  /supercharge your/gi,
  /take your [a-z ]{3,30} to the next level/gi,
  /where (?:innovation|creativity|possibilit) meets/gi,
  /seamlessly (?:integrate|connect|manage|bring)/gi,
  /designed (?:to help you|for) (?:succeed|thrive|grow|scale)/gi,
];

/** sloptrim #18 / Gesso not-x-but-y-cadence — the signature AI rhetorical turn. */
export const NOT_X_BUT_Y: RegExp[] = [
  /(?:it'?s|this is|that'?s|these are|they'?re)?\s*not (?:just|only|merely|simply) (?:a|an|the|about) [^.!?]{2,120}[.!?]?\s*(?:it'?s|but|—|--)[^.!?]{2,120}/gi,
  /isn'?t (?:just|only|merely|simply) (?:a|an|the|about)[^.!?]{2,120}/gi,
  /not (?:just|only) [a-z]{2,30},? (?:but|it'?s) /gi,
  /it'?s not about [^.!?]{2,80}[.;] it'?s about/gi,
  /more than (?:just )?(?:a|an) [a-z]{2,30}[^.!?]{0,80}(?:—|--|it'?s)/gi,
];

/** sloptrim #38 compulsive conclusions. */
export const CONCLUSION_FORMULA: RegExp[] = [
  /in conclusion/gi, /in summary/gi, /to summarize/gi, /to conclude/gi,
  /all in all/gi, /in essence/gi, /ultimately,/gi, /overall,/gi,
];

/** sloptrim #19 filler phrases — wordiness that survives every edit. */
export const FILLER_PHRASES: string[] = [
  "in terms of", "when it comes to", "with regard to", "a large number of",
  "in close proximity to", "prior to the start", "during the course of",
  "on a regular basis", "in spite of the fact that", "for all intents and purposes",
  "the fact of the matter is", "in a manner of speaking", "it is important to note",
  "it should be noted that", "as many of you already know", "at the end of the day",
];

/** gstack happy-talk openers. */
export const HAPPY_TALK: RegExp[] = [
  /^welcome to /gim,
  /we are (?:thrilled|excited|proud) to (?:announce|present|introduce)/gi,
  /we'?re on a mission to/gi,
  /our (?:journey|story) began/gi,
  /thank you for visiting/gi,
];

/** Fonts that read as "I gave up on typography" when they carry the brand voice (unslop + gstack overused list). */
export const OVERUSED_FONTS: string[] = [
  "inter", "roboto", "arial", "helvetica", "system-ui", "-apple-system",
  "segoe ui", "open sans", "lato", "montserrat", "poppins", "roboto mono",
  "source sans pro", "noto sans", "dejavu sans", "liberation sans", "sans-serif",
];

/** Fonts that read as intentional when they lead a stack (for the keep-list). */
export const DISTINCTIVE_FONTS: string[] = [
  "geist", "satoshi", "general sans", "cabinet grotesk", "switzer", "clash display",
  "canela", "söhne", "sohne", "playfair", "fraunces", "instrument serif",
  "space grotesk", "ibm plex", "jetbrains mono", "ibm plex sans", "newsreader",
  "instrument sans", "bricolage grotesque", "schibsted grotesk", "outfit",
  "urbanist", "plus jakarta sans", "signifier", "untitled sans", "neue haas",
  "suisse intl", "apercu", "circular", "futura", "garamond", "baskerville",
  "caslon", "bodoni", "dm serif", "gambetta", "supreme",
];

/** Emoji commonly standing in for an icon system (gstack: emoji as design elements). */
export const SLOP_EMOJI: RegExp =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F900}-\u{1F9FF}]/gu;

/** Gesso fabricated-precision + template stat rows. */
export const STAT_PATTERN: RegExp = /\b\d+(?:[.,]\d+)?\s*(?:k\+?\s*(?:users|customers|clients|developers|teams)|%\s*(?:uptime|faster|more|less|growth|conversion)|x\s*(?:faster|more|better|cheaper)|ms\s*faster)\b/gi;
