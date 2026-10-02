#!/usr/bin/env node
/**
 * GLM Mail Server (Node edition) — zero-dependency MTA for zhelp.space-z.ai
 * ==========================================================================
 * Why a Node port of mailserver.py exists (Task 42, 2026-10-03): the portal's
 * production runtime is the platform's FC container — a slim node image built
 * from the deploy artifact. Python/aiosmtpd are NOT guaranteed there (and pip
 * state dies with every sandbox reset). node IS guaranteed (start.sh execs it).
 *
 * Contract parity with the Python stack (outbound.py / mailctl.py keep working):
 *   INBOUND  : SMTP on 0.0.0.0:2525 (MAILSERVER_PORT overrides)
 *              - rcpt @zhelp.space-z.ai with a known local part -> Maildir
 *              - external rcpt from a loopback peer -> outbound spool
 *              - anything else -> 550 (strict: no open relay)
 *   OUTBOUND : spool/outbound/queue/<id>.eml + <id>.json — SAME meta schema
 *              as queue_outbound() in mailserver.py, so the sandbox-side
 *              flush tooling (mailctl.py flush / outbound.py) reads it as-is.
 *              No auto-flush thread here: the smarthost unlock stays a
 *              sandbox operation (see README.md "Unlock delivery").
 *   ACCOUNTS : virtual mailboxes under mailboxes/<local>/Maildir
 *              glm, postmaster, abuse, admin
 *
 * The portal's own client (src/lib/mailer.ts) speaks a lock-step RFC 5321
 * dialogue: 220 banner -> EHLO 250 -> MAIL 250 -> RCPT 250 -> DATA 354 ->
 * final 250 -> QUIT. Replies are single- or multi-line, always CRLF-terminated.
 */

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DIR = process.env.MAILSERVER_DIR || path.dirname(fileURLToPath(import.meta.url));
const MAILBOXES = path.join(DIR, "mailboxes");
const QUEUE = path.join(DIR, "spool", "outbound", "queue");
const DEFERRED = path.join(DIR, "spool", "outbound", "deferred");
const SENT = path.join(DIR, "spool", "outbound", "sent");
const DOMAIN = "zhelp.space-z.ai";
const HELO_NAME = "mail.zhelp.space-z.ai";
const PORT = Number(process.env.MAILSERVER_PORT || 2525);
const LOCAL_ACCOUNTS = new Set(["glm", "postmaster", "abuse", "admin"]);
const MAX_DATA = 10 * 1024 * 1024; // 10MB hard cap on the DATA payload

for (const d of [MAILBOXES, QUEUE, DEFERRED, SENT, path.join(DIR, "logs")]) fs.mkdirSync(d, { recursive: true });
for (const acc of LOCAL_ACCOUNTS)
  for (const sub of ["new", "cur", "tmp"]) fs.mkdirSync(path.join(MAILBOXES, acc, "Maildir", sub), { recursive: true });

function log(msg) {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  console.log(
    `[${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}] ${msg}`
  );
}

let qseq = 0;
function spoolId() {
  return `${Math.floor(Date.now() / 1000)}.${process.pid}.${crypto.randomBytes(3).toString("hex")}`;
}

/** Spool an outbound message — meta schema identical to mailserver.py queue_outbound(). */
function queueOutbound(fromAddr, rcpts, raw, reason) {
  const msgId = spoolId();
  fs.writeFileSync(path.join(QUEUE, msgId + ".eml"), raw);
  fs.writeFileSync(
    path.join(QUEUE, msgId + ".json"),
    JSON.stringify(
      {
        id: msgId,
        from: fromAddr,
        rcpts,
        queued_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        attempts: 0,
        last_error: reason,
      },
      null,
      2
    )
  );
  log(`QUEUED outbound id=${msgId} from=${fromAddr} rcpts=${rcpts.join(",")} (${reason})`);
  return msgId;
}

/** Maildir delivery: write into tmp/, rename into new/ (atomic on same fs). */
function deliverLocal(acc, raw) {
  const maildir = path.join(MAILBOXES, acc, "Maildir");
  for (const sub of ["new", "cur", "tmp"]) fs.mkdirSync(path.join(maildir, sub), { recursive: true });
  const d = new Date();
  const usec = String(process.hrtime.bigint() % 1000000n).padStart(6, "0");
  const host = os.hostname().replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 32) || "localhost";
  qseq += 1;
  const name = `${Math.floor(d.getTime() / 1000)}.M${usec}P${process.pid}Q${qseq}.${host}`;
  fs.writeFileSync(path.join(maildir, "tmp", name), raw);
  fs.renameSync(path.join(maildir, "tmp", name), path.join(maildir, "new", name));
  return name;
}

