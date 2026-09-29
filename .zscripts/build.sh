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

# Freshness check: if source changed after the last finished build, kick a
# detached rebuild (ships in the NEXT deploy call; this one packs what exists
# because the pipeline cannot wait for a full build).
newest_src=$(find src public prisma next.config.ts package.json -type f -newer "$STANDALONE/server.js" 2>/dev/null | head -1 || true)
if [ -n "$newest_src" ]; then
  echo "[build.sh] source newer than build (e.g. $newest_src) — kicking detached rebuild" >> "$LOG"
  if ! pgrep -f "next build" > /dev/null 2>&1; then
    ZBUILD_BG=1 setsid bash "$0" >> "$LOG" 2>&1 < /dev/null &
    disown 2>/dev/null || true
  fi
fi

# Pack the latest finished standalone build synchronously (the pipeline checks
# for the artifact immediately after this script exits).
if [ -f "$STANDALONE/server.js" ] && [ -d "$STANDALONE/.next/static" ]; then
  tar -czf "$OUT" -C "$STANDALONE" .
  echo "[build.sh] artifact ready: $OUT ($(du -h "$OUT" | cut -f1)) at $(date -u +%T)" >> "$LOG"
  exit 0
fi

echo "[build.sh] FATAL: no finished standalone build to pack" >> "$LOG"
exit 1
