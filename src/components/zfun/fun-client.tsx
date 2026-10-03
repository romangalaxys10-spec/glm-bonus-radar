"use client";

/**
 * zFun lobby — thirty 8-bit games, playable right here.
 * Lobby grid + inline cabinet mount with ?g= deep links. Scores are
 * localStorage-only; nothing about the games is fetched or simulated.
 */

import { useCallback, useEffect, useState, type ComponentType } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ZFUN_BY_SLUG, ZFUN_GAMES, zfunBestKey } from "@/lib/zfun";
import { BackToLobby } from "./engine";

/* ------------------------------------------------------------------ */
/* Game mounts — client-only lazy imports, one per cabinet.            */
/* ------------------------------------------------------------------ */

const GAME_VIEWS: Record<string, ComponentType> = {
  snake: dynamic(() => import("./games/snake"), { ssr: false, loading: () => <LoadStub /> }),
  blocks: dynamic(() => import("./games/blocks"), { ssr: false, loading: () => <LoadStub /> }),
  breakout: dynamic(() => import("./games/breakout"), { ssr: false, loading: () => <LoadStub /> }),
  pong: dynamic(() => import("./games/pong"), { ssr: false, loading: () => <LoadStub /> }),
  invaders: dynamic(() => import("./games/invaders"), { ssr: false, loading: () => <LoadStub /> }),
  flap: dynamic(() => import("./games/flap"), { ssr: false, loading: () => <LoadStub /> }),
  runner: dynamic(() => import("./games/runner"), { ssr: false, loading: () => <LoadStub /> }),
  merge: dynamic(() => import("./games/merge"), { ssr: false, loading: () => <LoadStub /> }),
  mines: dynamic(() => import("./games/mines"), { ssr: false, loading: () => <LoadStub /> }),
  simon: dynamic(() => import("./games/simon"), { ssr: false, loading: () => <LoadStub /> }),
  asteroids: dynamic(() => import("./games/asteroids"), { ssr: false, loading: () => <LoadStub /> }),
  hopper: dynamic(() => import("./games/hopper"), { ssr: false, loading: () => <LoadStub /> }),
  muncher: dynamic(() => import("./games/muncher"), { ssr: false, loading: () => <LoadStub /> }),
  kong: dynamic(() => import("./games/kong"), { ssr: false, loading: () => <LoadStub /> }),
  lander: dynamic(() => import("./games/lander"), { ssr: false, loading: () => <LoadStub /> }),
  missile: dynamic(() => import("./games/missile"), { ssr: false, loading: () => <LoadStub /> }),
  racer: dynamic(() => import("./games/racer"), { ssr: false, loading: () => <LoadStub /> }),
  cycle: dynamic(() => import("./games/cycle"), { ssr: false, loading: () => <LoadStub /> }),
  bomber: dynamic(() => import("./games/bomber"), { ssr: false, loading: () => <LoadStub /> }),
  cubes: dynamic(() => import("./games/cubes"), { ssr: false, loading: () => <LoadStub /> }),
  memory: dynamic(() => import("./games/memory"), { ssr: false, loading: () => <LoadStub /> }),
  whack: dynamic(() => import("./games/whack"), { ssr: false, loading: () => <LoadStub /> }),
  stacker: dynamic(() => import("./games/stacker"), { ssr: false, loading: () => <LoadStub /> }),
  xo: dynamic(() => import("./games/xo"), { ssr: false, loading: () => <LoadStub /> }),
  ships: dynamic(() => import("./games/ships"), { ssr: false, loading: () => <LoadStub /> }),
  slots: dynamic(() => import("./games/slots"), { ssr: false, loading: () => <LoadStub /> }),
  pinball: dynamic(() => import("./games/pinball"), { ssr: false, loading: () => <LoadStub /> }),
  hangman: dynamic(() => import("./games/hangman"), { ssr: false, loading: () => <LoadStub /> }),
  punch: dynamic(() => import("./games/punch"), { ssr: false, loading: () => <LoadStub /> }),
  maze: dynamic(() => import("./games/maze"), { ssr: false, loading: () => <LoadStub /> }),
};

