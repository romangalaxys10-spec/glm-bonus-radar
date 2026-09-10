"use client";

import { useSiteDataState, announcementKey } from "@/lib/dynamic-data";
import type { AnnouncementItem } from "@/lib/site-data";

/**
 * Shared "brand-new announcement landed mid-session" selector.
 *
 * The diffing lives in the dynamic-data store (refresh() compares the newly
 * fetched announcement set against the previously rendered one; the very
 * first load never counts as news). Consumers — the hero announcements
 * strip and the Z-Assist teaser/launcher — read the same 9-second fresh
 * window here, so the visitor notices both at the same time.
 *
 * `announcementKey` is re-exported for consumers that need stable
 * per-item keys (e.g. marking which rows are the fresh ones).
 */

export { announcementKey };

export function useFreshAnnouncements(): { active: boolean; fresh: AnnouncementItem[] } {
  const { freshAnnouncements } = useSiteDataState();
  return { active: freshAnnouncements.length > 0, fresh: freshAnnouncements };
}
