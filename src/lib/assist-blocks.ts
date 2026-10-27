/**
 * Assist generative-UI blocks — "answers you can interact with".
 *
 * Pattern adopted from CopilotKit's OpenIntelligentUI (MIT): the model may
 * append a fenced `blocks` JSON payload after its markdown answer, and the
 * chat renders validated, typed interactive components (comparison tables,
 * charts, steppers, action cards, live calculators) instead of prose alone.
 * We run the paradigm natively on the portal's own model gateway — no
 * CopilotKit runtime, no Python sidecar, no OpenAI keys.
 *
 * Everything here is defensive by design:
 *  - zod-validated, size-capped shapes;
 *  - invalid or oversized blocks are dropped, never fatal;
 *  - no HTML strings, no dangerouslySetInnerHTML, no inline JS (unlike
 *    OpenIntelligentUI's sandboxed iframe channel, our blocks are typed
 *    React components, so there is no script surface at all);
 *  - hrefs restricted to same-origin relative paths and https://.
 */

import { z } from "zod";

/* ------------------------------ block schemas ----------------------------- */

const CAPTION_MAX = 240;

const caption = z.string().max(CAPTION_MAX).optional();

const TableBlockSchema = z.object({
  type: z.literal("table"),
  title: z.string().min(1).max(120),
  columns: z.array(z.string().min(1).max(48)).min(2).max(5),
  rows: z.array(z.array(z.string().max(90)).min(1).max(5)).min(2).max(10),
  note: caption,
  source: caption,
});

const ChartBarSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.number().finite(),
  hint: z.string().max(80).optional(),
});

const ChartBlockSchema = z.object({
  type: z.literal("chart"),
  title: z.string().min(1).max(120),
  unit: z.string().max(24).optional(),
  bars: z.array(ChartBarSchema).min(2).max(8),
  note: caption,
  source: caption,
});

const StepsBlockSchema = z.object({
  type: z.literal("steps"),
  title: z.string().min(1).max(120),
  items: z.array(z.string().min(1).max(220)).min(2).max(8),
  note: caption,
  source: caption,
});

const ActionLinkSchema = z.object({
  label: z.string().min(1).max(48),
  href: z
    .string()
    .min(1)
    .max(300)
    .refine((href) => /^\/[^\s]*$/.test(href) || /^https:\/\/[^\s]+$/.test(href), {
      message: "href must be a same-origin path or an https:// URL",
    }),
  note: z.string().max(90).optional(),
});

const ActionsBlockSchema = z.object({
  type: z.literal("actions"),
  title: z.string().min(1).max(120),
  links: z.array(ActionLinkSchema).min(1).max(4),
  note: caption,
  source: caption,
});

/** Prebuilt local tools — computations run client-side only, nothing is sent anywhere. */
const CalcBlockSchema = z.object({
  type: z.literal("calc"),
  tool: z.enum(["credit-estimator"]),
  title: z.string().min(1).max(120).optional(),
  /** Numbers the user already stated in the conversation (used as starting values). */
  prefill: z.record(z.string(), z.number().finite()).optional(),
  note: caption,
  source: caption,
});

export const AssistBlockSchema = z.discriminatedUnion("type", [
  TableBlockSchema,
  ChartBlockSchema,
  StepsBlockSchema,
  ActionsBlockSchema,
  CalcBlockSchema,
]);

export type TableBlock = z.infer<typeof TableBlockSchema>;
export type ChartBlock = z.infer<typeof ChartBlockSchema>;
export type StepsBlock = z.infer<typeof StepsBlockSchema>;
export type ActionsBlock = z.infer<typeof ActionsBlockSchema>;
export type CalcBlock = z.infer<typeof CalcBlockSchema>;
export type AssistBlock = z.infer<typeof AssistBlockSchema>;

/* -------------------------------- limits ---------------------------------- */

const MAX_BLOCKS = 2;
const MAX_FENCE_CHARS = 6000;

/* -------------------------------- parser ---------------------------------- */

const FENCE_RE = /```(blocks|calc|chart|table|actions|steps)[ \t]*\r?\n([\s\S]*?)```/g;

export interface ParsedAssistReply {
  text: string;
  blocks: AssistBlock[];
}

/** Post-schema sanity pass: table rows must match the column count. */
function shapeCheck(block: AssistBlock): boolean {
  if (block.type === "table") {
    const width = block.columns.length;
    return block.rows.every((row) => row.length === width);
  }
  return true;
}

/**
 * Splits a model reply into displayable markdown text and a list of
 * validated generative-UI blocks. Accepts the whole raw reply (fence
 * included); tolerates malformed JSON, unknown block types, oversized
 * payloads — anything suspicious is dropped and the prose stands alone.
 */
export function parseAssistReply(reply: string): ParsedAssistReply {
  const blocks: AssistBlock[] = [];
  let text = reply;

  const matches = [...reply.matchAll(FENCE_RE)];
  if (matches.length > 0) {
    // Only the LAST fence is considered — the protocol puts blocks at the end,
    // and this keeps a code example mentioning ```blocks from being parsed.
    const last = matches[matches.length - 1];
    const fenceTag = last[1];
    const raw = last[2];
    if (raw && raw.length <= MAX_FENCE_CHARS) {
      try {
        let parsed: unknown = JSON.parse(raw);
        // Models sometimes emit a single block object instead of an array — accept it.
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          parsed = [parsed];
        }
        if (Array.isArray(parsed)) {
          for (const item of parsed.slice(0, MAX_BLOCKS + 2)) {
            // Tolerance: a drifted fence tag (```calc, ```table, …) implies the
            // block type even when the model omitted the "type" field.
            let candidate: unknown = item;
            if (
              fenceTag !== "blocks" &&
              item !== null &&
              typeof item === "object" &&
              !Array.isArray(item) &&
              (item as Record<string, unknown>).type == null
            ) {
              candidate = { type: fenceTag, ...(item as Record<string, unknown>) };
            }
            const result = AssistBlockSchema.safeParse(candidate);
            if (result.success && shapeCheck(result.data) && blocks.length < MAX_BLOCKS) {
              blocks.push(result.data);
            }
          }
        }
      } catch {
        /* malformed JSON — prose-only reply */
      }
    }
    // Strip every blocks fence from the visible text (also partial earlier ones).
    text = reply.replace(FENCE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  }

  return { text, blocks };
}
