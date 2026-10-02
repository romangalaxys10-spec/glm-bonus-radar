import { NextResponse } from "next/server";
import { sendNotification } from "@/lib/mailer";
import { clientKey, overRate } from "@/lib/scanner/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * POST /api/notify/email — send a notification email FROM
 * glm@zhelp.space-z.ai (the portal's own account). Local recipients
 * (@zhelp.space-z.ai) land in the mailbox immediately; external recipients
 * are queued by the MTA and delivered as soon as its smarthost relay is
 * configured (see mailserver/README.md).
 */
export async function POST(req: Request) {
  if (overRate(`mail:${clientKey(req)}`))
    return NextResponse.json({ error: "rate-limited", message: "Too many emails — try again in a minute." }, { status: 429, headers: { "cache-control": "no-store" } });
  let body: { to?: string; subject?: string; text?: string; html?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad-json", message: "Body must be JSON." }, { status: 400 });
  }
  const to = (body.to ?? "").trim();
  const subject = (body.subject ?? "").trim();
  const text = (body.text ?? "").trim();
  if (!EMAIL_RE.test(to) || to.length > 320)
    return NextResponse.json({ error: "bad-to", message: "Provide a valid recipient email." }, { status: 400 });
  if (!subject || subject.length > 200)
    return NextResponse.json({ error: "bad-subject", message: "Subject must be 1–200 characters." }, { status: 400 });
  if (!text || text.length > 8000)
    return NextResponse.json({ error: "bad-text", message: "Body text must be 1–8000 characters." }, { status: 400 });

  const result = await sendNotification({ to, subject, text });
  if (result.status === "accepted")
    return NextResponse.json(
      {
        ...result,
        detail:
          result.routing === "local-mailbox"
            ? `Delivered to the ${to} mailbox (read it under “notifications inbox”).`
            : "Accepted by the mail server and queued for the outbound relay — external delivery starts as soon as the relay credentials are configured.",
      },
      { headers: { "cache-control": "no-store" } }
    );
  return NextResponse.json(
    {
      ...result,
      message:
        result.status === "unavailable"
          ? `Mail server not reachable on this host: ${result.detail}`
          : `Mail server refused the message: ${result.detail}`,
    },
    { status: result.status === "unavailable" ? 503 : 502, headers: { "cache-control": "no-store" } }
  );
}
