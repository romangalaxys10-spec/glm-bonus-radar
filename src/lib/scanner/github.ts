/**
 * zScanner — GitHub repo client (ledger 9b4ac333, IDEATE Approach A).
 *
 * One place for every GitHub byte: target parsing, token carrying, manual
 * redirects with a host allowlist, rate-limit mapping and token scrubbing.
 *
 * Token secrecy contract: the token exists ONLY as a parameter inside the
 * running job closure. It is never written to disk, never logged, never
 * placed in job events/results, and scrubbed from every error message and
 * any evidence string this module produces. Authorization is forwarded
 * ONLY to GitHub-owned hosts (api.github.com, raw.githubusercontent.com) —
 * never to a redirect target on any other origin.
 *
 * Request economy (IDEATE): repo metadata + tree = 2 api.github.com calls
 * (counted against GitHub's 60/hr unauthenticated / 5000/hr authenticated
 * quota). File contents come from raw.githubusercontent.com — a CDN host
 * that does NOT count against that quota and also serves private blobs
 * when a Bearer token is supplied.
 */

import { createHash } from "node:crypto";
import { ScanError, readBodyCapped } from "./fetcher";

const GH_API = "https://api.github.com";
const GH_RAW = "https://raw.githubusercontent.com";
const HOP_TIMEOUT_MS = 12_000;
const MAX_HOPS = 3;

/** Hosts that may receive the Authorization header. */
const AUTH_HOSTS = new Set(["api.github.com", "raw.githubusercontent.com"]);
/** Hosts a redirect may land on (GitHub-owned asset/CDN hosts). */
const ALLOWED_HOSTS = new Set([
  "api.github.com",
  "raw.githubusercontent.com",
  "github.com",
  "www.github.com",
  "objects.githubusercontent.com",
  "codeload.github.com",
]);

/* ---------------- token hygiene ---------------- */

export const GH_TOKEN_RE = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/;

/** Remove the user's token (and any token-shaped string) from text bound for responses/errors. */
export function scrubToken(text: string, token?: string): string {
  let out = text;
  if (token) out = out.split(token).join("[redacted]");
  return out.replace(GH_TOKEN_RE, "[redacted-token]");
}

/** Trim paste artifacts (spaces, surrounding quotes) from a user-typed token. */
export function normalizeToken(raw: string): string {
  return raw.trim().replace(/^["']*/, "").replace(/["']*$/, "").trim();
}

/** Non-reversible cache-key namespace so private results never serve anonymous callers. */
export function tokenFingerprint(token: string): string {
  return createHash("sha1").update(token).digest("hex").slice(0, 8);
}

/* ---------------- target parsing ---------------- */

export type GhRepoRef = { owner: string; repo: string };

/**
 * Accepts `owner/repo`, `github.com/owner/repo`, `https://github.com/owner/repo`,
 * with optional `.git` suffix, trailing slashes and a `/tree/branch` subpath.
 */
export function parseRepoTarget(raw: string): GhRepoRef | null {
  let s = raw.trim();
  if (!s || s.length > 300) return null;
  s = s.replace(/\/+$/, "").replace(/\.git$/i, "");
  const urlForm = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)(?:\/tree\/[^/\s]+)?/i.exec(s);
  let owner: string;
  let repo: string;
  if (urlForm) {
    owner = urlForm[1];
    repo = urlForm[2];
  } else {
    const short = /^([\w.-]+)\/([\w.-]+)$/.exec(s);
    if (!short) return null;
    owner = short[1];
    repo = short[2];
  }
  try {
    owner = decodeURIComponent(owner);
    repo = decodeURIComponent(repo);
  } catch {
    return null;
  }
  if (owner.length > 39 || repo.length > 100) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner)) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return { owner, repo };
}

/* ---------------- low-level fetch ---------------- */

type GhFetchResult = {
  status: number;
  headers: Record<string, string>;
  text: string;
  bytes: number;
  truncated: boolean;
};

function mapGhFailure(status: number, headers: Record<string, string>, body: string, hasToken: boolean): ScanError | null {
  if (status === 429 || (status === 403 && headers["x-ratelimit-remaining"] === "0") || /secondary rate limit/i.test(body))
    return new ScanError(
      "gh-rate-limited",
      hasToken
        ? "GitHub rate limit hit even with the token (secondary limits apply to bursts). Wait a minute and rescan."
        : "GitHub's API quota for anonymous users is used up (60 requests/hour per host). Add a GitHub token in the scanner to raise it to 5,000/hour."
    );
  return null;
}

