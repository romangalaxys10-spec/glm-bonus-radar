import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  DEV_KEY_PREFIX,
  EXEC_TIMEOUT_MS,
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
  devTokenMatches,
  extractDevToken,
  getOrCreateDevToken,
  resolveProjectPath,
  rotateDevToken,
  trimOutput,
} from "@/lib/devkey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dev Control — remote project management for the owner's paired agents.
 *
 * POST /api/dev   { action: "status" }
 *                 { action: "read",   path: "src/app/page.tsx" }
 *                 { action: "list",   dir:  "src/components" }
 *                 { action: "write",  path: "src/x.ts", content: "…" }
 *                 { action: "delete", path: "src/x.ts" }
 *                 { action: "exec",   command: "bun install" }
 *                 { action: "rotate" }          -> new pairing token
 *
 * Every action requires `Authorization: Bearer zdev_…`.
 * Protected paths (never readable/writable): .env*, .git, node_modules,
 * .next, .zscripts/cache, db/custom.db.
 *
 * Agent pairing (one-time setup — token lives in .env DEV_PUSH_TOKEN / DB):
 *   curl -X POST https://zhelp.space-z.ai/api/dev \
 *     -H "Authorization: Bearer zdev_…" -H "Content-Type: application/json" \
 *     -d '{"action":"write","path":"src/app/hello.tsx","content":"…"}'
 *
 * NOTE on deploys: the sandbox dev server hot-reloads edited files; the
 * deployed zhelp bundle only changes after `exec` a build + a platform
 * Deploy click (build.sh packs what `bun run build` produced).
 */

const execFileP = promisify(execFile);

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/dev",
    auth: `Authorization: Bearer ${DEV_KEY_PREFIX}…`,
    actions: ["status", "read", "list", "write", "delete", "exec", "rotate"],
    note: "Remote project management for the owner's paired agents. Token issued by the owner — never shown here.",
  });
}

/** Readiness probe (no secrets returned). */
export async function HEAD() {
  const row = await getOrCreateDevToken();
  return new NextResponse(null, {
    status: 200,
    headers: { "x-dev-token-ready": row ? "1" : "0" },
  });
}

export async function POST(req: NextRequest) {
  const token = extractDevToken(req);
  if (!(await devTokenMatches(token))) {
    return NextResponse.json(
      { error: "Unauthorized — pair your agent with the dev endpoint's Bearer token." },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  switch (action) {
    case "status":
      return status();
    case "read":
      return readFile(body.path);
    case "read_file":
      return readFile(body.path ?? body.file);
    case "list":
      return listDir(body.dir);
    case "write":
      return writeFile(body.path, body.content);
    case "write_file":
      return writeFile(body.path ?? body.file, body.content);
    case "delete":
      return deletePath(body.path);
    case "exec":
      return execCommand(body.command);
    case "run":
      return execCommand(body.command ?? body.cmd);
    case "rotate": {
      const row = await rotateDevToken();
      return NextResponse.json({
        rotated: true,
        note: "Store this now — the old token is dead. env DEV_PUSH_TOKEN (if set) still works.",
        token: row.token,
      });
    }
    default:
      return NextResponse.json(
        { error: `Unknown action "${action}". Use: status | read | list | write | delete | exec | rotate.` },
        { status: 400 },
      );
  }
}

/* -------------------------------- actions -------------------------------- */

async function status() {
  const [git] = await Promise.allSettled([
    execFileP("git", ["log", "-1", "--format=%h %s"], { timeout: 5_000 }),
  ]);
  return NextResponse.json({
    ok: true,
    projectRoot: process.cwd(),
    git: git.status === "fulfilled" ? git.value.stdout.trim() : "git unavailable",
    runtime: `node ${process.version}, up ${Math.round(process.uptime())}s`,
  });
}

async function readFile(rawPath: unknown) {
  const check = resolveProjectPath(rawPath);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 403 });
  try {
    const stat = await fs.stat(check.abs);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: `"${check.rel}" is a directory — use action "list".` }, { status: 400 });
    }
    if (stat.size > MAX_READ_BYTES) {
      return NextResponse.json(
        { error: `File is ${stat.size} bytes — read cap is ${MAX_READ_BYTES}. Fetch it in parts via exec (e.g. "sed -n '1,500p' file").` },
        { status: 413 },
      );
    }
    const content = await fs.readFile(check.abs, "utf8");
    return NextResponse.json({ ok: true, path: check.rel, bytes: stat.size, content });
  } catch {
    return NextResponse.json({ error: `No such file: ${check.rel}` }, { status: 404 });
  }
}

