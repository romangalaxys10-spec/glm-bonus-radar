/**
 * zScanner — Anti AI-Slop Reviewer: design-tell detectors (CSS + DOM).
 *
 * Deterministic, dependency-free, linear-time — same deploy-reliability
 * policy as the rest of zScanner. Inputs are capped upstream (HTML ≤ 2 MB,
 * each stylesheet ≤ 300 KB). Thresholds come from the research corpus:
 * Gesso's exact guards (indigo-accent hue windows, cream-default wash,
 * edge-stripe 3–6 px, ghost-card backdrop count), gstack's 11 blacklist
 * patterns (3-col icon grid, gradient everything, icon-in-circle rows,
 * centered-everything, emoji icons, colored left borders, cookie-cutter
 * rhythm) and the unslop-my-ui definition.
 */

import { type Finding } from "./types";
import { OVERUSED_FONTS, DISTINCTIVE_FONTS, SLOP_EMOJI } from "./slop-wordlists";

export type CssInput = {
  /** Every collected CSS text: <style> blocks + style="" attrs + fetched sheets. */
  css: string;
  /** Raw HTML (for DOM-structure detectors). */
  html: string;
  /** Sheet count actually fetched (for the metrics strip). */
  sheets: number;
  /** Byte total of collected CSS. */
  cssBytes: number;
};

/* ------------------------- tiny color machinery ------------------------- */

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Parse any CSS color we care about to [h(0-360), s(0-100), l(0-100)]; null when unparseable/transparent. */
export function colorToHsl(raw: string): [number, number, number] | null {
  const c = raw.trim().toLowerCase();
  if (!c || c === "transparent" || c === "currentcolor" || c === "inherit") return null;
  const hex = /^#([0-9a-f]{3,8})$/.exec(c);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((x) => x + x).join("") + (h.length === 4 ? h[3] + h[3] : "");
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    return rgbToHsl(r, g, b);
  }
  const rgb = /rgba?\(\s*([0-9.]+%?)[\s,]+([0-9.]+%?)[\s,]+([0-9.]+%?)/.exec(c);
  if (rgb) {
    const p = (x: string) => (x.endsWith("%") ? parseFloat(x) / 100 : parseFloat(x) / 255);
    return rgbToHsl(p(rgb[1]), p(rgb[2]), p(rgb[3]));
  }
  const hsl = /hsla?\(\s*([0-9.]+)(?:deg)?[\s,]+([0-9.]+)%?[\s,]+([0-9.]+)%?/.exec(c);
  if (hsl) return [parseFloat(hsl[1]) % 360, parseFloat(hsl[2]), parseFloat(hsl[3])];
  const named: Record<string, [number, number, number]> = {
    white: [0, 0, 100], black: [0, 0, 0], red: [0, 100, 50], blue: [220, 100, 50],
    purple: [280, 100, 50], violet: [270, 100, 50], indigo: [250, 100, 50],
    green: [120, 100, 50], orange: [30, 100, 50], pink: [330, 100, 71], gray: [0, 0, 50], grey: [0, 0, 50],
  };
  return named[c] ?? null;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s * 100, l * 100];
}

function isGrayish(hsl: [number, number, number]): boolean {
  return hsl[1] < 18;
}

/** Extract color-ish tokens from a string (hex, rgb(), hsl(), common names). */
function colorTokens(s: string): string[] {
  return (
    s.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]{3,40}\)|hsla?\([^)]{3,40}\)|\b(?:white|black|red|blue|purple|violet|indigo|orange|pink|green|gray|grey)\b/g) ?? []
  );
}

/* --------------------------- CSS helpers -------------------------------- */

/** Declarations of `prop: value` across the CSS (linear scan, bounded value). */
function eachDecl(css: string, prop: RegExp, cb: (value: string) => void): void {
  const re = new RegExp(`(?:^|[{;\\s])(${prop.source})\\s*:\\s*([^;}{]{1,220})`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) cb(m[2]);
}

function countMatches(s: string, re: RegExp): number {
  let n = 0;
  let m: RegExpExecArray | null;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = g.exec(s))) {
    n++;
    if (m[0].length === 0) g.lastIndex++; // safety against zero-length matches
    if (n > 5000) break;
  }
  return n;
}

/* ------------------------ gradient classification ------------------------ */

type GradientInfo = { raw: string; hueRange: [number, number] | null; saturatedStops: number; stops: number };

function analyzeGradients(css: string): GradientInfo[] {
  const out: GradientInfo[] = [];
  const re = /(linear|radial|conic)-gradient\(([^;()]{3,240}?)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const stops = colorTokens(m[2])
      .map(colorToHsl)
      .filter((x): x is [number, number, number] => x !== null && !isGrayish(x) && x[1] > 20 && x[2] > 12 && x[2] < 92);
    const hues = stops.map((s) => s[0]).sort((a, b) => a - b);
    out.push({
      raw: m[0].slice(0, 160),
      hueRange: hues.length >= 2 ? [Math.round(hues[0]), Math.round(hues[hues.length - 1])] : hues.length === 1 ? [Math.round(hues[0]), Math.round(hues[0])] : null,
      saturatedStops: stops.length,
      stops: stops.length,
    });
  }
  return out;
}

