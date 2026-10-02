# GLM Mail Server — zhelp.space-z.ai

Self-contained user-space mail stack for the domain **zhelp.space-z.ai**,
running inside the z.ai hosting sandbox as a plain Python process
(no root available: services bind :2525, not :25).

```
mailserver/
  mailserver.py        MTA: SMTP inbound on 0.0.0.0:2525 + local Maildir delivery
                       + outbound spooling + auto-flush thread (every 5 min)
  outbound.py          Delivery engine: smarthost / direct-MX / probe, with a
                       queue <-> deferred <-> sent state machine and backoff
  mailctl.py           Control CLI: status | send | list | read | flush | transcripts
  start.sh             Idempotent start / keepalive
  relay.env.example    Template for smarthost credentials (the unlock for delivery)
  mailboxes/<user>/Maildir/    Virtual accounts: glm, postmaster, abuse, admin
  spool/outbound/{queue,deferred,sent}/   Spool triples: .eml + .json + .transcript.txt
  logs/server.log      Runtime log
```

## Account

`glm@zhelp.space-z.ai` — virtual mailbox (Maildir). The sandbox has no root,
so accounts are virtual (no system users, no /etc/passwd entries). Receiving
works from inside the sandbox; receiving from the public internet is NOT
possible (the platform's ALB owns port 25/443 ingress and does not forward
SMTP — the domain's MX record points at the platform load balancer).

## Sending — current egress reality (measured 2026-10-02)

| Path | Status | Evidence |
|------|--------|----------|
| Direct-to-MX (TCP/25) | **BLOCKED** by sandbox firewall (IPv4 + IPv6, any destination) | `TCP mx00.gmx.net:25 BLOCKED -> TimeoutError` |
| Submission TCP/587 | **OPEN** | `220 gmx.net (mrgmx104) Nemesis ESMTP Service ready` |
| Submission TCP/465 | **OPEN** | connects (implicit TLS) |
| GMX handshake as mail.zhelp.space-z.ai | **ACCEPTED** | `250 gmx.net Hello mail.zhelp.space-z.ai [47.57.242.119]` |
| GMX relay without credentials | **REFUSED** | `MAIL FROM:<glm@...> -> 530 Authentication required` |
| DNS control (SPF/DKIM/MX) | **NONE** — platform-controlled | `dig TXT space-z.ai` → empty |

Conclusion: the sandbox behaves like a proper MTA (spool, retry, backoff,
verbatim transcripts), but the final hop requires a **smarthost** — exactly
like any cloud VM in 2026 (port 25 is blocked industry-wide).

## Unlock delivery (one step)

```bash
cp mailserver/relay.env.example mailserver/relay.env
# fill MAIL_SMARTHOST / MAIL_SMARTHOST_USER / MAIL_SMARTHOST_PASS with any
# provider account: GMX, Gmail (App Password), Zoho, Outlook, or an
# email-API provider (Brevo/SendGrid SMTP keys work too)
```

The auto-flush thread retries the queue every 5 minutes — the pending test
message to rommark@gmx.com goes out automatically. To flush immediately:

```bash
python3 mailserver/mailctl.py flush
```

Note: GMX/Gmail/Outlook require the From to match the account. Providers such
as Brevo/SendGrid can send with the custom From `glm@zhelp.space-z.ai` after
verifying the sender/domain (needs a DNS record we cannot publish from here).

## Security posture

- **No open relay**: external recipients are only accepted from 127.0.0.1
  submission; other peers may only mail local accounts, otherwise `550 5.7.1`.
- **Credentials**: `relay.env` holds smarthost credentials at runtime only;
  it is git-ignored and must never be committed. `relay.env.example` is the
  committed template.
- **Spool integrity**: every message is a full `.eml + .json + .transcript.txt`
  triple that moves atomically between queue/deferred/sent (no body loss).

## Quick reference

```bash
mailserver/start.sh                        # start (idempotent) / keepalive
python3 mailserver/mailctl.py status       # server + queue + mailboxes overview
python3 mailserver/mailctl.py send --to glm@zhelp.space-z.ai --subject "hi" --body "..."
python3 mailserver/mailctl.py list glm     # inbox listing
python3 mailserver/mailctl.py read glm     # newest message
python3 mailserver/mailctl.py flush        # attempt outbound delivery now
python3 mailserver/mailctl.py transcripts  # verbatim SMTP dialogues
```