/** Manual-redirect GET restricted to GitHub hosts; auth only on GH API/raw hosts. */
async function ghFetch(
  url: URL,
  token: string | undefined,
  accept: string,
  cap = 2_000_000
): Promise<GhFetchResult> {
  let current = new URL(url.toString());
  for (let hop = 0; ; hop++) {
    if (!ALLOWED_HOSTS.has(current.hostname))
      throw new ScanError("gh-network", "GitHub fetch redirected to an unexpected host — aborted.");
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), HOP_TIMEOUT_MS);
    let res: Response;
    try {
      const headers: Record<string, string> = {
        "user-agent": "zScanner/1.0 (+https://zhelp.space-z.ai/scanner; audit bot)",
        accept,
      };
      if (token && AUTH_HOSTS.has(current.hostname)) headers.authorization = `Bearer ${token}`;
      res = await fetch(current, { redirect: "manual", signal: abort.signal, headers });
    } catch (e) {
      throw new ScanError(
        "gh-network",
        e instanceof Error && e.name === "AbortError" ? "GitHub did not respond in time." : "GitHub could not be reached."
      );
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) throw new ScanError("gh-network", "GitHub redirect without a Location header.");
      if (hop + 1 > MAX_HOPS) throw new ScanError("gh-network", "Too many GitHub redirects.");
      try {
        res.body?.cancel();
      } catch {}
      current = new URL(loc, current);
      continue;
    }

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = headers[k.toLowerCase()] ? `${headers[k.toLowerCase()]}, ${v}` : v;
    });

    if (res.status === 401)
      throw new ScanError("gh-auth-invalid", "GitHub rejected this token (401) — it may be expired, revoked, or mistyped.");
    // Read first so secondary-rate-limit bodies can be inspected, then map.
    const { text, bytes, truncated } = await readBodyCapped(res, abort, cap);
    const limited = mapGhFailure(res.status, headers, text, Boolean(token));
    if (limited) throw limited;
    return { status: res.status, headers, text, bytes, truncated };
  }
}

/* ---------------- metadata / tree / files ---------------- */

export type GhRepoMeta = {
  fullName: string;
  description: string | null;
  topics: string[];
  language: string | null;
  licenseSpdx: string | null;
  defaultBranch: string;
  homepage: string | null;
  pushedAt: string | null;
  createdAt: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  sizeKb: number;
  visibility: "public" | "private";
  archived: boolean;
  fork: boolean;
};

export async function getRepoMeta(ref: GhRepoRef, token?: string): Promise<GhRepoMeta> {
  const res = await ghFetch(new URL(`${GH_API}/repos/${ref.owner}/${ref.repo}`), token, "application/vnd.github+json");
  if (res.status === 404)
    throw new ScanError(
      "gh-not-found",
      token
        ? "Token accepted, but GitHub reports no such repository for it — check the name, and that the token can read it (classic PAT: 'repo' scope; fine-grained: Metadata + Contents read)."
        : "Repository not found — it may be private. Paste a GitHub token with access to scan it."
    );
  if (res.status === 403)
    throw new ScanError("gh-scope-denied", "This token cannot read the repository (403). Classic PATs need the 'repo' scope; fine-grained tokens need Metadata + Contents read on that repo.");
  if (res.status !== 200) throw new ScanError("gh-network", `Unexpected GitHub response (${res.status}) while reading repository metadata.`);
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(res.text) as Record<string, unknown>;
  } catch {
    throw new ScanError("gh-network", "GitHub returned malformed repository metadata.");
  }
  const license = j.license as { spdx_id?: string } | null | undefined;
  return {
    fullName: String(j.full_name ?? `${ref.owner}/${ref.repo}`),
    description: (j.description as string | null) ?? null,
    topics: Array.isArray(j.topics) ? (j.topics as string[]).slice(0, 30) : [],
    language: (j.language as string | null) ?? null,
    licenseSpdx: license?.spdx_id && license.spdx_id !== "NOASSERTION" ? license.spdx_id : null,
    defaultBranch: String(j.default_branch ?? "main"),
    homepage: (j.homepage as string | null) || null,
    pushedAt: (j.pushed_at as string | null) ?? null,
    createdAt: (j.created_at as string | null) ?? null,
    stars: Number(j.stargazers_count ?? 0),
    forks: Number(j.forks_count ?? 0),
    openIssues: Number(j.open_issues_count ?? 0),
    sizeKb: Number(j.size ?? 0),
    visibility: j.visibility === "private" ? "private" : "public",
    archived: Boolean(j.archived),
    fork: Boolean(j.fork),
  };
}