/** Hue window covering indigo → violet → purple → fuchsia (the "AI product" band). */
function inAiHueBand(h: number): boolean {
  return h >= 235 && h <= 320;
}

/* ============================ detectors ================================= */

export function runDesignDetectors(input: CssInput, push: (f: Finding) => void): void {
  const { css, html } = input;

  /* ---- COLOR ---- */

  const gradients = analyzeGradients(css);

  // 1. gradient-text (Gesso severity-1 FIX; gstack blacklist) — background-clip:text
  const clipText = countMatches(css, /-?webkit-?background-clip\s*:\s*text|(?<![-a-z])background-clip\s*:\s*text/gi);
  if (clipText > 0) {
    const withBg = /background(?:-image)?\s*:[^;}{]{0,80}gradient[^;}{]{0,120}[;}]?\s*[-a-z]{0,20}background-clip\s*:\s*text|background-clip\s*:\s*text[^{]{0,60}background(?:-image)?\s*:[^;}{]{0,80}gradient/i.test(css) || /(?:background(?:-image)?[^;}{]{0,100}gradient[^;}{]{0,100}background-clip\s*:\s*text)/i.test(css);
    push({
      id: "slop-gradient-text",
      severity: withBg ? "high" : "medium",
      title: `Gradient-clipped headline text (${clipText} declaration${clipText > 1 ? "s" : ""})`,
      detail: "background-clip:text turns headings into gradient fills — the single most recognizable generated-UI tell. It reads as decoration standing in for a typographic idea.",
      fix: "Set the headline in one owned color. If you want emphasis, use weight, size or a real display face — not a purple fade.",
      evidence: (/-?webkit-?background-clip\s*:\s*text|background-clip\s*:\s*text/gi.exec(css) ?? ["background-clip: text"])[0],
    });
  }

  // 2. purple/violet AI-gradient washes (gstack #1; unslop; Gesso purple-violet-wash)
  const aiGradients = gradients.filter((g) => g.hueRange && g.saturatedStops >= 2 && g.hueRange.some(inAiHueBand));
  if (aiGradients.length > 0) {
    const spread = aiGradients.some((g) => g.hueRange && g.hueRange[1] - g.hueRange[0] > 25);
    push({
      id: "slop-purple-gradient",
      severity: spread ? "critical" : "high",
      title: `Purple/indigo gradient${aiGradients.length > 1 ? `s (${aiGradients.length})` : ""} — the "AI product" palette`,
      detail: "Blue-to-purple gradient fills are the default aesthetic of generated landing pages. A studio designer almost never ships an unchosen indigo wash; it signals template, not brand.",
      fix: "Pick one solid accent the palette owns. If a gradient is brand-mandated, keep it monochrome and quiet — no hue travel across the indigo band.",
      evidence: aiGradients.slice(0, 3).map((g) => g.raw).join("  ·  "),
    });
  }

  // 3. indigo accent (Gesso indigo-accent) — the Tailwind-violet default on controls
  const indigoHits = countMatches(css, /#(?:6366f1|8b5cf6|7c3aed|4f46e5|818cf8|6d28d9|a855f7|9333ea|7e22ce|6b21a8|4c1d95|5b21b6|3730a3|4338ca|a78bfa|c4b5fd|ddd6fe|ede9fe)\b|rgb(?:a)?\(\s*(?:99|139|124|79|129|109|168|147|126|107|76|91|55|67|167|196|221|237)\s*,/gi) + countMatches(html, /(?:bg|text|border|from|to|via|ring)-(?:indigo|violet|purple|fuchsia)-(?:400|500|600|700)\b/g);
  if (indigoHits >= 3) {
    push({
      id: "slop-indigo-accent",
      severity: "high",
      title: `Indigo/violet default accent (${indigoHits} uses)`,
      detail: "The Tailwind indigo/violet 400–700 band is the unchosen default of AI-generated UI. Gesso flags it as a severity-1 tell: nobody picked it; it came with the generator.",
      fix: "Re-accent: choose a hue outside 235–320° that fits the product's world (a warm signal, a deep green, a brand ink). Keep it to one.",
      evidence: `~${indigoHits} indigo/violet tokens across CSS + utility classes`,
    });
  }

  // 4. gradient fills on surfaces/buttons (Gesso gradient-fill / multicolor-fill)
  const surfaceGradients = gradients.filter((g) => g.saturatedStops >= 2).length;
  if (surfaceGradients >= 5) {
    push({
      id: "slop-gradient-fill",
      severity: surfaceGradients >= 12 ? "high" : "medium",
      title: `${surfaceGradients} gradient-filled surfaces`,
      detail: "Gradient fills on buttons, cards and sections are decoration doing a hierarchy's job. Dense gradient use is a generated-template fingerprint.",
      fix: "Flatten: solid fills, one accent; reserve any gradient for one signature moment — or none.",
      evidence: gradients.filter((g) => g.saturatedStops >= 2).slice(0, 3).map((g) => g.raw).join("  ·  "),
    });
  }

  // 5. cream/sand premium default (unslop; Gesso cream-default-wash)
  const bodyBg = (/body\s*\{[^}]{0,300}/i.exec(css) ?? [""])[0];
  const bgDecl = (/background(?:-color)?\s*:\s*([^;}{]{1,60})/i.exec(bodyBg) ?? [])[1];
  if (bgDecl) {
    const hsl = colorToHsl(bgDecl);
    if (hsl && hsl[2] > 82 && hsl[2] < 98 && hsl[1] > 14 && hsl[1] < 70 && hsl[0] > 15 && hsl[0] < 65) {
      push({
        id: "slop-cream-wash",
        severity: "low",
        title: "Cream/sand body background as the premium default",
        detail: "Warm parchment body wash is currently the generator's idea of 'premium editorial'. Fine when the brand owns it; a tell when it arrived with the template.",
        fix: "If the brand is not literally warm-paper, go honest white or a true off-white (≤3% saturation).",
        evidence: `body background: ${bgDecl.trim().slice(0, 60)}`,
      });
    }
  }

  // 6. dark-mode glow / radial halo (Gesso dark-glow, radial-halo; gstack polish)
  const darkBody = (() => {
    const hsl = colorToHsl(bgDecl ?? "");
    return hsl ? hsl[2] < 20 : /color-scheme\s*:\s*dark|prefers-color-scheme\s*:\s*dark/.test(css);
  })();
  const glowShadows: string[] = [];
  eachDecl(css, /box-?shadow/, (v) => {
    if (v.length > 20 && /rgba?\([^)]{3,30}\)|#[0-9a-f]{3,8}/i.test(v)) {
      const colors = colorTokens(v).map(colorToHsl).filter((x): x is [number, number, number] => x !== null && x[1] > 35 && x[2] > 25 && x[2] < 85);
      if (colors.length && /(?:[3-9]\d|[1-9]\d{2,})px/.test(v)) glowShadows.push(v.trim().slice(0, 120));
    }
  });
  if (glowShadows.length >= 2 && darkBody) {
    push({
      id: "slop-dark-glow",
      severity: "medium",
      title: `Neon glow shadows on a dark surface (${glowShadows.length})`,
      detail: "Saturated outer glows on near-black are the dark-theme equivalent of the purple gradient — the generated 'hacker premium' look.",
      fix: "Elevate with lightness steps, not colored light. One restrained glow only if it explains a light source.",
      evidence: glowShadows[0],
    });
  }
  const radialHalos = gradients.filter((g) => /radial/i.test(g.raw) && g.saturatedStops >= 1 && /(?:circle|at)\s+(?:center|50%)/i.test(g.raw)).length;
  if (radialHalos >= 3) {
    push({
      id: "slop-radial-halo",
      severity: "low",
      title: `Radial spotlight halos behind content (${radialHalos})`,
      detail: "Radial-gradient spotlights floating behind heroes/cards are the generated way to fake depth in an empty section.",
      fix: "Depth comes from content and hierarchy. Cut the halos.",
      evidence: gradients.filter((g) => /radial/i.test(g.raw)).slice(0, 2).map((g) => g.raw).join("  ·  "),
    });
  }

  /* ---- TYPOGRAPHY ---- */

  // 7. overused primary font (unslop personality-typeface; gstack overused-font)
  const fontStacks: string[] = [];
  eachDecl(css, /font-?family/, (v) => {
    if (fontStacks.length < 400) fontStacks.push(v.toLowerCase());
  });
  const firstFamilies = fontStacks.map((s) => (/["']?([^"',]+)["']?/.exec(s.trim())?.[1] ?? s.trim()).trim());
  const freq = new Map<string, number>();
  for (const f of firstFamilies) freq.set(f, (freq.get(f) ?? 0) + 1);
  const primary = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const primaryOverused = OVERUSED_FONTS.includes(primary);
  const h1Family = (/h1\s*\{[^}]{0,400}?font-?family\s*:\s*([^;}]{1,80})/i.exec(css) ?? [])[1]?.toLowerCase() ?? "";
  const h1First = (/["']?([^"',]+)["']?/.exec(h1Family.trim())?.[1] ?? h1Family.trim()).trim();
  const anyDistinctive = DISTINCTIVE_FONTS.some((d) => css.toLowerCase().includes(d));
  if (h1First && OVERUSED_FONTS.includes(h1First) && h1First !== "sans-serif") {
    push({
      id: "slop-overused-font",
      severity: "high",
      title: `Headlines set in ${h1First} — the given-up-on-typography signal`,
      detail: "The brand voice is carried by an overused system/default face. gstack flags Inter/Roboto/Arial-class stacks as the typographic tell of generated UI; the unslop brief bans them as personality typefaces.",
      fix: "Pick one display face with a point of view for headings (a grotesque, a serif, a mono — anything but the default) and keep a workhorse for body.",
      evidence: `h1 { font-family: ${h1Family.trim().slice(0, 60)} }`,
    });
  } else if (primaryOverused && !anyDistinctive && fontStacks.length >= 3) {
    push({
      id: "slop-overused-font",
      severity: "medium",
      title: `Type program led by ${primary} (no distinctive face anywhere)`,
      detail: "The most common family across stylesheets is an overused default and no intentional face appears. Generated UI defaults here because the model plays it safe.",
      fix: "Choose a pairing: one display + one body. Ban the removed defaults in the follow-up pass.",
      evidence: `most frequent stack: ${primary} (${freq.get(primary)} declarations)`,
    });
  }

  // 8. emoji as icons (gstack #8)
  const headingText = (html.match(/<h[1-4]\b[^>]{0,300}>[\s\S]{0,300}?<\/h[1-4]>/gi) ?? []).join(" ");
  const emojiHeadings = (headingText.match(SLOP_EMOJI) ?? []).length;
  const emojiAll = (html.replace(/<script[\s\S]{0,200000}?<\/script>/gi, " ").match(SLOP_EMOJI) ?? []).length;
  if (emojiHeadings >= 2) {
    push({
      id: "slop-emoji-icon",
      severity: "medium",
      title: `Emoji standing in for icons in headings (${emojiHeadings})`,
      detail: "Rockets, sparkles and lightning bolts as heading decoration are a blacklist tell: they fake personality without an icon system.",
      fix: "Ship a real icon set (consistent stroke, one weight) or no icons at all. Emoji in headings read as filler.",
      evidence: headingText.match(SLOP_EMOJI)?.slice(0, 8).join(" ") ?? "",
    });
  } else if (emojiAll >= 8 && emojiAll > (html.length / 1000) * 6) {
    push({
      id: "slop-emoji-icon",
      severity: "low",
      title: `Emoji-dense page (${emojiAll} visible)`,
      detail: "Emoji scattered through body copy and lists read as generated decoration; density is the tell, not any single glyph.",
      fix: "Cut to zero outside genuinely conversational copy.",
      evidence: `~${emojiAll} emoji across the page`,
    });
  }

  // 9. all-caps body / hollow text / tracking extremes / tiny body (Gesso type guards)
  if (countMatches(css, /text-?transform\s*:\s*uppercase/gi) >= 6 && countMatches(css, /(?:^|[{;\s])font-?size\s*:\s*(?:1[0-3]|0?\.[0-9]{1,2})px|font-?size\s*:\s*(?:0\.[6-9]|1[0-2])rem/gi) >= 4) {
    push({
      id: "slop-all-caps-body",
      severity: "low",
      title: "Heavy uppercase styling",
      detail: "ALL-CAPS as a frequent style is the broadsheet-decorations move the unslop brief flags: it decorates rather than typesets.",
      fix: "Uppercase only true labels (kickers, table heads); never body copy.",
    });
  }
  const trackingNeg = countMatches(css, /letter-?spacing\s*:\s*-(?:0\.[0-5][0-9]*|[1-9][0-9.]*)em/gi) + countMatches(html, /tracking-(?:tighter|tight)\b/g);
  if (trackingNeg >= 6) {
    push({
      id: "slop-crushed-tracking",
      severity: "low",
      title: `Crushed letter-spacing on display type (${trackingNeg})`,
      detail: "Extreme negative tracking on lowercase text is polish-tier generated typography — tight everywhere instead of set well.",
      fix: "-1% to -2% on large headings maximum; body stays at 0.",
    });
  }
  const tinyBody = countMatches(css, /font-?size\s*:\s*(?:0?\.[0-7][0-9]*rem|1[0-3]px)/gi);
  if (tinyBody >= 3) {
    push({
      id: "slop-tiny-body",
      severity: "medium",
      title: `Body-size text below ~14px (${tinyBody} declarations)`,
      detail: "Sub-14px body text fails readability and is a generated-UI habit when cramming template sections. Also an accessibility failure.",
      fix: "Body ≥ 16px; captions ≥ 12px — nothing between.",
      evidence: `${tinyBody} small font-size declarations`,
    });
  }
  if (countMatches(css, /-?webkit-?text-?stroke\s*:/gi) >= 1) {
    push({
      id: "slop-hollow-text",
      severity: "low",
      title: "Outline (hollow) display text",
      detail: "text-stroke headlines are a current generated-UI fashion; decoration replacing a typographic decision.",
      fix: "Fill the headline with ink; drop the stroke.",
    });
  }
  const monoBody = /body\s*\{[^}]{0,300}font-?family\s*:[^;}]{0,40}(?:mono|consolas|courier)/i.test(css);
  if (monoBody) {
    push({
      id: "slop-monospace-body",
      severity: "low",
      title: "Monospace as the body voice",
      detail: "Monospace body copy is 'terminal costume' — a personality borrowed from dev-tools that most products have not earned.",
      fix: "Mono for code and data; a real text face for reading.",
    });
  }

  /* ---- VISUAL ---- */

  // 10. heavy stacked shadows (Gesso heavy-box-shadow severity-2)
  const stackedShadows: string[] = [];
  eachDecl(css, /box-?shadow/, (v) => {
    if ((v.match(/rgba?\(|#[0-9a-f]{3,8}/gi) ?? []).length >= 2 || (v.match(/,\s*(?:0\s*)?(?:[0-9]{2,})px/g) ?? []).length >= 2) stackedShadows.push(v.trim().slice(0, 110));
  });
  if (stackedShadows.length >= 3) {
    push({
      id: "slop-heavy-shadow",
      severity: "medium",
      title: `Stacked multi-layer drop shadows (${stackedShadows.length})`,
      detail: "Puffy multi-shadow stacks on cards are the generated 'depth theater' tell — shadow doing a job elevation steps should do.",
      fix: "One shadow token, two elevation steps maximum, shadows near-transparent.",
      evidence: stackedShadows[0],
    });
  }

  // 11. gradient borders (Gesso gradient-border)
  if (/border-image\s*:[^;}{]{0,120}gradient|-?webkit-?background-?clip\s*:\s*(?:border-?box|padding-?box)[^}]{0,120}border(?:-color)?\s*:\s*transparent/i.test(css)) {
    push({
      id: "slop-gradient-border",
      severity: "medium",
      title: "Gradient borders on cards/containers",
      detail: "1px gradient rims are the generated sibling of gradient fills — decoration, not structure.",
      fix: "Solid hairline in the palette's border role; let spacing define hierarchy.",
    });
  }

  // 12. edge stripe on cards (gstack #9; Gesso edge-stripe)
  const edgeStripes = countMatches(css, /border-?left\s*:\s*(?:[3-6]|[0-5]\.?\d*)px\s+(?:solid\s+)?(?!none)(?:rgb|#|hsl|var\(--)/gi);
  if (edgeStripes >= 3) {
    push({
      id: "slop-edge-stripe",
      severity: "medium",
      title: `Colored left-border stripes on ${edgeStripes} card styles`,
      detail: "The 3px accent stripe on rounded cards is a blacklist pattern — the SaaS-starter card costume.",
      fix: "Kill the stripe; differentiate cards by content and spacing, not colored edges.",
    });
  }

  // 13. frosted-glass default (Gesso ghost-card; unslop decorative blur)
  const backdropBlur = countMatches(css, /backdrop-?filter\s*:\s*blur/gi) + countMatches(html, /backdrop-blur/g);
  if (backdropBlur >= 4) {
    push({
      id: "slop-ghost-card",
      severity: "medium",
      title: `Frosted-glass panels everywhere (${backdropBlur} blur surfaces)`,
      detail: "Translucent blur panels as the default surface is the unslop brief's 'decorative blur' and Gesso's ghost-card: depth that explains nothing.",
      fix: "One translucent layer where depth is real (a sticky header, a modal). Surfaces otherwise solid.",
      evidence: `${backdropBlur} backdrop-filter blur declarations`,
    });
  }

  // 14. uniform bubbly radius (gstack #5; Gesso over-rounded-card)
  const radii: number[] = [];
  eachDecl(css, /border-?radius/, (v) => {
    const px = /(\d+(?:\.\d+)?)px/.exec(v);
    if (px) radii.push(parseFloat(px[1]));
  });
  if (radii.length >= 8) {
    const big = radii.filter((r) => r >= 20).length;
    if (big / radii.length > 0.7) {
      push({
        id: "slop-over-rounded",
        severity: "low",
        title: "Uniform large radius on nearly everything",
        detail: "The same bubbly 20px+ radius on buttons, cards, inputs and images flattens the radius hierarchy — a blacklist tell.",
        fix: "Define a radius scale: small for controls, medium for cards, large for sheets. Inner = outer − gap.",
        evidence: `${big}/${radii.length} radius declarations ≥ 20px`,
      });
    }
  }

  // 15. fake dot-viz / repeated identical empty elements (Gesso fake-dot-viz)
  const dotRuns = html.match(/(?:<(?:div|span|li)\b[^>]{0,160}>\s*<\/(?:div|span|li)>\s*){8,}/g) ?? [];
  if (dotRuns.length > 0) {
    push({
      id: "slop-fake-dot-viz",
      severity: "medium",
      title: "Rows of repeated identical empty elements",
      detail: "Runs of 8+ identical empty divs/spans are the generated filler decoration (fake dot charts, spacer rows, skeleton cosplay in production).",
      fix: "Real data, real chart, or an honest empty state — not decorative dot rows.",
      evidence: `pattern like ${(dotRuns[0] ?? "").slice(0, 80)}…`,
    });
  }

  /* ---- LAYOUT ---- */

  // 16. the 3-column icon-card grid (gstack #2 — THE most recognizable AI layout)
  const grid3 = countMatches(css, /grid-?template-?columns\s*:\s*repeat\(\s*3\s*,/gi) + countMatches(html, /(?:sm|md|lg):grid-cols-3\b/g);
  const iconTiles = countMatches(html, /(?:class="[^"]{0,200}(?:rounded-full|rounded-\[9999px\]|circle)[^"]{0,200}"[^>]{0,120}>\s*<svg[\s\S]{0,200}?<\/svg>)|<svg[\s\S]{0,200}?<\/svg>\s*<\/(?:div|span)>/gi) + countMatches(css, /(?:^|[{;\s])border-?radius\s*:\s*50%/gi);
  if (grid3 >= 1 && iconTiles >= 3) {
    push({
      id: "slop-3col-icon-grid",
      severity: "high",
      title: "Icon-tile + title + blurb 3-column grid — the generated layout",
      detail: "gstack's #1 tell: icon-in-colored-circle, bold title, two-line description, repeated three times symmetrically. It is the first template every generator reaches for.",
      fix: "Break the symmetry: uneven column spans, real content density, no icon tile per heading. If the content is genuinely three equal things, question the content first.",
      evidence: `3-col grids: ${grid3}, icon-circle tiles: ${iconTiles}`,
    });
  } else if (grid3 >= 2) {
    push({
      id: "slop-3col-icon-grid",
      severity: "medium",
      title: `${grid3} three-column feature grids`,
      detail: "Repeated symmetric 3-col feature sections give the page the cookie-cutter rhythm of generated marketing sites.",
      fix: "Vary the section composition; not everything is a 3-up.",
      evidence: `grid columns: repeat(3) × ${grid3}`,
    });
  }

  // 17. icon-tile above every heading (Gesso icon-topped-feature-card / gstack #3)
  if (iconTiles >= 5 && grid3 === 0) {
    push({
      id: "slop-icon-tiles",
      severity: "medium",
      title: `Icon-in-circle tiles above headings (${iconTiles})`,
      detail: "The SaaS-starter look: a colored circle + glyph perched over every heading. Decoration doing an information-architecture job.",
      fix: "Remove tile chrome; icons inline with text or none.",
      evidence: `~${iconTiles} circular icon tiles`,
    });
  }

  // 18. centered everything (gstack #4)
  const centered = countMatches(css, /text-?align\s*:\s*center/gi) + countMatches(html, /text-center/g);
  if (centered >= 12) {
    push({
      id: "slop-centered-everything",
      severity: centered >= 28 ? "high" : "medium",
      title: `Center-aligned everything (${centered} rules/classes)`,
      detail: "text-align:center applied page-wide is a blacklist pattern — it reads as a generator avoiding layout decisions.",
      fix: "Left-align by default; center only the one moment that earns it (a hero statement, a CTA).",
      evidence: `${centered} centering declarations`,
    });
  }

  // 19. kicker/eyebrow chips (Gesso hero-kicker-eyebrow, gstack detector)
  const eyebrows = countMatches(html, /class="[^"]{0,160}(?:eyebrow|kicker|overline)[^"]{0,160}"/gi) + countMatches(html, /(?:text-(?:2xs|xs)|text-\[10px\]|text-\[11px\])[^"]{0,80}uppercase[^"]{0,80}(?:tracking-(?:widest|\[0\.[2-9]))/g);
  if (eyebrows >= 3) {
    push({
      id: "slop-eyebrow-chips",
      severity: "low",
      title: `Uppercase eyebrow chips above headings (${eyebrows})`,
      detail: "The tiny-caps kicker over every heading is a generated section-costume; on heroes it is the hero-eyebrow-chip detector hit.",
      fix: "Cut most eyebrows; where a label carries real information, style it as part of the type scale, not a badge.",
      evidence: `${eyebrows} eyebrow/kicker patterns`,
    });
  }

  // 20. numbered section markers 01/02/03 (gstack; unslop identical-card markers)
  const numbered = countMatches(html, />\s*0?[1-9]\s*<[\s\S]{0,120}?(?:<\/h[1-3]>|font-?weight)/gi) + countMatches(html, /\b0[1-9]\b\s*[-–—.]?\s*<\/(?:span|div|p)>/gi);
  if (numbered >= 3) {
    push({
      id: "slop-numbered-markers",
      severity: "low",
      title: "01 / 02 / 03 section markers with no real sequence",
      detail: "Decorative number prefixes imply an order the content does not have — the unslop brief's 'identical cards, 01/02/03 markers with no real sequence'.",
      fix: "Number only actual steps. Otherwise the numbers are noise — delete.",
      evidence: `${numbered} numbered marker patterns`,
    });
  }

  // 21. identical repeated cards (unslop identical card grids)
  const classRuns = html.match(/class="([^"]{10,240})"[^>]{0,80}>/g) ?? [];
  const classFreq = new Map<string, number>();
  for (const run of classRuns) {
    const cls = /class="([^"]{10,240})"/.exec(run)?.[1] ?? "";
    // component-shaped only: has card/item/tile vocabulary AND visual container hints
    // (a bare repeated utility string like "flex items-center" is normal, not a clone grid)
    if (/(?:card|item|tile|feature|panel|offer|plan|post|product)/i.test(cls) && /(?:rounded|border|shadow|bg-|surface)/i.test(cls)) classFreq.set(cls, (classFreq.get(cls) ?? 0) + 1);
  }
  const biggestRun = [...classFreq.entries()].sort((a, b) => b[1] - a[1])[0];
  if (biggestRun && biggestRun[1] >= 6) {
    push({
      id: "slop-uniform-cards",
      severity: biggestRun[1] >= 10 ? "high" : "medium",
      title: `${biggestRun[1]} identical card shells (same class string)`,
      detail: "One class string repeated 6+ times with the same internal structure gives the page 'content of unequal weight in equal boxes' — the generated grid.",
      fix: "Same-shape rows are fine for true peers (tables, lists); feature content needs composition, not clones.",
      evidence: `class="${biggestRun[0].slice(0, 110)}" × ${biggestRun[1]}`,
    });
  }

  // 22. z-index soup (unslop)
  const zMax = Math.max(0, ...[...css.matchAll(/z-?index\s*:\s*(\d{1,6})/gi)].map((m) => parseInt(m[1], 10)).filter((n) => n < 100000));
  const zTailwind = countMatches(html, /z-\[(?:9\d{2,}|\d{4,})\]/g);
  if (zMax >= 900 || zTailwind >= 2) {
    push({
      id: "slop-zindex-soup",
      severity: "low",
      title: `Z-index reaching ${Math.max(zMax, ...((zTailwind ? [9999] : [0])))}`,
      detail: "Triple-digit z-values and z-[999] utilities are the unslop brief's z-index soup: layering managed by shouting instead of a stacking plan.",
      fix: "Define 3 stacking tiers (base, raised, overlay) and stay inside them.",
    });
  }

  // 23. gray body text failing contrast on light bg (unslop; gstack color cat.)
  const bodyColor = (/body\s*\{[^}]{0,400}?[^-]color\s*:\s*([^;}{]{1,50})/i.exec(css) ?? [])[1];
  if (bodyColor) {
    const hsl = colorToHsl(bodyColor);
    const bgHsl = colorToHsl(bgDecl ?? "#ffffff");
    if (hsl && bgHsl && bgHsl[2] > 80 && hsl[2] > 55 && hsl[2] < 80 && isGrayish(hsl)) {
      push({
        id: "slop-gray-contrast",
        severity: "medium",
        title: "Low-contrast gray body text on a light background",
        detail: "Mid-gray body copy on white is the unslop brief's contrast failure — and gstack's WCAG body 4.5:1 rule. Generated themes ship it as 'elegant muted'.",
        fix: "Body ink ≥ 4.5:1 against its background. Reserve muted grays for labels ≥ 3:1.",
        evidence: `body color: ${bodyColor.trim().slice(0, 40)} on light bg`,
      });
    }
  }
  const gray400 = countMatches(html, /text-(?:gray|slate|zinc|neutral|stone)-(?:300|400)\b/g);
  if (gray400 >= 4) {
    push({
      id: "slop-gray-contrast",
      severity: "medium",
      title: `gray-300/400 body text on light theme (${gray400} uses)`,
      detail: "The 400-weight gray utilities on white fail the 4.5:1 body bar — the classic generated 'muted text everywhere' wash.",
      fix: "Body text in gray-600/700 or darker; 400-level grays only for decorative meta at large sizes.",
      evidence: `${gray400} gray-300/400 text utilities`,
    });
  }

  /* ---- MOTION ---- */

  // 24. bounce / spring easing (Gesso bounce-easing; unslop bounce hovers)
  const bounceEasing = countMatches(css, /cubic-?bezier\(\s*[0-9.]+\s*,\s*1\.[3-9]\d*\s*,/gi) + countMatches(css, /(?:ease-out-back|ease-spring|bounce|spring)/gi);
  if (bounceEasing >= 2) {
    push({
      id: "slop-bounce-easing",
      severity: "low",
      title: `Bounce/spring easing (${bounceEasing} uses)`,
      detail: "Overshoot curves on every interaction are the unslop brief's bounce-easing tell — motion with no purpose beyond wobble.",
      fix: "ease-out in, ease-in out, 150–300ms. One authored motion moment per page, not a spring everywhere.",
    });
  }
  // 25. transition: all (Gesso transition-all GATE)
  const transAll = countMatches(css, /transition\s*:\s*all(?:\s+[0-9.sms]*)?/gi) + countMatches(html, /transition-all\b/g);
  if (transAll >= 5) {
    push({
      id: "slop-transition-all",
      severity: "low",
      title: `transition: all used ${transAll} times`,
      detail: "Animating every property is the generator's default; it causes jank and unpredictable motion.",
      fix: "List properties explicitly; animate only transform and opacity.",
    });
  }
  // 26. layout-prop animation (Gesso layout-prop-animation GATE)
  if (/transition[^;}{]{0,80}\b(?:width|height|top|left|margin|padding|font-?size)\b|@(?:-webkit-)?keyframes[^{]{0,60}\{[^@]{0,600}\b(?:width|height|top|left)\s*:/i.test(css)) {
    push({
      id: "slop-layout-anim",
      severity: "medium",
      title: "Animating layout properties (width/height/top/left)",
      detail: "Layout-property animations trigger reflow every frame — slow by construction and a Gesso gate-level tell.",
      fix: "Animate transform/opacity only; flip layout changes behind them.",
    });
  }
  // 27. hover-scale images (Gesso hover-scale-image; unslop hover-scale)
  if (/(?:a|img|figure|article|div)[^{]{0,80}:hover[^{]{0,40}\{[^}]{0,120}transform[^;}]{0,40}scale\(/i.test(css)) {
    push({
      id: "slop-hover-scale",
      severity: "low",
      title: "Hover-scale zoom on images/cards",
      detail: "The default generated hover: everything swells 1.05x. Purpose-free motion listed in both the unslop brief and Gesso.",
      fix: "Hover states should inform (underline, border, caption reveal) — not inflate.",
    });
  }
  // 28. logo marquee (gstack detector)
  if (/animation[^;}{]{0,80}(?:marquee|scroll-x|slide-left|translate-x)/i.test(css) && /@keyframes[^{]{0,40}\{[^}]{0,300}translate[XY]?\s*\(\s*-?(?:50%|100%)/i.test(css)) {
    push({
      id: "slop-logo-marquee",
      severity: "low",
      title: "Infinite marquee strip",
      detail: "Auto-scrolling logo/word rows are the generated social-proof costume; nobody reads frame four.",
      fix: "A static, well-set logo row with real permission; or cut it.",
    });
  }

  /* ---- IMAGERY / QUALITY ---- */

  const imgs = html.match(/<img\b[^>]{0,400}>/gi) ?? [];
  const noAlt = imgs.filter((t) => !/\balt\s*=\s*["'][^"']*["']/i.test(t) && !/\baria-hidden/i.test(t)).length;
  if (imgs.length >= 3 && noAlt / imgs.length > 0.5) {
    push({
      id: "slop-missing-alt",
      severity: "medium",
      title: `${noAlt}/${imgs.length} images missing alt text`,
      detail: "Missing alt mass is both an accessibility failure and the generated-page habit of shipping imagery nobody wrote captions for.",
      fix: "Alt text on every meaningful image; empty alt only for true decoration.",
    });
  }
  const placeholderImgs = imgs.filter((t) => /placehold\.(?:co|it)|picsum\.photos|placekitten|via\.placeholder|dummyimage|source\.unsplash|unsplash\.it|data:image\/svg\+xml[^"]{0,40}placeholder/i.test(t)).length;
  if (placeholderImgs > 0) {
    push({
      id: "slop-placeholder-image",
      severity: "medium",
      title: `${placeholderImgs} placeholder image service URL(s)`,
      detail: "placeholder.co/picsum-style images shipped to production are Gesso's placeholder-image gate: the gray box standing in for art direction.",
      fix: "Real product imagery, licensed assets, or no image at all.",
      evidence: imgs.find((t) => /placehold|picsum|placekitten/i.test(t))?.slice(0, 140),
    });
  }
  const brokenImg = imgs.filter((t) => /\bsrc\s*=\s*["'](?:["']|#|javascript:)/i.test(t)).length;
  if (brokenImg > 0) {
    push({
      id: "slop-broken-image",
      severity: "high",
      title: `${brokenImg} image(s) with empty/placeholder src`,
      detail: "Empty image sources render as broken artifacts — the page shipped without looking at itself.",
      fix: "Remove or fix the sources; add onerror handling for user-content images.",
    });
  }
  if (!/<html\b[^>]{0,200}\blang\s*=/i.test(html)) {
    push({
      id: "slop-missing-lang",
      severity: "low",
      title: "<html> has no lang attribute",
      detail: "Missing document language is Gesso's missing-lang fix: machines read it as languageless content.",
      fix: 'Set <html lang="…"> to the page language.',
    });
  }

  return void input.sheets; // sheets count surfaces via metrics; keeps signature forward-compatible
}
