/**
 * zScanner — Anti AI-Slop Reviewer: VISUAL EVIDENCE stage (v6).
 *
 * The deterministic detectors (slop-css.ts / slop.ts) judge the page from
 * its source. This stage proves the important tells to the user's eyes:
 * it loads the page in the QA browser, mirrors the fired detectors against
 * the live DOM (computed styles), and screenshots each located element
 * with a red outline + label chip, plus one clean full-page context shot.
 *
 * Contract:
 *  - Evidence only — shots never change the score, grade or severities.
 *  - Best effort — any failure (browser busy, page dead, locator empty,
 *    timeout) degrades to `note` and the report ships without shots.
 *    The scan itself must NEVER fail or stall because of this stage.
 *  - Bounded — ≤5 tell shots + 1 context shot, JPEG, hard data-URL cap.
 *  - Serialized — runs through withQaBrowser (browserLock), so it queues
 *    politely behind Auto QA; a busy browser at stage entry skips the
 *    stage with an honest note instead of hanging the scan.
 */

import { browserLockBusy, newQaContext, withQaBrowser } from "./browser";
import { type Finding, type Severity, type SlopShot } from "./types";

/** Detectors with a DOM locator strategy (everything else is CSS/copy-only). */
const SHOOTABLE = new Set<string>([
  "slop-purple-gradient",
  "slop-gradient-fill",
  "slop-indigo-accent",
  "slop-gradient-text",
  "slop-ghost-card",
  "slop-heavy-shadow",
  "slop-3col-icon-grid",
  "slop-icon-tiles",
  "slop-uniform-cards",
  "slop-gray-contrast",
  "slop-emoji-icon",
  "slop-eyebrow-chips",
  "slop-stat-row",
  "slop-testimonial-row",
]);

/** Static tell metadata for the gallery card (label + what to notice). */
const SHOT_META: Record<string, { label: string; caption: string }> = {
  "slop-purple-gradient": { label: "purple gradient wash", caption: "Largest element painted with an indigo-band gradient (235–320°) — highlighted. The default-generated palette." },
  "slop-gradient-fill": { label: "gradient fill", caption: "Highlighted element carries a gradient fill where one owned solid color would do." },
  "slop-indigo-accent": { label: "indigo accent CTA", caption: "Highlighted CTA is filled in the generated indigo band — the accent every template reaches for." },
  "slop-gradient-text": { label: "gradient-clipped text", caption: "Highlighted headline is gradient-clipped text — a rendering trick, not a type decision." },
  "slop-ghost-card": { label: "ghost card", caption: "Highlighted card: backdrop-blur over a translucent fill — depth that decorates instead of explaining." },
  "slop-heavy-shadow": { label: "heavy shadow", caption: "Highlighted element floats on a 40px+ soft shadow — the template's only depth token." },
  "slop-3col-icon-grid": { label: "3-column icon grid", caption: "Highlighted grid: equal icon tiles in lockstep columns — composition replaced by a clone grid." },
  "slop-icon-tiles": { label: "icon tile row", caption: "Highlighted tile row: same visual costume on every item, nothing actually compared." },
  "slop-uniform-cards": { label: "uniform card row", caption: "Highlighted row: identical cards with identical class signatures — the layout nobody designed." },
  "slop-gray-contrast": { label: "low-contrast gray text", caption: "Highlighted text block fails WCAG 4.5:1 against its background — the muted-gray body copy habit." },
  "slop-emoji-icon": { label: "emoji as icon", caption: "Highlighted heading opens with an emoji standing in for a real icon." },
  "slop-eyebrow-chips": { label: "eyebrow chip", caption: "Highlighted uppercase micro-label above a heading — the template's section opener costume." },
  "slop-stat-row": { label: "big-number stat row", caption: "Highlighted row: three+ unverifiable big numbers — the template counts instead of the product." },
  "slop-testimonial-row": { label: "testimonial costume", caption: "Highlighted section: stars + quotes in the standard costume nobody is convinced by." },
};

const MAX_TELL_SHOTS = 5;
const CONTEXT_CAP_HEIGHT = 4800;
const SHOT_PAD = 18;
/** Hard per-shot data URL cap (~410 KB) — one bloated hero never sinks the report. */
const MAX_SHOT_CHARS = 550_000;
/** Whole stage budget; the timer side resolves with a note, never throws. */
const STAGE_TIMEOUT_MS = 75_000;

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4, pass: 5 };

