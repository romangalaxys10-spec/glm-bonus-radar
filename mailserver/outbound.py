#!/usr/bin/env python3
"""
Outbound queue manager for GLM Mail Server (zhelp.space-z.ai).

Delivery policy per message, in order:
  1. smarthost   — if mailserver/relay.env defines MAIL_SMARTHOST (+ optional
                   MAIL_SMARTHOST_USER/PASS, MAIL_SMARTHOST_MODE=starttls|ssl),
                   relay through it. This is the only path that works in this
                   sandbox (TCP/25 egress is firewall-blocked; 587/465 are open).
  2. direct MX   — real-MTA behaviour: resolve recipient MX, attempt port 25.
                   Currently every attempt fails with a timeout because the
                   sandbox blocks TCP/25 egress; each failure is logged verbatim.
  3. probe       — on attempt #1 only: anonymous handshake with a public
                   submission host (mail.gmx.net:587) to capture the exact
                   remote response (530 auth required) for the transcript.

State machine:  queue -> deferred -> (retry with backoff) -> deferred | sent
Every message keeps its full spool triple (.eml + .json + .transcript.txt) in
exactly one of spool/outbound/{queue,deferred,sent}/ — files MOVE between
states, never get lost. Deferred messages are retried when due (backoff
4m,16m,64m,256m,1024m, capped 6h) by flush_all(), which the mail server calls
every 5 minutes (auto-flush) and mailctl flush calls on demand.
"""
import os
import sys
import json
import time
import socket
import smtplib
import ssl
import subprocess
from email import message_from_bytes

BASE = os.path.dirname(os.path.abspath(__file__))
SPOOL = os.path.join(BASE, "spool", "outbound")
QUEUE = os.path.join(SPOOL, "queue")
DEFERRED = os.path.join(SPOOL, "deferred")
SENT = os.path.join(SPOOL, "sent")
RELAY_ENV = os.path.join(BASE, "relay.env")
HELO_NAME = "mail.zhelp.space-z.ai"
PROBE_HOST = ("mail.gmx.net", 587)  # GMX submission; recipient domain is gmx.com

sys.path.insert(0, BASE)
os.chdir(BASE)


def log(msg: str):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [outbound] {msg}", flush=True)


def load_relay():
    if not os.path.exists(RELAY_ENV):
        return None
    cfg = {}
    for line in open(RELAY_ENV):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            cfg[k.strip()] = v.strip()
    if not cfg.get("MAIL_SMARTHOST"):
        return None
    return cfg


def mx_lookup(domain: str):
    try:
        out = subprocess.run(["dig", "+short", "MX", domain],
                             capture_output=True, text=True, timeout=10).stdout
        rows = []
        for line in out.splitlines():
            parts = line.split()
            if len(parts) == 2:
                rows.append((int(parts[0]), parts[1].rstrip(".")))
        rows.sort()
        return [h for _, h in rows]
    except Exception as e:
        log(f"MX lookup failed for {domain}: {e}")
        return []


def smtp_dialog_probe(transcript, host, port, sender=None, rcpt=None):
    """Anonymous SMTP handshake + envelope probe; records exact server responses."""
    try:
        srv = smtplib.SMTP(host, port, timeout=20)
        code, banner = srv.ehlo(HELO_NAME)
        transcript.append(f">> EHLO {HELO_NAME} -> {code} {banner.decode(errors='replace')[:120]}")
        code, resp = srv.starttls(context=ssl.create_default_context())
        transcript.append(f">> STARTTLS -> {code} {resp.decode(errors='replace')[:120]}")
        srv.ehlo(HELO_NAME)
        if sender and rcpt:
            try:
                code, resp = srv.docmd("MAIL", f"FROM:<{sender}>")
                transcript.append(f">> MAIL FROM:<{sender}> -> {code} {resp.decode(errors='replace')[:160]}")
                code, resp = srv.docmd("RCPT", f"TO:<{rcpt}>")
                transcript.append(f">> RCPT TO:<{rcpt}> -> {code} {resp.decode(errors='replace')[:160]}")
            except smtplib.SMTPServerDisconnected as e:
                transcript.append(f">> server disconnected mid-dialogue: {e}")
        srv.quit()
        return True
    except Exception as e:
        transcript.append(f">> {host}:{port} {type(e).__name__}: {e}")
        return False


def try_direct_mx(rcpt_domain, transcript):
    mxs = mx_lookup(rcpt_domain) or [f"{rcpt_domain}."]
    log(f"direct-MX for {rcpt_domain}: {', '.join(mxs)}")
    for mx in mxs[:3]:
        try:
            s = socket.create_connection((mx, 25), timeout=8)
            banner = s.recv(128).decode(errors="replace").strip()[:100]
            s.close()
            transcript.append(f">> TCP {mx}:25 CONNECTED, banner: {banner}")
            return True  # full dialogue would continue here once TCP/25 is reachable
        except Exception as e:
            transcript.append(f">> TCP {mx}:25 BLOCKED -> {type(e).__name__}: {e}")
    return False


