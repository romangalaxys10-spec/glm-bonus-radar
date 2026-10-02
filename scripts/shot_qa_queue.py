"""zScanner v5.1 — QUEUE user-experience verification (browser golden path).

Scenario: the QA slot is occupied by a paused run (mid-run login question).
A second user prepares an audit in the UI and runs it:
  1. questionnaire shows the busy line (running/queued counts) + busy chip
  2. the run is ACCEPTED and the progress bar shows the queue state
     ("in queue — position 1 of 1 waiting · starts in ≈ Ns")
  3. when the holder's question is answered (via API), the queued UI run
     starts automatically and renders a normal report.
Screenshot: queue progress bar (light).
"""
import json
import re
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:3101/scanner"
FIXTURE = "http://127.0.0.1:3999/"
OUT_QUEUE = "/home/z/my-project/download/zscanner-v51-qa-queue.png"
OUT_REPORT = "/home/z/my-project/download/zscanner-v51-qa-queue-report.png"

failures: list[str] = []


def post(path, body, timeout=60):
    req = urllib.request.Request("http://127.0.0.1:3101" + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def get(path, timeout=30):
    with urllib.request.urlopen("http://127.0.0.1:3101" + path, timeout=timeout) as r:
        return json.loads(r.read().decode())


# ---- [0] occupy the slot: run A pauses on its mid-run login question ----
a = post("/api/scan/qa-auto/start", {"url": FIXTURE, "answers": {"useLogin": True, "username": "qa-tester", "password": "wrong-password-123"}})
a_id = a["jobId"]
a_question = None
t0 = time.time()
while time.time() - t0 < 150:
    time.sleep(1.2)
    ja = get(f"/api/scan/job/{a_id}")
    if ja.get("question"):
        a_question = ja["question"]
        break
    if ja.get("status") in ("done", "error"):
        break
if not a_question:
    print("FATAL: holder run A never paused on a question — scenario impossible")
    sys.exit(1)
print("[setup] run A holds the slot (question pending)")

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 1200}, device_scale_factor=2)
    page = ctx.new_page()
    page.add_init_script("localStorage.setItem('br-mode','light')")
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(800)
    app = page.locator("section#security")

    # [1] prepare audit -> questionnaire shows busy telemetry
    page.get_by_role("tab", name="auto qa auditor").click()
    page.get_by_placeholder(re.compile("your-app.example.com")).fill(FIXTURE)
    page.get_by_role("button", name="Prepare audit").click()
    app.get_by_text("Before the run — the auditor asks:").wait_for(timeout=60_000)
    if not app.get_by_text(re.compile("browser busy — your run will queue")).is_visible():
        failures.append("busy chip missing")
    if not app.get_by_text(re.compile(r"auto-QA is busy — 1 running")).is_visible():
        failures.append("busy queue line missing")
    print("[1] questionnaire shows busy telemetry (chip + queue line)")

    # uncheck the login box (fixture auto-detects a login form; the queued UI
    # run should stay unauthenticated so it completes without questions)
    page.get_by_role("checkbox", name=re.compile("A login form was detected")).click()

    # [2] run -> accepted -> queue progress bar with position + ETA
    page.get_by_role("button", name="Run full E2E audit").click()
    app.get_by_text(re.compile(r"in queue — position 1 of \d+ waiting")).wait_for(timeout=20_000)
    if not app.get_by_text(re.compile(r"starts in ≈")).is_visible():
        failures.append("queue ETA label missing")
    print("[2] queue progress bar visible (position + ETA)")
    app.screenshot(path=OUT_QUEUE)

    # [3] release A -> the UI's queued run starts automatically -> report
    post("/api/scan/qa-auto/answer", {"jobId": a_id, "answerId": a_question["id"], "value": "skip"})
    print("[3] A's question answered — queued UI run should start")
    deadline = time.time() + 300
    rendered = False
    while time.time() < deadline:
        time.sleep(1.5)
        txt = app.inner_text()
        if re.search(r"findings · \d+ ms", txt):
            rendered = True
            break
    if not rendered:
        failures.append("queued UI run never rendered a report")
    elif not re.search(r"ZSC(-[A-Z2-9]{4}){4}", app.inner_text()):
        failures.append("queued run report token missing")
    else:
        print("[4] queued UI run completed with a full report")
        app.screenshot(path=OUT_REPORT)
    ctx.close()
    browser.close()

if failures:
    print("FAILURES:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("V5.1 QUEUE GOLDEN PATH: ALL GREEN")
