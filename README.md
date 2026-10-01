# GLM Bonus Radar

[![Live portal](https://img.shields.io/badge/live-bonus_radar-cc3d2e?style=flat-square)](https://rommark.dev)
[![GitHub repo](https://img.shields.io/badge/source-github-181717?style=flat-square&logo=github)](https://github.com/romangalaxys10-spec/glm-bonus-radar)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](./LICENSE)

A live tracker for every known **z.ai** bonus window, peak-hour surcharge and limited-time token
discount — with second-accurate countdowns, timezone-aware timelines, an AI bot that re-reads the
official docs every hour, and a Prometheus-compatible metrics endpoint. No stale screenshots, no
guessing when to fire the heavy agent runs.

## Highlights

- **Live bonus windows** — golden nightly Flash campaign, peak-hours surcharge, Flash API −50%
  promo; every event carries a ticking countdown ("time left until open/close") and flips state
  automatically.
- **AI doc-sync** — an hourly job fetches the official `docs.z.ai` pages, asks an LLM to extract a
  strict JSON payload (windows / pricing / plans / announcements), validates + normalizes it and
  only saves real changes. Safety-net pins keep the peak window, the Flash promo and the nightly
  recurrence alive even when the extraction wobbles.
- **Always-updating changelog** — [`/changelog`](https://github.com/romangalaxys10-spec/glm-bonus-radar/blob/main/src/app/changelog/page.tsx)
  journals every sync run (applied changes in full, quiet sweeps as one-liners, errors in red) and
  refreshes itself every minute. The "data updated on" badge only moves for real data changes.
- **Modular notifications** — opt-in browser notifications (golden window / any window /
  announcements) plus Telegram delivery: paste a BotFather token, link a chat with `/start <code>`,
  pick categories.
- **Z-Assist chat** — a grounded chatbot answering from the newest fetched docs text (the bot and
  the page share one source of truth).
- **Subscribable announcements** — Atom (`/api/announcements`) + RSS (`?format=rss`) feeds with
  per-entry source links and auto-discovery `<link>` tags.
- **PWA** — installable (Chromium native prompt + iOS Add-to-Home-Screen recipe), offline-safe
  service worker that never serves stale radar data.
- **Prometheus metrics** — `/api/metrics` exposes `bonus_inference_active`,
  `_transition_seconds` and `_end_timestamp_seconds` per window.
- **6 palettes × light/dark/system**, invite-token banner with copy button, mobile-first layouts.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Prisma + SQLite ·
z-ai-web-dev-sdk (LLM extraction + chat) · deployable behind Caddy or any Node host.

## Getting started

```bash
bun install                # or npm install / pnpm install
npx prisma db push         # create the SQLite database
npm run dev                # http://localhost:3000
```

Environment (`.env`):

```
DATABASE_URL="file:./../db/custom.db"
```

Optional: the Telegram bot token is configured at runtime through the portal's notification panel
(stored in the DB, never in code). The LLM features use `z-ai-web-dev-sdk` defaults.

Production:

```bash
npm run build && npm start
```

## Project map

```
src/app/                 home portal, /changelog journal, API routes (metrics, sync, feed, assist, telegram)
src/components/portal/   countdowns, windows/timeline, pricing, plans, chat, notifications, PWA prompt
src/lib/windows.ts       SGT window engine (fixed UTC+8 math, recurring + bounded events)
src/lib/docs-sync.ts     hourly AI sync: fetch docs → LLM extract → validate → diff → journal
src/lib/dynamic-data.ts  client store polling AI-synced data (announcements diffing, seen-set)
prisma/schema.prisma     SiteData + SyncRun journal + TelegramChat models
```

## Credits

Developed by **[Rommark.Dev](https://rommark.dev)** ·
[Telegram](https://t.me/VibeCodePrompterSystem) ·
[LinkedIn](https://www.linkedin.com/in/rоman-m-793b3310)

Unofficial community tracker — not affiliated with Z.ai. Data comes from the official
[docs.z.ai](https://docs.z.ai) pages, re-verified hourly.

## License

[MIT](./LICENSE)
