/**
 * zScanner — memory-only abuse guards (ledger verdict: the only state that
 * survives this host is process state). Per-IP token bucket, global
 * in-flight semaphore, and a TTL single-flight cache so repeated scans of
 * the same target cost one outbound fetch per TTL.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;

const buckets = new Map<string, number[]>();

/** true when the caller is over quota. */
export function overRate(key: string): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) {
    buckets.set(key, arr);
    return true;
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 5000) buckets.clear(); // hard cap on tracker memory
  return false;
}

const MAX_INFLIGHT = 3;
let inflight = 0;
const waiters: (() => void)[] = [];

export async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_INFLIGHT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
    waiters.shift()?.();
  }
}

type Entry = { at: number; value: unknown };
const cache = new Map<string, Entry>();
const inflightScans = new Map<string, Promise<unknown>>();
const TTL_MS = 10 * 60_000;

/** TTL + single-flight wrapper. Reads never extend TTL (least surprise). */
export async function cachedScan<T>(key: string, fn: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { value: hit.value as T, cached: true };
  const running = inflightScans.get(key);
  if (running) return { value: (await running) as T, cached: false };
  const p = fn()
    .then((v) => {
      cache.set(key, { at: Date.now(), value: v });
      if (cache.size > 100) {
        // evict oldest entries
        const keys = [...cache.keys()].slice(0, 50);
        for (const k of keys) {
          if (Date.now() - (cache.get(k)?.at ?? 0) > TTL_MS) cache.delete(k);
        }
      }
      return v;
    })
    .finally(() => inflightScans.delete(key));
  inflightScans.set(key, p);
  return { value: await p, cached: false };
}

/** Best-effort client IP (platform is behind a proxy that sets XFF). */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
