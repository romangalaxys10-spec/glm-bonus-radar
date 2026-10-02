import { NextResponse } from "next/server";
import { ScanError } from "./fetcher";

/** Map scanner failures to honest HTTP statuses (no information leaks). */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ScanError) {
    const status = e.code.startsWith("bad-") || e.code.startsWith("private-") ? 400 : 502;
    return NextResponse.json({ error: e.code, message: e.message }, { status, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({ error: "scan-failure", message: "The scan could not complete. Try again." }, { status: 500, headers: { "cache-control": "no-store" } });
}

export async function readJson<T>(req: Request, maxBytes = 300_000): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new ScanError("bad-request", "Request body too large.");
  const raw = await req.text();
  if (raw.length > maxBytes) throw new ScanError("bad-request", "Request body too large.");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ScanError("bad-request", "Body must be JSON.");
  }
}
