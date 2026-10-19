/**
 * ZCode product docs — the official documentation/wiki at zcode.z.ai/en/docs.
 *
 * The Z-Assist engine (floating widget, /agent full chat, Telegram bots)
 * answers ZCode questions (install, Goal Mode, MCP, hooks, subagents, ...)
 * from these pages. They are fetched into their own DB snapshot by the same
 * scheduler that syncs docs.z.ai (boot / hourly / manual) — a failed zcode
 * fetch never fails the main sync, and a stale snapshot keeps serving until
 * the next successful run.
 *
 * The doc site is a Next.js SPA whose pages ARE server-rendered: the plain
 * HTML contains the full page text after the shared sidebar (up to the
 * "Copy page" marker) and before the right-hand "On this page" TOC.
 */

import { db } from "@/lib/db";

export const ZCODE_DOCS_SNAPSHOT_KEY = "zcode-docs-snapshot";
export const ZCODE_DOCS_HUB = "https://zcode.z.ai/en/docs";
export const ZCODE_CHANGELOG_URL = "https://zcode.z.ai/en/changelog";

/** Every page in the official docs nav (en) + the changelog wiki. */
export const ZCODE_DOC_SOURCES: Array<{ url: string; label: string; max: number }> = [
  { url: "https://zcode.z.ai/en/docs", label: "ZCode overview (Welcome to ZCode for GLM-5.3)", max: 2600 },
  { url: "https://zcode.z.ai/en/docs/welcome", label: "Get started — welcome", max: 2200 },
  { url: "https://zcode.z.ai/en/docs/install", label: "Install (desktop app, v3.15.3)", max: 2400 },
  { url: "https://zcode.z.ai/en/docs/configuration", label: "Connect models / configuration", max: 2200 },
  { url: "https://zcode.z.ai/en/docs/feedback", label: "Feedback & support", max: 1600 },
  { url: "https://zcode.z.ai/en/docs/agents", label: "ZCode Agent (core agent)", max: 2400 },
  { url: "https://zcode.z.ai/en/docs/goal", label: "Goal Mode (/goal)", max: 2200 },
  { url: "https://zcode.z.ai/en/docs/browser-use", label: "Browser automation", max: 2000 },
  { url: "https://zcode.z.ai/en/docs/task-management", label: "Task & file management", max: 2000 },
  { url: "https://zcode.z.ai/en/docs/repo-wiki", label: "Repo wiki", max: 2000 },
  { url: "https://zcode.z.ai/en/docs/memory", label: "Memory", max: 2000 },
  { url: "https://zcode.z.ai/en/docs/automations", label: "Automations", max: 2000 },
  { url: "https://zcode.z.ai/en/docs/idle-time-tasks", label: "Idle-time tasks", max: 1800 },
  { url: "https://zcode.z.ai/en/docs/edit-history", label: "Edit history", max: 1800 },
  { url: "https://zcode.z.ai/en/docs/remote-development", label: "Remote development", max: 1800 },
  { url: "https://zcode.z.ai/en/docs/remote-control", label: "Remote control", max: 1800 },
  { url: "https://zcode.z.ai/en/docs/bot-channel", label: "Bot channel", max: 1800 },
  { url: "https://zcode.z.ai/en/docs/subagents", label: "Subagents", max: 2000 },
  { url: "https://zcode.z.ai/en/docs/plugin", label: "Plugins", max: 1800 },
  { url: "https://zcode.z.ai/en/docs/skill", label: "Skills", max: 1800 },
  { url: "https://zcode.z.ai/en/docs/mcp-services", label: "MCP services", max: 2200 },
  { url: "https://zcode.z.ai/en/docs/commands", label: "Commands", max: 2000 },
  { url: "https://zcode.z.ai/en/docs/hooks", label: "Hooks", max: 2000 },
  { url: "https://zcode.z.ai/en/docs/usage-stats", label: "Usage stats", max: 1800 },
  { url: "https://zcode.z.ai/en/docs/safety-confirm", label: "Safety confirmation", max: 1800 },
  { url: "https://zcode.z.ai/en/docs/ADE-tools", label: "ADE tools", max: 1800 },
  { url: "https://zcode.z.ai/en/docs/keyboard-shortcuts", label: "Keyboard shortcuts", max: 1800 },
  { url: "https://zcode.z.ai/en/docs/qa", label: "FAQ (Q&A)", max: 2600 },
  { url: ZCODE_CHANGELOG_URL, label: "ZCode changelog (release wiki)", max: 2600 },
];