async function listDir(rawDir: unknown) {
  const check = resolveProjectPath(typeof rawDir === "string" && rawDir.trim() ? rawDir : ".");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 403 });
  try {
    const entries = await fs.readdir(check.abs, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (e) => {
        let size: number | null = null;
        if (e.isFile()) {
          try {
            size = (await fs.stat(path.join(check.abs, e.name))).size;
          } catch {
            size = null;
          }
        }
        return { name: e.name, type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other", size };
      }),
    );
    return NextResponse.json({ ok: true, dir: check.rel, count: items.length, items });
  } catch {
    return NextResponse.json({ error: `No such directory: ${check.rel}` }, { status: 404 });
  }
}

async function writeFile(rawPath: unknown, rawContent: unknown) {
  const check = resolveProjectPath(rawPath);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 403 });
  if (typeof rawContent !== "string") {
    return NextResponse.json({ error: "content must be a string." }, { status: 400 });
  }
  if (Buffer.byteLength(rawContent, "utf8") > MAX_WRITE_BYTES) {
    return NextResponse.json({ error: `content exceeds the ${MAX_WRITE_BYTES}-byte write cap.` }, { status: 413 });
  }
  await fs.mkdir(path.dirname(check.abs), { recursive: true });
  await fs.writeFile(check.abs, rawContent, "utf8");
  return NextResponse.json({
    ok: true,
    path: check.rel,
    bytes: Buffer.byteLength(rawContent, "utf8"),
    note: "Written. The sandbox dev server hot-reloads src/ changes; the deployed bundle needs `exec bun run build` + a platform Deploy click.",
  });
}

async function deletePath(rawPath: unknown) {
  const check = resolveProjectPath(rawPath);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 403 });
  try {
    const stat = await fs.stat(check.abs);
    if (stat.isDirectory()) {
      await fs.rmdir(check.abs); // only EMPTY dirs — refuses recursively
      return NextResponse.json({ ok: true, deleted: check.rel, kind: "empty-dir" });
    }
    await fs.unlink(check.abs);
    return NextResponse.json({ ok: true, deleted: check.rel, kind: "file" });
  } catch (e) {
    const msg =
      e instanceof Error && "code" in e && e.code === "ENOTEMPTY"
        ? "Directory not empty — delete its files first."
        : `No such file: ${check.rel}`;
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}

async function execCommand(rawCommand: unknown) {
  if (typeof rawCommand !== "string" || !rawCommand.trim()) {
    return NextResponse.json({ error: "command must be a non-empty string." }, { status: 400 });
  }
  if (rawCommand.length > 4_000) {
    return NextResponse.json({ error: "command too long (4k char cap)." }, { status: 400 });
  }
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileP("bash", ["-lc", rawCommand], {
      cwd: process.cwd(),
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    return NextResponse.json({
      ok: true,
      exitCode: 0,
      durationMs: Date.now() - started,
      stdout: trimOutput(stdout),
      stderr: trimOutput(stderr),
    });
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    return NextResponse.json(
      {
        ok: false,
        exitCode: typeof err.code === "number" ? err.code : 1,
        killed: err.killed === true,
        durationMs: Date.now() - started,
        stdout: trimOutput(err.stdout ?? ""),
        stderr: trimOutput(err.stderr ?? String(e)),
      },
      { status: 200 },
    );
  }
}
