import type { Metadata } from "next";
import { AgentAdStage } from "@/components/portal/agent-ad-remotion";
import { GitHubMark } from "@/components/portal/scanner-icons";
import { INVITE_CODE, INVITE_URL } from "@/lib/invite";

export const metadata: Metadata = {
  title: "24x7 Agent — an always-on AI computer, from $5.75/mo · Powered by xShredo",
  description:
    "A KVM server built for one job: running your AI agents around the clock. 79 AI stacks pre-installed — Ollama + Open WebUI, ComfyUI, n8n, LibreChat, OpenHands, Qdrant, Whisper, Jupyter — live in 5–10 minutes with full root, 2 TB traffic, DDoS protection and 2N power in Tampa, FL (US-East). Powered by xShredo.",
  alternates: { canonical: "/agent" },
  openGraph: {
    title: "24x7 Agent — an always-on AI computer, from $5.75/mo",
    description:
      "79 AI stacks pre-installed, live in about 10 minutes, full root on your own KVM box. No queues, no per-seat fees, no weekend setup. Powered by xShredo.",
    type: "website",
  },
};

/* ------------------------------------------------------------------ */
/* Offer data — mirrors the xShredo AI VPS promo (xshredo.com/promo)    */
/* ------------------------------------------------------------------ */

const PROMO_BASE = "https://xshredo.com/promo/ai-vps";

/** UTM-tagged promo URL so the partner can attribute portal referrals. */
function promo(utmContent: string) {
  return `${PROMO_BASE}?utm_source=zhelp.space-z.ai&utm_medium=portal-page&utm_campaign=24x7-agent&utm_content=${utmContent}`;
}

const STACK_CATEGORIES: Array<[string, number]> = [
  ["vector dbs", 15],
  ["agents", 14],
  ["chat uis", 11],
  ["voice", 10],
  ["llm serving", 8],
  ["rag", 8],
  ["image & vision", 6],
  ["dev & notebooks", 4],
  ["evals & ops", 3],
];

const FEATURED_STACKS = [
  {
    cat: "llm serving",
    name: "Ollama + Open WebUI",
    d: "The classic local-LLM pair: pull any model, chat from any browser. Your private ChatGPT.",
    slug: "ollama-open-webui",
  },
  {
    cat: "image & vision",
    name: "ComfyUI",
    d: "Node-based Stable Diffusion pipelines on your own box. No queues, no content filters.",
    slug: "comfyui",
  },
  {
    cat: "agents & automation",
    name: "n8n",
    d: "Self-hosted workflow automation with AI nodes — wire your stack together without SaaS fees.",
    slug: "n8n",
  },
  {
    cat: "chat uis",
    name: "LibreChat",
    d: "Multi-model chat UI wired to your API keys. Private by default.",
    slug: "librechat",
  },
  {
    cat: "coding agents",
    name: "OpenHands",
    d: "The open coding agent — a full dev environment where your repos keep your rules.",
    slug: "openhands",
  },
  {
    cat: "vector dbs",
    name: "Qdrant",
    d: "The vector database your RAG stack deserves — private, fast, yours.",
    slug: "qdrant",
  },
  {
    cat: "voice & speech",
    name: "Whisper",
    d: "Batch-transcribe audio on dedicated cores. Your audio never leaves your box.",
    slug: "whisper",
  },
  {
    cat: "dev & notebooks",
    name: "Jupyter PyTorch",
    d: "PyTorch notebooks on dedicated cores — train and experiment without Colab limits.",
    slug: "jupyter-pytorch",
  },
];

const TUESDAY = [
  { stack: "Whisper", task: "overnight batch", result: "42 meetings · no issues" },
  { stack: "ComfyUI", task: "render queue", result: "312 images · 02:14 AM" },
  { stack: "n8n", task: "inbox triage", result: "ran 9:14 AM · no issues" },
  { stack: "LibreChat", task: "team usage", result: "28 chats today" },
  { stack: "Qdrant", task: "doc sync", result: "1,204 vectors upserted" },
  { stack: "OpenHands", task: "refactor task", result: "PR opened · awaiting you" },
];

