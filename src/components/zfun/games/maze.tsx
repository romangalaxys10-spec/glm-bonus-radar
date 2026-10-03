"use client";

/** zFun · MAZE — a fresh labyrinth every level, a shrinking clock, one exit. */

import { useEffect, useRef, useState } from "react";
import {
  C,
  CanvasRef,
  GameShell,
  GameStatus,
  Input,
  Pad,
  PIXELATED,
  beep,
  ctx2d,
  drawGlyphText,
  useBest,
  useInput,
  useLoop,
} from "../engine";

const COLS = 15;
const ROWS = 11;
const CELL = 14;
const W = COLS * CELL + 2; // 212
const H = ROWS * CELL + 2; // 156

interface MazeCell {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

function carveMaze(): MazeCell[][] {
  const grid: MazeCell[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({ n: true, e: true, s: true, w: true })),
  );
  const visited = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false));
  const stack: [number, number][] = [[0, 0]];
  visited[0][0] = true;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const neighbors: [number, number, "n" | "e" | "s" | "w", "n" | "e" | "s" | "w"][] = [];
    if (y > 0 && !visited[y - 1][x]) neighbors.push([x, y - 1, "n", "s"]);
    if (x < COLS - 1 && !visited[y + 0][x + 1]) neighbors.push([x + 1, y, "e", "w"]);
    if (y < ROWS - 1 && !visited[y + 1][x]) neighbors.push([x, y + 1, "s", "n"]);
    if (x > 0 && !visited[y][x - 1]) neighbors.push([x - 1, y, "w", "e"]);
    if (!neighbors.length) {
      stack.pop();
      continue;
    }
    const [nx, ny, wallSelf, wallOther] = neighbors[Math.floor(Math.random() * neighbors.length)];
    grid[y][x][wallSelf] = false;
    grid[ny][nx][wallOther] = false;
    visited[ny][nx] = true;
    stack.push([nx, ny]);
  }
  return grid;
}

export default function MazeGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [level, setLevel] = useState(1);
  const [best, submitBest] = useBest("maze");
  const canvasRef: CanvasRef = useRef(null);

  const maze = useRef<MazeCell[][]>(carveMaze());
  const px = useRef(0);
  const py = useRef(0);
  const budget = useRef(26_000);
  const timeLeft = useRef(26_000);
  const stepIn = useRef(0);

  function newLevel(n: number) {
    maze.current = carveMaze();
    px.current = 0;
    py.current = 0;
    budget.current = Math.max(13_000, 27_000 - n * 2_000);
    timeLeft.current = budget.current;
    stepIn.current = 0;
    setLevel(n);
  }

  function reset() {
    newLevel(1);
    setStatus("playing");
  }

  const start = () => reset();

  function tryMove(dx: number, dy: number) {
    const cell = maze.current[py.current][px.current];
    if (dx === 1 && !cell.e) px.current += 1;
    else if (dx === -1 && !cell.w) px.current -= 1;
    else if (dy === 1 && !cell.s) py.current += 1;
    else if (dy === -1 && !cell.n) py.current -= 1;
    else return false;
    beep(430, 22, "square", 0.015);
    return true;
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // walls
    ctx.fillStyle = C.dim;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = maze.current[y][x];
        const bx = 1 + x * CELL;
        const by = 1 + y * CELL;
        if (c.n) ctx.fillRect(bx, by, CELL + 1, 2);
        if (c.w) ctx.fillRect(bx, by, 2, CELL + 1);
        if (x === COLS - 1 && c.e) ctx.fillRect(bx + CELL - 1, by, 2, CELL + 1);
        if (y === ROWS - 1 && c.s) ctx.fillRect(bx, by + CELL - 1, CELL + 1, 2);
      }
    }
    // exit
    ctx.fillStyle = C.accent;
    ctx.fillRect(1 + (COLS - 1) * CELL + 3, 1 + (ROWS - 1) * CELL + 3, CELL - 5, CELL - 5);
    ctx.fillStyle = C.bright;
    ctx.fillRect(1 + (COLS - 1) * CELL + 6, 1 + (ROWS - 1) * CELL + 6, 3, 3);
    // player
    ctx.fillStyle = C.brand;
    ctx.fillRect(1 + px.current * CELL + 3, 1 + py.current * CELL + 3, CELL - 6, CELL - 6);
    ctx.fillStyle = C.bg;
    ctx.fillRect(1 + px.current * CELL + 6, 1 + py.current * CELL + 6, 2, 2);
    // timer bar + seconds
    const frac = Math.max(0, timeLeft.current / budget.current);
    ctx.fillStyle = C.frame;
    ctx.fillRect(4, H - 8, W - 8, 4);
    ctx.fillStyle = frac > 0.3 ? C.green : C.red;
    ctx.fillRect(4, H - 8, (W - 8) * frac, 4);
    const secs = Math.ceil(timeLeft.current / 1000);
    drawGlyphText(ctx, String(secs), W - 13, 4, 1, secs <= 5 ? C.red : C.dim);
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    if (status === "playing") {
      timeLeft.current -= dt;
      if (timeLeft.current <= 0) {
        beep(120, 320, "sawtooth", 0.05);
        setStatus("over");
        submitBest(level);
        return;
      }
      // held-direction movement with a step timer
      stepIn.current -= dt;
      if (stepIn.current <= 0) {
        const dirs: [string, number, number][] = [
          ["up", 0, -1],
          ["down", 0, 1],
          ["left", -1, 0],
          ["right", 1, 0],
        ];
        let moved = false;
        for (const [btn, dx, dy] of dirs) {
          if (input.held.has(btn as "up")) {
            moved = tryMove(dx, dy);
            if (moved) break;
          }
        }
        stepIn.current = moved ? 95 : 0;
      }
      if (px.current === COLS - 1 && py.current === ROWS - 1) {
        submitBest(level);
        newLevel(level + 1);
        beep(760, 140);
      }
    }
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  return (
    <GameShell
      slug="maze"
      title="MAZE"
      status={status}
      scoreLabel="LEVEL"
      score={level}
      best={best}
      hint="arrows / WASD or the pads — hold to run · reach the blue exit before the bar empties"
      overlayNote={
        status === "over"
          ? `walled in on level ${level} · best ${Math.max(best, level)}`
          : status === "ready"
            ? "every level is a brand-new labyrinth"
            : undefined
      }
      onStart={start}
      pads={
        <>
          <div className="flex flex-col items-center gap-2">
            <Pad input={input} btn="up" label="↑" ariaLabel="Move up" />
            <div className="flex gap-2">
              <Pad input={input} btn="left" label="←" ariaLabel="Move left" />
              <Pad input={input} btn="down" label="↓" ariaLabel="Move down" />
              <Pad input={input} btn="right" label="→" ariaLabel="Move right" />
            </div>
          </div>
        </>
      }
      canvasMax={Math.min(440, W * 2)}
    >
      <canvas ref={canvasRef} width={W} height={H} style={PIXELATED} className="block w-full touch-none" />
    </GameShell>
  );
}
