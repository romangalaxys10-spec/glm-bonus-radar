"use client";

/** zFun · CYCLE — leave a wall behind you, trap the other rider, never touch a wall. */

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
  useBest,
  useInput,
  useLoop,
} from "../engine";

const COLS = 30;
const ROWS = 20;
const CELL = 8;
const W = COLS * CELL; // 240
const H = ROWS * CELL; // 160

interface Pt {
  x: number;
  y: number;
}

const DIRS: Record<string, Pt> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function occupied(cells: Set<string>, x: number, y: number): boolean {
  return x < 0 || y < 0 || x >= COLS || y >= ROWS || cells.has(`${x},${y}`);
}

/** Free-space flood count (capped) — keeps the CPU from boxing itself in. */
function freedom(cells: Set<string>, x: number, y: number): number {
  const seen = new Set<string>();
  const q: Pt[] = [{ x, y }];
  while (q.length && seen.size < 14) {
    const p = q.shift()!;
    const k = `${p.x},${p.y}`;
    if (seen.has(k) || occupied(cells, p.x, p.y)) continue;
    seen.add(k);
    q.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
  }
  return seen.size;
}

export default function CycleGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("cycle");
  const canvasRef: CanvasRef = useRef(null);

  const you = useRef<Pt>({ x: 5, y: 10 });
  const youDir = useRef<Pt>(DIRS.right);
  const cpu = useRef<Pt>({ x: 24, y: 10 });
  const cpuDir = useRef<Pt>(DIRS.left);
  const youTrail = useRef<Set<string>>(new Set());
  const cpuTrail = useRef<Set<string>>(new Set());
  const acc = useRef(0);
  const accCpu = useRef(0);

  function reset() {
    you.current = { x: 5, y: 10 };
    youDir.current = DIRS.right;
    cpu.current = { x: 24, y: 10 };
    cpuDir.current = DIRS.left;
    youTrail.current = new Set(["5,10"]);
    cpuTrail.current = new Set(["24,10"]);
    acc.current = 0;
    accCpu.current = 0;
    setScore(0);
    setStatus("playing");
  }

  const start = () => reset();

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.grid;
    for (let x = 0; x < COLS; x += 3) for (let y = 0; y < ROWS; y += 3) ctx.fillRect(x * CELL, y * CELL, 1, 1);
    for (const k of youTrail.current) {
      const [x, y] = k.split(",").map(Number);
      ctx.fillStyle = C.accent;
      ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
    }
    for (const k of cpuTrail.current) {
      const [x, y] = k.split(",").map(Number);
      ctx.fillStyle = C.red;
      ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
    }
    ctx.fillStyle = C.brand;
    ctx.fillRect(you.current.x * CELL - 1, you.current.y * CELL - 1, CELL + 1, CELL + 1);
    ctx.fillStyle = "#fca5a5";
    ctx.fillRect(cpu.current.x * CELL - 1, cpu.current.y * CELL - 1, CELL + 1, CELL + 1);
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    if (status === "playing") {
      const edges = input.drain();
      for (const e of edges) {
        const d = DIRS[e];
        if (!d) continue;
        if (d.x === -youDir.current.x && d.y === -youDir.current.y) continue;
        youDir.current = d;
      }

      acc.current += dt;
      accCpu.current += dt;
      const allCells = new Set<string>([...youTrail.current, ...cpuTrail.current]);

      // player step
      if (acc.current >= 105) {
        acc.current = 0;
        you.current = { x: you.current.x + youDir.current.x, y: you.current.y + youDir.current.y };
        if (occupied(allCells, you.current.x, you.current.y)) {
          beep(110, 300, "square", 0.05);
          setStatus("over");
          submitBest(youTrail.current.size);
        } else {
          youTrail.current.add(`${you.current.x},${you.current.y}`);
          setScore(youTrail.current.size);
        }
      }

      // cpu step — slower tick, honest but careful
      if (status === "playing" && accCpu.current >= 118) {
        accCpu.current = 0;
        const cellsNow = new Set<string>([...youTrail.current, ...cpuTrail.current]);
        const options = Object.values(DIRS).filter(
          (d) => !(d.x === -cpuDir.current.x && d.y === -cpuDir.current.y) &&
            !occupied(cellsNow, cpu.current.x + d.x, cpu.current.y + d.y),
        );
        if (options.length === 0) {
          beep(660, 200);
          setStatus("won");
          submitBest(youTrail.current.size);
        } else {
          let bestOpt = options[0];
          let bestScore = -Infinity;
          for (const d of options) {
            const nx = cpu.current.x + d.x;
            const ny = cpu.current.y + d.y;
            const nextCells = new Set<string>([...cellsNow, `${nx},${ny}`]);
            const dist = Math.abs(nx - you.current.x) + Math.abs(ny - you.current.y);
            const sc = freedom(nextCells, nx, ny) * 2 - dist * 0.3 + Math.random();
            if (sc > bestScore) {
              bestScore = sc;
              bestOpt = d;
            }
          }
          cpuDir.current = bestOpt;
          cpu.current = { x: cpu.current.x + bestOpt.x, y: cpu.current.y + bestOpt.y };
          cpuTrail.current.add(`${cpu.current.x},${cpu.current.y}`);
        }
      }
    } else {
      input.drain();
    }
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  return (
    <GameShell
      slug="cycle"
      title="CYCLE"
      status={status}
      scoreLabel="TRAIL"
      score={score}
      best={best}
      hint="arrows / WASD turn — walls kill on touch · outlast the red rider"
      overlayNote={
        status === "won"
          ? `red rider derezzed at trail ${score}`
          : status === "over"
            ? `derezzed at trail ${score} · best ${Math.max(best, score)}`
            : "your light is the wall"
      }
      onStart={start}
      pads={
        <>
          <div className="flex flex-col items-center gap-2">
            <Pad input={input} btn="up" label="↑" ariaLabel="Turn up" />
            <div className="flex gap-2">
              <Pad input={input} btn="left" label="←" ariaLabel="Turn left" />
              <Pad input={input} btn="down" label="↓" ariaLabel="Turn down" />
              <Pad input={input} btn="right" label="→" ariaLabel="Turn right" />
            </div>
          </div>
        </>
      }
      canvasMax={480}
    >
      <canvas ref={canvasRef} width={W} height={H} style={PIXELATED} className="block w-full touch-none" />
    </GameShell>
  );
}
