/**
 * Seed "My Dev Blog" with first-party mini articles about the projects
 * built for/around Z.AI, and ensure the pairing token exists.
 *
 * Run: bun run scripts/seed-blog.ts
 * Idempotent — upserts by slug, safe to re-run. Prints the pairing token
 * ONCE (only when it had to mint a fresh one; env wins if set).
 */
import { db } from "../src/lib/db";
import { getOrCreateBlogToken } from "../src/lib/blog";

type Seed = {
  slug: string;
  title: string;
  excerpt: string;
  tags: string;
  author: string;
  body: string;
};

const SEEDS: Seed[] = [
  {
    slug: "why-this-blog-exists",
    title: "Why this blog exists (and how my agents write it)",
    excerpt:
      "A short intro: what this blog is, what lands here, and the token-gated API that lets any of my agents publish straight to it.",
    tags: "meta, agents, z.ai",
    author: "Rommark",
    body: `I build a lot of small, sharp tools around the **Z.AI** platform — trackers, scanners, agents, an arcade, an API gateway. Most of them live right here on this portal. But the *why* behind each build usually stays in my head or in a commit message nobody reads.

That changes with this blog.

## What lands here

- **Build notes** — the story behind each project: the itch it scratches, the design calls, the lessons.
- **Shipped-thing announcements** — when something new goes live on the portal, a mini article explains it in plain words.
- **Agent-written posts** — my own coding agents can publish here through a small API, so the blog grows at the same pace as the work.

## The publishing trick

There is no CMS and no login form. Articles arrive over a token-gated endpoint: an agent POSTs markdown, the portal validates it, and it goes live. The token is a shared secret between me and my agents — re-pushing the same slug updates the article in place, which makes the blog self-correcting.

Everything you read here is first-party: real things I shipped, described honestly — including the limits.`,
  },
  {
    slug: "glm-bonus-radar-live-tracker",
    title: "GLM Bonus Radar: never miss a Z.AI bonus window again",
    excerpt:
      "The origin project: a live tracker for every Z.AI bonus window, surcharge and discount — computed in your browser, synced from the official docs by an AI every hour.",
    tags: "z.ai, glm, open-source",
    author: "Rommark",
    body: `Z.AI runs time-limited bonus windows — nightly Flash campaigns, peak-hour surcharges, API price promos. The data exists, but it's scattered across doc pages that change without notice. Screenshots go stale; guessing costs tokens.

**GLM Bonus Radar** fixes that. It's the portal you're on right now.

## What it does

- Tracks every known bonus window with **second-accurate countdowns** and a timezone-aware timeline — the "time left until open" number is computed live in your browser, UTC+8 math handled for you.
- An **AI doc-sync job** re-reads the official docs.z.ai pages every hour, extracts a strict JSON payload (windows, pricing, plans, announcements), validates it, and only saves *real* changes. Safety-net pins keep the recurring windows alive even when extraction wobbles.
- A **changelog** journals every sync run — applied changes in full, quiet sweeps as one-liners.
- A **Prometheus-compatible metrics endpoint** exposes window state as numbers, so your infra can decide *when* to fire the heavy agent runs.

## The lesson

The hard part was never the countdowns — it was trusting the data. "Only save real changes" plus a visible journal is what turned a toy dashboard into infrastructure. Same doctrine carried into everything else on this portal.`,
  },
  {
    slug: "z-assist-chat-grounded-in-official-docs",
    title: "Z-Assist: a docs-grounded chat that refuses to hallucinate",
    excerpt:
      "The portal's assistant answers from the official docs.z.ai and zcode.z.ai text only — with a machine-audited anti-hallucination contract, a verification layer and staff-approved self-learning.",
    tags: "z.ai, agents, rag, trust",
    author: "Rommark",
    body: `Support chats that invent pricing tiers are worse than no chat at all. **Z-Assist** — the chat in this portal's header and at /agent — was built around one rule: *answer only from material you can point at*.

## How grounding works

- A curated knowledge base plus **hourly-fetched official docs** (docs.z.ai and all 29 zcode.z.ai wiki pages) form the corpus. The chat and the pages you read share one source of truth.
- An **anti-hallucination contract** is machine-audited: every factual claim — price, date, quota, model name, URL — must come from the corpus, a staff-approved learned answer, or the user's own message.
- A **verification layer** re-checks replies before they ship: URL allowlists, corpus cross-checks, verified-badge gating.
- A **humanizer pass** keeps answers readable — short paragraphs, honest limits, no docs-dump wall of text.

## The parts that make it feel alive

Answers **stream live** with a multi-model fallback ladder, comparisons arrive as tables, and quota math runs as interactive tools you can tweak in the bubble. Accounts are a one-glance token (ZA-…): users come to get help, staff sign in to help users — reviewing conversations and approving learned answers back into the knowledge base.

The honest limit: Z-Assist knows the docs, not your account. When something is account-specific, it says so and links the right official page instead of guessing.`,
  },
  {
    slug: "zscanner-six-scanners-one-url",
    title: "zScanner: six scanners, one URL (or one GitHub repo)",
    excerpt:
      "A free scanner suite — security headers, SEO/GEO, QA reliability, a browser-driving Auto QA auditor, a code reviewer and an anti AI-slop grader — with re-verified findings and fix prompts.",
    tags: "z.ai, devtools, security, geo",
    author: "Rommark",
    body: `Most "website checkers" do one thing and dump a raw wall of findings. **zScanner** (at /scanner) bundles six of them and treats the report as a *work order*, not a verdict.

## The six

1. **Security Audit** — headers, CORS, exposure probes and leaked-secret patterns, with severity and concrete leads.
2. **SEO / GEO / Performance** — titles, structured data, llms.txt, AI-crawler policy, TTFB and linker health.
3. **QA reliability audit** — dead ends, broken promises, the small tells that erode trust.
4. **Auto QA Auditor** — actually drives your app in a real browser and works through flows end-to-end.
5. **Code Reviewer** — heuristic repo review in the Semgrep/Bandit spirit.
6. **Anti AI-Slop Reviewer** — grades how *generated* your design and copy read, with 50+ deterministic tells and an unslop rewrite plan.

## The doctrine

- Findings are **re-verified before reporting** — no drive-by flags.
- Every scan gets a **saveable token**: paste it after your next deploy and see fixed / still-open / new.
- Every report ends with a **copy-paste fix prompt** for your dev agent, because the fixer is usually another AI.

It scans websites or GitHub repos (private ones via an in-memory-only token that never touches the database). Free, no signup.`,
  },
  {
    slug: "zsearch-same-web-different-ranking",
    title: "zSearch: same web, different ranking",
    excerpt:
      "A GEO-first search engine that scores sources on citability — structure, freshness, entity clarity — and shows how results re-order when the reader is an AI assistant.",
    tags: "z.ai, geo, seo, search",
    author: "Rommark",
    body: `SEO optimized for Google. GEO optimizes for the reader that answers *instead* of Google: the AI assistant. **zSearch** (at /search) is a small engine built to make the difference visible.

## What a search shows

- An **AI answer preview** with citation chips — the kind of summary an assistant would produce.
- Every source scored on **citability**: structure, freshness, entity clarity and the four GEO signals.
- A **SEO-vs-GEO toggle** that re-sorts results, so you can see the rank delta between "what ranks for humans" and "what gets cited by machines".

## Why it matters

Generative engines don't reward keyword density — they reward pages an LLM can quote confidently: clean headings, explicit entities, stable facts, machine-readable summaries. Whether you ship docs, a product page or a blog (this one included), the question "can an AI cite me accurately?" is now a traffic question.

zSearch is also a dogfood demo: the portal's own pages are built to score well on it.`,
  },
  {
    slug: "zfun-arcade-no-ads-no-tracking",
    title: "zFun: 30+ games, zero ads, zero tracking",
    excerpt:
      "A browser arcade built as a palette cleanser — snake, breakout, pinball, missile command, slots and friends on one shared cabinet chrome. Pure play, no accounts.",
    tags: "z.ai, games, fun",
    author: "Rommark",
    body: `Every serious project needs a unserious one. **zFun** (at /fun) is the portal's arcade: thirty-plus small games I built one at a time — snake, breakout, pinball, invaders, minesweeper, hangman, slots, a missile command clone, even a whack-a-mole.

## The rules I kept

- **No ads.** The portal's ad inventory went to zero on purpose; an arcade with ads is just a landing page with extra steps.
- **No accounts.** Scores live in your browser. Close the tab, no harm done.
- **One shared cabinet.** Every game runs on the same chrome — pause, sound, touch controls, the arcade-shell look — so adding a game means writing the game, not the boilerplate.

## The unexpected payoff

Building tiny games turned out to be great R&D for the serious tools: the Auto QA auditor's browser driving, the token-based theming sweep, and several interaction patterns in Z-Assist were all rehearsed here first.

Sometimes the best feature work starts as a game.`,
  },
  {
    slug: "endpoint-your-agents-talk-to-z-ai-through-this-portal",
    title: "The Endpoint: point any agent SDK at this portal",
    excerpt:
      "An OpenAI/Anthropic-compatible API gateway with issuable keys — including a special z-assist model id that answers from the same grounded docs brain as the chat.",
    tags: "z.ai, api, agents",
    author: "Rommark",
    body: `Every agent tool I use speaks one of two dialects: OpenAI's chat.completions or Anthropic's messages. So the portal learned both.

**The Endpoint** (at /endpoint) exposes:

- \`POST /api/endpoint/v1/chat/completions\` — OpenAI-style streaming and all.
- \`POST /api/endpoint/v1/messages\` (+ count-tokens) — Anthropic-style.
- \`GET /api/endpoint/v1/models\` — model discovery.

## The interesting model id

Alongside the pass-through models there is **z-assist**: the portal's docs-grounded brain exposed as a model. Point a coding agent or an IDE extension at it and every answer is grounded in the same hourly-synced official docs the chat uses — with the anti-hallucination verification layer attached.

## Keys without ceremony

Keys are issuable from the endpoint dashboard (password-gated), shown once, revocable any time. Usage stats per key keep the accounting honest.

The design goal was boring reliability: same shapes, same headers, same streaming semantics your SDK already expects — the portal just becomes another base URL.`,
  },
  {
    slug: "membox-memory-that-survives-your-agents",
    title: "Membox: memory that survives your agents",
    excerpt:
      "A memory box for AI agents — the missing piece between stateless chat sessions and a real working memory: store, recall and reuse what your agents learn across runs.",
    tags: "z.ai, agents, memory, membox",
    author: "Rommark",
    body: `Agents have a goldfish problem: every session starts from zero. Context windows fill up, sessions end, and the hard-won knowledge — which config worked, which endpoint moved, why that one test is flaky — evaporates.

**Membox** is my take on the missing middle layer: a small, deliberate memory box that agents can write to and read from across runs.

## The shape of it

- **Boxes, not dumps.** Memories are short, labeled entries — a name, the fact, and why it matters — not an endless transcript to re-summarize.
- **Recall beats storage.** The point isn't remembering everything; it's surfacing the right entry at the right moment, so an agent starts a task already knowing the last task's lessons.
- **Boring tech.** The box stays queryable and diffable — memory you can audit beats memory you can't.

## Where it fits with this portal

The same idea runs through Z-Assist's **self-learning**: staff-approved answers re-enter the knowledge base, so the chat gets smarter instead of just older. Membox generalizes that instinct — treat agent knowledge as a first-class artifact, version it, and let every new run inherit it.

*(Building in public: this one lives outside the portal — notes here will grow as it matures.)*`,
  },
];

async function main() {
  // 1. Pairing token — env wins; DB row self-heals to match so both stay valid.
  const envToken = process.env.BLOG_PUSH_TOKEN?.trim();
  const row = await getOrCreateBlogToken();
  if (envToken && row.token !== envToken) {
    await db.blogToken.update({ where: { id: row.id }, data: { token: envToken } });
    console.log("blog token synced to env BLOG_PUSH_TOKEN");
  }

  // 2. Seed articles (upsert by slug — re-running updates in place).
  for (const s of SEEDS) {
    await db.blogPost.upsert({
      where: { slug: s.slug },
      update: { title: s.title, excerpt: s.excerpt, body: s.body, tags: s.tags, author: s.author },
      create: { ...s, source: "seed", published: true },
    });
    console.log("seeded:", s.slug);
  }

  const count = await db.blogPost.count();
  console.log(`done — ${count} posts live`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
