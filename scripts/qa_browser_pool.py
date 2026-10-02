#!/usr/bin/env python3
"""
qa_browser_pool.py — build a GLIBC-BASELINE-COMPATIBLE lib closure for the QA
browser, then PROVE the baseline compatibility.

Why this exists (prod incident #2, 2026-10-02):
  The first portable pack shipped libs copied from the DEV sandbox (Debian 13,
  glibc 2.41). Those libs REQUIRE GLIBC_2.36..2.39 symbols. The prod FC image
  has an older glibc, so the loader died instantly at spawn:
    "launch: Target page, context or browser has been closed ... <launching>"
  The browser binary itself needs only GLIBC_<=2.25 (chrome targets ancient
  glibc) — the libs were the poison. This script rebuilds libs/ from an OLD
  Debian baseline (buster, glibc 2.28) so the same pack runs on every host
  with glibc >= 2.28 (Debian 10-13, Ubuntu 18.04-24.04, RHEL 8/9, Amazon 2023).
  Old libs on a NEW glibc are fine: symbol versioning is backward-compatible.

How it works:
  1. Indexes Debian {SUITE} (default buster) main: Contents-amd64.gz maps
     soname -> package, Packages.gz maps package -> .deb path. Cached in
     QA_PACK_CACHE (default /tmp/zqa-deb-pool).
  2. Walks the browser binary's recursive DT_NEEDED graph (objdump -p),
     resolving every soname from the baseline pool and copying it into
     .browsers/libs/<soname>. glibc core (ld-linux/libc/libm/...) stays on the
     HOST — the host loader pairs with the host libc, and /proc/self/exe must
     stay the real browser binary (bundled-loader mode breaks chrome's child
     spawning — measured 2026-10-02, see qa_browser_pack.sh header).
  3. Gates (all mandatory):
     a. no glibc core leaked into libs/
     b. soname graph resolves cleanly with LD_LIBRARY_PATH=libs (host loader)
     c. SYMBOL GATE: max GLIBC_ required by every lib <= baseline (2.28);
        no lib may require GLIBCXX_/CXXABI_ (chrome links libc++ statically;
        a C++ runtime dependency would silently raise the glibc floor)
     d. OLD-LOADER SMOKE: downloads the baseline glibc itself and runs the
        browser through the BASELINE loader+libc:
            old-ld-linux --library-path old-core:libs <browser> --version
        must print "HeadlessChrome/...". This is the end-to-end proof that the
        exact shipped artifact launches under glibc 2.28 — the verification a
        same-glibc FC sim could never provide.

Env knobs:
  QA_PACK_SUITE        baseline suite (default buster)
  QA_PACK_MIRROR       mirror root (default https://archive.debian.org/debian)
  QA_PACK_CACHE        cache dir (default /tmp/zqa-deb-pool)
  QA_PACK_SKIP_SMOKE   "1" skips gate (d) — debugging only, never for release
Exit 0 = pack verified; non-zero = gate failed with a printed reason.
"""

import gzip
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

SUITE = os.environ.get("QA_PACK_SUITE", "buster")
MIRROR = os.environ.get("QA_PACK_MIRROR", "https://archive.debian.org/debian")
CACHE = Path(os.environ.get("QA_PACK_CACHE", "/tmp/zqa-deb-pool"))
SKIP_SMOKE = os.environ.get("QA_PACK_SKIP_SMOKE") == "1"

# glibc version floor per suite (the gate baseline)
SUITE_FLOOR = {"buster": (2, 28), "bullseye": (2, 31), "bookworm": (2, 36)}
FLOOR = SUITE_FLOOR.get(SUITE, (2, 28))

GLIBC_CORE_RE = re.compile(
    r"^(ld-linux|libc\.so|libm\.so|libpthread\.so|libdl\.so|librt\.so|"
    r"libresolv\.so|libnss_dns\.so|libnss_files\.so|libanl\.so|libutil\.so|"
    r"libnsl\.so|libnss_compat\.so)"
)
SYM_RE = re.compile(r"(GLIBCXX|CXXABI|GLIBC)_([0-9]+(?:\.[0-9]+)*)")

