#!/usr/bin/env python3
"""
GLM Mail Server — virtual-mailbox MTA for zhelp.space-z.ai
===========================================================
User-space mail server (no root available in sandbox):

  INBOUND  : SMTP on 0.0.0.0:2525
             - rcpt @zhelp.space-z.ai with a known local part -> Maildir delivery
             - any other rcpt -> 550 (strict: no open relay)
  OUTBOUND : external rcpts are spooled to spool/outbound/queue
             and flushed by outbound.py (smarthost via relay.env, else direct-MX attempt)
  ACCOUNTS : one directory per local part under mailboxes/<user>/Maildir
             current account: glm@zhelp.space-z.ai

Also runs a background auto-flush thread (every 300s) so queued mail
goes out as soon as smarthost credentials appear in relay.env.
"""
import os
import sys
import json
import time
import email
import mailbox
import socket
import threading
import signal
from email.message import EmailMessage
from email.utils import make_msgid, formatdate

BASE = os.path.dirname(os.path.abspath(__file__))
MAILBOXES = os.path.join(BASE, "mailboxes")
SPOOL = os.path.join(BASE, "spool", "outbound")
QUEUE = os.path.join(SPOOL, "queue")
LOGS = os.path.join(BASE, "logs")
DOMAIN = "zhelp.space-z.ai"
HELO_NAME = "mail.zhelp.space-z.ai"
PORT = int(os.environ.get("MAILSERVER_PORT", "2525"))
LOCAL_ACCOUNTS = {"glm", "postmaster", "abuse", "admin"}  # virtual accounts

sys.path.insert(0, BASE)
os.chdir(BASE)

for d in (MAILBOXES, QUEUE, os.path.join(SPOOL, "deferred"), os.path.join(SPOOL, "sent"), LOGS):
    os.makedirs(d, exist_ok=True)
for acc in LOCAL_ACCOUNTS:
    for sub in ("new", "cur", "tmp"):
        os.makedirs(os.path.join(MAILBOXES, acc, "Maildir", sub), exist_ok=True)


def log(msg: str):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)


def queue_outbound(from_addr: str, rcpt_addrs: list, data: bytes, reason: str):
    """Spool a message for outbound delivery via outbound.py"""
    msg_id = f"{int(time.time())}.{os.getpid()}.{os.urandom(3).hex()}"
    with open(os.path.join(QUEUE, msg_id + ".eml"), "wb") as f:
        f.write(data)
    meta = {
        "id": msg_id,
        "from": from_addr,
        "rcpts": rcpt_addrs,
        "queued_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "attempts": 0,
        "last_error": reason,
    }
    with open(os.path.join(QUEUE, msg_id + ".json"), "w") as f:
        json.dump(meta, f, indent=2)
    log(f"QUEUED outbound id={msg_id} from={from_addr} rcpts={','.join(rcpt_addrs)} ({reason})")
    return msg_id


class MailHub:
    """aiosmtpd handler: local delivery + outbound spooling, no open relay."""

    async def handle_RCPT(self, server, session, envelope, address, rcpt_options):
        local, _, domain = address.partition("@")
        domain = domain.lower()
        peer = session.peer[0] if session.peer else ""
        if domain == DOMAIN and local.lower() in LOCAL_ACCOUNTS:
            envelope.rcpt_tos.append(address)
            session.rcpt_addrs = getattr(session, "rcpt_addrs", [])
            session.rcpt_addrs.append(address)
            return "250 OK"
        # policy: we are NOT an open relay; external rcpt only from localhost submission
        if peer.startswith("127."):
            envelope.rcpt_tos.append(address)
            session.rcpt_addrs = getattr(session, "rcpt_addrs", [])
            session.rcpt_addrs.append(address)
            return "250 OK (queued for outbound)"
        return f"550 5.7.1 relay access denied for <{address}>"

    async def handle_DATA(self, server, session, envelope):
        peer = session.peer[0] if session.peer else "?"
        rcpts = getattr(session, "rcpt_addrs", envelope.rcpt_tos)
        sender = envelope.mail_from or "unknown@localhost"
        try:
            msg = email.message_from_bytes(envelope.content)
        except Exception as e:
            log(f"REJECT unparseable DATA from {peer}: {e}")
            return "500 5.3.0 message unparseable"

        if not msg.get("Message-ID"):
            msg["Message-ID"] = make_msgid(domain=DOMAIN)
        if not msg.get("Date"):
            msg["Date"] = formatdate(localtime=False)
        received = (
            f"from {peer} ({peer}) by {HELO_NAME} "
            f"with ESMTP id {os.urandom(6).hex()}; {formatdate(localtime=False)}"
        )
        msg["Received"] = received
        raw = msg.as_bytes()

        local_rcpts, ext_rcpts = [], []
        for r in rcpts:
            local, _, dom = r.partition("@")
            (local_rcpts if dom.lower() == DOMAIN else ext_rcpts).append(r)

        delivered = []
        for r in local_rcpts:
            acc = r.partition("@")[0].lower()
            try:
                md = mailbox.Maildir(os.path.join(MAILBOXES, acc, "Maildir"), create=True)
                md.add(raw)
                md.flush()
                delivered.append(r)
                log(f"DELIVERED local -> {r} ({len(raw)} bytes) from={sender}")
            except Exception as e:
                log(f"ERROR delivering to {r}: {e}")

        if ext_rcpts:
            queue_outbound(sender, ext_rcpts, raw, "external rcpt: routed to outbound queue")

        if delivered:
            return "250 Message accepted for delivery"
        if ext_rcpts:
            return "250 Message accepted (queued for outbound)"
        return "550 no valid recipients"


def start_auto_flush():
    def loop():
        import outbound
        while True:
            try:
                outbound.flush_all(reason="auto-flush")
            except Exception as e:
                log(f"auto-flush error: {e}")
            time.sleep(300)
    t = threading.Thread(target=loop, daemon=True, name="auto-flush")
    t.start()
    return t


def main():
    try:
        from aiosmtpd.controller import Controller
    except ImportError:
        log("FATAL: aiosmtpd not installed. Run: pip3 install aiosmtpd")
        sys.exit(1)

    log(f"GLM Mail Server starting: {HELO_NAME} listening on 0.0.0.0:{PORT}")
    log(f"domain={DOMAIN} accounts={sorted(LOCAL_ACCOUNTS)} spool={SPOOL}")
    controller = Controller(MailHub(), hostname="0.0.0.0", port=PORT)
    controller.start()
    start_auto_flush()
    log("mail server is UP (SIGTERM to stop)")

    stop = threading.Event()
    def _sig(signum, frame):
        log(f"signal {signum} received, shutting down")
        stop.set()
    signal.signal(signal.SIGTERM, _sig)
    signal.signal(signal.SIGINT, _sig)
    while not stop.is_set():
        stop.wait(1.0)
    controller.stop()
    log("mail server stopped")


if __name__ == "__main__":
    main()
