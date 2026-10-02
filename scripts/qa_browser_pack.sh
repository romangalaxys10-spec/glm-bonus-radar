#!/bin/bash
# qa_browser_pack.sh — assemble a PORTABLE QA browser pack under .browsers/
#
# Purpose: the production FC container's runtime image is slimmer AND OLDER
# than the dev sandbox. Two incidents, two different root causes:
#
#   Incident #1 (2026-10-02 morning): image lacked system libs entirely ->
#   launch failed with zero diagnostics. Fixed by shipping a lib closure +
#   fonts and surfacing every launch error (browserDiagnostics + init probe).
#
#   Incident #2 (2026-10-02 evening, "browser failed — launch: Target page,
#   context or browser has been closed ... <launching>"): the shipped closure
#   was copied from the DEV sandbox (Debian 13, glibc 2.41) and its libs
#   REQUIRE GLIBC_2.36..2.39. The prod image's older glibc loader died the
#   moment it resolved them. The browser binary itself only needs
#   GLIBC_<=2.25 — the libs were the poison.
#
# Fix: libs/ is now built from a GLIBC-BASELINE pool (Debian 10 buster,
# glibc 2.28) by scripts/qa_browser_pool.py. Old libs run fine on newer
# glibc (symbol versioning is backward-compatible), so one pack covers
# Debian 10-13 / Ubuntu 18.04-24.04 / RHEL 8-9 / Amazon 2023.
# Gate d in the pool script PROVES the exact shipped browser launches under
# the baseline loader+libc (old-ld-linux --library-path ... --version).
#
#   .browsers/
#     chromium_headless_shell-XXXX/chrome-headless-shell-linux64/  (trimmed)
#     libs/          baseline-glibc lib closure, files named by SONAME
#     fonts/         DejaVu (slim images ship zero fonts)
#
# The pack() step in .zscripts/build.sh copies .browsers/ into the artifact;
# browser.ts launches with LD_LIBRARY_PATH=<cwd>/.browsers/libs (+ shipped
# fonts fontconfig + writable HOME) and falls back to a host-env tier if the
# pack tier ever fails.
#
# NOTE: a bundled-loader mode (ld-linux --library-path) was tested and REJECTED
# for the REAL launch: under it /proc/self/exe = ld-linux, which breaks
# chrome's icudtl.dat lookup AND its child-process spawning. It IS used inside
# qa_browser_pool.py — but only as a VERIFICATION harness (gate d), never to
# ship.
#
# Idempotent: safe to re-run; rebuilds libs/fonts each time (pool downloads
# are cached in /tmp/zqa-deb-pool).
set -euo pipefail
cd /home/z/my-project

BSDIR=.browsers
BUILD_DIR=""
# discover the staged browser (repo .browsers first, then dev cache)
for d in "$BSDIR"/chromium_headless_shell-* "$HOME"/.cache/ms-playwright/chromium_headless_shell-*; do
  if [ -x "$d/chrome-headless-shell-linux64/chrome-headless-shell" ]; then BUILD_DIR="$d"; break; fi
done
[ -n "$BUILD_DIR" ] || { echo "FATAL: no chromium_headless_shell build found"; exit 1; }
APP="$BUILD_DIR/chrome-headless-shell-linux64"
echo "[pack] browser build: $BUILD_DIR"

# ---------- 1. trim locales (keep en only) ----------
if [ -d "$APP/locales" ]; then
  find "$APP/locales" -type f ! -name 'en*.pak' -delete
  echo "[pack] locales trimmed -> $(ls "$APP/locales" | tr '\n' ' ')"
fi
# drop dep manifests (not used at runtime)
rm -f "$APP/deb.deps" "$APP/rpm.deps"

# ---------- 2. baseline-glibc lib closure (scripts/qa_browser_pool.py) ----------
# Replaces the old host-ldd closure: host copies pulled glibc-2.41-built libs
# whose symbol requirements killed older prod loaders (incident #2).
python3 scripts/qa_browser_pool.py

# ---------- 3. fonts ----------
FONTS="$BSDIR/fonts"
rm -rf "$FONTS"; mkdir -p "$FONTS"
cp -f /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf "$FONTS/"
cp -f /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf "$FONTS/"

# ---------- 4. launcher-side env contract (handled in browser.ts) ----------
# withQaBrowser() launches the discovered binary with:
#   LD_LIBRARY_PATH=<cwd>/.browsers/libs[:...existing]     (pack tier)
#   or the host env only                                   (host tier fallback)
#   FONTCONFIG_FILE/FONTCONFIG_PATH -> generated fonts.conf (shipped fonts)
#   HOME -> writable tmp dir (crashpad/locks)
chmod 755 "$APP/chrome-headless-shell"
rm -f "$BSDIR/run.sh"   # loader-wrapper mode rejected (see header)

echo "[pack] binary+assets: $(du -sh "$BUILD_DIR" | cut -f1)  fonts: $(du -sh "$FONTS" | cut -f1)"
echo "[pack] total .browsers: $(du -sh "$BSDIR" | cut -f1)"
echo "[pack] OK"
