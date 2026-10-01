#!/bin/bash
# Platform boot/dev script (z.ai fullstack mode). Mirrors the default bun
# flow exactly: install → db push → start dev server → wait until ready.
set -e
cd /home/z/my-project

if [ "$(id -u)" = "0" ]; then
  exec su z -c "bash /home/z/my-project/.zscripts/dev.sh"
fi

echo "[dev.sh] install dependencies"
bun install

echo "[dev.sh] push database schema"
bun run db:push

echo "[dev.sh] starting dev server"
bun run dev &

echo "[dev.sh] waiting for :3000"
for i in $(seq 1 60); do
  if curl -s --connect-timeout 2 --max-time 5 http://localhost:3000 > /dev/null 2>&1; then
    echo "[dev.sh] dev server ready"
    break
  fi
  sleep 1
done

curl -s --max-time 30 http://localhost:3000 > /dev/null || echo "[dev.sh] warmup request failed (continuing)"
echo "[dev.sh] done"
