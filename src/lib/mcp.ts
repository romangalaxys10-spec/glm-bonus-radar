import { db } from "@/lib/db";
import { normalizeBlogWrite } from "@/lib/blog";
import {
  loadHomepageContent,
  resetHomepageContent,
  saveHomepagePatch,
} from "@/lib/homepage-store";
import { formatRecentPostDate } from "@/lib/recent-posts";

/**
 * MCP (Model Context Protocol) server for the ZHelp portal — stateless
 * Streamable-HTTP transport (JSON-RPC 2.0 over POST, JSON responses).
 *
 *   POST https://zhelp.space-z.ai/api/mcp
 *   Authorization: Bearer zblog_…      (the blog pairing token)
 *
 * Lets any external agent publish/edit/remove blog articles and reshape
 * the homepage (hero copy, tool cards, section headers, visibility,
 * custom sections) — validated, instantly live, reversible.
 *
 * This module is split in two halves:
 *   - handleMcpRpc: the pure protocol layer (unit-tested, transport-free)
 *   - buildMcpTools: the real tools wired to the DB
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"];
export const SITE_URL = "https://zhelp.space-z.ai";

/* ------------------------------ protocol ------------------------------ */

export interface McpTool {
  def: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  /** Throwing McpToolError yields a tool-result with isError: true. */
  run(args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export class McpToolError extends Error {}

export interface McpHttpResponse {
  status: number;
  /** null body → 204-style empty response (notifications). */
  body: Record<string, unknown> | null;
}

interface RpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

function ok(id: unknown, result: Record<string, unknown>): McpHttpResponse {
  return { status: 200, body: { jsonrpc: "2.0", id, result } };
}

function err(id: unknown, code: number, message: string): McpHttpResponse {
  return { status: 200, body: { jsonrpc: "2.0", id, error: { code, message } } };
}

/**
 * Handle one JSON-RPC message (already JSON.parse'd by the caller).
 * Transport errors are expressed as HTTP statuses; JSON-RPC errors as
 * in-body error objects with status 200 (per JSON-RPC-over-HTTP norms).
 */
export async function handleMcpRpc(
  payload: unknown,
  tools: McpTool[],
  serverInfo: { name: string; version: string },
): Promise<McpHttpResponse> {
  /* JSON parse errors surface before this function; a non-object payload
     is structurally invalid for our stateless server. */
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { status: 400, body: { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: expected a single JSON-RPC 2.0 message object." } } };
  }
  const req = payload as RpcRequest;
  if (typeof req.method !== "string" || req.method.length === 0) {
    return err(null, -32600, "Invalid Request: missing method.");
  }

  /* Notifications: accepted, no response body. */
  if (req.method.startsWith("notifications/")) return { status: 202, body: null };

  const id = req.id ?? null;

  switch (req.method) {
    case "initialize": {
      const requested = (req.params as Record<string, unknown> | undefined)?.protocolVersion;
      const version =
        typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : MCP_PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo,
        instructions:
          "ZHelp portal editing tools. blog_* manages articles on /blog (upsert by slug). " +
          "homepage_get shows the current editable document; homepage_update applies a validated " +
          "patch (hero copy, tool cards, section headers, visibility, custom markdown sections) " +
          "that goes live on the main page immediately; homepage_reset restores the shipped page.",
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: tools.map((t) => t.def) });
    case "tools/call": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      const name = typeof params.name === "string" ? params.name : "";
      const tool = tools.find((t) => t.def.name === name);
      if (!tool) {
        return err(id, -32602, `Unknown tool "${name || "(missing)"}" — see tools/list.`);
      }
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      if (args === null || typeof args !== "object" || Array.isArray(args)) {
        return err(id, -32602, "Tool arguments must be an object.");
      }
      /* Tool failures are RESULTS (isError), not protocol errors — the
         agent can read the message and retry with fixed arguments. */
      try {
        const result = await tool.run(args);
        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (e: unknown) {
        const message = e instanceof McpToolError ? e.message : "Internal tool error.";
        if (!(e instanceof McpToolError)) console.error(`[mcp] tool ${name} crashed:`, e);
        return ok(id, {
          content: [{ type: "text", text: message }],
          isError: true,
        });
      }
    }
    default:
      return err(id, -32601, `Method not found: ${req.method}`);
  }
}

/* ------------------------------ tools ------------------------------ */

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new McpToolError(`Missing required string argument "${key}".`);
  }
  return v;
}

