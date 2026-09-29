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

# 4. Serve. node v24 is present in the image; bun as a fallback.
if command -v node > /dev/null 2>&1; then
  exec node server.js
else
  exec bun server.js
fi
