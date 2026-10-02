#!/bin/bash
# Start / keep the GLM Mail Server running (idempotent).
# Task 42 (2026-10-03): the MTA is now the zero-dependency Node server
# (mailserver.mjs) — python3/aiosmtpd are no longer needed, so the server
# also boots identically inside the production FC container.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/logs/server.log"
mkdir -p "$DIR/logs"

# already running? (probe: a real SMTP banner on 127.0.0.1:2525)
if node -e 'const n=require("net");const s=n.connect(2525,"127.0.0.1",()=>{process.exit(0)});s.on("error",()=>process.exit(1));setTimeout(()=>process.exit(1),3000).unref()' 2>/dev/null;
then
    echo "mail server already UP (pid $(cat "$DIR/server.pid" 2>/dev/null || echo '?'))"
    exit 0
fi

nohup env MAILSERVER_DIR="$DIR" node "$DIR/mailserver.mjs" >> "$LOG" 2>&1 &
echo $! > "$DIR/server.pid"
sleep 1.2
if kill -0 "$(cat "$DIR/server.pid")" 2>/dev/null && \
   node -e 'const n=require("net");const s=n.connect(2525,"127.0.0.1",()=>{process.exit(0)});s.on("error",()=>process.exit(1));setTimeout(()=>process.exit(1),3000).unref()' 2>/dev/null;
then
    echo "mail server STARTED, pid $(cat "$DIR/server.pid"), log: $LOG"
else
    echo "FAILED to start — last log lines:"; tail -5 "$LOG"; exit 1
fi
