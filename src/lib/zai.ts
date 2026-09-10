import ZAI from "z-ai-web-dev-sdk";

/**
 * Shared z-ai-web-dev-sdk instance (backend only).
 * One client reused across requests per the SDK skill guidance.
 */
let zaiPromise: ReturnType<typeof ZAI.create> | null = null;

export function getZai() {
  return (zaiPromise ??= ZAI.create());
}
