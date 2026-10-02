/**
 * zScanner — the single choke point for every outbound byte.
 *
 * SSRF posture (ledger 3b26f85d, Architecture A): http/https only, ports
 * 80/443 only, no credentials in URL, DNS resolved and every A/AAAA answer
 * validated against private/reserved ranges before connect, manual redirect
 * following (each hop re-validated, max 4), per-request timeout, streamed
 * byte cap, total deadline. All scanner fetches MUST go through here.
 */

import { lookup } from "node:dns/promises";

const MAX_REDIRECTS = 4;
const PER_REQUEST_TIMEOUT_MS = 10_000;
const TOTAL_DEADLINE_MS = 20_000;

export class ScanError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type FetchedPage = {
  finalUrl: string;
  status: number;
  /** Lower-cased header names -> join of values. */
  headers: Record<string, string>;
  body: string;
  bytes: number;
  truncated: boolean;
  hops: number;
  /** Time from final-hop request start to response headers (perf signal). */
  ttfbMs: number;
};

/** Parse an IPv4 string; null when not dotted-quad. */
function parseIpv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const octs = m.slice(1).map(Number);
  if (octs.some((o) => o > 255)) return null;
  return octs;
}

function ipv4IsPrivate(o: number[]): boolean {
  const [a, b] = o;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local (incl. cloud metadata)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && o[2] === 0) || // 192.0.0.0/24 + 192.0.2.0/24
    (a === 198 && (b === 18 || b === 19 || (b === 51 && o[2] === 100))) ||
    (a === 203 && b === 0 && o[2] === 113) ||
    a >= 224 // multicast + reserved + broadcast
  );
}

function ipv6IsPrivate(addr: string): boolean {
  const a = addr.toLowerCase();
  if (a === "::" || a === "::1") return true;
  if (a.startsWith("fc") || a.startsWith("fd")) return true; // ULA fc00::/7
  if (a.startsWith("fe8") || a.startsWith("fe9") || a.startsWith("fea") || a.startsWith("feb"))
    return true; // link-local fe80::/10
  if (a.startsWith("ff")) return true; // multicast
  if (a.startsWith("2001:db8")) return true; // documentation
  if (a.startsWith("100:")) return true; // discard-only 100::/64
  // IPv4-mapped / NAT64 tail — extract embedded IPv4 and re-check
  const tail = a.split(":").pop() ?? "";
  const v4 = parseIpv4(tail);
  if (v4 && (a.includes("::ffff") || a.startsWith("64:ff9b"))) return ipv4IsPrivate(v4);
  return false;
}

function hostIpIsForbidden(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4) return ipv4IsPrivate(v4);
  if (ip.includes(":")) return ipv6IsPrivate(ip);
  return true; // unparseable answers are treated as hostile
}

function schemeHostPort(u: URL): void {
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new ScanError("bad-scheme", "Only http(s) URLs can be scanned.");
  if (u.port !== "" && u.port !== "80" && u.port !== "443")
    throw new ScanError("bad-port", "Only ports 80 and 443 can be scanned.");
  if (u.username || u.password)
    throw new ScanError("bad-credentials", "URLs with embedded credentials are not scanned.");
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa"))
    throw new ScanError("private-host", "Local/internal hostnames are not scanned.");
}

async function assertResolvablePublic(u: URL): Promise<void> {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  // Literal IPv6 in brackets — validate directly, no DNS
  if (host.includes(":")) {
    if (ipv6IsPrivate(host)) throw new ScanError("private-ip", "Private IP targets are not scanned.");
    return;
  }
  let answers: { address: string }[];
  try {
    answers = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ScanError("dns-failure", `Could not resolve ${host}.`);
  }
  if (!answers.length) throw new ScanError("dns-failure", `No DNS answers for ${host}.`);
  for (const { address } of answers) {
    if (hostIpIsForbidden(address))
      throw new ScanError("private-ip", "Private/reserved IP targets are not scanned.");
  }
}

