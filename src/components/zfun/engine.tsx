"use client";

/**
 * zFun engine — the shared 8-bit arcade runtime.
 *
 * One input system (keyboard + on-screen pads feed the same edge/hold model),
 * one game loop, one best-score store, one chiptune beep, one shell chrome.
 * Games render on low-res canvases scaled with image-rendering: pixelated.
 */

import {
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { zfunBestKey } from "@/lib/zfun";

/* ------------------------------------------------------------------ */
/* Palette — arcade colors over the portal's xShredo chrome.           */
/* ------------------------------------------------------------------ */

export const C = {
  bg: "#0a0a0b",
  grid: "rgba(255,255,255,0.05)",
  frame: "rgba(255,255,255,0.1)",
  ink: "#e4e4e7",
  dim: "#a1a1aa",
  faint: "#52525b",
  bright: "#fafafa",
  accent: "#3b82f6",
  brand: "#60a5fa",
  red: "#f87171",
  orange: "#fb923c",
  yellow: "#facc15",
  green: "#4ade80",
} as const;

/* ------------------------------------------------------------------ */
/* Input — keyboard and on-screen pads feed one model.                 */
/* ------------------------------------------------------------------ */

export type Btn =
  | "up"
  | "down"
  | "left"
  | "right"
  | "fire"
  | "action"
  | "flag"
  | "ul"
  | "ur"
  | "dl"
  | "dr";

const KEYMAP: Record<string, Btn> = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  Space: "fire",
  Enter: "fire",
  KeyJ: "fire",
  KeyK: "action",
  KeyX: "action",
  KeyF: "flag",
  // diagonal hops (isometric cabinets)
  KeyQ: "ul",
  KeyE: "ur",
  KeyZ: "dl",
  KeyC: "dr",
};

export interface Input {
  /** Buttons currently held (keyboard or virtual pad). */
  readonly held: ReadonlySet<Btn>;
  /** One-shot presses since the last drain (keyboard never auto-repeats). */
  drain(): Btn[];
  /** A–Z key presses since the last drain (word-game channel). */
  drainLetters(): string[];
  /** Virtual pad hookup: simulate a button press/release. */
  press(b: Btn, isDown: boolean): void;
}

export function useInput(): Input {
  const held = useRef(new Set<Btn>());
  const edges = useRef<Btn[]>([]);
  const letters = useRef<string[]>([]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      // Letters are additive: every A–Z key feeds the word-game channel,
      // mapped keys (WASD, QEZC, …) additionally act as buttons.
      const lm = /^Key([A-Z])$/.exec(e.code);
      if (lm && !e.repeat) letters.current.push(lm[1]);
      const b = KEYMAP[e.code];
      if (!b) return;
      // A game is on screen: never let the page scroll under the player.
      e.preventDefault();
      if (!e.repeat) edges.current.push(b);
      held.current.add(b);
    };
    const onUp = (e: KeyboardEvent) => {
      const b = KEYMAP[e.code];
      if (b) held.current.delete(b);
    };
    const onBlur = () => held.current.clear();
    window.addEventListener("keydown", onDown, { passive: false });
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      held.current.clear();
      edges.current.length = 0;
      letters.current.length = 0;
    };
  }, []);

  return {
    get held() {
      return held.current;
    },
    drain() {
      const out = edges.current;
      edges.current = [];
      return out;
    },
    drainLetters() {
      const out = letters.current;
      letters.current = [];
      return out;
    },
    press(b: Btn, isDown: boolean) {
      if (isDown) {
        edges.current.push(b);
        held.current.add(b);
      } else {
        held.current.delete(b);
      }
    },
  };
}

/** On-screen arcade button — 44px+ touch target, promo chip styling. */
export function Pad({
  input,
  btn,
  label,
  wide,
  ariaLabel,
}: {
  input: Input;
  btn: Btn;
  label: string;
  wide?: boolean;
  ariaLabel?: string;
}) {
  const [active, setActive] = useState(false);
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setActive(true);
    input.press(btn, true);
  };
  const up = () => {
    setActive(false);
    input.press(btn, false);
  };
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      aria-pressed={active}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={up}
      onContextMenu={(e) => e.preventDefault()}
      className={`zs-pixel select-none touch-none rounded-full border text-[9px] leading-none transition-colors ${
        wide ? "px-6" : ""
      } h-12 min-w-12 ${
        active
          ? "border-[var(--rc-accent)] bg-[rgba(59,130,246,0.14)] text-[var(--rc-brand)]"
          : "border-white/10 bg-white/[0.03] text-zinc-400"
      }`}
    >
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Loop — rAF with clamped dt, paused when the tab is hidden.          */
/* ------------------------------------------------------------------ */