export type SlopShotsOutcome = { shots: SlopShot[]; note?: string };

/**
 * In-page locator: mirrors the fired detectors against the LIVE DOM with
 * computed styles. Runs inside the target page — plain ES2020, no Node
 * globals, every step guarded. Returns document-coordinate rects with a
 * `mark` attribute set on each element for later re-location.
 */
function locateSlopElements(firedIds: string[]): { candidates: { id: string; mark: string; x: number; y: number; w: number; h: number }[]; docW: number; docH: number } {
  const out: { id: string; mark: string; x: number; y: number; w: number; h: number }[] = [];
  let docW = 1366;
  let docH = 2000;
  try {
    docW = Math.max(320, document.documentElement.scrollWidth);
    docH = Math.max(600, document.documentElement.scrollHeight);
    const fired = new Set(firedIds);
    const sx = window.scrollX || window.pageXOffset;
    const sy = window.scrollY || window.pageYOffset;
    const all = Array.from(document.body ? document.body.querySelectorAll<HTMLElement>("*") : []);
    let markSeq = 0;

    const rectOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height };
    };
    const visible = (el: Element, minW = 8, minH = 8) => {
      const r = el.getBoundingClientRect();
      if (r.width < minW || r.height < minH) return false;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) < 0.05) return false;
      return true;
    };
    const cs = (el: Element) => getComputedStyle(el);

    const parseRgb = (c: string): [number, number, number, number] | null => {
      const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?\s*\)/i);
      if (m) {
        let a = 1;
        if (m[4] != null) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), a];
      }
      const hx = c.match(/^#([0-9a-f]{3,8})$/i);
      if (hx) {
        let h = hx[1];
        if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
        const n = parseInt(h.slice(0, 6), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
      }
      return null;
    };
    const hueOf = (rgb: [number, number, number, number]): number => {
      const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (d < 0.04 || max < 0.12) return -1;
      let h = 0;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = Math.round(h * 60);
      return h < 0 ? h + 360 : h;
    };
    const inBand = (h: number) => h >= 228 && h <= 328; // indigo→purple→magenta band
    const colorsIn = (s: string): [number, number, number, number][] => {
      const out: [number, number, number, number][] = [];
      const re = /(?:rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) && out.length < 24) {
        const p = parseRgb(m[0]);
        if (p) out.push(p);
      }
      return out;
    };

    const push = (id: string, el: Element) => {
      const mark = `z${(markSeq++).toString(36)}`;
      try { el.setAttribute("data-zscan", mark); } catch { return; }
      const r = rectOf(el);
      out.push({ id, mark, x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.w, h: r.h });
    };
    const taken = new Set<Element>();
    /** A real tell element (card/row/hero/section) never covers most of the page —
     *  page-wrapper false positives get rejected here. */
    const AREA_CAP = 5_200_000; // ≈ 1366 × 3800
    const claim = (id: string, pool: Element[], score: (el: Element) => number): boolean => {
      const cands = pool.filter((el) => !taken.has(el) && visible(el));
      if (!cands.length) return false;
      cands.sort((a, b) => score(b) - score(a));
      const best = cands[0];
      if (score(best) <= 0) return false;
      const r = best.getBoundingClientRect();
      if (r.width * r.height > AREA_CAP) return false;
      taken.add(best);
      push(id, best);
      return true;
    };

    // --- color tells ---
    if (fired.has("slop-purple-gradient") || fired.has("slop-gradient-fill")) {
      const gradEls = all.filter((el) => {
        const bi = cs(el).backgroundImage;
        return /gradient\(/i.test(bi) && colorsIn(bi).some((c) => inBand(hueOf(c)));
      });
      claim("slop-purple-gradient", gradEls, (el) => {
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        // prefer hero-band elements: big + in the first two viewports
        const topBias = r.top + sy < vh * 2 ? 2 : 1;
        return r.width * r.height * topBias;
      });
    }
    if (fired.has("slop-indigo-accent")) {
      const ctas = all.filter((el) => {
        const tag = el.tagName.toLowerCase();
        if (!/^(a|button)$/.test(tag) && !(el as HTMLElement).getAttribute("role")?.includes("button")) return false;
        const s = cs(el);
        const bgC = parseRgb(s.backgroundColor);
        const bgFill = bgC && bgC[3] > 0.4 && inBand(hueOf(bgC));
        const bgGrad = /gradient\(/i.test(s.backgroundImage) && colorsIn(s.backgroundImage).some((c) => inBand(hueOf(c)));
        const r = el.getBoundingClientRect();
        return (bgFill || bgGrad) && r.width < 420 && r.height < 130 && (el.textContent ?? "").trim().length <= 44;
      });
      claim("slop-indigo-accent", ctas, (el) => el.getBoundingClientRect().width * el.getBoundingClientRect().height);
    }
    if (fired.has("slop-gradient-text")) {
      const gts = all.filter((el) => {
        const s = cs(el);
        const clip = (s as CSSStyleDeclaration & { webkitBackgroundClip?: string }).webkitBackgroundClip || s.backgroundClip;
        return (clip === "text" || (s as CSSStyleDeclaration & { webkitTextFillColor?: string }).webkitTextFillColor === "transparent") && /gradient\(/i.test(s.backgroundImage);
      });
      claim("slop-gradient-text", gts, (el) => parseFloat(cs(el).fontSize || "0"));
    }
    if (fired.has("slop-gray-contrast")) {
      const lum = (rgb: [number, number, number, number]) => {
        const a = rgb.slice(0, 3).map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
      };
      const effBg = (el: Element): [number, number, number, number] | null => {
        let cur: Element | null = el;
        for (let i = 0; i < 24 && cur; i++) {
          const bg = parseRgb(cs(cur).backgroundColor);
          if (bg && bg[3] > 0.6) return bg;
          cur = cur.parentElement;
        }
        return null;
      };
      const low = all.filter((el) => {
        const t = (el.textContent ?? "").trim();
        if (t.length < 40 || t.length > 900) return false;
        // element must own (not just contain) most of its text
        const own = Array.from(el.childNodes).reduce((n, node) => n + (node.nodeType === 3 ? (node.textContent ?? "").length : 0), 0);
        if (own < t.length * 0.5) return false;
        const fg = parseRgb(cs(el).color);
        const bg = effBg(el);
        if (!fg || !bg) return false;
        const l1 = lum(fg), l2 = lum(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        return ratio < 4.5 && parseFloat(cs(el).fontSize || "16") >= 13;
      });
      claim("slop-gray-contrast", low, (el) => el.getBoundingClientRect().width * el.getBoundingClientRect().height);
    }

    // --- visual tells ---
    if (fired.has("slop-ghost-card")) {
      const ghosts = all.filter((el) => {
        const s = cs(el);
        const bf = s.backdropFilter || (s as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter || "";
        if (!/blur\(/i.test(bf)) return false;
        const bg = parseRgb(s.backgroundColor);
        const translucent = !bg || bg[3] < 0.4;
        const r = el.getBoundingClientRect();
        return translucent && r.width >= 160 && r.height >= 90;
      });
      claim("slop-ghost-card", ghosts, (el) => el.getBoundingClientRect().width * el.getBoundingClientRect().height);
    }
    if (fired.has("slop-heavy-shadow")) {
      const sh = all.filter((el) => {
        const bsh = cs(el).boxShadow;
        if (!bsh || bsh === "none") return false;
        const m = bsh.match(/rgba?\([^)]+\)\s+(\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px/);
        const alpha = bsh.match(/rgba?\([^)]*?([\d.]+)\)/);
        const blur = m ? parseFloat(m[2]) : 0;
        return blur >= 34 && alpha ? parseFloat(alpha[1]) >= 0.18 : blur >= 44;
      });
      claim("slop-heavy-shadow", sh, (el) => el.getBoundingClientRect().width * el.getBoundingClientRect().height);
    }

    // --- layout tells ---
    const kidsOf = (el: Element) => Array.from(el.children).filter((c) => visible(c, 24, 16));
    /** Children must sit SIDE BY SIDE (same visual row) — vertical page
     *  stacks have equal widths too and must not match. */
    const sameRow = (kids: Element[]) => {
      if (kids.length < 2) return false;
      const t0 = kids[0].getBoundingClientRect().top;
      const t1 = kids[1].getBoundingClientRect().top;
      return Math.abs(t1 - t0) <= Math.max(48, kids[0].getBoundingClientRect().height * 0.35);
    };
    const uniformRow = (el: Element) => {
      const kids = kidsOf(el);
      if (kids.length < 3 || !sameRow(kids)) return false;
      const ws = kids.map((k) => k.getBoundingClientRect().width);
      const w0 = ws[0];
      if (!ws.every((w) => Math.abs(w - w0) <= w0 * 0.14)) return false;
      const sig = (k: Element) => (k.className && typeof k.className === "string" ? k.className.trim().split(/\s+/)[0] : k.tagName);
      const s0 = sig(kids[0]);
      const same = kids.filter((k) => sig(k) === s0).length;
      return same >= Math.max(3, kids.length - 1);
    };
    if (fired.has("slop-uniform-cards")) {
      const rows = all.filter((el) => {
        const r = el.getBoundingClientRect();
        return uniformRow(el) && r.width >= 420 && kidsOf(el)[0].getBoundingClientRect().width * kidsOf(el)[0].getBoundingClientRect().height >= 6000;
      });
      claim("slop-uniform-cards", rows, (el) => -el.getBoundingClientRect().width * el.getBoundingClientRect().height);
    }
    const iconish = (el: Element) => {
      if (el.querySelector("svg, img, picture")) return true;
      return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test((el.textContent ?? "").slice(0, 4));
    };
    if (fired.has("slop-3col-icon-grid") || fired.has("slop-icon-tiles")) {
      const grids = all.filter((el) => {
        const s = cs(el);
        const kids = kidsOf(el);
        if (kids.length < 3) return false;
        const tracks = s.display === "grid" ? s.gridTemplateColumns.split(" ").filter((t) => t !== "0px").length : 0;
        const cols = tracks >= 3;
        const equalW = (() => {
          const ws = kids.slice(0, 6).map((k) => k.getBoundingClientRect().width);
          return ws.length >= 3 && ws.every((w) => Math.abs(w - ws[0]) <= ws[0] * 0.18);
        })();
        if (!(cols || (equalW && sameRow(kids)))) return false;
        const withIcons = kids.filter(iconish).length;
        return withIcons >= Math.ceil(kids.length * 0.6);
      });
      claim(fired.has("slop-3col-icon-grid") ? "slop-3col-icon-grid" : "slop-icon-tiles", grids, (el) => -el.getBoundingClientRect().width * el.getBoundingClientRect().height);
    }
    if (fired.has("slop-eyebrow-chips")) {
      const chips = all.filter((el) => {
        const s = cs(el);
        const t = (el.textContent ?? "").trim();
        const nxt = el.nextElementSibling;
        return (
          s.textTransform === "uppercase" && parseFloat(s.fontSize || "16") <= 13.5 &&
          parseFloat(s.letterSpacing || "0") >= 0.8 && t.length >= 3 && t.length <= 34 &&
          !!nxt && /^h[1-6]$/i.test(nxt.tagName)
        );
      });
      claim("slop-eyebrow-chips", chips, (el) => { const r = el.getBoundingClientRect(); return r.top + sy < window.innerHeight * 3 ? 1 : 0; });
    }
    if (fired.has("slop-stat-row")) {
      const bigNum = (el: Element) => {
        const t = (el.textContent ?? "").trim();
        return /^[$€£±~]?\d[\d.,]*\s*[%+kKmM]?[+%]?$/.test(t) && parseFloat(cs(el).fontSize || "0") >= 22;
      };
      const statRows = all.filter((el) => {
        const kids = kidsOf(el);
        if (kids.length < 3 || !sameRow(kids)) return false;
        return kids.filter((k) => bigNum(k) || (k.querySelector("*") && Array.from(k.children).some(bigNum))).length >= 3;
      });
      claim("slop-stat-row", statRows, (el) => -el.getBoundingClientRect().width * el.getBoundingClientRect().height);
    }
    if (fired.has("slop-testimonial-row")) {
      const quotes = all.filter((el) => {
        const t = (el.textContent ?? "");
        if (!/testimonial|what (?:our |they say|people say)|loved by|trusted by/i.test(t)) return false;
        return (t.match(/[★⭐]/g) ?? []).length >= 2 || !!el.querySelector("img");
      });
      // shoot the section container, not the quote itself
      const secs = quotes.map((q) => q.closest("section") ?? (q.parentElement as Element) ?? q);
      claim("slop-testimonial-row", secs, (el) => { const r = el.getBoundingClientRect(); return -(r.width * r.height); });
    }
    if (fired.has("slop-emoji-icon")) {
      const heads = all.filter((el) => {
        if (!/^h[1-4]$/i.test(el.tagName) && el.tagName.toLowerCase() !== "strong") return false;
        return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test((el.textContent ?? "").slice(0, 3));
      });
      claim("slop-emoji-icon", heads, (el) => parseFloat(cs(el).fontSize || "0"));
    }

    // one shot per element even across detectors
    const seen = new Set<string>();
    return {
      candidates: out.filter((c) => (seen.has(c.mark) ? false : (seen.add(c.mark), true))),
      docW,
      docH,
    };
  } catch {
    return { candidates: out, docW, docH };
  }
}

/** Capture the visual-evidence pack. Never throws — failures become `note`. */
export async function captureSlopShots(pageUrl: string, findings: Finding[], progress: (frac: number, note?: string) => void): Promise<SlopShotsOutcome> {
  const shootable = findings
    .filter((f) => SHOOTABLE.has(f.id) && f.severity !== "pass" && SHOT_META[f.id])
    .sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
  if (!shootable.length) return { shots: [] };

  if (browserLockBusy()) {
    return { shots: [], note: "the QA browser was busy with another run — visual evidence was skipped for this scan (rerun in a minute to get shots)" };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<SlopShotsOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ shots: [], note: "the browser capture ran over its time budget — visual evidence was skipped for this scan" }), STAGE_TIMEOUT_MS);
  });

  const capture = (async (): Promise<SlopShotsOutcome> => {
    try {
      return await withQaBrowser(async (browser) => {
        const context = await newQaContext(browser);
        const page = await context.newPage();
        const shots: SlopShot[] = [];
        try {
          progress(0.05, "loading the page in the QA browser");
          try {
            await page.goto(pageUrl, { waitUntil: "load", timeout: 30_000 });
          } catch {
            await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
          }
          await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
          await page.waitForTimeout(1_200); // fonts, lazy images, late CSS

          // 1) clean full-page context shot (no overlays) — capped height
          progress(0.2, "context screenshot");
          const dims = await page.evaluate(() => ({
            w: Math.max(320, document.documentElement.scrollWidth),
            h: Math.max(600, document.documentElement.scrollHeight),
          }));
          const ctxH = Math.min(dims.h, CONTEXT_CAP_HEIGHT);
          try {
            const ctx = await page.screenshot({ clip: { x: 0, y: 0, width: Math.min(dims.w, 1366), height: ctxH }, type: "jpeg", quality: 60 });
            const dataUrl = `data:image/jpeg;base64,${ctx.toString("base64")}`;
            if (dataUrl.length <= MAX_SHOT_CHARS) {
              shots.push({ id: "context", label: "full page", caption: `The page as the reviewer saw it (desktop 1366px${dims.h > CONTEXT_CAP_HEIGHT ? `, first ${CONTEXT_CAP_HEIGHT}px of ${dims.h}` : ""}).`, severity: "info", dataUrl, w: Math.min(dims.w, 1366), h: ctxH });
            }
          } catch { /* context shot is optional */ }

          // 2) locate the fired tells in the live DOM
          progress(0.35, "locating the tells in the DOM");
          const firedIds = shootable.map((f) => f.id);
          const { candidates } = await page.evaluate(locateSlopElements, firedIds);
          if (!candidates.length) return { shots, note: shots.length ? undefined : "none of the fired tells could be located in the live DOM — no element shots this run" };

          const bySeverity = new Map(shootable.map((f) => [f.id, f]));
          const ordered = [...candidates]
            .filter((c) => bySeverity.has(c.id))
            .sort((a, b) => (SEV_RANK[bySeverity.get(a.id)!.severity] ?? 9) - (SEV_RANK[bySeverity.get(b.id)!.severity] ?? 9))
            .slice(0, MAX_TELL_SHOTS);

          // 3) highlight + clip each tell.
          // NOTE on coordinates (learned the hard way on chrome-headless-shell
          // 143 / playwright 1.57): page.screenshot({clip}) is VIEWPORT-relative
          // on the new headless — document-coordinate clips beyond the current
          // scroll position die with "Clipped area is either empty or outside
          // the resulting image". So: scrollIntoView first, then take the
          // element's FRESH boundingBox() (viewport-relative) and clip inside
          // the viewport. Overlays use position:fixed for the same reason.
          const vp = page.viewportSize() ?? { width: 1366, height: 900 };
          for (let i = 0; i < ordered.length; i++) {
            const c = ordered[i];
            const f = bySeverity.get(c.id)!;
            const meta = SHOT_META[c.id];
            progress(0.35 + ((i + 1) / (ordered.length + 1)) * 0.6, `screenshot: ${meta.label}`);
            try {
              const handle = await page.$(`[data-zscan="${c.mark}"]`);
              if (!handle) {
                console.error(`[slop-shots] ${c.id}: element gone`);
                continue;
              }
              await handle.scrollIntoViewIfNeeded().catch(() => undefined);
              await page.waitForTimeout(400); // lazy loads + scroll animations settle
              const bb = await handle.boundingBox();
              if (!bb || bb.width < 8 || bb.height < 8) {
                console.error(`[slop-shots] ${c.id}: no bounding box (invisible?)`);
                continue;
              }
              // clip = element + padding, clamped INSIDE the viewport
              const clipX = Math.max(0, Math.min(bb.x - SHOT_PAD, vp.width - 100));
              const clipY = Math.max(0, Math.min(bb.y - SHOT_PAD - 24, vp.height - 100));
              const clipW = Math.max(40, Math.min(bb.width + SHOT_PAD * 2, vp.width - clipX));
              const clipH = Math.max(40, Math.min(bb.height + SHOT_PAD * 2 + 24, vp.height - clipY));
              await page.evaluate(({ mark, cx, cy, label }: { mark: string; cx: number; cy: number; label: string }) => {
                try {
                  const el = document.querySelector(`[data-zscan="${mark}"]`) as HTMLElement | null;
                  if (el) {
                    el.style.outline = "3px solid #e11d48";
                    el.style.outlineOffset = "-3px";
                  }
                  const chip = document.createElement("div");
                  chip.setAttribute("data-zscan-chip", mark);
                  chip.textContent = `AI-slop tell: ${label}`;
                  chip.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;z-index:2147483647;background:#e11d48;color:#fff;font:600 11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;padding:2px 8px;border-radius:4px 4px 4px 0;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;`;
                  document.body.appendChild(chip);
                } catch { /* overlay is cosmetic */ }
              }, { mark: c.mark, cx: clipX, cy: clipY, label: meta.label });
              await page.waitForTimeout(80);

              let buf = await page.screenshot({ clip: { x: clipX, y: clipY, width: clipW, height: clipH }, type: "jpeg", quality: 72 });
              let dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
              if (dataUrl.length > MAX_SHOT_CHARS) {
                // gradient-heavy heroes compress poorly at q72 — one retry, lower quality
                buf = await page.screenshot({ clip: { x: clipX, y: clipY, width: clipW, height: clipH }, type: "jpeg", quality: 55 });
                dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
              }
              if (dataUrl.length <= MAX_SHOT_CHARS) {
                shots.push({ id: c.id, label: meta.label, caption: meta.caption, severity: f.severity, dataUrl, w: clipW, h: clipH });
              } else {
                console.error(`[slop-shots] ${c.id}: jpeg still over the size cap at q55 (${(dataUrl.length / 1024).toFixed(0)}KB) — skipped`);
              }
            } catch (err) {
              console.error(`[slop-shots] ${c.id}: shot failed:`, err instanceof Error ? err.message.split("\n")[0] : err);
            } finally {
              await page.evaluate(({ mark }: { mark: string }) => {
                try {
                  const el = document.querySelector(`[data-zscan="${mark}"]`) as HTMLElement | null;
                  if (el) { el.style.outline = ""; el.style.outlineOffset = ""; }
                  document.querySelectorAll(`[data-zscan-chip="${mark}"]`).forEach((n) => n.remove());
                } catch { /* cleanup best-effort */ }
              }, { mark: c.mark }).catch(() => undefined);
            }
          }
          return { shots };
        } finally {
          await context.close().catch(() => undefined);
        }
      });
    } catch (e) {
      return { shots: [], note: `the browser capture failed (${e instanceof Error ? e.message.split("\n")[0].slice(0, 140) : "unknown error"}) — the report ships without shots` };
    }
  })();

  const outcome = await Promise.race([capture, timeout]);
  if (timer) clearTimeout(timer);
  return outcome;
}
