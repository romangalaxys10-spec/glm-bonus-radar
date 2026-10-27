# GLM Bonus Radar

[![Live portal](https://img.shields.io/badge/live-zhelp.space--z.ai-cc3d2e?style=flat-square)](https://zhelp.space-z.ai)
[![GitHub repo](https://img.shields.io/badge/source-github-181717?style=flat-square&logo=github)](https://github.com/romangalaxys10-spec/glm-bonus-radar)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](./LICENSE)

A live portal for everything around the **z.ai** platform: every known bonus window, peak-hour
surcharge and limited-time token discount — tracked with second-accurate countdowns — plus a
grounded AI assistant, a six-in-one site/repo scanner suite, a GEO-first search engine, an
arcade, and an OpenAI/Anthropic-compatible API endpoint. An AI bot re-reads the official docs
every hour, so nothing here goes stale. No screenshots, no guessing when to fire the heavy
agent runs.

## What's inside

### The Radar (homepage)

- **Live bonus windows** — golden nightly Flash campaign, peak-hours surcharge, Flash API −50%
  promo; every event carries a ticking countdown ("time left until open/close") and flips state
  automatically. Timezone-aware timeline with honest per-segment bar math.
- **AI doc-sync** — an hourly job fetches the official `docs.z.ai` pages, asks an LLM to extract a
  strict JSON payload (windows / pricing / plans / announcements), validates + normalizes it and
  only saves real changes. Safety-net pins keep the peak window, the Flash promo and the nightly
  recurrence alive even when the extraction wobbles. ZCode product docs (`zcode.z.ai/en/docs`,
  all 29 pages) are fetched into their own snapshot on the same loop.
- **Always-updating changelog** — `/changelog` journals every sync run (applied changes in full,
  quiet sweeps as one-liners, errors in red) and refreshes itself every minute.
- **Subscribable announcements** — Atom (`/api/announcements`) + RSS (`?format=rss`) feeds with
  per-entry source links and auto-discovery `<link>` tags.
- **Prometheus metrics** — `/api/metrics` exposes `bonus_inference_active`,
  `_transition_seconds` and `_end_timestamp_seconds` per window.

### Z-Assist (`/agent` — also embedded on the homepage and in Telegram)

A chat experience grounded strictly in the official docs — the chat and the pages share one
source of truth.

- **Grounded answers** — curated knowledge base + hourly-fetched `docs.z.ai` and `zcode.z.ai`
  docs; the ZCode desktop ADE (install, Goal Mode, MCP, hooks, automations) is covered
  first-party. Anti-hallucination contract: every factual claim must come from the docs, a
  staff-approved learned answer, or the user's own message — replies are machine-audited.
- **Verification layer** — deterministic post-checks (URL allowlist, corpus cross-check) verify
  answers before they ship; verified replies get a badge.
- **Humanizer + streaming** — replies stream live and read like a knowledgeable human, not a
  docs-dump. Multi-model fallback ladder keeps the chat alive when one model is down.
- **Generative-UI blocks** — comparison tables, bar charts, tickable step lists, action links
  and a live quota calculator rendered right in the chat bubble.
- **Dual-role accounts** — visitors register with a one-glance personal access token
  (`ZA-XXXXXX`); users come to get help, staff sign in to help users: staff mode can review
  conversations, approve learned answers into the knowledge base and see the trust metrics.
  Chats follow the token across devices and self-heal if the database is ever rebuilt.
- **Telegram bot** — pair the portal with a BotFather token and talk to the same grounded
  assistant from Telegram.

### zScanner (`/scanner`)

Six instant scanners with live progress + ETA, for **websites OR GitHub repos** (private repos
via an in-memory-only token):

1. **Security Audit** — headers, CORS, exposure probes, leaked-secret patterns (fable
   sec-scan-style probes, CF-doctrine severity + leads).
2. **SEO / GEO / Performance** — titles, structured data, `llms.txt`, AI-crawler policy, TTFB,
   linker performance and GEO pillars.
3. **QA reliability audit** — dead ends, broken promises, reliability tells.
4. **Auto QA Auditor** — drives the app in a real browser end-to-end and asks/answers its way
   through the flows.
5. **Code Reviewer** — heuristic repo review in the spirit of Semgrep/Bandit and modern
   review-skills.
6. **Anti AI-Slop Reviewer** — grades how "generated" the design & copy read (50+ deterministic
   tells across markup, CSS and wording) with evidence and an unslop rewrite plan.

Findings are **re-verified before reporting**, every scan gets a saveable token — paste it
before your next scan to diff fixed / still-open / new — and every report ends with a
copy-paste fix prompt for your dev agent. Async job queue with progress + ETA. No signup.

### zSearch (`/search`)

A GEO-first search engine: same web, different ranking. AI answer preview with citation chips,
per-source citability scoring (structure · freshness · entity · GEO signals), a SEO-vs-GEO
comparison view, and shareable result URLs (`/search?q=…`).

### zFun (`/fun`)

A browser arcade — 30+ hand-built games (snake, breakout, pinball, missile command, hangman,
slots and friends) on one shared cabinet chrome. Zero ads, zero tracking.

### Endpoint (`/endpoint`)

An OpenAI/Anthropic-compatible API gateway on top of the platform:
`/api/endpoint/v1/chat/completions`, `/v1/messages` (+ count-tokens), `/v1/models` — with
issuable API keys and a special `z-assist` model id that answers from the same grounded docs
brain. Point any existing SDK or agent at it and go.

### My Dev Blog (`/blog`)

First-party mini articles about the projects built for and around Z.AI — the Radar, zScanner,
Z-Assist, zSearch, zFun, the Endpoint and Membox — plus build notes and lessons.

- **Public read, token-gated write**: `GET /api/blog` (list) and `GET /api/blog/<slug>` are open;
  publishing needs a Bearer token.
- **Agent pairing**: `POST /api/blog` with `Authorization: Bearer <token>` and JSON
  `{ title, body (markdown), excerpt?, tags?, author?, slug? }` — re-pushing the same slug
  updates the article in place; `DELETE /api/blog?slug=…` removes one;
  `POST /api/blog {"action":"rotate"}` rotates the pairing token.
- The pairing token lives in `.env` (`BLOG_PUSH_TOKEN`) with a DB fallback row (self-heals
  after a database rebuild). Agent-pushed markdown is rendered by an escape-first renderer —
  no HTML injection path from content to page.

### Dev Control (`POST /api/dev`)

The owner-only remote management endpoint — lets a paired agent update any part of the
project (content, features, code) without shell access to the sandbox.

- **Actions** (POST JSON, `Authorization: Bearer zdev_…`):
  `status` (git + runtime info) · `read {path}` · `list {dir}` · `write {path, content}` ·
  `delete {path}` (files / empty dirs) · `exec {command}` (bash, 120 s cap, captured
  stdout/stderr — install / build / migrate / git) · `rotate` (new pairing token).
- **Path guards**: every path must resolve inside the project root; a denylist protects
  `.env*`, `.git`, `node_modules`, `.next`, `.zscripts/cache` and the live SQLite file.
- **Pairing**: token lives in `.env` (`DEV_PUSH_TOKEN`) with a DB fallback row (`DevToken`,
  self-heals after a database rebuild); `POST /api/dev {"action":"rotate"}` swaps it without
  a deploy.
- **Deploy note**: the sandbox dev server hot-reloads edited `src/` files; the deployed
  zhelp bundle changes only after `exec` runs `bun run build` and a platform Deploy click
  ships the packed artifact.


### Platform-wide

- **Dark-first design** with a full light/white-paper mode toggle (`ModeToggle` in every
  header), semantic CSS-token theming across all surfaces.
- **Notifications** — opt-in browser notifications (golden window / any window /
  announcements) plus Telegram delivery, per-category.
- **PWA** — installable (Chromium native prompt + iOS Add-to-Home-Screen recipe), offline-safe
  service worker that never serves stale radar data.
- Mobile-first layouts everywhere.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Prisma + SQLite ·
z-ai-web-dev-sdk (LLM extraction, chat, vision) · Remotion (embedded media players) ·
deployable behind Caddy or any Node host.

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

- The Telegram bot token is configured at runtime through the portal's notification panel
  (stored in the DB, never in code). The LLM features use `z-ai-web-dev-sdk` defaults.
- The SQLite database file (`db/custom.db`) is **gitignored on purpose**: it holds user access
  tokens, chat transcripts and bot credentials. Never commit it. The schema
  (`prisma/schema.prisma`) is the source of truth — `npx prisma db push` recreates a fresh
  database anywhere, and Z-Assist accounts self-heal (users re-register, learned answers can be
  re-approved by staff).

Production:

```bash
npm run build && npm start
```

## Project map

```
src/app/                    portal pages: home, /agent (Z-Assist), /scanner, /search, /fun,
                            /endpoint, /changelog + API routes (sync, metrics, feed, agent chat/
                            session/register/staff/conversations, assist, telegram, endpoint,
                            scanner jobs, notify)
src/components/portal/      windows/timeline, pricing, plans, chat shell + messages + blocks,
                            scanner app, notifications, mode toggle, PWA prompt
src/components/zfun/        arcade engine + 30+ games
src/lib/windows.ts          SGT window engine (fixed UTC+8 math, recurring + bounded events)
src/lib/docs-sync.ts        hourly AI sync: fetch docs -> LLM extract -> validate -> diff -> journal
src/lib/zcode-docs.ts       ZCode wiki fetcher/normalizer (29 pages)
src/lib/assist-core.ts      Z-Assist system prompt + generative-UI block instructions
src/lib/assist-knowledge.ts curated official-docs knowledge base
src/lib/assist-verify.ts    anti-hallucination verification layer (URL allowlist, corpus checks)
src/lib/assist-humanize.ts  humanizer pass for chat replies
src/lib/assist-learn.ts     self-learning: staff-approved answers re-enter the knowledge base
src/lib/assist-users.ts     ZA- token accounts (dual-role users/staff)
src/lib/chat-stream.ts      streaming reply plumbing + multi-model fallback ladder
src/lib/scanner/*           the six scanners: fetcher, geoseo, security, qa, autoqa (browser),
                            code-review, slop (design/copy heuristics), jobs queue, verify
src/lib/geosearch.ts        zSearch GEO scoring + ranking
src/lib/endpoint.ts         OpenAI/Anthropic-compatible gateway logic
src/lib/zfun.ts             arcade state/score plumbing
src/lib/dynamic-data.ts     client store polling AI-synced data (announcements diffing, seen-set)
prisma/schema.prisma        SiteData, SyncRun journal, TelegramChat, ZAssistBot, AssistUser,
                            AssistConversation, AssistFeedback, AssistLearnEntry, EndpointKey,
                            ScanSnapshot
```

## Credits

Developed by **[Rommark.Dev](https://rommark.dev)** ·
[Telegram](https://t.me/VibeCodePrompterSystem) ·
[LinkedIn](https://www.linkedin.com/in/rоman-m-793b3310)

Unofficial community portal — not affiliated with Z.ai. Data comes from the official
[docs.z.ai](https://docs.z.ai) and [zcode.z.ai](https://zcode.z.ai/en/docs) pages, re-verified
hourly.

## License

[MIT](./LICENSE)
