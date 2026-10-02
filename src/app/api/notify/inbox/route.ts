import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/notify/inbox — the received-notifications view: reads the glm@
 * Maildir (mailserver/mailboxes/glm) when this host runs the mail stack.
 * The subject/body preview stays plain text; never rendered as HTML.
 */
function decodeSubject(s: string): string {
  return s.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b64: string) => {
    try {
      return Buffer.from(b64, "base64").toString("utf8");
    } catch {
      return _;
    }
  });
}

export async function GET() {
  const glm = ["mailserver", "mailboxes", "glm", "Maildir"];
  // ORDER MATTERS (Task 42): the live operator mailbox wins over a build-time
  // copy — Next's standalone output can contain a STALE mailserver/ snapshot
  // copied from the project root at build time, so process.cwd() may point at
  // a frozen Maildir. In the FC container /home/z/my-project does not exist
  // and cwd IS the shipped copy (/app/mailserver) — still correct.
  const candidates = [
    process.env.MAILBOX_DIR,
    ["/home/z/my-project", ...glm].join("/"),
    join(process.cwd(), ...glm),
    join(process.cwd(), "..", ...glm),
  ].filter(Boolean) as string[];
  const dir = candidates.find((p) => existsSync(p));
  if (!dir)
    return NextResponse.json(
      { available: false, message: "The mailbox lives on the operator host (mailserver/); this runtime does not mount it.", tried: candidates },
      { headers: { "cache-control": "no-store" } }
    );
  const files: { path: string; mtime: number }[] = [];
  for (const sub of ["new", "cur"]) {
    const d = join(dir, sub);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      try {
        files.push({ path: p, mtime: statSync(p).mtimeMs });
      } catch {}
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const messages = files.slice(0, 20).map(({ path, mtime }) => {
    const raw = readFileSync(path, "utf8");
    const header = (name: string) => {
      const m = new RegExp(`^${name}:\\s*(.*)$`, "im").exec(raw);
      return m ? decodeSubject(m[1].trim()) : "";
    };
    const bodyStart = raw.indexOf("\r\n\r\n") >= 0 ? raw.indexOf("\r\n\r\n") + 4 : raw.indexOf("\n\n") + 2;
    const body = raw.slice(bodyStart).replace(/\r?\n\.\r?\n?[\s\S]*$/, "").replace(/=\r?\n/g, "").slice(0, 300);
    return {
      from: header("From"),
      to: header("To"),
      subject: header("Subject"),
      date: header("Date"),
      preview: body.replace(/\s+/g, " ").trim(),
      receivedAt: new Date(mtime).toISOString(),
    };
  });
  return NextResponse.json({ available: true, count: messages.length, messages }, { headers: { "cache-control": "no-store" } });
}
