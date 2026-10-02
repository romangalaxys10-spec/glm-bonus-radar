#!/usr/bin/env python3
"""
mail.tm disposable inbox helper (API: https://api.mail.tm)
  create            -> creates account, saves creds to mailserver/.inbox.json (gitignored)
  messages          -> list inbox messages (id, from, subject)
  urls <pattern>    -> print all http(s) links found in messages whose subject/from matches pattern
  read <msg_id>     -> print a message body
"""
import sys, os, json, time, re, urllib.request, urllib.error

BASE = os.path.dirname(os.path.abspath(__file__))
CREDS = os.path.join(BASE, ".inbox.json")
API = "https://api.mail.tm"


def req(method, path, data=None, token=None, timeout=30):
    r = urllib.request.Request(API + path, method=method)
    r.add_header("Content-Type", "application/json")
    r.add_header("Accept", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    body = json.dumps(data).encode() if data is not None else None
    try:
        with urllib.request.urlopen(r, body, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def load():
    return json.load(open(CREDS))


def cmd_create():
    _, doms = req("GET", "/domains?page=1")
    raw = doms if isinstance(doms, list) else doms.get("hydra:member", doms.get("member", []))
    domains = [d["domain"] for d in raw if isinstance(d, dict) and d.get("isActive")]
    if not domains:
        print("no active mail.tm domains"); sys.exit(1)
    local = "glmradar" + os.urandom(3).hex()
    address = f"{local}@{domains[0]}"
    password = os.urandom(9).hex() + "Aa1!"
    code, acc = req("POST", "/accounts", {"address": address, "password": password})
    if code not in (200, 201):
        print(f"account create failed: {code} {acc}"); sys.exit(1)
    code, tok = req("POST", "/token", {"address": address, "password": password})
    if code != 200:
        print(f"token failed: {code} {tok}"); sys.exit(1)
    json.dump({"address": address, "password": password, "token": tok["token"],
               "id": acc.get("id")}, open(CREDS, "w"))
    print(f"created {address} (creds in .inbox.json, gitignored)")


def _token():
    d = load()
    return d["token"]


def _members(data):
    if isinstance(data, list):
        return data
    return data.get("hydra:member", data.get("member", []))


def cmd_messages():
    d = load()
    code, data = req("GET", "/messages?page=1", token=d["token"])
    msgs = _members(data)
    if not msgs:
        print("(inbox empty)")
    for m in msgs:
        frm = (m.get("from") or {}).get("address", "?")
        print(f"[{m['id']}] {m.get('createdAt','')} from={frm} subj={m.get('subject','')}")


def cmd_urls(pattern):
    d = load()
    code, data = req("GET", "/messages?page=1", token=d["token"])
    for m in _members(data):
        hay = f"{(m.get('from') or {}).get('address','')} {m.get('subject','')}"
        if re.search(pattern, hay, re.I):
            code, full = req("GET", "/messages/" + m["id"], token=d["token"])
            text = (full.get("text") or "") + " " + (full.get("html") and " ".join(full["html"]) or "")
            for url in set(re.findall(r"https?://[^\s\"'<>)]+", text)):
                print(url)


def cmd_read(msg_id):
    d = load()
    code, full = req("GET", "/messages/" + msg_id, token=d["token"])
    print("From:", (full.get("from") or {}).get("address"))
    print("Subject:", full.get("subject"))
    print((full.get("text") or "(no text part)")[:3000])


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "create":
        cmd_create()
    elif cmd == "messages":
        cmd_messages()
    elif cmd == "urls":
        cmd_urls(sys.argv[2] if len(sys.argv) > 2 else ".")
    elif cmd == "read":
        cmd_read(sys.argv[2])
    else:
        print(__doc__)
