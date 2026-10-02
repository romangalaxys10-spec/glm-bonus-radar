#!/bin/sh
# Published-instance boot script. The deploy pipeline extracts the build
# artifact into /app/ and FC runs:  docker-entrypoint.sh -> sh /app/start.sh
#
# Boot contract (learned from the FC CAExited error + image inspection,
# 2026-09-29):
#   - FC start command runs this file with dash (`sh /app/start.sh`), so it
#     MUST stay POSIX-sh compatible — no bashisms.
#   - FC health-checks FC_CUSTOM_LISTEN_PORT (81) within 120s and expects
#     HTTP 200; first non-healthy pass kills the deploy ("CAExited").
#   - The artifact directory next to this script contains the Next.js
#     standalone bundle (server.js, .next/, public, node_modules), the SQLite
#     database (db/custom.db) and the z-ai sdk config (.z-ai-config).
#
# This script must never exit: it execs the server in the foreground.
set -e

APP_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$APP_DIR"

# 1. z-ai-web-dev-sdk config. SDK resolution order: $cwd/.z-ai-config,
#    ~/.z-ai-config, /etc/.z-ai-config. Ship it in the artifact (build.sh
#    copies it); write the platform-standard stub as a fallback.
if [ ! -f .z-ai-config ]; then
  printf '{"baseUrl": "https://internal-api.z.ai/v1", "apiKey": "Z.ai"}\n' > .z-ai-config
fi

# 2. SQLite database: shipped in the artifact (prisma CLI is not part of the
#    standalone bundle, so the schema cannot be pushed at boot — the file
#    must arrive ready). Make it writable for whatever uid runs the server.
mkdir -p db
[ -f db/custom.db ] || : > db/custom.db
if [ "$(id -u)" = "0" ]; then
  chmod -R a+rwX db 2>/dev/null || true
fi

# 3. Runtime env. DATABASE_URL points at the extracted copy (NOT the sandbox
#    path baked into .env during development). Next standalone reads PORT and
#    HOSTNAME; FC routes to FC_CUSTOM_LISTEN_PORT.
export DATABASE_URL="file:${APP_DIR}/db/custom.db"
export NODE_ENV=production
export PORT="${FC_CUSTOM_LISTEN_PORT:-81}"
export HOSTNAME=0.0.0.0

# 4. GLM mail server (Task 42, 2026-10-03): zero-dependency Node MTA on
#    127.0.0.1:2525 so /api/notify/email works on this host. Best effort —
#    a mail failure must never block the portal boot (background + || true).
#    Same code path as the sandbox (mailserver/mailserver.mjs, no python).
if [ -f "$APP_DIR/mailserver/mailserver.mjs" ]; then
  mkdir -p "$APP_DIR/mailserver/logs" \
           "$APP_DIR/mailserver/spool/outbound/queue" \
           "$APP_DIR/mailserver/spool/outbound/deferred" \
           "$APP_DIR/mailserver/spool/outbound/sent" \
           "$APP_DIR/mailserver/mailboxes/glm/Maildir/new" \
           "$APP_DIR/mailserver/mailboxes/glm/Maildir/cur" \
           "$APP_DIR/mailserver/mailboxes/glm/Maildir/tmp" || true
  chmod -R a+rwX "$APP_DIR/mailserver" 2>/dev/null || true
  MAILSERVER_DIR="$APP_DIR/mailserver" node "$APP_DIR/mailserver/mailserver.mjs" \
    >> "$APP_DIR/mailserver/logs/server.log" 2>&1 &
fi

# 5. Serve. node v24 is present in the image; bun as a fallback.
if command -v node > /dev/null 2>&1; then
  exec node server.js
else
  exec bun server.js
fi
