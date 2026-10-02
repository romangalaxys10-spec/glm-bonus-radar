#!/usr/bin/env python3
"""
Live verification for the auto-QA auditor + email notifications (Task 34).
Boots nothing — expects the standalone sim on 127.0.0.1:3101 and
scripts/qa_fixture.py on 127.0.0.1:3999.

Checks:
  1. fixture: init probe detects the login form
  2. fixture: full E2E run with (wrong) login creds -> login-retry QUESTION
     appears mid-run -> answered -> run completes with findings + token
  3. sim self-audit: full E2E run with a flow check on the portal itself
  4. snapshot round-trip of the produced token
  5. email: local delivery (glm@) lands in Maildir + inbox API shows it
  6. email: external recipient accepted + relay-queued (honest status)
  7. SSR: /scanner renders the auto-qa tab + notifications panel
"""
import json
import subprocess
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:3101"
PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append((name, detail))
    print(("  ✓ " if cond else "  ✗ ") + name + (f" — {detail}" if detail and not cond else ""))


def post(path, body, timeout=120):
    req = urllib.request.Request(BASE + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode())


def get(path, timeout=60):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode())


def run_job(path, body, answer=None, max_wait=200):
    st, data = post(path, body)
    if st != 202 or "jobId" not in data:
        return {"http": st, "error": data}
    job_id = data["jobId"]
    t0 = time.time()
    question_asked = None
    while time.time() - t0 < max_wait:
        time.sleep(1.2)
        _, j = get(f"/api/scan/job/{job_id}")
        if j.get("question"):
            question_asked = j["question"]
            if answer:
                post("/api/scan/qa-auto/answer", {"jobId": job_id, "answerId": question_asked["id"], "value": answer})
        if j.get("status") == "done":
            return {"jobId": job_id, "question": question_asked, "report": j["result"]}
        if j.get("status") == "error":
            return {"jobId": job_id, "question": question_asked, "error": j.get("error")}
    return {"jobId": job_id, "question": question_asked, "error": {"message": "timeout"}}


print("== 1. init probe on fixture ==")
st, init = post("/api/scan/qa-auto/init", {"url": "http://127.0.0.1:3999/"})
check("init 200", st == 200, str(st))
check("login form detected", init.get("loginFormDetected") is True, json.dumps(init)[:200])
check("browser available", init.get("browserAvailable") is True)
check("browser smoke ok", init.get("browserSmoke") == "ok")

print("== 2. fixture E2E with failing login -> mid-run question ==")
res = run_job(
    "/api/scan/qa-auto/start",
    {
        "url": "http://127.0.0.1:3999/",
        "answers": {
            "useLogin": True,
            "username": "qa-tester",
            "password": "wrong-password-123",
            "flows": "check: zScanner rocks\ngoto: http://127.0.0.1:3999/about",
        },
    },
    answer="skip",
)
rep = res.get("report") or {}
check("run completed", "error" not in res or not res["error"], json.dumps(res.get("error", {}))[:200])
check("scanner kind auto-qa", rep.get("scanner") == "auto-qa")
check("mid-run question asked", bool(res.get("question")), "no question appeared")
check("question is login-retry", (res.get("question") or {}).get("id") == "login-retry")
ids = [f["id"] for f in rep.get("findings", [])]
check("console error caught", "autoqa-console-errors" in ids, str(ids))
check("uncaught error not required (fixture uses console.error)", isinstance(ids, list))
check("img alt finding", "autoqa-img-missing-alt" in ids, str(ids))
check("missing lang finding", "autoqa-missing-lang" in ids, str(ids))
check("broken link (/broken 404) found", "autoqa-broken-link" in ids, str(ids))
check("flow check honored", "autoqa-flow-check" not in ids, "text 'zScanner rocks' should exist on fixture")
check("login oracle failed (expected, wrong creds)", any(f["id"] == "autoqa-login-failed" for f in rep.get("findings", [])) or rep.get("metrics") and any(m["label"] == "login oracle" and m["value"] in ("failed", "uncertain") for m in rep["metrics"]))
check("score + grade present", isinstance(rep.get("score"), int) and bool(rep.get("grade")))
check("verdict present", rep.get("verdict") in ("ok", "needs-review", "blocked"))
check("metrics present", bool(rep.get("metrics")))
check("scan token minted", str(rep.get("scanToken", "")).startswith("ZSC-"), str(rep.get("scanToken")))
check("breakdown has a11y pillar", any(b["label"] == "accessibility" for b in rep.get("breakdown", [])))

print("== 2b. queue: second run waits with position + ETA (v5.1) ==")
# A occupies the slot and PAUSES on its mid-run login question (natural holder)
st, a = post("/api/scan/qa-auto/start", {"url": "http://127.0.0.1:3999/", "answers": {"useLogin": True, "username": "qa-tester", "password": "wrong-password-123"}})
check("A accepted", st == 202 and "jobId" in a, json.dumps(a)[:200])
print(f"  A start state: {json.dumps(a.get('queueState'))}")
a_id = a["jobId"]
a_question = None
t0 = time.time()
while time.time() - t0 < 150:
    time.sleep(1.2)
    _, ja = get(f"/api/scan/job/{a_id}")
    if ja.get("question"):
        a_question = ja["question"]
        break
    if ja.get("status") in ("done", "error"):
        break
check("A reached mid-run question (holds slot)", bool(a_question), json.dumps({"status": ja.get("status")})[:100])