/** Add Message-ID / Date / Received the way mailserver.py did — only when missing. */
function ensureHeaders(raw, peer) {
  let text = raw.toString("utf8");
  const sep = text.indexOf("\r\n\r\n");
  const head = sep === -1 ? text : text.slice(0, sep);
  const rest = sep === -1 ? "" : text.slice(sep);
  const adds = [];
  if (!/^message-id:/im.test(head)) adds.push(`Message-ID: <${spoolId()}.${crypto.randomBytes(4).toString("hex")}@${DOMAIN}>`);
  if (!/^date:/im.test(head)) adds.push(`Date: ${new Date().toUTCString()}`);
  const received =
    `Received: from ${peer} (${peer}) by ${HELO_NAME} with ESMTP id ${crypto.randomBytes(6).toString("hex")}; ` +
    `${new Date().toUTCString()}`;
  const headerBlock = [received, ...adds, head].filter(Boolean).join("\r\n");
  return Buffer.from(headerBlock + rest, "utf8");
}

function normalizePeer(addr) {
  if (!addr) return "";
  return addr.replace(/^::ffff:/, "");
}
const isLoopback = (addr) => {
  const p = normalizePeer(addr);
  return p.startsWith("127.") || p === "::1";
};

/** RCPT policy — byte-for-byte parity with mailserver.py MailHub.handle_RCPT. */
function rcptVerdict(address, peer) {
  const at = address.lastIndexOf("@");
  const local = at === -1 ? address : address.slice(0, at);
  const dom = (at === -1 ? "" : address.slice(at + 1)).toLowerCase();
  if (dom === DOMAIN && LOCAL_ACCOUNTS.has(local.toLowerCase())) return { accept: true };
  if (isLoopback(peer)) return { accept: true };
  return { accept: false, reply: `550 5.7.1 relay access denied for <${address}>\r\n` };
}

function splitRcpts(rcpts) {
  const local = [];
  const ext = [];
  for (const r of rcpts) {
    const at = r.lastIndexOf("@");
    const dom = (at === -1 ? "" : r.slice(at + 1)).toLowerCase();
    const acc = (at === -1 ? r : r.slice(0, at)).toLowerCase();
    if (dom === DOMAIN && LOCAL_ACCOUNTS.has(acc)) local.push(r);
    else if (dom === DOMAIN) local.push(r); // loopback-accepted account — Maildir-create parity with mailserver.py
    else ext.push(r);
  }
  return { local, ext };
}