export function useLoop(step: (dtMs: number) => void, active = true) {
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(50, t - last);
      last = t;
      if (!document.hidden) stepRef.current(dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

/* ------------------------------------------------------------------ */
/* Best scores — localStorage only, per game.                          */
/* ------------------------------------------------------------------ */

/**
 * Best-score hook. mode "max" (default) keeps the highest value ("points"),
 * mode "min" keeps the lowest non-zero value ("fastest time").
 */
export function useBest(
  slug: string,
  mode: "max" | "min" = "max",
): [number, (v: number) => void] {
  const [best, setBest] = useState(0);

  useEffect(() => {
    // deferred: reading storage synchronously in the effect body would cascade
    const id = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(zfunBestKey(slug));
        if (raw !== null) setBest(Number(raw) || 0);
      } catch {
        /* storage unavailable — scores stay session-only */
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [slug]);

  const submit = useCallback(
    (v: number) => {
      setBest((prev) => {
        const better = mode === "max" ? v > prev : prev === 0 || v < prev;
        if (!better) return prev;
        try {
          window.localStorage.setItem(zfunBestKey(slug), String(v));
        } catch {
          /* ignore */
        }
        return v;
      });
    },
    [slug, mode],
  );

  return [best, submit];
}

/* ------------------------------------------------------------------ */
/* Audio — one lazily-unlocked AudioContext, tiny square-wave beeps.   */
/* ------------------------------------------------------------------ */

let audioCtx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
}
export function isMuted() {
  return muted;
}

export function beep(freq: number, durMs = 60, type: OscillatorType = "square", vol = 0.035) {
  if (muted) return;
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000);
  } catch {
    /* audio is a garnish — never let it break a game */
  }
}

/* ------------------------------------------------------------------ */
/* Pixel drawing helpers — bitmap sprites + a 3×5 glyph font.          */
/* ------------------------------------------------------------------ */

/** Draws a bitmap sprite ("1" = pixel) at scale s. */
export function drawBitmap(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  x: number,
  y: number,
  s = 1,
  color: string = C.ink,
) {
  ctx.fillStyle = color;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === "1") ctx.fillRect(x + c * s, y + r * s, s, s);
    }
  }
}

const GLYPHS: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "011", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  ":": ["0", "1", "0", "1", "0"],
  "-": ["000", "000", "111", "000", "000"],
};

/**
 * Draws digits (and : -) in the 3×5 pixel font. Returns the width drawn.
 * Glyph metrics: width 3·s, colon width 1·s, tracking 1·s, height 5·s.
 */
export function drawGlyphText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  s = 1,
  color: string = C.bright,
  align: "left" | "center" = "left",
): number {
  let w = 0;
  for (const ch of text) w += (ch === ":" ? 1 : 3) * s + s;
  w -= s;
  let cx = align === "center" ? x - w / 2 : x;
  ctx.fillStyle = color;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) {
      const gw = (ch === ":" ? 1 : 3) * s;
      for (let r = 0; r < g.length; r++) {
        for (let c = 0; c < g[r].length; c++) {
          if (g[r][c] === "1") ctx.fillRect(cx + c * s, y + r * s, s, s);
        }
      }
      cx += gw + s;
    }
  }
  return w;
}

/** Maps a pointer event to logical canvas coordinates. */
export function pointerPos(e: React.PointerEvent<HTMLCanvasElement>): {
  x: number;
  y: number;
} {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * el.width,
    y: ((e.clientY - r.top) / r.height) * el.height,
  };
}

/** Standard canvas style: crisp pixels at any CSS size. */
export const PIXELATED = { imageRendering: "pixelated" } as const;

/** Convenience ref type for game canvases. */
export type CanvasRef = RefObject<HTMLCanvasElement | null>;

/** Grabs a 2D context or null. */
export function ctx2d(canvas: CanvasRef): CanvasRenderingContext2D | null {
  return canvas.current?.getContext("2d") ?? null;
}

/* ------------------------------------------------------------------ */
/* GameShell — shared arcade cabinet chrome (promo design language).   */
/* ------------------------------------------------------------------ */

export type GameStatus = "ready" | "playing" | "over" | "won";