export type GhTree = { blobs: { path: string; size: number }[]; truncated: boolean };

const MAX_TREE_ENTRIES = 20_000;

export async function getRepoTree(ref: GhRepoRef, branch: string, token?: string): Promise<GhTree> {
  const url = new URL(`${GH_API}/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const res = await ghFetch(url, token, "application/vnd.github+json", 7_000_000);
  if (res.status !== 200) throw new ScanError("gh-network", `Could not list the repository tree (HTTP ${res.status}).`);
  let j: { tree?: { type?: string; path?: string; size?: number }[]; truncated?: boolean };
  try {
    j = JSON.parse(res.text) as typeof j;
  } catch {
    throw new ScanError("gh-network", "GitHub returned a malformed repository tree.");
  }
  const blobs: { path: string; size: number }[] = [];
  let truncated = Boolean(j.truncated);
  for (const e of j.tree ?? []) {
    if (e.type !== "blob" || !e.path) continue;
    blobs.push({ path: e.path, size: Number(e.size ?? 0) });
    if (blobs.length >= MAX_TREE_ENTRIES) {
      truncated = true;
      break;
    }
  }
  return { blobs, truncated };
}

export type RawFile = { path: string; text: string; bytes: number; truncated: boolean };

/** Fetch a file blob through the CDN host (not counted against the API quota). */
export async function fetchRawFile(
  ref: GhRepoRef,
  branch: string,
  path: string,
  token?: string,
  cap = 160 * 1024
): Promise<RawFile | null> {
  const enc = path.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`${GH_RAW}/${ref.owner}/${ref.repo}/${encodeURIComponent(branch)}/${enc}`);
  const res = await ghFetch(url, token, "text/plain, application/json, */*;q=0.8", cap);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new ScanError("gh-network", `Could not fetch ${path} from GitHub (HTTP ${res.status}).`);
  return { path, text: res.text, bytes: res.bytes, truncated: res.truncated };
}

/**
 * Second verification channel for critical findings: the same file through
 * the Contents API raw media type — a different host and pipeline than the
 * CDN fetch, so agreement is meaningful confirmation.
 */
export async function fetchApiRawFile(
  ref: GhRepoRef,
  branch: string,
  path: string,
  token?: string,
  cap = 160 * 1024
): Promise<RawFile | null> {
  const enc = path.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`${GH_API}/repos/${ref.owner}/${ref.repo}/contents/${enc}?ref=${encodeURIComponent(branch)}`);
  const res = await ghFetch(url, token, "application/vnd.github.raw", cap);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new ScanError("gh-network", `Could not re-fetch ${path} via the API channel (HTTP ${res.status}).`);
  return { path, text: res.text, bytes: res.bytes, truncated: res.truncated };
}

/* ---------------- token validation ---------------- */

/** Probe GET /user so a bad token fails at POST time, before a job exists. */
export async function validateGhToken(token: string): Promise<{ login: string }> {
  const res = await ghFetch(new URL(`${GH_API}/user`), token, "application/vnd.github+json");
  if (res.status === 401) throw new ScanError("gh-auth-invalid", "GitHub rejected this token (401) — it may be expired, revoked, or mistyped.");
  if (res.status === 403) throw new ScanError("gh-auth-invalid", "GitHub refused this token for account lookup (403) — it may lack read access or be rate-capped; try again shortly.");
  if (res.status !== 200) throw new ScanError("gh-network", `Unexpected GitHub response (${res.status}) while validating the token.`);
  try {
    const j = JSON.parse(res.text) as { login?: string };
    if (!j.login) throw new Error("no login");
    return { login: j.login };
  } catch {
    throw new ScanError("gh-network", "GitHub returned a malformed token-validation response.");
  }
}
