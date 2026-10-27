#!/bin/bash
# content-guard.sh — backup & restore live site content around ANY update/patch.
#
# STANDING RULE (owner, 2026-10-27): before ANY update/patch, read the current
# site content (https://zhelp.space-z.ai, /blog, …), BACK IT UP, then restore
# it into the updated/patched version. This script is how the rule is followed.
#
#   backup [label]          snapshot prod + local content into backups/<ts>/
#   restore [dir|latest]    re-push backed-up posts into a target via /api/blog
#                           (target: PROD_URL env or https://zhelp.space-z.ai)
#
# Snapshots: prod-blog-posts.json / local-blog-posts.json (full bodies),
# announcements.json, homepage+blog HTML, local DB copy, manifest with hashes.
# A UNION snapshot (newest-wins per slug) is written to the TRACKED
# content-snapshot/blog-posts.json so it survives sandbox restarts via git.
set -u
cd /home/z/my-project

PROD_URL="${PROD_URL:-https://zhelp.space-z.ai}"
UA="Mozilla/5.0 (content-guard)"
BACKUP_ROOT=backups
SNAP_DIR=content-snapshot
KEEP=20

log() { printf '[content-guard] %s\n' "$*"; }

blog_token() {
  # from .env only — never echoed
  grep -E '^BLOG_PUSH_TOKEN=' .env 2>/dev/null | head -1 | cut -d= -f2-
}

fetch() { curl -fsSL -A "$UA" --max-time 30 "$1" 2>/dev/null; }

# ------------------------------- backup --------------------------------
cmd_backup() {
  local label="${1:-manual}"
  local ts dir
  ts="$(date -u +%Y%m%d-%H%M%S)"
  dir="$BACKUP_ROOT/${ts}-${label}"
  mkdir -p "$dir"
  log "backup -> $dir"

  # 1) PROD content (public APIs — no secrets sent anywhere)
  if fetch "$PROD_URL/api/blog?limit=100&full=1" > "$dir/prod-blog-posts.json"; then
    log "prod blog posts: $(python3 -c "import json;print(json.load(open('$dir/prod-blog-posts.json'))['count'])" 2>/dev/null || echo '?')"
  else
    echo '{"count":0,"posts":[],"error":"unreachable"}' > "$dir/prod-blog-posts.json"
    log "WARN: prod blog API unreachable — empty placeholder written"
  fi
  fetch "$PROD_URL/api/announcements" > "$dir/announcements.json" || echo '{}' > "$dir/announcements.json"
  fetch "$PROD_URL/" > "$dir/homepage.html" || echo '' > "$dir/homepage.html"
  fetch "$PROD_URL/blog" > "$dir/blog.html" || echo '' > "$dir/blog.html"

  # 2) LOCAL content (dev DB is the source of truth for seeded posts)
  cp -f db/custom.db "$dir/custom.db" 2>/dev/null || log "WARN: no local db copy"
  bun scripts/dump-blog.ts local > "$dir/local-blog-posts.json" 2>>"$dir/manifest.txt" \
    || echo '{"count":0,"posts":[]}' > "$dir/local-blog-posts.json"
  log "local blog posts: $(python3 -c "import json;print(json.load(open('$dir/local-blog-posts.json'))['count'])" 2>/dev/null || echo '?')"

  # 3) UNION snapshot (newest-wins per slug) — TRACKED, survives restarts
  mkdir -p "$SNAP_DIR"
  bun scripts/merge-prod-content.ts --snapshot-only "$dir/prod-blog-posts.json" "$dir/local-blog-posts.json" > "$SNAP_DIR/blog-posts.json" 2>/dev/null \
    || cp "$dir/local-blog-posts.json" "$SNAP_DIR/blog-posts.json"
  log "tracked union snapshot: $SNAP_DIR/blog-posts.json ($(python3 -c "import json;print(json.load(open('$SNAP_DIR/blog-posts.json'))['count'])" 2>/dev/null || echo '?') posts)"

  # 4) manifest
  {
    echo "created: $(date -u +%FT%TZ)"
    echo "label: $label"
    echo "prod: $PROD_URL"
    echo "git HEAD: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    sha256sum "$dir"/*.json "$dir"/*.html 2>/dev/null | sed 's/^/sha256: /'
  } > "$dir/manifest.txt"

  # 5) prune old backups (keep $KEEP newest)
  ls -1dt "$BACKUP_ROOT"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -rf "$old" && log "pruned $old"
  done
  log "backup DONE: $dir"
}

# ------------------------------- restore -------------------------------
cmd_restore() {
  local which="${1:-latest}"
  local dir
  if [ "$which" = "latest" ]; then
    dir="$(ls -1dt "$BACKUP_ROOT"/*/ 2>/dev/null | head -1)"
  else
    dir="$BACKUP_ROOT/$which"
    [ -d "$dir" ] || dir="$which"
  fi
  [ -f "$dir/prod-blog-posts.json" ] || { log "no snapshot in $dir"; exit 1; }

  local token target
  token="$(blog_token)"
  target="${PROD_URL}"
  [ -n "$token" ] || { log "ERROR: no BLOG_PUSH_TOKEN in .env — cannot authenticate restore"; exit 1; }

  log "restore from $dir -> $target/api/blog (upsert by slug)"
  bun scripts/restore-blog.ts "$dir/prod-blog-posts.json" "$dir/local-blog-posts.json" "$target" "$token"
}

case "${1:-help}" in
  backup)  shift; cmd_backup "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  *) echo "usage: content-guard.sh backup [label] | restore [dir|latest]" ;;
esac