/** Read a response body capped at `cap` bytes, aborting the fetch past it. */
export async function readBodyCapped(res: Response, abort: AbortController, cap: number) {
  const reader = res.body?.getReader();
  if (!reader) return { text: "", bytes: 0, truncated: false };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytes += value.byteLength;
    if (bytes >= cap) {
      truncated = true;
      abort.abort();
      break;
    }
  }
  const merged = new Uint8Array(Math.min(bytes, cap));
  let off = 0;
  for (const c of chunks) {
    if (off >= merged.length) break;
    merged.set(c.subarray(0, Math.min(c.length, merged.length - off)), off);
    off += c.length;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(merged), bytes, truncated };
}

/**
 * Guarded GET. Follows up to 4 redirects, validating scheme/host/DNS at
 * every hop. Returns headers + capped body text of the final response.
 */
export async function guardedGet(
  rawUrl: string,
  opts: { bodyCap: number; validateDns?: boolean; headers?: Record<string, string> } = { bodyCap: 2_000_000 }
): Promise<FetchedPage> {
  const started = Date.now();
  let current: URL;
  try {
    current = new URL(rawUrl.trim());
  } catch {
    throw new ScanError("bad-url", "That is not a valid URL.");
  }
  if (!/^(https?|)$/.test(current.protocol.replace(":", "")) && current.protocol !== "https:" && current.protocol !== "http:")
    throw new ScanError("bad-scheme", "Only http(s) URLs can be scanned.");

  const deadline = started + TOTAL_DEADLINE_MS;
  let hops = 0;
  let ttfbMs = 0;
  for (;;) {
    schemeHostPort(current);
    if (opts.validateDns !== false) await assertResolvablePublic(current);
    if (Date.now() > deadline) throw new ScanError("deadline", "Scan took too long; try again later.");
    const hopStarted = Date.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), Math.min(PER_REQUEST_TIMEOUT_MS, deadline - Date.now()));
    let res: Response;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: abort.signal,
        headers: {
          "user-agent": "zScanner/1.0 (+https://zhelp.space-z.ai/scanner; audit bot)",
          accept: "text/html,application/xhtml+xml,text/plain,*/*;q=0.8",
          ...opts.headers,
        },
      });
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error && e.name === "AbortError" ? "Target did not respond in time." : "Target could not be reached.";
      throw new ScanError("fetch-failure", msg);
    }
    clearTimeout(timer);
    ttfbMs = Date.now() - hopStarted;

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) throw new ScanError("fetch-failure", "Redirect without a Location header.");
      if (++hops > MAX_REDIRECTS) throw new ScanError("too-many-redirects", "More than 4 redirects.");
      try {
        res.body?.cancel();
      } catch {}
      const next = new URL(loc, current);
      if (next.origin !== current.origin && opts.validateDns !== false)
        await assertResolvablePublic(next);
      current = next;
      continue;
    }

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = headers[k.toLowerCase()] ? `${headers[k.toLowerCase()]}, ${v}` : v;
    });
    const { text, bytes, truncated } = await readBodyCapped(res, abort, opts.bodyCap);
    return {
      finalUrl: current.toString(),
      status: res.status,
      headers,
      body: text,
      bytes,
      truncated,
      hops,
      ttfbMs,
    };
  }
}

/** Cheap guard for user-typed targets before we even parse them. */
export function plausibleTarget(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 2000) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return null;
    return withScheme;
  } catch {
    return null;
  }
}

/**
 * Fast-fail preflight for POST handlers: normalize, validate scheme/port/
 * credentials/host and resolve DNS through the same guards the scan will
 * use. Throws ScanError so routes can 400 before a job is created.
 */
export async function preflightTarget(raw: string): Promise<string> {
  const target = plausibleTarget(raw);
  if (!target) throw new ScanError("bad-url", "Give a public URL like example.com.");
  const u = new URL(target);
  schemeHostPort(u);
  await assertResolvablePublic(u);
  return target;
}
