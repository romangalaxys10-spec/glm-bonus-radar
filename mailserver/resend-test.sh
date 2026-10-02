#!/bin/bash
# Re-queue the pending test email after a sandbox restart
# (the spool is runtime state; this restores it from the committed evidence copy).
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
EML="$DIR/pending-test.eml"
"$DIR/start.sh"
python3 - "$EML" <<'EOF'
import sys, os, json, time, smtplib, email
from email import message_from_bytes
BASE = "/home/z/my-project/mailserver"
raw = open(sys.argv[1], "rb").read()
msg = message_from_bytes(raw)
mid = f"{int(time.time())}.resend.{os.urandom(3).hex()}"
q = os.path.join(BASE, "spool", "outbound", "queue")
os.makedirs(q, exist_ok=True)
open(os.path.join(q, mid + ".eml"), "wb").write(raw)
json.dump({"id": mid, "from": msg["From"], "rcpts": [msg["To"].replace("GLM Assistant <", "").replace(">", "").strip() if "<" in (msg["To"] or "") else msg["To"]],
           "queued_at": time.strftime("%Y-%m-%d %H:%M:%S"), "attempts": 0,
           "last_error": "re-queued from committed evidence copy after restart"},
          open(os.path.join(q, mid + ".json"), "w"), indent=2)
print("re-queued:", mid, "->", msg["To"])
EOF
python3 "$DIR/mailctl.py" status
