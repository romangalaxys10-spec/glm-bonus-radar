/**
 * GLM Radar — email notification channel (v5).
 *
 * Sends FROM the portal's own identity glm@zhelp.space-z.ai by submitting
 * to the local mail server (mailserver/mailserver.py, SMTP :2525 on
 * 127.0.0.1). The MTA delivers local mailboxes immediately and routes
 * external recipients into its outbound queue (smarthost unlock documented
 * in mailserver/README.md). Zero dependencies: a minimal RFC 5321 client
 * over node:net is enough for our own MTA.
 *
 * Identity note: per the operator's request, ALL notification email is
 * From: GLM Radar <glm@zhelp.space-z.ai> (Reply-To the same). Local
 * recipients can read their mail via /api/notify/inbox (glm Maildir).
 */

import net from "node:net";
import { randomBytes } from "node:crypto";

export const MAIL_FROM = "glm@zhelp.space-z.ai";
export const MAIL_FROM_DISPLAY = "GLM Radar <glm@zhelp.space-z.ai>";
const HOST = process.env.MAIL_SUBMIT_HOST || "127.0.0.1";
const PORT = Number(process.env.MAIL_SUBMIT_PORT || 2525);
const TIMEOUT_MS = 10_000;

export type MailResult =
  | { status: "accepted"; routing: "local-mailbox" | "relay-queued"; id: string }
  | { status: "unavailable"; detail: string }
  | { status: "rejected"; detail: string };

function b64Subject(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

/** Speak the full SMTP dialogue; resolves with the final DATA reply code. */
function smtpDialogue(rcpt: string, data: string): Promise<{ code: number; lastReply: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: HOST, port: PORT, timeout: TIMEOUT_MS });
    let buffer = "";
    let step = 0; // 0 banner,1 ehlo,2 mail,3 rcpt,4 data,5 dot
    let dataReplies = "";
    const fail = (detail: string) => {
      socket.destroy();
      reject(new Error(detail));
    };
    socket.setTimeout(TIMEOUT_MS, () => fail("mail server timeout"));
    socket.on("error", (e) => fail(`mail server unreachable: ${e.message}`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      // a reply is complete when the last line is "NNN " (space after code)
      const lines = buffer.split(/\r?\n/);
      const last = lines[lines.length - 2] ?? "";
      if (!/^\d{3}(\s|$)/.test(last) || last[3] === "-") return; // multi-line reply still open
      const code = Number(last.slice(0, 3));
      buffer = "";
      if (step === 0) {
        if (code !== 220) return fail(`greeting ${code}`);
        step = 1;
        socket.write("EHLO zhelp.space-z.ai\r\n");
      } else if (step === 1) {
        if (code !== 250) return fail(`ehlo ${code}`);
        step = 2;
        socket.write(`MAIL FROM:<${MAIL_FROM}>\r\n`);
      } else if (step === 2) {
        if (code !== 250) return fail(`mail from rejected (${code})`);
        step = 3;
        socket.write(`RCPT TO:<${rcpt}>\r\n`);
      } else if (step === 3) {
        if (code !== 250) return fail(`recipient rejected (${code})`);
        step = 4;
        socket.write("DATA\r\n");
      } else if (step === 4) {
        if (code !== 354) return fail(`data not accepted (${code})`);
        step = 5;
        socket.write(data + "\r\n.\r\n");
      } else if (step === 5) {
        dataReplies = last;
        socket.write("QUIT\r\n");
        socket.end();
        resolve({ code, lastReply: dataReplies });
      }
    });
  });
}

/** Submit a notification email; returns an honest routing verdict. */
export async function sendNotification(opts: { to: string; subject: string; text: string }): Promise<MailResult> {
  const to = opts.to.trim();
  const id = `${Date.now()}.${randomBytes(4).toString("hex")}@zhelp.space-z.ai`;
  const headers = [
    `From: ${MAIL_FROM_DISPLAY}`,
    `To: ${to}`,
    `Reply-To: ${MAIL_FROM}`,
    `Subject: ${b64Subject(opts.subject.slice(0, 200))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${id}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset=utf-8',
    "Content-Transfer-Encoding: 8bit",
    "X-Mailer: GLM-Radar-Notifications/1.0",
    "X-Origin-Server: mail.zhelp.space-z.ai",
  ].join("\r\n");
  // dot-stuffing per RFC 5321
  const body = opts.text.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..").slice(0, 60_000);
  const data = `${headers}\r\n\r\n${body}`;
  try {
    const { code } = await smtpDialogue(to, data);
    if (code !== 250) return { status: "rejected", detail: `mail server replied ${code}` };
    const local = /@zhelp\.space-z\.ai$/i.test(to);
    return {
      status: "accepted",
      routing: local ? "local-mailbox" : "relay-queued",
      id,
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown error";
    if (/unreachable|timeout/.test(detail)) return { status: "unavailable", detail };
    return { status: "rejected", detail };
  }
}
