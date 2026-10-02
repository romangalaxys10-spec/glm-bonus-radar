import { NextResponse } from "next/server";
import { runRepoScan, type RepoScanKind } from "@/lib/scanner/repo-scans";
import { REPO_PLAN, startJob } from "@/lib/scanner/jobs";
import { cachedScan, clientKey, overRate, withSlot } from "@/lib/scanner/guard";
import { errorResponse, readJson } from "@/lib/scanner/http";
import { ScanError } from "@/lib/scanner/fetcher";
import { normalizeToken, parseRepoTarget, scrubToken, tokenFingerprint, validateGhToken } from "@/lib/scanner/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: RepoScanKind[] = ["security", "geo-seo", "qa", "code"];

/**
 * GitHub repo scanning for all four scanners. The user token (optional for
 * public repos, required for private ones) lives ONLY inside the running
 * job's closure: never stored, never logged, never echoed. Errors and the
 * final result both pass through scrubToken before leaving the process.
 */
export async function POST(req: Request) {
  try {
    if (overRate(`scan:${clientKey(req)}`))
      return NextResponse.json({ error: "rate-limited", message: "Slow down — 8 scans per minute." }, { status: 429, headers: { "cache-control": "no-store" } });

    const { repo, scanner, token: rawToken } = await readJson<{ repo?: string; scanner?: string; token?: string }>(req);
    const kind = (KINDS as string[]).includes(scanner ?? "") ? (scanner as RepoScanKind) : null;
    if (!kind) throw new ScanError("bad-request", "Pick one of the four scanners.");
    if (!repo || typeof repo !== "string") throw new ScanError("gh-bad-target", "Give a repository like owner/name or a github.com URL.");
    const ref = parseRepoTarget(repo);
    if (!ref) throw new ScanError("gh-bad-target", "That does not look like a GitHub repository (owner/name).");

    let token: string | undefined;
    if (rawToken && typeof rawToken === "string" && rawToken.trim()) {
      token = normalizeToken(rawToken);
      if (token.length < 20 || token.length > 255)
        throw new ScanError("gh-auth-invalid", "That does not look like a GitHub token. Paste a classic PAT (ghp_…) or a fine-grained token (github_pat_…).");
      // Fail fast at POST time so a bad token never becomes a half-run job.
      await validateGhToken(token);
    }

    // Cache namespace includes a token fingerprint so private-repo results
    // can never be served to an anonymous (or different-token) caller.
    const cacheKey = `ghrepo:${kind}:${ref.owner}/${ref.repo}:${token ? tokenFingerprint(token) : "anon"}`;
    const jobToken = token;
    const jobId = startJob(REPO_PLAN, async (progress) => {
      const { value, cached } = await withSlot(() =>
        cachedScan(cacheKey, () => runRepoScan(kind, repo, jobToken, progress))
      );
      const merged = { ...(value as Record<string, unknown>), cached };
      // Belt & suspenders: nothing token-shaped leaves via the result either.
      return JSON.parse(scrubToken(JSON.stringify(merged), jobToken)) as Record<string, unknown>;
    });
    return NextResponse.json({ jobId }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