export function buildMcpTools(): McpTool[] {
  return [
    {
      def: {
        name: "blog_publish",
        description:
          "Publish a new article on the ZHelp blog (https://zhelp.space-z.ai/blog) or update an existing one in place by slug. Body is markdown; code fences and '```blocks' generative-UI fences are rendered live.",
        inputSchema: {
          type: "object",
          required: ["title", "body"],
          properties: {
            title: { type: "string", minLength: 3, maxLength: 180 },
            body: { type: "string", minLength: 20, maxLength: 40000, description: "Markdown body." },
            excerpt: { type: "string", maxLength: 400, description: "Teaser; auto-derived from body when omitted." },
            tags: { type: "string", description: "Comma-separated lowercase tags, e.g. \"z.ai, agents\"." },
            author: { type: "string", maxLength: 80, description: "Display author (agent name)." },
            slug: { type: "string", description: "Stable slug; omit to derive from the title. Re-publishing the same slug updates in place." },
          },
        },
      },
      async run(args) {
        const norm = normalizeBlogWrite(args);
        if (!norm.ok) throw new McpToolError(norm.error);
        const v = norm.value;
        const post = await db.blogPost.upsert({
          where: { slug: v.slug },
          update: {
            title: v.title, body: v.body, excerpt: v.excerpt,
            tags: v.tags, author: v.author, published: v.published,
          },
          create: { ...v, source: "agent" },
        });
        return {
          ok: true,
          slug: post.slug,
          created: post.createdAt.getTime() === post.updatedAt.getTime(),
          url: `${SITE_URL}/blog/${post.slug}`,
          note: "Live on /blog now.",
        };
      },
    },
    {
      def: {
        name: "blog_list",
        description: "List recent published articles on the ZHelp blog (newest first).",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", minimum: 1, maximum: 50, description: "Default 20." },
          },
        },
      },
      async run(args) {
        const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
        const posts = await db.blogPost.findMany({
          where: { published: true },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: { slug: true, title: true, excerpt: true, createdAt: true, author: true, source: true },
        });
        return {
          count: posts.length,
          posts: posts.map((p) => ({
            slug: p.slug,
            title: p.title,
            excerpt: p.excerpt,
            date: formatRecentPostDate(p.createdAt.toISOString()),
            author: p.author ?? "Rommark",
            automated: p.source === "agent",
          })),
        };
      },
    },
    {
      def: {
        name: "blog_get",
        description: "Fetch one published article in full (markdown body) by slug.",
        inputSchema: {
          type: "object",
          required: ["slug"],
          properties: { slug: { type: "string" } },
        },
      },
      async run(args) {
        const slug = requireString(args, "slug");
        const post = await db.blogPost.findUnique({
          where: { slug },
          select: { slug: true, title: true, excerpt: true, body: true, tags: true, author: true, published: true, createdAt: true, updatedAt: true },
        });
        if (!post || !post.published) throw new McpToolError(`No published post with slug "${slug}".`);
        return { ...post, createdAt: post.createdAt.toISOString(), updatedAt: post.updatedAt.toISOString() };
      },
    },
    {
      def: {
        name: "blog_delete",
        description: "Remove an article from the ZHelp blog by slug. Permanent.",
        inputSchema: {
          type: "object",
          required: ["slug"],
          properties: { slug: { type: "string" } },
        },
      },
      async run(args) {
        const slug = requireString(args, "slug");
        try {
          await db.blogPost.delete({ where: { slug } });
          return { ok: true, deleted: slug };
        } catch {
          throw new McpToolError(`No post with slug "${slug}".`);
        }
      },
    },
    {
      def: {
        name: "homepage_get",
        description:
          "Read the current editable homepage document of https://zhelp.space-z.ai: hero copy, tool cards, section headers, per-section visibility and custom sections. Sections omitted from the stored doc currently use the shipped defaults.",
        inputSchema: { type: "object", properties: {} },
      },
      async run() {
        const { content, updatedAt, fellBack } = await loadHomepageContent();
        return { content, updatedAt, usingDefaultsBecauseInvalid: fellBack };
      },
    },
    {
      def: {
        name: "homepage_update",
        description:
          "Edit the https://zhelp.space-z.ai main page by applying a validated patch. Areas: hero (titleLead, titleEm, subtitle, chatBadgeLabel, chatBadgeHint), cards (replace the tool-card row; each {id,label,description,href,glyph}, glyph one of pen/search/gamepad/star/zap/book/globe/compass, max 6), show (booleans: newsStrip, blogBox, chatBadge, cutaway, windows, timeline, cnOps, pricing, plans, invite), sections (windows/timeline/cnOps/pricing/plans each {eyebrow,title,blurb}), custom (replace the list of extra markdown sections; each {id, eyebrow?, title?, body, after: windows|timeline|cn-ops|pricing|plans|invite|end, visible}, max 6). Edits go live immediately — no rebuild. Only pass the areas you want to change; arrays are replaced wholesale.",
        inputSchema: {
          type: "object",
          required: ["patch"],
          properties: {
            patch: { type: "object", description: "Partial document, e.g. {\"sections\":{\"pricing\":{\"title\":\"Live API prices\"}}}" },
          },
        },
      },
      async run(args) {
        const patch = args.patch;
        if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
          throw new McpToolError('Provide "patch" as a JSON object, e.g. {"show":{"plans":false}}.');
        }
        const saved = await saveHomepagePatch(patch);
        if (!saved.ok) throw new McpToolError(saved.error);
        return {
          ok: true,
          changed: saved.changed,
          url: `${SITE_URL}/`,
          content: saved.content,
        };
      },
    },
    {
      def: {
        name: "homepage_reset",
        description:
          "Remove ALL homepage overrides and restore https://zhelp.space-z.ai to the shipped design. Irreversible for custom sections (copy them first via homepage_get).",
        inputSchema: { type: "object", properties: {} },
      },
      async run() {
        await resetHomepageContent();
        return { ok: true, reset: true, note: "Homepage restored to the shipped design." };
      },
    },
  ];
}
