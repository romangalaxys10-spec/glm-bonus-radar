import { KNOWLEDGE, KNOWLEDGE_UPDATED } from "@/lib/assist-knowledge";
import { getDocsSnapshot } from "@/lib/docs-sync";
import { getZcodeSnapshot, ZCODE_DOCS_HUB } from "@/lib/zcode-docs";

/**
 * The grounding corpus — everything Z-Assist is allowed to state as fact:
 * the curated knowledge base (docs.z.ai + zcode.z.ai excerpts) plus the
 * latest hourly-synced official docs. Built once per minute and shared by
 * the system-prompt builder (assist-core) and the anti-hallucination
 * verifier (assist-verify), so what the model was told and what the
 * verifier checks against are ALWAYS the same material.
 */

export interface GroundingCorpus {
  /** Curated knowledge base (assist-knowledge.ts). */
  curated: string;
  /** Hourly docs.z.ai sync payload ("" when unavailable). */
  docsLatest: string;
  /** Hourly zcode.z.ai docs sync payload ("" when unavailable). */
  zcode: string;
  /** Everything concatenated — the string deterministic checks run against. */
  combined: string;
  docsFetchedAt?: string;
  zcodeFetchedAt?: string;
  updatedAt: string;
}

let cache: { at: number; corpus: GroundingCorpus } | null = null;
const TTL_MS = 60_000;

export async function buildGroundingCorpus(at = Date.now()): Promise<GroundingCorpus> {
  if (cache && at - cache.at < TTL_MS) return cache.corpus;

  let docsLatest = "";
  let zcode = "";
  let docsFetchedAt: string | undefined;
  let zcodeFetchedAt: string | undefined;

  try {
    const snapshot = await getDocsSnapshot();
    if (snapshot?.prompt) {
      docsLatest = snapshot.prompt;
      docsFetchedAt = snapshot.fetchedAt;
    }
  } catch {
    /* snapshot unavailable — curated base still applies */
  }

  try {
    const zsnap = await getZcodeSnapshot();
    if (zsnap?.prompt) {
      zcode = zsnap.prompt;
      zcodeFetchedAt = zsnap.fetchedAt;
    }
  } catch {
    /* zcode snapshot unavailable — curated section 10 still applies */
  }

  const corpus: GroundingCorpus = {
    curated: KNOWLEDGE,
    docsLatest,
    zcode,
    combined: `${KNOWLEDGE}\n${docsLatest}\n${zcode}`,
    docsFetchedAt,
    zcodeFetchedAt,
    updatedAt: KNOWLEDGE_UPDATED,
  };
  cache = { at, corpus };
  return corpus;
}