const COMPARE: Array<[string, string, string, string]> = [
  ["What it is", "Someone else's server, their rules", "A blank box you configure", "A purpose-built AI server"],
  ["Price", "$20–$200/mo, per seat", "$5–$80/mo + your weekend", "from $5.75/mo, everything in"],
  ["Setup", "Instant — but locked down", "A weekend in the terminal", "5–10 minutes, pre-built image"],
  ["Privacy", "Your data, their roadmap", "Yours — if you harden it", "Yours: full root, no telemetry"],
  ["Limits", "Rate limits, queues, filters", "You manage everything", "16 vCPU · 64 GB · 1 TB ceiling"],
  ["Runs while you sleep", "If you keep paying", "If you set it up", "Yes — 2N power, our racks"],
];

const FAQ = [
  {
    q: "Do these plans include a GPU?",
    a: "No — every stack is CPU-first and priced accordingly (from $5.75/mo). CPU inference handles quantized LLMs, Whisper-class speech and image models at useful speeds. If you outgrow it, the same box upgrades to 16 vCPU / 64 GB without a reinstall.",
  },
  {
    q: "How fast is “live in 10 minutes”?",
    a: "The stack is pre-installed on the image. Pick your size, deploy from the portal, and you are SSHing into a working installation in about 5–10 minutes. Full root from the first boot.",
  },
  {
    q: "Is my data private?",
    a: "It is your own KVM virtual machine with full root. Models, chats, vectors and logs stay on your box — no shared inference, no telemetry, no content filters, no training on your data.",
  },
  {
    q: "Where do the servers live?",
    a: "Tampa, Florida (US-East) — our own racks on ARPHost infrastructure: 2N power, redundant 10 Gbps Tier-1 uplinks and DDoS protection included.",
  },
  {
    q: "Can I run more than one stack?",
    a: "Each VPS ships one pre-configured stack, but with full root you can run additional tools alongside it — storage scales to 1 TB of replicated Ceph NVMe.",
  },
  {
    q: "What happens if I outgrow my plan?",
    a: "Resize in place — up to 16 vCPU, 64 GB RAM and 1 TB NVMe — without reinstalling your stack or moving your data.",
  },
];

const AGENT_NAV = [
  { href: "/", label: "← radar" },
  { href: "/scanner", label: "scanner" },
];

const EXTERNAL = { target: "_blank", rel: "sponsored noopener" } as const;

function SectionHeader({ eyebrow, title, blurb }: { eyebrow: string; title: string; blurb: string }) {
  return (
    <div className="mb-6 max-w-3xl">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rc-accent)]">{eyebrow}</p>
      <h2 className="mt-1.5 font-display text-2xl font-light tracking-[-0.01em] text-[var(--rc-bright)] md:text-3xl">{title}</h2>
      <p className="mt-2 text-[15px] text-[var(--rc-text-dim)]">{blurb}</p>
    </div>
  );
}

