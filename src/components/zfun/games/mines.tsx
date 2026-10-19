"use client";

/** zFun · MINES — 9×9, ten mines. Tap reveals, long-press (or FLAG) marks. */

import { useEffect, useRef, useState } from "react";
import {
  C,
  CanvasRef,
  GameShell,
  GameStatus,
  PIXELATED,
  beep,
  ctx2d,
  drawBitmap,
  drawGlyphText,
  pointerPos,
  useBest,
  useLoop,
} from "../engine";

const N = 9;
const MINES = 10;
const CELL = 22;
const MARGIN = 4;
const W = MARGIN * 2 + CELL * N; // 206
const H = W;

const MINE = ["00100100", "01111110", "11111111", "11111111", "11111111", "01111110", "00100100"];
const FLAG = ["11111000", "11111000", "11000000", "11000000", "11000000", "11000000", "11000000", "11000000"];

const NUM_COLOR: Record<number, string> = {
  1: C.brand,
  2: C.green,
  3: C.red,
  4: C.accent,
  5: "#b91c1c",
  6: "#2dd4bf",
  7: C.bright,
  8: C.dim,
};

export default function MinesGame() {
  const [status, setStatus] = useState<GameStatus>("ready");
  const [seconds, setSeconds] = useState(0);
  const [flags, setFlags] = useState(0);
  const [best, submitBest] = useBest("mines", "min");
  const canvasRef: CanvasRef = useRef(null);

  const mines = useRef<Set<number>>(new Set());
  const open = useRef<Set<number>>(new Set());
  const flagged = useRef<Set<number>>(new Set());
  const placed = useRef(false);
  const elapsed = useRef(0);
  const overIdx = useRef(-1);

  const idx = (r: number, c: number) => r * N + c;

  function place(safe: number) {
    mines.current = new Set();
    const banned = new Set<number>([safe, ...neighbors(safe)]);
    while (mines.current.size < MINES) {
      const i = Math.floor(Math.random() * N * N);
      if (!banned.has(i)) mines.current.add(i);
    }
    placed.current = true;
  }

  function neighbors(i: number): number[] {
    const r = Math.floor(i / N);
    const c = i % N;
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < N && nc >= 0 && nc < N) out.push(idx(nr, nc));
      }
    return out;
  }

  function countAt(i: number): number {
    let n = 0;
    for (const j of neighbors(i)) if (mines.current.has(j)) n++;
    return n;
  }

  function reset() {
    mines.current = new Set();
    open.current = new Set();
    flagged.current = new Set();
    placed.current = false;
    elapsed.current = 0;
    overIdx.current = -1;
    setSeconds(0);
    setFlags(0);
    setStatus("playing");
  }

  const start = () => reset();

  function reveal(i: number) {
    if (status !== "playing" || open.current.has(i) || flagged.current.has(i)) return;
    if (!placed.current) place(i);
    if (mines.current.has(i)) {
      overIdx.current = i;
      beep(110, 300, "square", 0.05);
      setStatus("over");
      return;
    }
    // flood fill
    const stack = [i];
    while (stack.length) {
      const cur = stack.pop()!;
      if (open.current.has(cur) || flagged.current.has(cur) || mines.current.has(cur)) continue;
      open.current.add(cur);
      if (countAt(cur) === 0) for (const j of neighbors(cur)) if (!open.current.has(j)) stack.push(j);
    }
    beep(500, 30);
    // win?
    if (open.current.size === N * N - MINES) {
      beep(660, 80);
      beep(880, 120);
      setStatus("won");
      submitBest(Math.floor(elapsed.current / 1000));
    }
  }

  function toggleFlag(i: number) {
    if (status !== "playing" || open.current.has(i)) return;
    if (flagged.current.has(i)) {
      flagged.current.delete(i);
      setFlags((f) => f - 1);
    } else if (flagged.current.size < MINES) {
      flagged.current.add(i);
      setFlags((f) => f + 1);
      beep(600, 35);
    }
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const i = idx(r, c);
        const x = MARGIN + c * CELL;
        const y = MARGIN + r * CELL;
        const isOpen = open.current.has(i);
        // cell background
        ctx.fillStyle = isOpen ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.09)";
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        if (flagged.current.has(i)) drawBitmap(ctx, FLAG, x + 7, y + 5, 1, C.yellow);
        if (isOpen) {
          const n = countAt(i);
          if (n) drawGlyphText(ctx, String(n), x + CELL / 2, y + CELL / 2 - 5, 2, NUM_COLOR[n], "center");
        }
        // mines shown at end
        if (status !== "playing" && mines.current.has(i) && !flagged.current.has(i)) {
          drawBitmap(ctx, MINE, x + 7, y + 7, 1, i === overIdx.current ? C.red : C.dim);
        }
        // grid line
        ctx.strokeStyle = C.frame;
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      }
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    if (status === "playing") {
      elapsed.current += dt;
      setSeconds(Math.floor(elapsed.current / 1000));
    }
    draw();
  });



  useEffect(() => {
    draw();
     
  }, []);

  const press = useRef<{ i: number; timer: ReturnType<typeof setTimeout> | null; longFired: boolean } | null>(null);
  const flagMode = useRef(false);
  const [flagModeUi, setFlagModeUi] = useState(false);

  function cellFromEvent(e: React.PointerEvent<HTMLCanvasElement>): number | null {
    const p = pointerPos(e);
    const c = Math.floor((p.x - MARGIN) / CELL);
    const r = Math.floor((p.y - MARGIN) / CELL);
    if (r < 0 || r >= N || c < 0 || c >= N) return null;
    return idx(r, c);
  }

  return (
    <GameShell
      slug="mines"
      title="MINES"
      status={status}
      scoreLabel="TIME"
      score={seconds}
      best={best}
      hint="tap to reveal · long-press / F / FLAG to mark · first tap is always safe"
      overlayNote={
        status === "won"
          ? `cleared in ${seconds}s — best ${best > 0 ? Math.min(best, seconds) : seconds}s`
          : status === "over"
            ? `${MINES - flags} mines unaccounted for`
            : `${MINES - flags} mines left`
      }
      onStart={start}
      pads={
        <button
          type="button"
          onClick={() => {
            flagMode.current = !flagMode.current;
            setFlagModeUi(flagMode.current);
          }}
          aria-pressed={flagModeUi}
          className={`zs-pixel h-12 rounded-full border px-6 text-[9px] leading-none transition-colors ${
            flagModeUi
              ? "border-[var(--rc-accent)] bg-[rgba(59,130,246,0.14)] text-[var(--rc-brand)]"
              : "border-hair/10 bg-hair/[0.03] text-dim"
          }`}
        >
          FLAG {flagModeUi ? "ON" : "OFF"}
        </button>
      }
      canvasMax={360}
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={PIXELATED}
        className="block w-full touch-none"
        onContextMenu={(e) => {
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          if (status !== "playing") return;
          const i = cellFromEvent(e);
          if (i === null) return;
          if (e.pointerType === "mouse" && e.button === 2) {
            toggleFlag(i);
            return;
          }
          press.current = { i, timer: null, longFired: false };
          press.current.timer = setTimeout(() => {
            if (press.current && press.current.i === i) {
              press.current.longFired = true;
              toggleFlag(i);
              try {
                navigator.vibrate?.(30);
              } catch {
                /* haptics optional */
              }
            }
          }, 350);
        }}
        onPointerUp={(e) => {
          const p = press.current;
          press.current = null;
          if (p?.timer) clearTimeout(p.timer);
          if (!p || p.longFired || status !== "playing") return;
          const i = cellFromEvent(e);
          if (i !== p.i) return;
          if (flagMode.current || (e.pointerType === "mouse" && e.button === 2)) toggleFlag(i);
          else reveal(i);
        }}
        onPointerLeave={() => {
          if (press.current?.timer) clearTimeout(press.current.timer);
          press.current = null;
        }}
      />
    </GameShell>
  );
}
