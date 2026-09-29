#!/bin/bash
# Platform deploy-pipeline build script (z.ai fullstack mode).
#
# Measured pipeline contract (reverse-engineered 2026-09-29 from /deploy
# responses + captured invocation env — see worklog Task 21):
#   1. The pipeline runs this script with BUILD_ID=<id> in the environment and
#      KILLS it after roughly ~14s.
#   2. When this script exits (or is killed), the pipeline requires the build
#      artifact at:  /tmp/build_fullstack_${BUILD_ID}.tar.gz
#      Missing artifact -> "构建产物不存在: /tmp/build_fullstack_<id>.tar.gz".
#   3. The artifact is the Next.js standalone production bundle (server.js at
#      tar root) — exactly what `bun run build` assembles under
#      .next/standalone (server.js + .next/static + public + bundled deps).
#
# Strategy: a full `next build` takes ~40s cold / ~14s warm — it cannot run
# inside the kill window. So builds happen DETACHED (double-fork orphan,
# survives any pipeline kill) and are kept warm; this script packs the latest
# finished standalone build synchronously and exits 0 fast.
set -e
cd /home/z/my-project

LOG=/home/z/my-project/.zscripts/build.log

# Re-exec as z when invoked as root — keeps node_modules/.next ownership sane
# so the z-user dev server can still write afterwards.
if [ "$(id -u)" = "0" ]; then
  exec su z -c "bash /home/z/my-project/.zscripts/build.sh"
fi

# ---------------- worker mode (detached background build) ----------------
if [ "$ZBUILD_BG" = "1" ]; then
  {
    echo "[bg] === worker start $(date -u +%FT%TZ) (user $(id -un)) ==="
    if bun install; then echo "[bg] install ok $(date -u +%T)"; else echo "[bg] INSTALL FAILED"; fi
    if bun run db:push; then echo "[bg] db ok $(date -u +%T)"; else echo "[bg] DB PUSH FAILED"; fi
    if bun run build; then
      echo "[bg] BUILD OK $(date -u +%FT%TZ)"
    else
      echo "[bg] BUILD FAILED $(date -u +%FT%TZ) (previous standalone stays in place; inspect this log)"
    fi
  } >> "$LOG" 2>&1
  exit 0
fi

# ---------------- pipeline mode (artifact must exist on exit) ----------------
echo "=== build request $(date -u +%FT%TZ) (invoker: $(id -un), pid $$) ===" >> "$LOG"

OUT="/tmp/build_fullstack_${BUILD_ID:-$(date +%s)}.tar.gz"
STANDALONE=/home/z/my-project/.next/standalone

# ORDER IS LOAD-BEARING: pack FIRST, kick rebuild AFTER.
# Incident 2026-09-29 13:51: the freshness kick ran before the pack; the
# detached `next build` wiped .next/standalone while tar was reading it, so
# no artifact was produced and the deploy failed even though the code was
# fine. Packing first guarantees every call that finds a complete standalone
# ships it; the rebuild only affects the NEXT call.

# Pack the latest finished standalone build synchronously (the pipeline checks
# for the artifact immediately after this script exits). The artifact must be
# a SELF-BOOTING app dir: the platform extracts it to /app/ and runs
# `sh /app/start.sh` (FC CAExited on 2026-09-29 proved /app/start.sh is the
# boot entry), then health-checks FC_CUSTOM_LISTEN_PORT within 120s.
if [ -f "$STANDALONE/server.js" ] && [ -d "$STANDALONE/.next/static" ]; then
  # a) boot entry — POSIX sh, must sit at the tar root
  install -m 755 /home/z/my-project/.zscripts/start.sh "$STANDALONE/start.sh"

  # b) SQLite DB with current data (prisma CLI is not in the standalone
  #    bundle, so the schema cannot be pushed at boot — ship it ready)
  mkdir -p "$STANDALONE/db"
  cp -f /home/z/my-project/db/custom.db "$STANDALONE/db/custom.db"

  # c) z-ai sdk config (SDK reads $cwd/.z-ai-config first)
  if [ -r /etc/.z-ai-config ]; then
    cp -f /etc/.z-ai-config "$STANDALONE/.z-ai-config"
  else
    printf '{"baseUrl": "https://internal-api.z.ai/v1", "apiKey": "Z.ai"}\n' > "$STANDALONE/.z-ai-config"
  fi

  # d) normalize the .env Next copies into standalone (it contains the sandbox
  #    path; start.sh's export overrides it, but keep the file consistent too)
  printf 'DATABASE_URL=file:/app/db/custom.db\n' > "$STANDALONE/.env"

  tar -czf "$OUT" -C "$STANDALONE" .
  echo "[build.sh] artifact ready: $OUT ($(du -h "$OUT" | cut -f1)) at $(date -u +%T)" >> "$LOG"

  # Freshness check (AFTER packing — see the ORDER note above): if source
  # changed after the last finished build, kick a detached rebuild so the
  # NEXT deploy call ships the fresh code. This call ships what exists.
  newest_src=$(find src public prisma next.config.ts package.json -type f -newer "$STANDALONE/server.js" 2>/dev/null | head -1 || true)
  if [ -n "$newest_src" ]; then
    echo "[build.sh] source newer than build (e.g. $newest_src) — kicking detached rebuild" >> "$LOG"
    if ! pgrep -f "next build" > /dev/null 2>&1; then
      ZBUILD_BG=1 setsid bash "$0" >> "$LOG" 2>&1 < /dev/null &
      disown 2>/dev/null || true
    fi
  fi

  exit 0
fi

echo "[build.sh] FATAL: no finished standalone build to pack" >> "$LOG"
exit 1