/** Primary accent CTA — reused by hero, pricing and the closing band. */
function DeployCta({ utmContent, big }: { utmContent: string; big?: boolean }) {
  return (
    <a
      href={promo(utmContent)}
      {...EXTERNAL}
      aria-label="Deploy your AI VPS from $5.75 per month on xShredo"
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-[var(--rc-accent)] font-mono font-bold text-[var(--rc-on-accent)] shadow-[0_4px_18px_-4px_color-mix(in_srgb,var(--rc-accent)_70%,transparent)] outline-none transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_9px_28px_-6px_color-mix(in_srgb,var(--rc-accent)_80%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--rc-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--rc-bg)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        big ? "px-7 py-3 text-[14px]" : "px-5 py-2.5 text-[13px]"
      }`}
    >
      deploy from $5.75/mo
      <span aria-hidden className="transition-transform duration-200 motion-reduce:transition-none">
        →
      </span>
    </a>
  );
}

export default function AgentPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Top invite banner — same strip as every portal page */}
      <a
        href={INVITE_URL}
        target="_blank"
        rel="noopener"
        className="block bg-[var(--rc-accent)] px-4 py-2 text-center text-[13px] font-semibold text-[var(--rc-on-accent)] transition-opacity hover:opacity-90"
      >
        <span className="font-mono">10% OFF</span> your first GLM Coding subscription — invite token{" "}
        <span className="font-mono underline decoration-dotted underline-offset-2">{INVITE_CODE}</span> · claim here →
      </a>

      {/* Sticky header */}
      <header className="sticky top-0 z-50 border-b border-[var(--rc-border)] bg-[color-mix(in_srgb,var(--rc-bg)_86%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-8">
          <a href="/agent" className="font-display text-lg font-semibold italic tracking-tight text-gradient">
            24x7 Agent
          </a>
          <nav aria-label="Sections" className="order-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] md:order-2">
            {AGENT_NAV.map((n) => (
              <a key={n.href} href={n.href} className="text-[var(--rc-text-dim)] transition-colors hover:text-[var(--rc-accent)]">
                {n.label}
              </a>
            ))}
            <a
              href="https://github.com/romangalaxys10-spec/glm-bonus-radar"
              target="_blank"
              rel="noopener"
              aria-label="Source on GitHub"
              title="Source on GitHub"
              className="flex items-center gap-1 text-[var(--rc-text-dim)] transition-colors hover:text-[var(--rc-accent)]"
            >
              <GitHubMark className="h-3.5 w-3.5" />
              github
            </a>
          </nav>
          <div className="order-2 md:order-3" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-24 pt-12 md:px-8">
        {/* ---------------------------------------------------------- */}
        {/* Hero                                                        */}
        {/* ---------------------------------------------------------- */}
        <section aria-label="Offer" className="pb-12">
          <p className="inline-flex items-center gap-2 rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rc-text-dim)]">
            <span aria-hidden className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--rc-accent)] opacity-75 motion-reduce:hidden" />
              <span aria-hidden className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--rc-accent)]" />
            </span>
            ai vps · tampa, fl · us-east
          </p>
          <h1 className="mt-4 max-w-3xl font-display text-4xl font-light leading-[1.06] tracking-[-0.02em] text-[var(--rc-bright)] md:text-6xl">
            An AI Agent computer <em className="italic text-[var(--rc-text-dim)]">that never sleeps</em>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-[var(--rc-text-dim)]">
            79 AI stacks pre-installed. Live in about 10 minutes. Full root on your own KVM box — no queues, no
            per-seat fees, no weekend setup. Your agents keep working while you don&apos;t.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <DeployCta utmContent="hero" big />
            <a
              href={promo("hero-ai-pick")}
              {...EXTERNAL}
              className="inline-flex items-center justify-center rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] px-5 py-2.5 font-mono text-[13px] font-semibold text-[var(--rc-text)] transition-colors hover:border-[var(--rc-accent)] hover:text-[var(--rc-accent)]"
            >
              not sure? let AI pick my stack
            </a>
          </div>
          <p className="mt-4 font-mono text-[12px] text-[var(--rc-text-dim)]">
            from $5.75/mo · cancel anytime · 2 TB traffic included · Tampa, FL (US-East)
          </p>

          {/* Stats strip */}
          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["79", "AI stacks pre-installed"],
              ["~10 min", "from deploy to SSH"],
              ["1–16 vCPU", "1–64 GB · resize in place"],
              ["2 TB", "traffic · DDoS protection"],
            ].map(([v, k]) => (
              <div key={k} className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] px-4 py-3">
                <p className="font-display text-xl font-bold tracking-tight text-[var(--rc-text)] md:text-2xl">{v}</p>
                <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--rc-text-dim)]">{k}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Immersive Remotion simulation ad                            */}
        {/* ---------------------------------------------------------- */}
        <section aria-label="Simulation: a day on the 24x7 Agent box" className="scroll-mt-24 pb-14">
          <SectionHeader
            eyebrow="immersive simulation"
            title="Watch a box run for a day"
            blurb="A 16-second simulated walkthrough — the 02:00 laptop death, the one-command deploy, and the dashboard that never sleeps. Rendered in-app with Remotion; every number matches the sponsor's promo."
          />
          <div className="max-w-4xl">
            <AgentAdStage />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <DeployCta utmContent="remotion-ad" />
            <p className="font-mono text-[12px] text-[var(--rc-text-dim)]">
              simulated ad · real specs from the sponsor&apos;s promo page · powered by xShredo
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Pain points                                                 */}
        {/* ---------------------------------------------------------- */}
        <section aria-label="Why the usual options run out" className="scroll-mt-24 pb-14">
          <SectionHeader
            eyebrow="the problem"
            title="The free lunch always runs out"
            blurb="Every “easy” way to run AI around the clock gives the compute back right when your agent needs it most."
          />
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                id: "01",
                t: "Colab cuts you off mid-run",
                d: "Sessions expire. GPUs waitlist. Limits tighten. Your overnight training job is somebody else's scheduling problem.",
              },
              {
                id: "02",
                t: "SaaS AI bills per seat — and reads your data",
                d: "Rate limits, content filters, someone else's roadmap. Every seat is a meter running, and the logs live on their servers.",
              },
              {
                id: "03",
                t: "A DIY cloud VM is a weekend in the terminal",
                d: "Dockerfiles, drivers, firewalls — before the fun part. Then you get to keep it all patched, forever.",
              },
            ].map((c) => (
              <div key={c.id} className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5">
                <p className="font-mono text-[11px] text-[var(--rc-accent)]">{c.id}</p>
                <h3 className="mt-1 font-display text-lg font-semibold tracking-tight">{c.t}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--rc-text-dim)]">{c.d}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-[color-mix(in_srgb,var(--rc-accent)_45%,var(--rc-border))] bg-[color-mix(in_srgb,var(--rc-accent)_7%,var(--rc-surface))] p-5 md:p-6">
            <p className="font-display text-lg font-semibold tracking-tight text-[var(--rc-text)] md:text-xl">
              This is the purpose-built answer.
            </p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--rc-text-dim)]">
              A server made for one job: running your AI stack — pre-built, pre-secured, always on.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Pillars                                                     */}
        {/* ---------------------------------------------------------- */}
        <section aria-label="Why this box works" className="scroll-mt-24 pb-14">
          <SectionHeader
            eyebrow="the machine"
            title="Full root on a box that just works"
            blurb="Not a shared notebook, not a locked SaaS tenant — a KVM virtual machine of your own, imaged by people who run AI stacks for a living."
          />
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                id: "pick · deploy · done",
                t: "Working app in 5–10 minutes",
                d: "Choose from 79 pre-built stacks — the image already has everything installed and wired. You SSH into a running app, not debug apt at 1 AM.",
              },
              {
                id: "full root · full privacy",
                t: "Your KVM, your rules",
                d: "Pull any model, change any config, install anything. Models, chats and vectors stay on your box — no shared inference, no content filters.",
              },
              {
                id: "scale in place",
                t: "Grow without reinstalling",
                d: "Start small at 1 vCPU / 1 GB. Resize in place up to 16 vCPU / 64 GB and 1 TB of replicated Ceph NVMe — stack and data stay exactly where they are.",
              },
            ].map((c) => (
              <div key={c.id} className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--rc-accent)]">{c.id}</p>
                <h3 className="mt-1 font-display text-lg font-semibold tracking-tight">{c.t}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--rc-text-dim)]">{c.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Stack catalog                                               */}
        {/* ---------------------------------------------------------- */}
        <section aria-label="Stack catalog" className="scroll-mt-24 pb-14">
          <SectionHeader
            eyebrow="79 stacks · tap to deploy"
            title="Pick the job, not the plumbing"
            blurb="One image per stack, maintained for you. Every plan is the same machine: 1–16 vCPU, 1–64 GB RAM, 50 GB–1 TB NVMe, 2 TB traffic."
          />
          <div className="mb-5 flex flex-wrap gap-2">
            {STACK_CATEGORIES.map(([label, n]) => (
              <span
                key={label}
                className="rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] px-3 py-1 font-mono text-[11px] text-[var(--rc-text-dim)]"
              >
                {label} · {n}
              </span>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {FEATURED_STACKS.map((s) => (
              <div
                key={s.slug}
                className="flex flex-col rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-5"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--rc-text-dim)]">{s.cat}</p>
                <h3 className="mt-1 font-display text-lg font-semibold tracking-tight">{s.name}</h3>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-[var(--rc-text-dim)]">{s.d}</p>
                <a
                  href={promo(`stack-${s.slug}`)}
                  {...EXTERNAL}
                  className="mt-4 inline-flex items-center gap-1.5 self-start font-mono text-[12px] font-bold text-[var(--rc-accent)] underline-offset-4 transition-colors hover:underline"
                >
                  deploy this stack
                  <span aria-hidden className="transition-transform duration-200 motion-reduce:transition-none">
                    →
                  </span>
                </a>
              </div>
            ))}
          </div>
          <p className="mt-5">
            <a
              href={promo("browse-stacks")}
              {...EXTERNAL}
              className="font-mono text-[13px] font-semibold text-[var(--rc-accent)] underline decoration-dotted underline-offset-4"
            >
              browse all 79 stacks ↗
            </a>
          </p>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Terminal demo                                               */}
        {/* ---------------------------------------------------------- */}
        <section aria-label="Deploy in one command" className="scroll-mt-24 pb-14">
          <SectionHeader
            eyebrow="one command"
            title="Ditch the weekend setup"
            blurb="One command in the portal — the stack, the service and the firewall rule come back done."
          />
          <div
            role="img"
            aria-label="Terminal transcript: deploying the Ollama + Open WebUI stack and going live in 7 minutes 42 seconds"
            className="max-w-2xl overflow-hidden rounded-2xl border border-[#2c3326] bg-[#0c110d] shadow-[0_18px_50px_-24px_rgba(0,0,0,0.55)]"
          >
            <div className="flex items-center gap-1.5 border-b border-[#232a22] px-4 py-2.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-[#e8533a]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#a8822d]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#5d7a52]" />
              <span className="ml-3 font-mono text-[11px] text-[#7e8a7e]">root@portal — 80×24</span>
            </div>
            <pre className="overflow-x-auto px-5 py-4 font-mono text-[12.5px] leading-[1.75] text-[#cfdccf] md:text-[13px]">
              <span className="text-[#eef4ee]">$ xshredo deploy ollama-open-webui --size m</span>
              {"\n"}
              <span className="text-[#7e8a7e]">→ provisioning KVM VM in TPA01 … done (42s)</span>
              {"\n"}
              <span className="text-[#7e8a7e]">→ mounting 200 GB ceph-nvme … done (3s)</span>
              {"\n"}
              <span className="text-[#7e8a7e]">→ installing ollama · open-webui … pre-built</span>
              {"\n"}
              <span className="text-[#7e8a7e]">→ opening firewall 11434/3000 … done (1s)</span>
              {"\n"}
              <span className="text-[#8fd694]">✓ live in 7m 42s — http://10.0.0.14:3000</span>
              {"\n\n"}
              <span className="text-[#eef4ee]">$ ssh root@your-box</span>
              {"\n"}
              <span className="text-[#7e8a7e]"># full root from the first boot</span>
            </pre>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Always-on Tuesday                                           */}
        {/* ---------------------------------------------------------- */}
        <section aria-label="A Tuesday on the box" className="scroll-mt-24 pb-14">
          <SectionHeader
            eyebrow="always on · always working"
            title="Your agents do not sleep — neither does the box"
            blurb="No idle logout, no expired session, no cold start at 3 AM. Here is what one ordinary Tuesday looks like on a 24x7 Agent box."
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {TUESDAY.map((t) => (
              <div key={t.stack} className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-[15px] font-semibold tracking-tight">{t.stack}</h3>
                  <p className="font-mono text-[11px] text-[var(--rc-text-dim)]">{t.task}</p>
                </div>
                <p className="mt-2.5 flex items-center gap-2 font-mono text-[12px] text-[var(--rc-text)]">
                  <span aria-hidden className="relative flex h-1.5 w-1.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4e9a58] opacity-60 motion-reduce:hidden" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#4e9a58]" />
                  </span>
                  {t.result}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Comparison                                                  */}
        {/* ---------------------------------------------------------- */}
        <section aria-label="Compare the options" className="scroll-mt-24 pb-14">
          <SectionHeader
            eyebrow="same money · different outcome"
            title="What $5–$20 a month buys"
            blurb="The same budget goes three very different directions — and only one of them keeps your agents running overnight."
          />
          <div className="overflow-x-auto rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)]">
            <table className="w-full min-w-[680px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-[var(--rc-border)] font-mono text-[11px] uppercase tracking-[0.1em]">
                  <th scope="col" className="px-4 py-3 font-normal text-[var(--rc-text-dim)]">
                    what you get
                  </th>
                  <th scope="col" className="px-4 py-3 font-normal text-[var(--rc-text-dim)]">
                    SaaS AI subscription
                  </th>
                  <th scope="col" className="px-4 py-3 font-normal text-[var(--rc-text-dim)]">
                    DIY cloud VM
                  </th>
                  <th scope="col" className="bg-[color-mix(in_srgb,var(--rc-accent)_9%,transparent)] px-4 py-3 font-bold text-[var(--rc-accent)]">
                    xShredo AI VPS
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([label, saas, diy, xs]) => (
                  <tr key={label} className="border-b border-[var(--rc-border)] last:border-b-0">
                    <th scope="row" className="px-4 py-3 align-top font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-[var(--rc-text-dim)]">
                      {label}
                    </th>
                    <td className="px-4 py-3 align-top text-[var(--rc-text-dim)]">{saas}</td>
                    <td className="px-4 py-3 align-top text-[var(--rc-text-dim)]">{diy}</td>
                    <td className="bg-[color-mix(in_srgb,var(--rc-accent)_9%,transparent)] px-4 py-3 align-top font-medium text-[var(--rc-text)]">
                      {xs}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Pricing                                                     */}
        {/* ---------------------------------------------------------- */}
        <section aria-label="Pricing" className="scroll-mt-24 pb-14">
          <SectionHeader
            eyebrow="launch pricing is live"
            title="One price floor. Every stack."
            blurb="No per-seat fees, no surprise egress bills, no meter running while your agent thinks."
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col rounded-2xl border border-[color-mix(in_srgb,var(--rc-accent)_45%,var(--rc-border))] bg-[color-mix(in_srgb,var(--rc-accent)_7%,var(--rc-surface))] p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rc-accent)]">from</p>
              <p className="mt-1 font-display text-4xl font-bold tracking-tight md:text-5xl">
                $5.75
                <span className="ml-1 font-mono text-sm font-normal text-[var(--rc-text-dim)]">/mo</span>
              </p>
              <p className="mt-3 flex-1 text-[13px] leading-relaxed text-[var(--rc-text-dim)]">
                Everything included. Every plan is the same machine — resize up to 16 vCPU · 64 GB · 1 TB NVMe whenever
                you outgrow it.
              </p>
              <div className="mt-5">
                <DeployCta utmContent="pricing" />
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rc-accent)]">included</p>
              <ul className="mt-3 grid gap-2.5 text-[13px] leading-relaxed text-[var(--rc-text)]">
                {[
                  "KVM VM with full root",
                  "1–16 vCPU · 1–64 GB RAM",
                  "50 GB–1 TB replicated Ceph NVMe",
                  "2 TB traffic included",
                  "DDoS protection · snapshots · VNC console",
                ].map((item) => (
                  <li key={item} className="flex gap-2">
                    <span aria-hidden className="mt-0.5 font-mono text-[var(--rc-accent)]">
                      ✓
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid gap-4">
              <div className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rc-accent)]">
                  what you pay later
                </p>
                <ul className="mt-3 grid gap-1.5 text-[13px] leading-relaxed text-[var(--rc-text-dim)]">
                  <li>Nothing, if the base box fits.</li>
                  <li>A resize, if your models grow.</li>
                  <li>Extra traffic only if you go viral.</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] p-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rc-accent)]">
                  what you are not paying for
                </p>
                <ul className="mt-3 grid gap-1.5 text-[13px] leading-relaxed text-[var(--rc-text-dim)]">
                  <li>Per-seat SaaS fees.</li>
                  <li>API middlemen and markups.</li>
                  <li>Queue time on someone else&apos;s GPU.</li>
                  <li>A weekend in the terminal.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* FAQ                                                         */}
        {/* ---------------------------------------------------------- */}
        <section aria-label="Questions, answered" className="scroll-mt-24 pb-14">
          <SectionHeader
            eyebrow="questions, answered"
            title="Straight answers before you deploy"
            blurb="The six things everyone asks, answered the way we would want them answered."
          />
          <div className="grid gap-3">
            {FAQ.map((f) => (
              <details
                key={f.q}
                className="group rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-surface)] px-5 py-4 open:border-[color-mix(in_srgb,var(--rc-accent)_40%,var(--rc-border))]"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-[15px] font-semibold tracking-tight [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span
                    aria-hidden
                    className="shrink-0 font-mono text-lg leading-none text-[var(--rc-accent)] transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[var(--rc-text-dim)]">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Closing CTA                                                 */}
        {/* ---------------------------------------------------------- */}
        <section aria-label="Deploy now" className="scroll-mt-24">
          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--rc-accent)_45%,var(--rc-border))] bg-[color-mix(in_srgb,var(--rc-accent)_7%,var(--rc-surface))] px-6 py-10 text-center md:py-12">
            <h2 className="mx-auto max-w-2xl font-display text-2xl font-bold tracking-tight text-[var(--rc-text)] md:text-3xl">
              Launch pricing is live. Your first stack is 10 minutes away.
            </h2>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <DeployCta utmContent="closing" big />
              <a
                href={promo("closing-ai-pick")}
                {...EXTERNAL}
                className="inline-flex items-center justify-center rounded-full border border-[var(--rc-border)] bg-[var(--rc-surface)] px-5 py-2.5 font-mono text-[13px] font-semibold text-[var(--rc-text)] transition-colors hover:border-[var(--rc-accent)] hover:text-[var(--rc-accent)]"
              >
                not sure? let AI pick my stack
              </a>
            </div>
            <p className="mt-5 font-mono text-[12px] text-[var(--rc-text-dim)]">
              2 TB traffic included · DDoS protection · Tampa, FL (US-East) · full root from first boot
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-[var(--rc-border)]">
        <div className="mx-auto max-w-6xl px-5 py-8 font-mono text-xs text-[var(--rc-text-dim)] md:px-8">
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <p className="font-display text-lg font-semibold tracking-tight text-[var(--rc-text)]">
                <a
                  href={promo("footer")}
                  {...EXTERNAL}
                  className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
                >
                  Powered by xShredo
                </a>
              </p>
              <p className="mt-1.5 leading-relaxed">an ARPHost brand · Tampa, FL (US-East) · 2N power · Tier-1 uplinks</p>
            </div>
            <div>
              <p className="mb-2 font-semibold uppercase tracking-[0.08em] text-[var(--rc-tone3)]">portal</p>
              <ul className="grid gap-1">
                <li>
                  <a href="/" className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]">
                    ← GLM Bonus Radar
                  </a>
                </li>
                <li>
                  <a href="/scanner" className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]">
                    zScanner — security · SEO/GEO · QA · anti-slop
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/romangalaxys10-spec/glm-bonus-radar"
                    target="_blank"
                    rel="noopener"
                    className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
                  >
                    source on GitHub ↗
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="mb-2 font-semibold uppercase tracking-[0.08em] text-[var(--rc-tone3)]">disclaimer</p>
              <p className="leading-relaxed">
                Sponsor page. The hosting offer is provided by xShredo (an ARPHost brand); the portal around it is an
                unofficial community tracker and is not affiliated with Z.ai Platform.
              </p>
            </div>
          </div>
          <p className="mt-8 border-t border-[var(--rc-border)] pt-5 text-[11px] leading-relaxed">
            Developed by{" "}
            <a
              href="https://rommark.dev"
              target="_blank"
              rel="noopener"
              className="font-semibold text-[var(--rc-text)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--rc-accent)]"
            >
              Rommark.Dev
            </a>{" "}
            · <span className="text-[var(--rc-accent)]">Powered by xShredo</span>
          </p>
        </div>
      </footer>

      {/* GEO: machine-readable offer — server-rendered so crawlers and
          generative engines read it in the initial HTML (same pattern as
          the homepage sponsor block). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: "24x7 Agent — xShredo AI VPS",
            description:
              "An always-on KVM server for AI agents: 79 pre-installed AI stacks (Ollama + Open WebUI, ComfyUI, n8n, LibreChat, OpenHands, Qdrant, Whisper, Jupyter), live in 5–10 minutes, full root, 1–16 vCPU, 1–64 GB RAM, up to 1 TB Ceph NVMe, 2 TB traffic, DDoS protection, Tampa FL US-East. Powered by xShredo.",
            brand: { "@type": "Brand", name: "xshredo" },
            category: "Cloud Hosting",
            offers: {
              "@type": "Offer",
              url: PROMO_BASE,
              price: "5.75",
              priceCurrency: "USD",
              availability: "https://schema.org/InStock",
            },
          }),
        }}
      />
    </div>
  );
}
