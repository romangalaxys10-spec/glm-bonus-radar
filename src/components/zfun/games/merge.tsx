"use client";

/** zFun · MERGE — 2048 on a 4×4 field. Arrows or swipe, chase the big tile. */

import { useEffect, useRef, useState } from "react";
import {
  C,
  CanvasRef,
  GameShell,
  GameStatus,
  PIXELATED,
  beep,
  ctx2d,
  drawGlyphText,
  pointerPos,
  useBest,
  useInput,
  useLoop,
} from "../engine";

const N = 4;
const CELL = 42;
const GAP = 6;
const MARGIN = 8;
const W = MARGIN * 2 + CELL * N + GAP * (N - 1); // 202
const H = W;

// tile value → [bg, fg]
const TILE_STYLE: Record<number, [string, string]> = {
  2: ["#3f3f46", C.bright],
  4: ["#52525b", C.bright],
  8: ["#71717a", C.bright],
  16: ["#a1a1aa", "#18181b"],
  32: ["#d4d4d8", "#18181b"],
  64: [C.yellow, "#18181b"],
  128: [C.orange, "#18181b"],
  256: [C.red, C.bright],
  512: [C.green, "#18181b"],
  1024: [C.accent, C.bright],
  2048: [C.brand, "#050505"],
};

function spawn(grid: number[][]): void {
  const empty: [number, number][] = [];
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) if (!grid[r][c]) empty.push([r, c]);
  if (!empty.length) return;
  const [r, c] = empty[Math.floor(Math.random() * empty.length)];
  grid[r][c] = Math.random() < 0.9 ? 2 : 4;
}

function slideRow(row: number[]): { row: number[]; gained: number; moved: boolean } {
  const vals = row.filter(Boolean);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < vals.length; i++) {
    if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
      const m = vals[i] * 2;
      out.push(m);
      gained += m;
      i++;
    } else out.push(vals[i]);
  }
  while (out.length < N) out.push(0);
  const moved = out.some((v, i) => v !== row[i]);
  return { row: out, gained, moved };
}

function move(grid: number[][], dir: "up" | "down" | "left" | "right"): { grid: number[][]; gained: number; moved: boolean } {
  const g = grid.map((r) => [...r]);
  let gained = 0;
  let moved = false;
  for (let i = 0; i < N; i++) {
    // extract line in slide direction
    let line: number[];
    if (dir === "left") line = [...g[i]];
    else if (dir === "right") line = [...g[i]].reverse();
    else if (dir === "up") line = g.map((r) => r[i]);
    else line = g.map((r) => r[i]).reverse();
    const res = slideRow(line);
    gained += res.gained;
    // write back
    for (let j = 0; j < N; j++) {
      const v = res.row[j];
      if (dir === "left") g[i][j] = v;
      else if (dir === "right") g[i][N - 1 - j] = v;
      else if (dir === "up") g[j][i] = v;
      else g[N - 1 - j][i] = v;
    }
    if (res.moved) moved = true;
  }
  return { grid: g, gained, moved };
}

function canMove(grid: number[][]): boolean {
  for (const dir of ["up", "down", "left", "right"] as const)
    if (move(grid, dir).moved) return true;
  return false;
}

export default function MergeGame() {
  const input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("merge");
  const canvasRef: CanvasRef = useRef(null);

  const grid = useRef<number[][]>([]);
  const wonShown = useRef(false);
  const flash = useRef<{ r: number; c: number; t: number } | null>(null);

  function reset() {
    grid.current = Array.from({ length: N }, () => Array(N).fill(0));
    spawn(grid.current);
    spawn(grid.current);
    setScore(0);
    wonShown.current = false;
    setStatus("playing");
  }

  const start = () => reset();

  function doMove(dir: "up" | "down" | "left" | "right") {
    const res = move(grid.current, dir);
    if (!res.moved) return;
    grid.current = res.grid;
    spawn(grid.current);
    flash.current = { r: -1, c: -1, t: 120 };
    if (res.gained) {
      setScore((s) => s + res.gained);
      beep(320 + Math.log2(res.gained) * 40, 50);
    } else beep(240, 25);
    // win check
    if (!wonShown.current && grid.current.some((row) => row.some((v) => v >= 2048))) {
      wonShown.current = true;
      beep(880, 200);
      setStatus("won");
      submitBest(score + res.gained);
      return;
    }
    // dead check
    if (!canMove(grid.current)) {
      beep(110, 300, "square", 0.05);
      setStatus("over");
      submitBest(score + res.gained);
    }
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // empty cells
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const x = MARGIN + c * (CELL + GAP);
        const y = MARGIN + r * (CELL + GAP);
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.fillRect(x, y, CELL, CELL);
      }
    // tiles
    if (grid.current.length) {
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          const v = grid.current[r][c];
          if (!v) continue;
          const x = MARGIN + c * (CELL + GAP);
          const y = MARGIN + r * (CELL + GAP);
          const [bg, fg] = TILE_STYLE[v] ?? [C.brand, "#050505"];
          ctx.fillStyle = flash.current && flash.current.t > 80 ? C.bright : bg;
          ctx.fillRect(x, y, CELL, CELL);
          drawGlyphText(ctx, String(v), x + CELL / 2, y + CELL / 2 - 5, 2, fg, "center");
        }
    }
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    if (status === "playing") {
      const edges = input.drain();
      for (const e of edges) {
        if (e === "up") doMove("up");
        if (e === "down") doMove("down");
        if (e === "left") doMove("left");
        if (e === "right") doMove("right");
      }
    } else input.drain();
    if (flash.current) {
      flash.current.t -= dt;
      if (flash.current.t <= 0) flash.current = null;
    }
    draw();
  });



  useEffect(() => {
    draw();
     
  }, []);

  // won overlay → tap continues playing
  const startOrContinue = () => {
    if (status === "won") {
      setStatus("playing");
      return;
    }
    reset();
  };

  const swipe = useRef<{ x: number; y: number } | null>(null);

  return (
    <GameShell
      slug="merge"
      title="MERGE"
      status={status}
      scoreLabel="PTS"
      score={score}
      best={best}
      hint="arrows / swipe any direction · win at 2048, keep going after"
      overlayNote={
        status === "over"
          ? `score ${score} · board full`
          : status === "won"
            ? "2048 reached — tap to keep going"
            : "merge equal tiles"
      }
      onStart={startOrContinue}
      canvasMax={340}
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={PIXELATED}
        className="block w-full touch-none"
        onPointerDown={(e) => {
          if (status !== "playing") return;
          swipe.current = pointerPos(e);
        }}
        onPointerUp={(e) => {
          if (status !== "playing" || !swipe.current) return;
          const p = pointerPos(e);
          const dx = p.x - swipe.current.x;
          const dy = p.y - swipe.current.y;
          swipe.current = null;
          if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
          if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? "right" : "left");
          else doMove(dy > 0 ? "down" : "up");
        }}
      />
    </GameShell>
  );
}
