#!/bin/bash
# Start / keep the GLM Mail Server running (idempotent).
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/logs/server.log"
mkdir -p "$DIR/logs"

# already running?
if python3 - "$DIR" <<'EOF' 2>/dev/null
import sys, smtplib, os
try:
    s = smtplib.SMTP("127.0.0.1", 2525, timeout=3); s.noop(); s.quit()
    sys.exit(0)
except Exception:
    sys.exit(1)
EOF
then
    echo "mail server already UP (pid $(cat "$DIR/server.pid" 2>/dev/null || echo '?'))"
    exit 0
fi

nohup python3 "$DIR/mailserver.py" >> "$LOG" 2>&1 &
echo $! > "$DIR/server.pid"
sleep 1.5
if kill -0 "$(cat "$DIR/server.pid")" 2>/dev/null; then
    echo "mail server STARTED, pid $(cat "$DIR/server.pid"), log: $LOG"
else
    echo "FAILED to start — last log lines:"; tail -5 "$LOG"; exit 1
fi