const server = net.createServer((socket) => {
  const peer = normalizePeer(socket.remoteAddress);
  let buffer = Buffer.alloc(0);
  let closing = false;
  const state = {
    phase: "cmd", // cmd | data
    ehlo: false,
    mailFrom: null,
    rcpts: [],
  };

  const reply = (s) => {
    if (!closing) socket.write(s);
  };

  function finishData(payload) {
    const raw = ensureHeaders(payload, peer);
    const sender = state.mailFrom || "unknown@localhost";
    const { local, ext } = splitRcpts(state.rcpts);
    const delivered = [];
    for (const r of local) {
      const acc = r.slice(0, r.lastIndexOf("@")).toLowerCase();
      try {
        const name = deliverLocal(acc, raw);
        delivered.push(r);
        log(`DELIVERED local -> ${r} as ${name} (${raw.length} bytes) from=${sender}`);
      } catch (e) {
        log(`ERROR delivering to ${r}: ${e.message}`);
      }
    }
    if (ext.length) queueOutbound(sender, ext, raw, "external rcpt: routed to outbound queue");
    if (delivered.length) reply("250 Message accepted for delivery\r\n");
    else if (ext.length) reply("250 Message accepted (queued for outbound)\r\n");
    else reply("550 no valid recipients\r\n");
    state.mailFrom = null;
    state.rcpts = [];
  }

  function handleLine(line) {
    const verb = line.slice(0, line.indexOf(" ") === -1 ? line.length : line.indexOf(" ")).toUpperCase();
    if (verb === "EHLO" || verb === "HELO") {
      state.ehlo = true;
      state.mailFrom = null;
      state.rcpts = [];
      reply(`250-${HELO_NAME}\r\n250-SIZE ${MAX_DATA}\r\n250 8BITMIME\r\n`);
    } else if (verb === "MAIL") {
      const m = /from:\s*<([^>]*)>/i.exec(line) || /from:\s*(\S+)/i.exec(line);
      state.mailFrom = m ? m[1] : null;
      state.rcpts = [];
      reply("250 2.1.0 sender OK\r\n");
    } else if (verb === "RCPT") {
      const m = /to:\s*<([^>]*)>/i.exec(line) || /to:\s*(\S+)/i.exec(line);
      if (!state.mailFrom) return reply("503 5.5.1 Error: need MAIL command\r\n");
      if (!m || !m[1]) return reply("501 5.1.3 bad recipient address syntax\r\n");
      const v = rcptVerdict(m[1], peer);
      if (!v.accept) return reply(v.reply);
      state.rcpts.push(m[1]);
      reply("250 2.1.5 recipient OK\r\n");
    } else if (verb === "DATA") {
      if (!state.rcpts.length) return reply("503 5.5.1 Error: need RCPT command\r\n");
      state.phase = "data";
      reply("354 End data with <CR><LF>.<CR><LF>\r\n");
    } else if (verb === "RSET") {
      state.mailFrom = null;
      state.rcpts = [];
      reply("250 2.0.0 OK\r\n");
    } else if (verb === "NOOP") {
      reply("250 2.0.0 OK\r\n");
    } else if (verb === "QUIT") {
      closing = true;
      socket.end(`221 ${HELO_NAME} closing connection\r\n`);
    } else if (verb === "VRFY") {
      reply("252 2.1.5 Cannot VRFY user, but will accept message and attempt delivery\r\n");
    } else {
      reply("502 5.5.2 command not recognized\r\n");
    }
  }

  function consume() {
    // One outer loop drives BOTH phases so a single TCP chunk carrying
    // e.g. "DATA\r\n<payload>\r\n.\r\nQUIT\r\n" is fully served without
    // waiting for another read (that would deadlock lock-step clients).
    for (;;) {
      if (closing) return;
      if (state.phase === "data") {
        const term = Buffer.from("\r\n.\r\n");
        const idx = buffer.indexOf(term);
        if (idx === -1) {
          if (buffer.length > MAX_DATA) {
            log(`REJECT oversized DATA from ${peer} (${buffer.length} bytes)`);
            reply("552 5.3.4 message size exceeds fixed maximum\r\n");
            state.phase = "cmd";
            state.mailFrom = null;
            state.rcpts = [];
            buffer = Buffer.alloc(0);
            continue;
          }
          return; // keep the FULL buffer — the terminator may straddle chunks
        }
        let payload = buffer.subarray(0, idx);
        buffer = buffer.subarray(idx + term.length);
        // RFC 5321 dot-unstuffing: remove one leading "." per line
        const lines = payload.toString("utf8").split(/\r\n/);
        payload = Buffer.from(lines.map((l) => (l.startsWith(".") ? l.slice(1) : l)).join("\r\n"), "utf8");
        state.phase = "cmd";
        finishData(payload); // resets the envelope
        continue;
      }
      const idx = buffer.indexOf("\r\n");
      if (idx === -1) {
        if (buffer.length > 8192) {
          log(`REJECT oversized command buffer from ${peer}`);
          socket.destroy();
        }
        return;
      }
      const line = buffer.subarray(0, idx).toString("utf8");
      buffer = buffer.subarray(idx + 2);
      if (line.length) handleLine(line);
    }
  }

  socket.on("data", (chunk) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    try {
      consume();
    } catch (e) {
      log(`ERROR session ${peer}: ${e.message}`);
      reply("451 4.3.0 internal error\r\n");
      state.phase = "cmd";
      buffer = Buffer.alloc(0);
    }
  });
  socket.setTimeout(120_000, () => socket.destroy());
  socket.on("error", () => socket.destroy());
  log(`connection from ${peer || "unknown"}`);
  reply(`220 ${HELO_NAME} GLM Mail Server ready\r\n`);
});

server.on("error", (e) => {
  // EADDRINUSE (double boot) or any fatal socket issue must NEVER take the
  // portal boot down — exit 0 and let the still-running instance serve.
  log(`FATAL server error: ${e.message}`);
  process.exit(0);
});

server.listen(PORT, "0.0.0.0", () => {
  log(`GLM Mail Server (node) starting: ${HELO_NAME} listening on 0.0.0.0:${PORT}`);
  log(`domain=${DOMAIN} accounts=${[...LOCAL_ACCOUNTS].sort().join(",")} spool=${path.dirname(QUEUE)}`);
  log("mail server is UP (SIGTERM to stop)");
});

process.on("SIGTERM", () => {
  log("signal SIGTERM received, shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
});