export function GameShell({
  slug,
  title,
  status,
  scoreLabel,
  score,
  best,
  hint,
  overlayNote,
  onStart,
  pads,
  canvasMax,
  children,
}: {
  slug: string;
  title: string;
  status: GameStatus;
  scoreLabel: string;
  score: number;
  best: number;
  hint: string;
  overlayNote?: string;
  onStart: () => void;
  pads?: ReactNode;
  canvasMax?: number;
  children: ReactNode;
}) {
  const [sndOn, setSndOn] = useState(true);
  const playing = status === "playing";

  // Space / Enter start or restart from the overlay (the shell's promise:
  // "TAP OR PRESS SPACE" — honored uniformly for all ten games).
  const startRef = useRef(onStart);
  useEffect(() => {
    startRef.current = onStart;
  });
  useEffect(() => {
    if (playing) return;
    const h = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        startRef.current();
      }
    };
    window.addEventListener("keydown", h, { passive: false });
    return () => window.removeEventListener("keydown", h);
  }, [playing]);
  return (
    <div className="flex flex-col items-center">
      {/* Cabinet header */}
      <div className="flex w-full max-w-full flex-wrap items-center justify-between gap-2 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span
              className={`absolute inline-flex h-full w-full rounded-full ${
                playing ? "animate-ping bg-[#3b82f6]/60" : ""
              }`}
            />
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                playing ? "bg-[#3b82f6]" : "bg-zinc-600"
              }`}
            />
          </span>
          <span className="zs-pixel text-[10px] text-zinc-200">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[11px] text-zinc-400">
            {scoreLabel} <span className="zs-pixel text-[9px] text-zinc-100">{score}</span>
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[11px] text-zinc-400">
            BEST <span className="zs-pixel text-[9px] text-[var(--rc-brand)]">{best}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setMuted(!sndOn);
              setSndOn(!sndOn);
              if (sndOn) return; // was on → now muted, no beep
              beep(660, 40);
            }}
            aria-label={sndOn ? "Mute sound effects" : "Unmute sound effects"}
            className="hidden rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:border-white/30 hover:text-zinc-200 sm:block"
          >
            {sndOn ? "SND ON" : "MUTED"}
          </button>
        </div>
      </div>

      {/* Screen */}
      <div
        className="relative w-full overflow-hidden rounded-[14px] border border-white/10 bg-[#0a0a0b] p-2 sm:p-3"
        style={{
          boxShadow:
            "0 30px 80px -20px rgba(59,130,246,0.28), inset 0 1px 0 rgba(255,255,255,0.14)",
          maxWidth: canvasMax,
        }}
      >
        {/* LED strip — sibling of the glowing console on /search */}
        <div className="mb-2 flex items-center gap-1.5 px-1">
          <span className="h-1 w-6 rounded-full bg-[#3b82f6]" />
          <span className="h-1 w-2 rounded-full bg-white/25" />
          <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">
            zfun · {slug}
          </span>
        </div>
        <div className="relative">
          {children}
          {!playing && (
            <button
              type="button"
              aria-label={status === "ready" ? `Start ${title}` : "Play again"}
              onPointerDown={(e) => {
                e.preventDefault();
                onStart();
              }}
              className="absolute inset-0 z-10 flex cursor-pointer flex-col items-center justify-center gap-3 bg-[#050505]/80 backdrop-blur-[2px]"
            >
              <span className="zs-pixel text-center text-sm text-zinc-100 sm:text-base">
                {status === "ready" ? title : status === "won" ? "YOU WIN" : "GAME OVER"}
              </span>
              {overlayNote ? (
                <span className="font-mono text-[11px] text-zinc-400">{overlayNote}</span>
              ) : null}
              <span className="zs-pixel animate-pulse text-[8px] text-[var(--rc-brand)]">
                TAP OR PRESS SPACE
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Touch pads */}
      {pads ? (
        <div className="flex w-full flex-wrap items-center justify-center gap-2 py-3">{pads}</div>
      ) : null}

      {/* Controls hint */}
      <p className="pb-2 text-center font-mono text-[11px] text-zinc-500">{hint}</p>
    </div>
  );
}

/** Small chip closing the cabinet and returning to the zFun lobby grid. */
export function BackToLobby({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Back to all games"
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-[12px] text-zinc-400 transition-colors hover:border-white/30 hover:text-zinc-200"
    >
      ← all games
    </button>
  );
}