def deliver_via_smarthost(cfg, msg, sender, rcpts, transcript):
    host = cfg["MAIL_SMARTHOST"]
    port = int(cfg.get("MAIL_SMARTHOST_PORT", "587"))
    mode = cfg.get("MAIL_SMARTHOST_MODE", "starttls")
    try:
        if mode == "ssl":
            srv = smtplib.SMTP_SSL(host, port, timeout=25,
                                   context=ssl.create_default_context())
            srv.ehlo(HELO_NAME)
        else:
            srv = smtplib.SMTP(host, port, timeout=25)
            srv.ehlo(HELO_NAME)
            srv.starttls(context=ssl.create_default_context())
            srv.ehlo(HELO_NAME)
        if cfg.get("MAIL_SMARTHOST_USER"):
            srv.login(cfg["MAIL_SMARTHOST_USER"], cfg.get("MAIL_SMARTHOST_PASS", ""))
        refused = srv.sendmail(sender, rcpts, msg.as_bytes())
        srv.quit()
        if refused:
            transcript.append(f">> smarthost refused rcpts: {refused}")
            return False
        transcript.append(f">> smarthost {host}:{port} ACCEPTED message for {','.join(rcpts)}")
        return True
    except Exception as e:
        transcript.append(f">> smarthost {host}:{port} ERROR -> {type(e).__name__}: {e}")
        return False


def _locate(mid):
    for state in ("queue", "deferred", "sent"):
        if os.path.exists(os.path.join(SPOOL, state, mid + ".json")):
            return state
    return None


def _due(meta):
    ts = meta.get("next_attempt_epoch")
    if ts is None:
        return True
    return time.time() >= float(ts)


def flush_all(reason="manual"):
    relay = load_relay()
    ids = []
    if os.path.isdir(QUEUE):
        ids += [f[: -len(".json")] for f in os.listdir(QUEUE) if f.endswith(".json")]
    due_ids = []
    if os.path.isdir(DEFERRED):
        for f in os.listdir(DEFERRED):
            if not f.endswith(".json"):
                continue
            try:
                meta = json.load(open(os.path.join(DEFERRED, f)))
            except Exception:
                continue
            if _due(meta):
                due_ids.append(f[: -len(".json")])
    if ids or due_ids:
        log(f"flush_all({reason}): {len(ids)} queued + {len(due_ids)} deferred due, "
            f"smarthost={'CONFIGURED' if relay else 'not configured'}")
    for mid in ids + due_ids:
        flush_one(mid, relay)


def flush_one(mid, relay=None):
    state = _locate(mid)
    if state is None:
        return
    cur = os.path.join(SPOOL, state)
    meta = json.load(open(os.path.join(cur, mid + ".json")))
    eml_path = os.path.join(cur, mid + ".eml")
    if not os.path.exists(eml_path):
        os.remove(os.path.join(cur, mid + ".json"))
        return

    meta["attempts"] = meta.get("attempts", 0) + 1
    attempt = meta["attempts"]
    sender, rcpts = meta["from"], meta["rcpts"]
    rcpt_domain = rcpts[0].partition("@")[2].lower()
    transcript = [f"=== delivery attempt #{attempt} @ {time.strftime('%Y-%m-%d %H:%M:%S')} "
                  f"for <{rcpts[0]}> (from <{sender}>) ==="]

    delivered = False
    if relay:
        msg = message_from_bytes(open(eml_path, "rb").read())
        delivered = deliver_via_smarthost(relay, msg, sender, rcpts, transcript)
    if not delivered:
        if not try_direct_mx(rcpt_domain, transcript):
            if attempt == 1:
                transcript.append(f">> probe: anonymous submission handshake with {PROBE_HOST[0]}:{PROBE_HOST[1]}")
                smtp_dialog_probe(transcript, PROBE_HOST[0], PROBE_HOST[1],
                                  sender=sender, rcpt=rcpts[0])
            else:
                transcript.append(">> (submission probe skipped; see attempt #1 transcript)")

    # append transcript (stays with the message through state changes)
    with open(os.path.join(cur, mid + ".transcript.txt"), "a") as f:
        f.write("\n".join(transcript) + "\n")

    if delivered:
        meta["last_error"] = "delivered"
        meta["delivered_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    else:
        summary = next((l for l in transcript if "530" in l), None) \
            or next((l for l in transcript if "BLOCKED" in l), None) \
            or transcript[-1]
        meta["last_error"] = summary[:220]
        meta["status_hint"] = ("no smarthost configured and TCP/25 egress is blocked; "
                               "add provider credentials to mailserver/relay.env "
                               "(see relay.env.example) and the auto-flush will deliver")
    meta["last_attempt"] = time.strftime("%Y-%m-%d %H:%M:%S")
    dest_state = "sent" if delivered else "deferred"
    if not delivered:
        backoff = min(60 * (4 ** min(attempt, 6)), 6 * 3600)  # 4m,16m,64m,256m,1024m, cap 6h
        meta["next_attempt_epoch"] = time.time() + backoff
        meta["next_attempt"] = time.strftime("%Y-%m-%d %H:%M:%S",
                                             time.localtime(meta["next_attempt_epoch"]))
        log(f"DEFERRED id={mid} attempt#{attempt}: {meta['last_error'][:140]} | retry in {backoff//60}m")
    else:
        log(f"SENT id={mid} via smarthost -> {','.join(rcpts)}")

    json.dump(meta, open(os.path.join(cur, mid + ".json"), "w"), indent=2)
    if dest_state != state:  # move the full spool triple
        dest_dir = os.path.join(SPOOL, dest_state)
        for suffix in (".eml", ".json", ".transcript.txt"):
            src = os.path.join(cur, mid + suffix)
            if os.path.exists(src):
                os.replace(src, os.path.join(dest_dir, mid + suffix))


if __name__ == "__main__":
    flush_all(reason="cli")
