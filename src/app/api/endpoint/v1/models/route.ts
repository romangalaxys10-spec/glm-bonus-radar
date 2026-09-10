import { NextRequest } from "next/server";
import { MODEL_ID, findKeyRow, extractApiKey } from "@/lib/endpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OpenAI-compatible model listing — advertises the Z-Assist model id. */
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
    data: [
      {
        id: MODEL_ID,
        object: "model",
        created: 1735689600,
        owned_by: "glm-bonus-radar",
      },
    ],
  });
}
