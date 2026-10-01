import { NextRequest } from "next/server";
import { MODEL_IDS, findKeyRow, extractApiKey } from "@/lib/endpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_META: Record<string, string> = {
  "z-assist": "Docs-grounded z.ai support only — bonus windows, pricing, quotas, official docs.",
  "z-code": "General all-capable assistant — vision, coding, agentic planning, all in one.",
};

/** OpenAI-compatible model listing — the two IDE personas. */
export async function GET(req: NextRequest) {
  const keyRow = await findKeyRow(extractApiKey(req)).catch(() => null);
  if (!keyRow) {
    return Response.json(
      { error: { message: "Invalid API key — grab yours from the secret /endpoint section.", type: "authentication_error", param: null, code: null } },
      { status: 401 },
    );
  }
  return Response.json({
    object: "list",
    data: MODEL_IDS.map((id) => ({
      id,
      object: "model",
      created: 1735689600,
      owned_by: "glm-bonus-radar",
      ...(MODEL_META[id] ? { description: MODEL_META[id] } : {}),
    })),
  });
}
