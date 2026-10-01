/**
 * Z-Assist knowledge base — curated excerpts from the official z.ai documentation.
 * Sources (fetched from docs.z.ai, all times Asia/Singapore UTC+8 unless noted):
 *  - https://docs.z.ai/guides/overview/quick-start
 *  - https://docs.z.ai/devpack/quick-start
 *  - https://docs.z.ai/devpack/overview
 *  - https://docs.z.ai/devpack/notice/usage-revision
 *  - https://docs.z.ai/devpack/notice/event-glm-5.3-flash
 *  - https://docs.z.ai/guides/overview/pricing
 *  - https://docs.z.ai/devpack/credit-campaign-rules  (invite campaign)
 *  - https://docs.z.ai/devpack/faq
 *  - https://docs.z.ai/devpack/notice/usage-revision  (legacy plans)
 */

export const KNOWLEDGE_UPDATED = "2026-09-09";

export const KNOWLEDGE = `
=== OFFICIAL Z.AI KNOWLEDGE BASE (curated from docs.z.ai, updated ${KNOWLEDGE_UPDATED}) ===

--- 1. GETTING STARTED (Platform quick start) ---
- Get an API key: 1) Register/Login at https://z.ai/model-api (Z.AI Open Platform). 2) Top up at the Billing page https://z.ai/manage-apikey/billing if needed. 3) Create a key at https://z.ai/manage-apikey/apikey-list. 4) Copy and keep it secret (never hard-code it).
- Flagship models: GLM-5.3 (latest flagship, strongest software engineering + agent capabilities), GLM-5.3-Flash (multimodal coding model, visual programming), GLM-Image (text-to-image, open-source SOTA in complex scenarios), CogVideoX-3 (video generation with improved frame stability/clarity).
- Calling methods: HTTP REST API, official Python SDK (pip install zai-sdk), official Java SDK (ai.z.openapi:zai-sdk:0.3.5), OpenAI Python/Node/Java SDKs (base_url https://api.z.ai/api/paas/v4/), or the API Reference at https://docs.z.ai/api-reference.
- Standard API endpoint: POST https://api.z.ai/api/paas/v4/chat/completions with header "Authorization: Bearer YOUR_API_KEY". Python: from zai import ZaiClient; client = ZaiClient(api_key="YOUR_API_KEY").
- OpenAI SDK migration: set base_url to https://api.z.ai/api/paas/v4/ and use model "glm-5.3".

--- 2. GLM CODING PLAN (devpack quick start) ---
- Subscribe at https://z.ai/subscribe. Steps: register/login -> subscribe to GLM Coding Plan -> obtain API key -> connect a coding tool -> start coding.
- Individual plan users create an API key under Individual Coding Plan > Plan Overview (https://z.ai/manage-apikey/apikey-list). Team plan members get their key under Team Coding Plan > My Plan; the Team key is NOT interchangeable with other Z.AI API keys.
- Supported tools (plan is STRICTLY limited to these): Claude Code, Roo Code, Kilo Code, Cline, OpenCode, OpenClaw, Crush, Goose, Cursor, and a few others listed at https://docs.z.ai/devpack/tool/others. All supported tools share the same subscription quota.
- Coding-plan endpoints (Base URLs):
  * Anthropic Messages protocol: https://api.z.ai/api/anthropic  (used by Claude Code and Goose)
  * OpenAI Chat Completions protocol: https://api.z.ai/api/coding/paas/v4  (most other tools)
  * OpenAI Responses protocol: https://api.z.ai/api/v1
- All plans support GLM-5.3 and GLM-5.3-Flash. Requests for GLM-5.2/GLM-5.1 are auto-routed to GLM-5.3; GLM-4.7 requests are auto-routed to GLM-5.3-Flash.
- Exclusive MCP servers included in ALL plans: Vision Understanding (GLM-4.6V; analyze UI mockups -> code, understand flowcharts/architecture diagrams, extract text from screenshots), Web Search (latest tech docs/API changes), Web Reader (fetch full webpage content, structured data), and Zread.
- Advanced usage scenarios: natural language programming, intelligent code completion, debugging & repair, codebase Q&A, automated task handling (fix lint, resolve merge conflicts, generate release notes).

--- 3. CODING PLAN TIERS & CREDITS (devpack overview) ---
New credits-based plans (since July 30, 2026; previous plans no longer sold to new users):
| Plan | 5-hour credits | Weekly credits |
| Lite | 2,000 | 10,000 |
| Pro  | 12,000 | 60,000 |
| Max  | 28,000 | 140,000 |
- 5-hour credits: dynamically refreshed; quota resets 5 hours after consumption. Weekly credits: start at subscription, reset every 7 days.
- Credit formula: model credit usage = (input tokens x input multiplier + cached input tokens x cached input multiplier + output tokens x output multiplier) / 10,000. MCP tool credit usage = number of calls x output multiplier.
- Multipliers: GLM-5.3 -> input 6.9, cached input 1.7, output 24. GLM-5.3-Flash (incl. Vision MCP) -> input 2.3, cached input 0.56, output 8. MCP servers (Web Search, Web Reader, Zread) -> output multiplier 1.2.
- OFF-PEAK DISCOUNT: during off-peak hours model usage is charged at 50% of the standard credit rate (i.e., 0.5x). Peak hours: Monday to Friday, 14:00-18:00 Singapore time (UTC+8). Weekends are off-peak ALL DAY.
- Off-peak savings: fully using off-peak discounts saves up to 92% vs pay-as-you-go GLM-5.3 standard API calls.
- Estimated weekly token allowance by cache hit rate (examples, GLM-5.3): Lite 48-97M, Pro 290-580M, Max 676-1,352M tokens/week at 95% cache hit; higher cache hit rate -> more tokens. Minimum assumes all-peak usage (1x rate), maximum assumes all-off-peak (0.5x rate).
- View token consumption per pricing type and tool calls at https://z.ai/manage-apikey/billing (Charge Type page).

--- 4. LEGACY PLANS (pre-July-30 subscribers) ---
- Legacy V1/V2 and Team plans keep their price/benefits/limits until the end of the current billing cycle. Plans are never switched automatically.
- Legacy V2 quotas (per prompt ~= 15-20 model invocations; monthly quota ~= 15-30x the subscription fee):
  Lite: ~80 prompts / 5h, ~400 prompts / week. Pro: ~400 / 5h, ~2,000 / week. Max: ~1,600 / 5h, ~8,000 / week.
- Legacy multipliers: GLM-5.3 = 1x off-peak / 3x peak; GLM-5.3-Flash = 0.4x off-peak / 1.2x peak. Peak = Mon-Fri 14:00-18:00 UTC+8.
- Legacy V2 users can upgrade immediately to a HIGHER tier of the new credits-based plan; same-tier switch or downgrade requires waiting for expiry. Legacy V1/Team must wait for expiry. 50% Migration Support discount (from April 30 notice) remains valid through its original period and works for the new credits plan.

--- 5. GLM-5.3-FLASH USAGE CAMPAIGN (event) ---
- Campaign period: September 3, 2026 - September 20, 2026. All paid plan users, no manual activation, applies automatically.
- Daily window 23:00 -> 09:00 next day (Singapore time UTC+8), including weekends and holidays:
  * Via ZCode: ZERO quota consumption -> unlimited GLM-5.3-Flash usage.
  * Via other supported agents: available quota is DOUBLED (2x) versus your plan's standard rules.
- Applies ONLY to GLM-5.3-Flash. GLM-5.3 still consumes quota at standard rules during the window.

--- 6. API PRICING (per 1M tokens, USD; guides/overview/pricing) ---
Latest models (limited-time 50% promo on Flash ends 24:00 September 9, 2026 UTC+8):
- GLM-5.3-Flash: input $0.075 (was $0.15), cached input $0.015 (was $0.03), output $0.25 (was $0.50); cached input storage limited-time free.
- GLM-5.3: input $1.4, cached input $0.26, output $4.4. GLM-5.2: same as 5.3.
Text models: GLM-5.1 $1.4/$4.4; GLM-5 $1/$3.2; GLM-4.7 & GLM-4.6 & GLM-4.5 $0.6/$2.2; GLM-4.5-X $2.2/$8.9; GLM-4.5-Air $0.2/$1.1; GLM-4.5-AirX $1.1/$4.5; GLM-4.7-FlashX $0.07/$0.4; GLM-4-32B-0414-128K $0.1/$0.1; GLM-4.7-Flash FREE; GLM-4.5-Flash FREE.
Vision: GLM-4.6V $0.3/$0.9; GLM-OCR $0.03/$0.03; GLM-4.6V-FlashX $0.04/$0.4; GLM-4.5V $0.6/$1.8; GLM-4.6V-Flash FREE.
Built-in tool: Web Search $0.01/use. Image: GLM-Image $0.015/image, CogView-4 $0.01/image. Video: CogVideoX-3 $0.2/video. Audio: GLM-ASR-2512 $0.03/MTok (~$0.0024/min). Agents: GLM Slide/Poster Agent (beta) $0.7/MTok; General-Purpose Translation $3/MTok; Popular Special Effects Video Templates $0.2/video.

--- 7. INVITE CAMPAIGN ("Invite Friends, Get Credits") ---
- Invited friends get a 10% INSTANT DISCOUNT on their FIRST GLM Coding subscription order when they register via a unique invitation link or code. Our community invite link: https://z.ai/subscribe?ic=R0K78RJKNW (invite code R0K78RJKNW).
- Eligibility for the 10% discount: newly registered users, or existing users who have NEVER had a paid subscription. Once per user (per mobile/email). Applies only to the initial subscription order; renewals/upgrades/downgrades are NOT eligible. Cannot stack with other first-order discount campaigns. Stripe minimum: final payable after all discounts/credits must be >= $0.50, else discount may be adjusted.
- Inviter rewards: for each valid friend, 10% of the friend's first-order Actual Payment Amount as Credits. Payout begins once 3 valid invites are reached (first 3 disbursed lump-sum, then immediate per friend). Every cumulative 30 valid friends -> one-time extra 10% of those 30 friends' total actual payments. No upper limit.
- Valid invitation = friend registers via your link/code + is a new paying user + completes first GLM Coding subscription payment within 72 hours + order not refunded within 24 hours. Last valid touchpoint gets the reward.
- Credits: non-cash benefits; usable to offset GLM Coding subscriptions, resource/feature packs, and API call fees. Non-refundable, non-transferable, non-withdrawable. Issued within 24-48h after payment confirmation & review (contact support if >72h). View in the Invite pop-up "Your Credit Rewards" or Billing > Transaction History.

--- 8. SUBSCRIPTION MANAGEMENT & FAQ ---
- Models included in the Coding Plan: GLM-5.3 + GLM-5.3-Flash only (see auto-routing above).
- Quota exhausted? GLM calls in supported tools use ONLY Coding Plan quota; the system will NOT deduct account balance. Wait for the next 5-hour cycle refresh. Plan users cannot make plan API calls outside supported tools.
- Payment deduction order for subscriptions: 1) credits balance, 2) cash balance, 3) linked payment method (card/PayPal). Small card minimum may round the deduction up.
- Cancel: on the subscription management page, at least 24 hours before the next billing date to avoid auto-renewal; plan stays valid until expiry.
- Refunds: subscriptions are non-refundable once purchased, even if unused.
- Upgrades: same-tier upgrade (e.g. Lite monthly -> Lite annual) takes effect AFTER current plan expires (validity cumulative; Lite monthly -> Lite annual = 13 months total). Cross-tier upgrade takes effect immediately; remaining value of the original plan is pro-rated into account balance to offset the price difference.
- Billing cycle change: select the plan on the subscription page; it takes effect after the current billing cycle ends.
- Error "1113 Insufficient Balance" after buying the coding package? Usually the coding-plan conditions are not met: (1) not using an officially supported tool, (2) wrong base URL (Claude Code/Goose -> https://api.z.ai/api/anthropic; others -> https://api.z.ai/api/coding/paas/v4), (3) calling models other than GLM-5.3 / GLM-5.3-Flash.
- Where to check usage: https://z.ai/manage-apikey/subscription (Usage Statistics) and https://z.ai/manage-apikey/billing (Charge Type).

--- 9. KEY OFFICIAL LINKS ---
- Docs hub index: https://docs.z.ai/llms.txt | API reference: https://docs.z.ai/api-reference
- Quick start (platform): https://docs.z.ai/guides/overview/quick-start | Coding plan quick start: https://docs.z.ai/devpack/quick-start
- Coding plan overview: https://docs.z.ai/devpack/overview | FAQ: https://docs.z.ai/devpack/faq
- Pricing: https://docs.z.ai/guides/overview/pricing
- Usage revision notice: https://docs.z.ai/devpack/notice/usage-revision
- Flash campaign notice: https://docs.z.ai/devpack/notice/event-glm-5.3-flash
- Invite campaign rules: https://docs.z.ai/devpack/credit-campaign-rules
- Subscribe (with our 10% OFF invite code): https://z.ai/subscribe?ic=R0K78RJKNW
=== END KNOWLEDGE BASE ===
`;

export const SUGGESTED_QUESTIONS = [
  "When are off-peak hours and how much do I save?",
  "How does the 10% OFF invite code work?",
  "What's included in the GLM-5.3-Flash campaign?",
  "How do the new credits-based plans work?",
  "Which coding tools are supported?",
  "How do I get an API key and make my first call?",
];