LIBDIR_HINT = re.compile(r"^(usr/)?lib(32|64|x32)?/")


def log(msg: str) -> None:
    print(f"[pool] {msg}", flush=True)


def fetch(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    log(f"fetch {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "zqa-pack/2"})
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    tmp.rename(dest)
    return dest


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


# ---------------------------------------------------------------- indexes ---

def load_contents_index() -> dict:
    """soname -> (package, archive path). Cached as JSON (parse is slow)."""
    idx_file = CACHE / f"contents-{SUITE}-main.json"
    if idx_file.exists():
        return json.loads(idx_file.read_text())
    gz = fetch(f"{MIRROR}/dists/{SUITE}/main/Contents-amd64.gz", CACHE / f"contents-{SUITE}-main.gz")
    idx: dict[str, list] = {}
    with gzip.open(gz, "rt", errors="replace") as f:
        for line in f:
            if ".so" not in line:
                continue
            parts = line.rstrip("\n").split(None, 1)
            if len(parts) != 2:
                continue
            path, pkgs = parts
            base = path.rsplit("/", 1)[-1]
            if not base.startswith("lib"):
                continue
            # old Contents format lists "section/package" (e.g. libs/libx11-6);
            # package names never contain '/', so keep the last segment
            pkg = pkgs.split(",")[0].strip().rsplit("/", 1)[-1]
            # prefer the primary multiarch dir (lib/x86_64-linux-gnu)
            rank = 0 if ("x86_64-linux-gnu" in path and LIBDIR_HINT.match(path)) else 1
            prev = idx.get(base)
            if prev is None or rank < prev[2]:
                idx[base] = [pkg, path, rank]
    CACHE.mkdir(parents=True, exist_ok=True)
    slim = {k: [v[0], v[1]] for k, v in idx.items()}
    idx_file.write_text(json.dumps(slim))
    log(f"contents index: {len(slim)} sonames ({SUITE}/main)")
    return slim


def load_packages_index() -> dict:
    """package -> .deb path inside the mirror."""
    pkg_file = CACHE / f"packages-{SUITE}-main.json"
    if pkg_file.exists():
        return json.loads(pkg_file.read_text())
    gz = fetch(f"{MIRROR}/dists/{SUITE}/main/binary-amd64/Packages.gz", CACHE / f"packages-{SUITE}-main.gz")
    out: dict[str, str] = {}
    pkg = None
    with gzip.open(gz, "rt", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                pkg = None
                continue
            if line.startswith("Package: "):
                pkg = line[9:]
            elif line.startswith("Filename: ") and pkg:
                out[pkg] = line[10:]
    CACHE.mkdir(parents=True, exist_ok=True)
    pkg_file.write_text(json.dumps(out))
    log(f"packages index: {len(out)} packages ({SUITE}/main)")
    return out


DEB_OF: dict[str, str] = {}


def materialize(soname: str) -> Path | None:
    """Download + extract the package providing soname; return its file."""
    idx = load_contents_index()
    pkgs = load_packages_index()
    hit = idx.get(soname)
    if not hit:
        return None
    pkg = hit[0]
    fname = pkgs.get(pkg)
    if not fname:
        return None
    DEB_OF[soname] = f"{pkg} ({fname.rsplit('/', 1)[-1]})"
    deb = fetch(f"{MIRROR}/{fname}", CACHE / "debs" / fname.rsplit("/", 1)[-1])
    xdir = CACHE / "extracted" / pkg
    if not (xdir / ".done").exists():
        if xdir.exists():
            shutil.rmtree(xdir)
        xdir.mkdir(parents=True)
        r = run(["dpkg-deb", "-x", str(deb), str(xdir)])
        if r.returncode != 0:
            raise RuntimeError(f"dpkg-deb -x failed for {pkg}: {r.stderr.strip()}")
        (xdir / ".done").touch()
    # locate the exact file inside the extracted tree
    for sub in ("lib/x86_64-linux-gnu", "usr/lib/x86_64-linux-gnu", "lib64", "usr/lib64", "lib", "usr/lib"):
        cand = xdir / sub / soname
        if cand.is_file():
            return cand
    # fall back to a bounded walk
    for p in xdir.rglob(soname):
        if p.is_file() and LIBDIR_HINT.match(p.relative_to(xdir).as_posix()):
            return p
    return None


def needed_of(path: Path) -> list[str]:
    r = run(["objdump", "-p", str(path)])
    if r.returncode != 0:
        raise RuntimeError(f"objdump -p failed on {path}")
    return re.findall(r"NEEDED\s+(\S+)", r.stdout)


def max_symbols(path: Path) -> tuple[list, list]:
    r = run(["objdump", "-T", str(path)])
    if r.returncode != 0:
        raise RuntimeError(f"objdump -T failed on {path}")
    glibc, cxx = [], []
    for m in SYM_RE.finditer(r.stdout):
        name, ver = m.group(1), m.group(2)
        vt = tuple(int(x) for x in ver.split("."))
        if name == "GLIBC":
            glibc.append(vt)
        else:
            cxx.append((name, vt))
    return (max(glibc) if glibc else []), cxx


def ver_str(v) -> str:
    return ".".join(str(x) for x in v)


# ------------------------------------------------------------------- main ---

def main() -> int:
    project = Path("/home/z/my-project")
    bsdir = project / ".browsers"
    libs = bsdir / "libs"

    # locate the browser binary
    exe = None
    for d in sorted(bsdir.glob("chromium_headless_shell-*"), reverse=True):
        for cand in (
            d / "chrome-headless-shell-linux64" / "chrome-headless-shell",
            d / "chrome-linux" / "headless_shell",
        ):
            if cand.is_file():
                exe = cand
                break
        if exe:
            break
    if not exe:
        print("FATAL: no chromium_headless_shell binary found under .browsers/")
        return 2
    log(f"browser: {exe.relative_to(project)}")

    exe_max_glibc, exe_cxx = max_symbols(exe)
    log(f"browser requires GLIBC<={ver_str(exe_max_glibc) if exe_max_glibc else '?'} "
        f"{'CXX:' + repr(exe_cxx) if exe_cxx else ''}")

    # closure walk: exe DT_NEEDED + the known dlopen-at-runtime set
    queue = needed_of(exe) + [
        "libfontconfig.so.1", "libfreetype.so.6", "libexpat.so.1", "libpng16.so.16",
        "libsoftokn3.so", "libnssdbm3.so", "libfreeblpriv3.so", "libssl3.so", "libsmime3.so",
    ]
    seen: set[str] = set()
    if libs.exists():
        shutil.rmtree(libs)
    libs.mkdir(parents=True)
    origin: dict[str, str] = {}
    host_fallback: list[str] = []

    while queue:
        soname = queue.pop(0)
        if soname in seen:
            continue
        seen.add(soname)
        if GLIBC_CORE_RE.match(soname):
            continue  # host glibc provides (loader+libc must pair)
        dest = libs / soname
        if dest.exists():
            continue
        src = materialize(soname)
        if src is None:
            # host copies are the exact poison that killed prod (incident #2):
            # opt-in only, and the symbol gate still judges them
            if os.environ.get("QA_PACK_ALLOW_HOST_LIB") != "1":
                print(f"FATAL: soname not found in {SUITE} pool: {soname} "
                      f"(set QA_PACK_ALLOW_HOST_LIB=1 to copy from host and pass gate c)")
                return 3
            r = run(["ldconfig", "-p"])
            m = re.search(rf"^\s*{re.escape(soname)} \(.*\) => (\S+)", r.stdout, re.M)
            if not m:
                print(f"FATAL: soname not found in {SUITE} pool nor host: {soname}")
                return 3
            shutil.copy2(m.group(1), dest)
            host_fallback.append(soname)
            origin[soname] = f"HOST {m.group(1)}"
            queue.extend(needed_of(dest))
            continue
        shutil.copy2(src, dest)
        origin[soname] = DEB_OF.get(soname, "?")
        queue.extend(needed_of(dest))

    log(f"closure: {len(origin)} libs placed")

    # ---------------- gate a: no glibc core in libs/ ----------------
    leaked = [p.name for p in libs.iterdir() if GLIBC_CORE_RE.match(p.name)]
    if leaked:
        print(f"FATAL: glibc core leaked into libs/: {leaked}")
        return 4

    # ---------------- gate b: soname graph resolves (host loader) ----------------
    env = dict(os.environ, LD_LIBRARY_PATH=str(libs))
    r = run(["ldd", str(exe)], env=env)
    missing = [l.strip() for l in r.stdout.splitlines() if "not found" in l]
    if missing:
        print("FATAL: unresolved sonames even with LD_LIBRARY_PATH:")
        for l in missing:
            print(f"  {l}")
        return 5

    # ---------------- gate c: symbol floor ----------------
    offenders = []
    for p in sorted(libs.iterdir()):
        gmax, cxx = max_symbols(p)
        if cxx:
            offenders.append(f"{p.name}: requires C++ runtime {cxx[0][0]}_{ver_str(cxx[0][1])} (no libstdc++ is shipped)")
        if gmax and gmax > FLOOR:
            offenders.append(f"{p.name}: requires GLIBC_{ver_str(gmax)} > baseline {ver_str(FLOOR)}")
    if host_fallback:
        print(f"WARN: host fallback used for: {host_fallback} (gate c still applies)")
    if offenders:
        print(f"FATAL: symbol gate failed (baseline {SUITE} = glibc {ver_str(FLOOR)}):")
        for o in offenders:
            print(f"  {o}")
        return 6

    # ---------------- gate d: OLD-LOADER end-to-end smoke ----------------
    if SKIP_SMOKE:
        log("gate d SKIPPED (QA_PACK_SKIP_SMOKE=1) — debugging only!")
    else:
        idx = load_contents_index()
        pkgs = load_packages_index()
        hit = idx.get("libc.so.6")
        if not hit:
            print("FATAL: cannot locate libc6 in pool for old-loader smoke")
            return 7
        deb = fetch(f"{MIRROR}/{pkgs[hit[0]]}", CACHE / "debs" / pkgs[hit[0]].rsplit("/", 1)[-1])
        xdir = CACHE / "extracted" / hit[0]
        if not (xdir / ".done").exists():
            xdir.mkdir(parents=True, exist_ok=True)
            run(["dpkg-deb", "-x", str(deb), str(xdir)])
        oldcore = CACHE / "oldcore"
        oldcore.mkdir(parents=True, exist_ok=True)
        for p in xdir.rglob("*.so*"):
            if p.is_file() and LIBDIR_HINT.match(p.relative_to(xdir).as_posix()):
                shutil.copy2(p, oldcore / p.name)
        oldld = oldcore / "ld-linux-x86-64.so.2"
        if not oldld.is_file():
            print(f"FATAL: ld-linux not found in {hit[0]} extraction")
            return 7
        cmd = [str(oldld), "--library-path", f"{oldcore}:{libs}", str(exe), "--version"]
        r = run(cmd, timeout=90)
        # modern chrome-for-testing reports "Google Chrome for Testing x.y";
        # older builds report "HeadlessChrome/x.y" — accept either
        ok = r.returncode == 0 and "Chrome" in r.stdout
        if ok:
            log(f"old-loader smoke OK (glibc {ver_str(FLOOR)}): {r.stdout.strip()}")
        else:
            print("FATAL: old-loader smoke FAILED — the pack does NOT launch under baseline glibc")
            print(f"  cmd: {' '.join(cmd)}")
            print(f"  rc={r.returncode} stdout={r.stdout.strip()[:400]!r} stderr={r.stderr.strip()[:800]!r}")
            return 8

    # ---------------- summary ----------------
    total = sum(p.stat().st_size for p in libs.iterdir())
    log(f"libs: {len(origin)} files, {total / 1e6:.1f} MB, floor glibc {ver_str(FLOOR)} ({SUITE})")
    by_pkg: dict[str, list] = {}
    for s, o in sorted(origin.items()):
        by_pkg.setdefault(o.split(" (")[0], []).append(s)
    for pkg, sons in sorted(by_pkg.items()):
        log(f"  {pkg}: {', '.join(sons)}")
    print("POOL OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