export interface ZcodeFetchedDoc {
  url: string;
  label: string;
  md: string;
  ok: boolean;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
};

/**
 * HTML -> readable doc text: drops script/style, breaks lines on block tags,
 * collapses runs of whitespace, strips the shared sidebar (everything up to
 * and including the first "Copy page" button) and the trailing TOC.
 */
export function htmlToDocText(rawHtml: string): string {
  let s = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/tr|\/div|\/section|\/article|\/td|\/th)[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  for (const [ent, ch] of Object.entries(ENTITIES)) s = s.split(ent).join(ch);
  s = s.replace(/&[a-z]+;/gi, " ");
  s = s.replace(/[ \t]+/g, " ");
  let text = s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");

  const cp = text.indexOf("Copy page");
  if (cp >= 0) text = text.slice(cp + "Copy page".length);
  const toc = text.indexOf("\nOn this page\n");
  if (toc >= 0) text = text.slice(0, toc);
  // Some pages repeat the sidebar after the content — cut at the known first
  // repeated nav group if it sneaks past the TOC cut.
  const repeat = text.indexOf("\nFeedback & Support\nLearn how to report issues");
  if (repeat >= 0) text = text.slice(0, repeat);
  return text.trim();
}

export async function fetchZcodeDocs(): Promise<{ pages: ZcodeFetchedDoc[]; fetchedAt: string }> {
  const fetchedAt = new Date().toISOString();
  const pages: ZcodeFetchedDoc[] = [];
  for (const src of ZCODE_DOC_SOURCES) {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      const text = htmlToDocText(raw);
      // A soft-404 renders as a tiny page — treat it as a failed fetch.
      if (text.length < 120 || /^404[:\s]/.test(text)) throw new Error("page not found (soft 404)");
      pages.push({ url: src.url, label: src.label, md: text.slice(0, src.max), ok: true });
    } catch (err) {
      console.error(`[zcode-docs] failed to fetch ${src.url}:`, err);
      pages.push({ url: src.url, label: src.label, md: "", ok: false });
    }
  }
  return { pages, fetchedAt };
}

export function zcodeToPrompt(pages: ZcodeFetchedDoc[]): string {
  return pages
    .filter((p) => p.ok)
    .map((p) => `===== ZCODE DOC: ${p.label} (${p.url}) =====\n${p.md}`)
    .join("\n\n");
}

export interface ZcodeSyncResult {
  okPages: number;
  total: number;
  fetchedAt: string;
  chars: number;
}

/** Fetches all ZCode doc pages and refreshes the DB snapshot. */
export async function runZcodeSync(): Promise<ZcodeSyncResult> {
  const { pages, fetchedAt } = await fetchZcodeDocs();
  const okPages = pages.filter((p) => p.ok);
  // Only overwrite the snapshot when something succeeded — a total network
  // failure keeps the previous snapshot serving.
  if (okPages.length === 0) throw new Error("all ZCode doc sources failed to fetch");
  const prompt = zcodeToPrompt(pages);
  await db.siteData.upsert({
    where: { key: ZCODE_DOCS_SNAPSHOT_KEY },
    create: { key: ZCODE_DOCS_SNAPSHOT_KEY, payload: JSON.stringify({ prompt, fetchedAt }) },
    update: { payload: JSON.stringify({ prompt, fetchedAt }) },
  });
  return { okPages: okPages.length, total: pages.length, fetchedAt, chars: prompt.length };
}

export async function getZcodeSnapshot(): Promise<{ prompt: string; fetchedAt: string } | null> {
  const row = await db.siteData.findUnique({ where: { key: ZCODE_DOCS_SNAPSHOT_KEY } });
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as { prompt: string; fetchedAt: string };
  } catch {
    return null;
  }
}
