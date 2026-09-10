import { getStoredSiteData } from "@/lib/docs-sync";
import type { AnnouncementItem } from "@/lib/site-data";

/**
 * Announcement feed — lets people subscribe to the AI-synced z.ai
 * announcements from any RSS/Atom reader.
 *
 *   GET /api/announcements            → Atom 1.0 (application/atom+xml)
 *   GET /api/announcements?format=rss → RSS 2.0 (application/rss+xml)
 *
 * Entries are the same items the hero strip renders: dated model releases
 * and promos extracted hourly from the official docs, each linking back to
 * its exact source page.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEED_TITLE = "GLM Bonus Radar — z.ai announcements";
const FEED_SUBTITLE =
  "Dated z.ai model releases, promos and limit changes, extracted hourly from the official docs.z.ai by the GLM Bonus Radar AI doc-sync.";

/** djb2 — stable, dependency-free content hash for entry ids. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** "2026-08-26" from the text → SGT-midnight instant for that release day. */
function entryDate(a: AnnouncementItem, fallbackIso: string): { iso: string; rfc822: string } {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(a.text);
  const d = m ? new Date(`${m[1]}T00:00:00+08:00`) : new Date(fallbackIso);
  const iso = Number.isFinite(d.getTime()) ? d.toISOString() : fallbackIso;
  return { iso, rfc822: new Date(iso).toUTCString() };
}

/**
 * Coerce whatever the sync stored into renderable items. Older sync runs
 * may have persisted legacy plain strings — never render undefined text.
 */
function asItems(raw: unknown): AnnouncementItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a): AnnouncementItem | null => {
      if (typeof a === "string") {
        const text = a.trim();
        return text ? { text } : null;
      }
      if (!a || typeof a !== "object") return null;
      const row = a as Record<string, unknown>;
      if (typeof row.text !== "string" || !row.text.trim()) return null;
      const item: AnnouncementItem = { text: row.text.trim() };
      if (typeof row.source === "string" && row.source) item.source = row.source;
      return item;
    })
    .filter((a): a is AnnouncementItem => a != null);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const format = url.searchParams.get("format") === "rss" ? "rss" : "atom";

  let announcements: AnnouncementItem[] = [];
  let updatedIso = new Date().toISOString();
  try {
    const stored = await getStoredSiteData();
    announcements = asItems(stored?.payload?.announcements);
    if (stored?.updatedAt) updatedIso = stored.updatedAt;
  } catch {
    /* DB unavailable — serve an empty but valid feed */
  }

  const xml =
    format === "rss"
      ? renderRss(origin, announcements, updatedIso)
      : renderAtom(origin, announcements, updatedIso);

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type":
        format === "rss"
          ? "application/rss+xml; charset=utf-8"
          : "application/atom+xml; charset=utf-8",
      "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
    },
  });
}

function renderAtom(origin: string, announcements: AnnouncementItem[], updatedIso: string): string {
  const entries = announcements
    .map((a) => {
      const link = a.source ?? `${origin}/`;
      const id = `${link}#br-ann-${hash(JSON.stringify([a.text, a.source ?? null]))}`;
      const { iso } = entryDate(a, updatedIso);
      return `  <entry>
    <id>${esc(id)}</id>
    <title>${esc(a.text)}</title>
    <link rel="alternate" href="${esc(link)}"/>
    <published>${iso}</published>
    <updated>${iso}</updated>
    <summary>${esc(a.text)}</summary>
    <content type="text">${esc(a.text)}</content>
  </entry>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(FEED_TITLE)}</title>
  <subtitle>${esc(FEED_SUBTITLE)}</subtitle>
  <id>${esc(`${origin}/api/announcements`)}</id>
  <link rel="self" href="${esc(`${origin}/api/announcements`)}"/>
  <link rel="alternate" href="${esc(`${origin}/`)}"/>
  <updated>${updatedIso}</updated>
  <generator>GLM Bonus Radar AI doc-sync</generator>
${entries}
</feed>
`;
}

function renderRss(origin: string, announcements: AnnouncementItem[], updatedIso: string): string {
  const items = announcements
    .map((a) => {
      const link = a.source ?? `${origin}/`;
      const id = `${link}#br-ann-${hash(JSON.stringify([a.text, a.source ?? null]))}`;
      const { rfc822 } = entryDate(a, updatedIso);
      return `    <item>
      <title>${esc(a.text)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="false">${esc(id)}</guid>
      <pubDate>${rfc822}</pubDate>
      <description>${esc(a.text)}</description>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(FEED_TITLE)}</title>
    <link>${esc(`${origin}/`)}</link>
    <description>${esc(FEED_SUBTITLE)}</description>
    <lastBuildDate>${new Date(updatedIso).toUTCString()}</lastBuildDate>
    <generator>GLM Bonus Radar AI doc-sync</generator>
${items}
  </channel>
</rss>
`;
}