function LoadStub() {
  return (
    <div className="flex h-56 items-center justify-center rounded-[14px] border border-white/10 bg-[#0a0a0b]">
      <span className="zs-pixel animate-pulse text-[10px] text-zinc-500">LOADING CARTRIDGE…</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pixel glyphs — hand-drawn 8×8 motifs, "1" = ink, "2" = accent.      */
/* ------------------------------------------------------------------ */

const GLYPHS: Record<string, string[]> = {
  snake: [
    "01111100",
    "01000000",
    "01000000",
    "00111100",
    "00000010",
    "00000010",
    "01111100",
    "00000020",
  ],
  blocks: [
    "00111000",
    "00010000",
    "00000000",
    "00000000",
    "22222200",
    "00000000",
    "01110111",
    "00000000",
  ],
  breakout: ["11011111", "11111011", "11111111", "00000000", "00000020", "00000000", "01111100", "00000000"],
  pong: ["10000001", "10000001", "10020001", "10000001", "10000001", "00000000", "00000000", "00000000"],
  invaders: [
    "00100100",
    "00100100",
    "00111100",
    "01111110",
    "11011011",
    "11111111",
    "10111101",
    "10100101",
  ],
  flap: ["11110002", "11111002", "11100002", "01110002", "00110002", "22222222", "00000002", "00000002"],
  runner: ["00011000", "01101100", "01101100", "00111100", "00011000", "00011000", "00011000", "22222222"],
  merge: ["11102220", "11102220", "11102220", "00000000", "22201110", "22201110", "22201110", "00000000"],
  mines: ["00100100", "01111110", "11111111", "11121111", "11111111", "01111110", "00100100", "00000000"],
  simon: ["11102220", "11102220", "11102220", "00011000", "22202220", "22202220", "22202220", "00000000"],
  asteroids: ["00010000", "00101000", "00000100", "11000010", "01111100", "10001110", "00000000", "00000000"],
  hopper: ["00111100", "01000010", "01111110", "11011011", "01111110", "00100100", "01111110", "00000020"],
  muncher: ["00111110", "01111110", "11111100", "11111000", "11111100", "01111110", "00111110", "00000000"],
  kong: ["11110110", "11111110", "01111100", "00010000", "01010100", "01010100", "01010100", "22222222"],
  lander: ["00010000", "00111100", "01111110", "11011011", "01000010", "00100100", "01111110", "00000020"],
  missile: ["00000100", "00000110", "00000111", "10011111", "00000111", "00000110", "00000100", "00000002"],
  racer: ["00111100", "01111110", "11100111", "11100111", "01111110", "00111100", "00022000", "00000000"],
  cycle: ["10000001", "10000001", "10000001", "10011111", "10000001", "11100001", "00000000", "00000000"],
  bomber: ["00011100", "00001000", "01111110", "11111111", "11111111", "11111111", "01111110", "00111100"],
  cubes: ["00011000", "00111100", "01111110", "00011000", "00111100", "11111111", "00000000", "00000020"],
  memory: ["11100111", "10011001", "10011001", "11100111", "11100111", "10011001", "10011001", "11100222"],
  whack: ["00000000", "00111100", "01111110", "11011011", "01111110", "00111100", "01111110", "00000000"],
  stacker: ["00000000", "00000000", "00111000", "01111100", "00000000", "11111111", "11111111", "00022000"],
  xo: ["11011011", "01101100", "00111000", "01101100", "11011011", "00000000", "00111100", "01100110"],
  ships: ["00011000", "00111100", "01111110", "11111111", "00111100", "00100100", "11000011", "00000000"],
  slots: ["00100010", "01110111", "00100010", "00111000", "01110111", "01110111", "00000000", "00022000"],
  pinball: ["00000100", "00001010", "00010001", "00101000", "01010000", "10100000", "01100000", "00000020"],
  hangman: ["11111110", "00010000", "00010000", "00010000", "01110100", "00010000", "00010000", "00000000"],
  punch: ["00111100", "01111110", "11111111", "11111111", "01111110", "00111100", "00011000", "00000000"],
  maze: ["11111110", "00000010", "01111110", "01000000", "01011110", "01000010", "01111010", "00000022"],
};

function PixelGlyph({ slug, className }: { slug: string; className?: string }) {
  const rows = GLYPHS[slug] ?? [];
  const cell = 4;
  return (
    <svg
      viewBox={`0 0 ${8 * cell} ${8 * cell}`}
      shapeRendering="crispEdges"
      aria-hidden
      className={className}
    >
      {rows.flatMap((row, r) =>
        [...row].map((ch, c) =>
          ch === "1" || ch === "2" ? (
            <rect
              key={`${r}-${c}`}
              x={c * cell}
              y={r * cell}
              width={cell}
              height={cell}
              fill={ch === "2" ? "#3b82f6" : "#e4e4e7"}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Lobby + cabinet                                                     */
/* ------------------------------------------------------------------ */

function readBests(): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    for (const g of ZFUN_GAMES) {
      const raw = window.localStorage.getItem(zfunBestKey(g.slug));
      if (raw !== null) out[g.slug] = Number(raw) || 0;
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}

export function FunClient() {
  const [active, setActive] = useState<string | null>(null);
  const [bests, setBests] = useState<Record<string, number>>({});

  // Bests are device-local; re-read on mount and whenever a game closes
  // (deferred so the effect body never sets state synchronously).
  useEffect(() => {
    const id = window.setTimeout(() => setBests(readBests()), 0);
    return () => window.clearTimeout(id);
  }, [active]);

  // Deep link: /fun?g=snake opens the cabinet directly (StrictMode-safe,
  // deferred one tick to avoid a synchronous setState inside the effect).
  useEffect(() => {
    const g = new URLSearchParams(window.location.search).get("g");
    if (g && ZFUN_BY_SLUG[g]) {
      const id = window.setTimeout(() => {
        setActive(g);
        document.title = `${ZFUN_BY_SLUG[g].title} · zFun — GLM Bonus Radar`;
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, []);

  const open = useCallback((slug: string) => {
    setActive(slug);
    try {
      window.history.replaceState(null, "", `/fun?g=${slug}`);
    } catch {
      /* ignore */
    }
    document.title = `${ZFUN_BY_SLUG[slug].title} · zFun — GLM Bonus Radar`;
  }, []);

  const close = useCallback(() => {
    setActive(null);
    try {
      window.history.replaceState(null, "", "/fun");
    } catch {
      /* ignore */
    }
    document.title = "zFun — Thirty 8-bit games · GLM Bonus Radar";
    setBests(readBests());
  }, []);

  // Escape exits the cabinet.
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, close]);

  const ActiveGame = active ? GAME_VIEWS[active] : null;
  const activeMeta = active ? ZFUN_BY_SLUG[active] : null;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--rc-bg)] text-zinc-100 antialiased selection:bg-[#3b82f6]/30">
      {/* Header — same chrome as the rest of the promo portal */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#050505]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3 md:px-8">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[var(--rc-bright)] text-sm font-bold text-zinc-950">
              z
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-zinc-50">zFun</span>
            <span className="hidden font-mono text-[11px] text-zinc-500 sm:inline">by GLM Bonus Radar</span>
          </div>
          <Link
            href="/"
            className="font-mono text-[12px] text-zinc-400 transition-colors hover:text-zinc-200"
          >
            ← radar
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 pt-10 md:px-8">
        {ActiveGame && activeMeta ? (
          /* ------------------------- cabinet view ------------------------- */
          <section aria-label={`${activeMeta.title} game`} className="mx-auto max-w-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <BackToLobby onClose={close} />
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                {activeMeta.tag}
              </span>
            </div>
            <h1 className="mt-4 text-2xl font-light tracking-[-0.02em] text-zinc-50 md:text-3xl">
              {activeMeta.title},{" "}
              <em className="italic text-zinc-400">insert nothing, press play.</em>
            </h1>
            <p className="mb-4 mt-2 text-[15px] leading-relaxed text-zinc-400">{activeMeta.blurb}</p>
            <ActiveGame />
          </section>
        ) : (
          /* -------------------------- lobby view -------------------------- */
          <>
            <section aria-label="zFun arcade intro">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                zfun arcade · 30 games · 0 installs
              </p>
              <div className="relative">
                {/* blue radial glow — same hero treatment as the portal */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute -top-16 left-1/2 h-72 w-[36rem] max-w-full -translate-x-1/2"
                  style={{
                    background:
                      "radial-gradient(ellipse, rgba(59,130,246,0.10), transparent 65%)",
                  }}
                />
                <h1 className="mt-3 text-4xl font-light leading-[1.06] tracking-[-0.02em] text-zinc-50 md:text-6xl">
                  Thirty 8-bit games,
                  <br />
                  <em className="italic text-zinc-400">played right here.</em>
                </h1>
              </div>
              <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-zinc-400 md:text-lg">
                A built-in arcade for the radar: thirty small classics rendered on pixel canvases.
                Keyboard on desktop, touch pads on the phone — every game runs entirely in your
                browser, and your best scores never leave your device.
              </p>
            </section>

            <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-5">
              {ZFUN_GAMES.map((g) => (
                <button
                  key={g.slug}
                  type="button"
                  onClick={() => open(g.slug)}
                  aria-label={`Play ${g.title}`}
                  className="group flex flex-col rounded-[14px] border border-white/10 bg-[#0a0a0b] p-4 text-left transition-colors hover:border-white/30"
                >
                  <PixelGlyph
                    slug={g.slug}
                    className="h-8 w-8 transition-transform group-hover:scale-110 motion-reduce:group-hover:scale-100"
                  />
                  <span className="mt-3 text-[15px] font-semibold tracking-tight text-zinc-100">
                    {g.title}
                  </span>
                  <span className="mt-1 text-[13px] leading-relaxed text-zinc-400 line-clamp-2">
                    {g.blurb}
                  </span>
                  <span className="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider">
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-zinc-400">
                      {g.tag}
                    </span>
                    {(bests[g.slug] ?? 0) > 0 && (
                      <span className="rounded-full border border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.08)] px-2 py-0.5 text-[var(--rc-brand)]">
                        best {bests[g.slug]}
                      </span>
                    )}
                  </span>
                  <span className="mt-3 font-mono text-[11px] text-zinc-500 transition-colors group-hover:text-[var(--rc-brand)]">
                    play <span aria-hidden>→</span>
                  </span>
                </button>
              ))}
            </div>

            {/* How it plays */}
            <div className="mt-14 border-t border-white/10 pt-10">
              <h2 className="text-2xl font-light tracking-[-0.02em] text-zinc-50 md:text-3xl">
                How it plays.
                <br />
                <em className="italic text-zinc-400">Three honest rules.</em>
              </h2>
              <div className="mt-8 grid gap-8 md:grid-cols-3">
                <div>
                  <h3 className="text-[15px] font-semibold text-zinc-100">Desktop: keyboard</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                    Arrows or WASD move, space fires and jumps, ↑ rotates. Each cabinet shows its
                    exact control line under the screen — no hidden combos, nothing to memorize
                    before you start.
                  </p>
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-zinc-100">Phone: touch pads</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                    Every game that needs direction buttons gets on-screen arcade pads sized for
                    thumbs, plus gestures where they feel natural — swipe the snake, drag the
                    breakout paddle, swipe the merge board.
                  </p>
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-zinc-100">Scores: yours only</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                    Best scores live in your browser&apos;s localStorage and sync with nothing.
                    There are no accounts, no leaderboards and no telemetry — the arcade is a
                    local machine, it just happens to live on a web page.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-6 font-mono text-[12px] text-zinc-500 md:px-8">
          <span>zFun · part of GLM Bonus Radar</span>
          <span>
            thirty local games · no data leaves your device ·{" "}
            <Link href="/" className="text-[var(--rc-brand)] transition-colors hover:text-[var(--rc-accent)]">
              back to the radar
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