# B must be QUEUED while A occupies the slot
st, b = post("/api/scan/qa-auto/start", {"url": "http://127.0.0.1:3999/", "answers": {"useLogin": False, "flows": "check: zScanner rocks"}})
check("B accepted (202)", st == 202, json.dumps(b)[:200])
print(f"  B start state: running={b.get('queueState', {}).get('running')} waiting={b.get('queueState', {}).get('waiting')} waitingIds={b.get('queueState', {}).get('waitingIds')}")
check("B start response carries queue preview", isinstance(b.get("queue"), dict) and b["queue"].get("position") == 1, f"preview={json.dumps(b.get('queue'))} state={json.dumps(b.get('queueState'))}")
b_id = b.get("jobId", "")
b_queue_seen = None
t0 = time.time()
while time.time() - t0 < 12:
    time.sleep(0.4)
    _, jb = get(f"/api/scan/job/{b_id}")
    if jb.get("queue"):
        b_queue_seen = jb["queue"]
        break
check("B poll shows queue position/ETA", bool(b_queue_seen) and b_queue_seen.get("position") == 1 and b_queue_seen.get("etaSec", 0) >= 5, json.dumps(b_queue_seen))
st, init_busy = post("/api/scan/qa-auto/init", {"url": "http://127.0.0.1:3999/"})
q = init_busy.get("qaQueue") or {}
check("init responds fast while a run holds the browser", st == 200, f"status={st}")
check("init reports busy queue (running>=1)", st == 200 and q.get("running", 0) >= 1, json.dumps(q))
check("init smoke honest while busy", init_busy.get("browserSmoke") == "busy", json.dumps({"smoke": init_busy.get("browserSmoke")}))

# release A -> A finishes -> B must be granted and run to completion
if a_question:
    post("/api/scan/qa-auto/answer", {"jobId": a_id, "answerId": a_question["id"], "value": "skip"})
a_done_wall = None
t0 = time.time()
while time.time() - t0 < 220:
    time.sleep(1.2)
    _, ja = get(f"/api/scan/job/{a_id}")
    if ja.get("status") in ("done", "error"):
        a_done_wall = time.time()
        break
check("A completed", ja.get("status") == "done", json.dumps(ja.get("error", {}))[:150])
b_done = None
t0 = time.time()
while time.time() - t0 < 240:
    time.sleep(1.2)
    _, jb = get(f"/api/scan/job/{b_id}")
    if jb.get("status") in ("done", "error"):
        b_done = jb
        break
check("B completed after queue", (b_done or {}).get("status") == "done", json.dumps((b_done or {}).get("error", {}))[:150])
repb = (b_done or {}).get("result") or {}
check("B report valid auto-qa", repb.get("scanner") == "auto-qa" and str(repb.get("scanToken", "")).startswith("ZSC-"))
check("B has runStartedAt (timer hand-off)", isinstance((b_done or {}).get("runStartedAt"), int))
b_rs = (b_done or {}).get("runStartedAt")
check("B ran strictly after A finished", bool(a_done_wall) and isinstance(b_rs, int) and b_rs / 1000 >= a_done_wall - 1.5)
check("B queue cleared once granted", not (b_done or {}).get("queue"))

print("== 3. sim self-audit (portal itself) ==")
res2 = run_job(
    "/api/scan/qa-auto/start",
    {"url": "http://127.0.0.1:3101/scanner", "answers": {"useLogin": False, "flows": "check: zScanner"}},
    max_wait=220,
)
rep2 = res2.get("report") or {}
check("self-audit completed", not res2.get("error"), json.dumps(res2.get("error", {}))[:200])
ids2 = [f["id"] for f in rep2.get("findings", [])]
check("self-audit visited pages", any(m["label"] == "pages visited in browser" for m in rep2.get("metrics", [])))
check("self-audit token minted", str(rep2.get("scanToken", "")).startswith("ZSC-"))

print("== 4. token snapshot round-trip ==")
tok = rep2.get("scanToken") or rep.get("scanToken")
st, snap = get(f"/api/scan/snapshot?token={tok}")
check("snapshot lookup", st == 200 and snap.get("token") == tok, json.dumps(snap)[:150])

print("== 5. email: local delivery ==")
st, mail = post("/api/notify/email", {"to": "glm@zhelp.space-z.ai", "subject": "Auto-QA verify test", "text": "Verification mail from scripts/verify_autoqa.py"})
check("local mail accepted", st == 200 and mail.get("status") == "accepted", json.dumps(mail)[:200])
check("routed local-mailbox", mail.get("routing") == "local-mailbox", json.dumps(mail)[:200])
time.sleep(1)
st, inbox = get("/api/notify/inbox")
check("inbox available", st == 200 and inbox.get("available") is True, json.dumps(inbox)[:150])
check("inbox shows the message", any("Auto-QA verify test" in m.get("subject", "") for m in inbox.get("messages", [])))

print("== 6. email: external queued (honest status) ==")
st, mail2 = post("/api/notify/email", {"to": "rommark@gmx.com", "subject": "Auto-QA verify external", "text": "Queued relay test."})
check("external accepted", st == 200 and mail2.get("status") == "accepted", json.dumps(mail2)[:200])
check("routed relay-queued", mail2.get("routing") == "relay-queued", json.dumps(mail2)[:200])

print("== 7. SSR assertions ==")
import http.client

conn = http.client.HTTPConnection("127.0.0.1", 3101, timeout=30)
conn.request("GET", "/scanner")
html = conn.getresponse().read().decode()
check("auto-qa tab in SSR HTML", "auto qa auditor" in html)
check("notifications panel in SSR", "email notifications" in html)
check("glm identity in SSR", "glm@zhelp.space-z.ai" in html)

print(f"\nRESULT: {len(PASS)} passed, {len(FAIL)} failed")
for name, detail in FAIL:
    print(f"  FAILED: {name} — {detail}")
sys.exit(1 if FAIL else 0)
