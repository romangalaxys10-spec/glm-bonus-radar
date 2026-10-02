#!/usr/bin/env python3
"""
mailctl — control CLI for GLM Mail Server (zhelp.space-z.ai)

  status            server up? queue/deferred/sent counts
  send              compose + submit a message through the server
                    --from glm@zhelp.space-z.ai --to a@b.c --subject S [--body-file F | --body TEXT]
  list [account]    list messages in a local Maildir (default: glm)
  read [account]    print newest message of a local Maildir
  flush             attempt outbound delivery of queued mail now
  transcripts       show latest transcript of every deferred/sent message
"""
import os
import sys
import json
import glob
import time
import mailbox
import argparse
import smtplib
import email
from email.message import EmailMessage

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
os.chdir(BASE)

MAILBOXES = os.path.join(BASE, "mailboxes")
SPOOL = os.path.join(BASE, "spool", "outbound")
SERVER_HOST, SERVER_PORT = "127.0.0.1", 2525
DOMAIN = "zhelp.space-z.ai"


def counts():
    out = {}
    for state in ("queue", "deferred", "sent"):
        d = os.path.join(SPOOL, state)
        out[state] = len(glob.glob(os.path.join(d, "*.json"))) if os.path.isdir(d) else 0
    return out


def server_up():
    try:
        s = smtplib.SMTP(SERVER_HOST, SERVER_PORT, timeout=5)
        s.noop()
        s.quit()
        return True
    except Exception:
        return False


def cmd_status(_):
    up = server_up()
    c = counts()
    print(f"mail server : {'UP' if up else 'DOWN'} on {SERVER_HOST}:{SERVER_PORT}")
    print(f"queue/deferred/sent : {c['queue']} / {c['deferred']} / {c['sent']}")
    for acc in sorted(os.listdir(MAILBOXES)) if os.path.isdir(MAILBOXES) else []:
        md = mailbox.Maildir(os.path.join(MAILBOXES, acc, "Maildir"), create=False)
        print(f"mailbox {acc}@{DOMAIN} : {len(md)} message(s)")


def cmd_send(args):
    msg = EmailMessage()
    msg["From"] = args.sender or f"GLM Assistant <glm@{DOMAIN}>"
    msg["To"] = args.to
    msg["Subject"] = args.subject
    msg["Date"] = email.utils.formatdate(localtime=False)
    body = open(args.body_file).read() if args.body_file else args.body
    msg.set_content(body)
    if not server_up():
        print("ERROR: mail server is not running. Start it with mailserver/start.sh")
        sys.exit(1)
    s = smtplib.SMTP(SERVER_HOST, SERVER_PORT, timeout=15)
    refused = s.send_message(msg)
    s.quit()
    print(f"ACCEPTED by server: from={msg['From']} to={args.to} subject=\"{args.subject}\"")
    if refused:
        print(f"refused rcpts: {refused}")


def cmd_list(args):
    acc = args.account or "glm"
    md = mailbox.Maildir(os.path.join(MAILBOXES, acc, "Maildir"), create=False)
    keys = sorted(md.keys(), key=lambda k: md[k].get("Date", ""))
    if not keys:
        print(f"mailbox {acc}@{DOMAIN} is empty")
        return
    for k in keys:
        m = md[k]
        print(f"- [{m.get('Date','?')}] {m.get('From','?')} :: {m.get('Subject','(no subject)')}")


def cmd_read(args):
    acc = args.account or "glm"
    md = mailbox.Maildir(os.path.join(MAILBOXES, acc, "Maildir"), create=False)
    if not md:
        print(f"mailbox {acc}@{DOMAIN} is empty")
        return
    newest = sorted(md.keys(), key=lambda k: md[k].get("Date", ""))[-1]
    m = md[newest]
    print(f"From: {m.get('From')}\nTo: {m.get('To')}\nDate: {m.get('Date')}\nSubject: {m.get('Subject')}\n")
    print(m.get_payload())


def cmd_flush(_):
    import outbound
    outbound.flush_all(reason="mailctl flush")
    c = counts()
    print(f"after flush -> queue/deferred/sent : {c['queue']} / {c['deferred']} / {c['sent']}")


def cmd_transcripts(_):
    for state in ("deferred", "sent"):
        for f in sorted(glob.glob(os.path.join(SPOOL, state, "*.transcript.txt"))):
            print(f"--- {state}/{os.path.basename(f)} ---")
            print(open(f).read().strip()[-2000:])


def main():
    p = argparse.ArgumentParser(prog="mailctl")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sp = sub.add_parser("send")
    sp.add_argument("--to", required=True)
    sp.add_argument("--from", dest="sender", default=None)
    sp.add_argument("--subject", required=True)
    b = sp.add_mutually_exclusive_group(required=True)
    b.add_argument("--body")
    b.add_argument("--body-file")
    sp.set_defaults(fn=cmd_send)
    lp = sub.add_parser("list"); lp.add_argument("account", nargs="?"); lp.set_defaults(fn=cmd_list)
    rp = sub.add_parser("read"); rp.add_argument("account", nargs="?"); rp.set_defaults(fn=cmd_read)
    sub.add_parser("flush").set_defaults(fn=cmd_flush)
    sub.add_parser("transcripts").set_defaults(fn=cmd_transcripts)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
