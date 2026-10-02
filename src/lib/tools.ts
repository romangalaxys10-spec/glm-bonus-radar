/**
 * Useful tools — field-tested utilities and deep-dive write-ups from the
 * same builder (Rommark.Dev). Server-rendered data, no live state needed.
 *
 * Grounding rules for the copy:
 *   - descriptions stick to what the linked source itself states (its title,
 *     meta description or README) — no invented claims;
 *   - the Hosting Reviver entry mirrors the kit's README failure-mode table,
 *     which was battle-tested on this very portal (zhelp.space-z.ai).
 */

export type ToolIcon = "github" | "article" | "terminal" | "layers" | "scan";
export type ToolKind = "tutorial" | "open source" | "review" | "guide" | "built-in";

export type Tool = {
  id: string;
  name: string;
  url: string;
  /** Display-only domain label for the card footer. */
  host: string;
  kind: ToolKind;
  icon: ToolIcon;
  tagline: string;
  /** Featured cards render in the two-column lead row. */
  featured?: boolean;
  /** Internal routes render as Next <Link> without target=_blank. */
  internal?: boolean;
};

export const TOOLS: Tool[] = [
  {
    id: "zscanner",
    name: "zScanner",
    url: "/scanner",
    host: "this app",
    kind: "built-in",
    icon: "scan",
    tagline:
      "The radar's own scanner suite, four online scanners with live progress + ETA: Security Audit (headers, CORS, exposure probes, leaked secrets), SEO/GEO/Performance (AI-crawler policy, llms.txt, TTFB, payload), a QA reliability audit and a heuristic Code Reviewer. Each accepts a website/IP or a GitHub repo (private repos via a token kept in memory only), re-verifies findings before reporting, and ends with a copy-paste fix prompt for your dev agent.",
    internal: true,
  },
  {
    id: "github-auto-push",
    name: "GitHub Auto Push Protocol",
    url: "https://claw.rommark.dev/blog/53-github-agent-workflow-tutorial.html",
    host: "claw.rommark.dev",
    kind: "tutorial",
    icon: "github",
    featured: true,
    tagline:
      "Step-by-step tutorial on generating GitHub PAT tokens, setting automated workspace & chat-history push rules in web and local IDEs, and restoring projects across sessions — how an AI agent's work survives the sandbox.",
  },
  {
    id: "zai-hosting-reviver",
    name: "Z.ai (space-z.ai) Hosting Reviver",
    url: "https://github.com/romangalaxys10-spec/zai-hosting-patcher",
    host: "github.com",
    kind: "open source",
    icon: "github",
    featured: true,
    tagline:
      "Self-healing deploy kit for z.ai fullstack hosting — repairs missing build artifacts, CAExited boot errors, pack/rebuild races and the “Sorry, there was a problem deploying the code” doom loop. Battle-tested on this very portal.",
  },
  {
    id: "zaimem",
    name: "ZaiMem",
    url: "https://claw.rommark.dev/blog/zaimem-mcp-vector-memory-ai-agents-review.html",
    host: "claw.rommark.dev",
    kind: "review",
    icon: "layers",
    tagline:
      "Persistent session memory and MCP vector context enhancer for Claude Code, Cursor, Windsurf, Cline and chat.z.ai — 33 tools, GitHub storage sync and token compression, reviewed in depth.",
  },
  {
    id: "zcode-smart-skill",
    name: "zCode Smart Skill",
    url: "https://claw.rommark.dev/blog/zcode-smart-skill-gvs5h-ledger-orchestration-review.html",
    host: "claw.rommark.dev",
    kind: "review",
    icon: "article",
    tagline:
      "GVS5H ledger orchestration reviewed: disk-backed multi-agent collaboration with adversarial test specs — the technique that matched Claude Fable 5 on LiveCodeBench-Hard.",
  },
  {
    id: "zcode-smart-mode",
    name: "zCode Smart Mode",
    url: "https://claw.rommark.dev/blog/67-zcode-smart-mode-gvs5h-ledger-orchestration.html",
    host: "claw.rommark.dev",
    kind: "guide",
    icon: "terminal",
    tagline:
      "The GVS5H shared-filesystem-ledger technique shipped as a drop-in /smart command for ZCode with auto-triggering — five open-weight Qwen3.8-27B instances matching Claude Fable 5.",
  },
];
