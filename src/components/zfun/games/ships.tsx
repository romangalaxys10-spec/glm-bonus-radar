"use client";

/** zFun · SHIPS — battleship on two grids. Find the fleet before it finds yours. */

import { useEffect, useRef, useState } from "react";
import {
  C,
  CanvasRef,
  GameShell,
  GameStatus,
  PIXELATED,
  beep,
  ctx2d,
  useBest,
  useLoop,
} from "../engine";

const N = 8;
const CELL = 15;
const GAP = 26;
const OY = 26;
const W = N * CELL * 2 + GAP * 3; // 278
const H = OY + N * CELL + 14; // 160

interface Ship {
  cells: number[]; // r*N+c
  hits: number;
}

interface Side {
  shots: Map<number, "hit" | "miss">;
  fleet: Ship[];
}

const SIZES = [4, 3, 2, 2];

function placeFleet(): Ship[] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const taken = new Set<number>();
    const fleet: Ship[] = [];
    let ok = true;
    for (const size of SIZES) {
      let placed = false;
      for (let tries = 0; tries < 60 && !placed; tries++) {
        const horiz = Math.random() < 0.5;
        const r = Math.floor(Math.random() * (horiz ? N : N - size + 1));
        const c = Math.floor(Math.random() * (horiz ? N - size + 1 : N));
        const cells: number[] = [];
        for (let i = 0; i < size; i++) cells.push(horiz ? r * N + c + i : (r + i) * N + c);
        if (cells.some((x) => taken.has(x))) continue;
        cells.forEach((x) => taken.add(x));
        fleet.push({ cells, hits: 0 });
        placed = true;
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return fleet;
  }
  return [{ cells: [0, 1, 2, 3], hits: 0 }]; // unreachable in practice
}

export default function ShipsGame() {
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("ships");
  const canvasRef: CanvasRef = useRef(null);

  const enemy = useRef<Side>({ shots: new Map(), fleet: placeFleet() });
  const mine = useRef<Side>({ shots: new Map(), fleet: placeFleet() });
  const cpuIn = useRef(700);
  const cpuTarget = useRef<number[]>([]);
  const msg = useRef("your shot");

  function reset() {
    enemy.current = { shots: new Map(), fleet: placeFleet() };
    mine.current = { shots: new Map(), fleet: placeFleet() };
    cpuIn.current = 700;
    cpuTarget.current = [];
    msg.current = "your shot";
    setScore(0);
    setStatus("playing");
  }

  const start = () => reset();

  function fireAt(side: Side, idx: number): "hit" | "miss" | "dup" {
    if (side.shots.has(idx)) return "dup";
    const ship = side.fleet.find((s) => s.cells.includes(idx));
    if (ship) {
      ship.hits += 1;
      side.shots.set(idx, "hit");
      return "hit";
    }
    side.shots.set(idx, "miss");
    return "miss";
  }

  function sunkCount(side: Side): number {
    return side.fleet.filter((s) => s.hits >= s.cells.length).length;
  }

  function playerFire(idx: number) {
    if (status !== "playing") return;
    const res = fireAt(enemy.current, idx);
    if (res === "dup") return;
    if (res === "hit") {
      setScore((v) => v + 1);
      beep(680, 60);
      msg.current = "hit!";
    } else {
      beep(240, 40);
      msg.current = "miss";
    }
    if (sunkCount(enemy.current) === enemy.current.fleet.length) {
      beep(900, 240);
      setStatus("won");
      submitBest(score + 1);
      return;
    }
    cpuIn.current = 650;
  }

  function cpuFire() {
    const mine2 = mine.current;
    let idx: number;
    if (cpuTarget.current.length) {
      idx = cpuTarget.current.pop()!;
    } else {
      const free: number[] = [];
      for (let i = 0; i < N * N; i++) if (!mine2.shots.has(i)) free.push(i);
      if (!free.length) return;
      idx = free[Math.floor(Math.random() * free.length)];
    }
    const res = fireAt(mine2, idx);
    if (res === "hit") {
      msg.current = "they hit you";
      beep(180, 120);
      // hunt neighbors next
      const r = Math.floor(idx / N);
      const c = idx % N;
      const neighbors = [
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ]
        .filter(([rr, cc]) => rr >= 0 && rr < N && cc >= 0 && cc < N)
        .map(([rr, cc]) => rr * N + cc)
        .filter((x) => !mine2.shots.has(x));
      cpuTarget.current.push(...neighbors);
      if (sunkCount(mine2) === mine2.fleet.length) {
        beep(90, 340, "sawtooth", 0.06);
        setStatus("over");
        submitBest(score);
        return;
      }
    } else {
      msg.current = "they missed";
      beep(300, 30, "triangle", 0.02);
    }
    cpuIn.current = 900;
  }

  function drawGrid(ctx: CanvasRenderingContext2D, ox: number, side: Side, isEnemy: boolean) {
    for (let i = 0; i < N * N; i++) {
      const x = ox + (i % N) * CELL;
      const y = OY + Math.floor(i / N) * CELL;
      const shot = side.shots.get(i);
      const isShip = !isEnemy && side.fleet.some((s) => s.cells.includes(i));
      ctx.fillStyle = isShip ? "rgba(59,130,246,0.4)" : "#161618";
      ctx.fillRect(x, y, CELL - 1, CELL - 1);
      if (shot === "hit") {
        ctx.fillStyle = C.red;
        ctx.fillRect(x + 3, y + 3, CELL - 7, CELL - 7);
        ctx.fillStyle = C.bright;
        ctx.fillRect(x + 5, y + 5, CELL - 11, CELL - 11);
      } else if (shot === "miss") {
        ctx.fillStyle = C.dim;
        ctx.fillRect(x + CELL / 2 - 1, y + CELL / 2 - 1, 3, 3);
      }
      ctx.strokeStyle = C.grid;
      ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
    }
    // sunk markers
    for (const s of side.fleet) {
      if (s.hits < s.cells.length) continue;
      const xs = s.cells.map((c2) => ox + (c2 % N) * CELL);
      const ys = s.cells.map((c2) => OY + Math.floor(c2 / N) * CELL);
      ctx.strokeStyle = C.red;
      ctx.strokeRect(Math.min(...xs) + 0.5, Math.min(...ys) + 0.5,
        Math.max(...xs) - Math.min(...xs) + CELL - 1, Math.max(...ys) - Math.min(...ys) + CELL - 1);
    }
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    drawGrid(ctx, GAP, enemy.current, true);
    drawGrid(ctx, GAP * 2 + N * CELL, mine.current, false);
    // divider + status pips
    ctx.fillStyle = C.faint;
    ctx.fillRect(GAP + N * CELL + GAP / 2 - 1, OY, 2, N * CELL);
    ctx.fillStyle = C.dim;
    for (let i = 0; i < 4; i++) {
      const sunkE = enemy.current.fleet[i].hits >= enemy.current.fleet[i].cells.length;
      const sunkM = mine.current.fleet[i].hits >= mine.current.fleet[i].cells.length;
      ctx.fillStyle = sunkE ? C.accent : C.frame;
      ctx.fillRect(GAP + i * 6, 12, 4, 4);
      ctx.fillStyle = sunkM ? C.red : C.frame;
      ctx.fillRect(GAP * 2 + N * CELL + i * 6, 12, 4, 4);
    }
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    if (status === "playing" && cpuIn.current > 0) {
      cpuIn.current -= dt;
      if (cpuIn.current <= 0) cpuFire();
    }
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  return (
    <GameShell
      slug="ships"
      title="SHIPS"
      status={status}
      scoreLabel="HITS"
      score={score}
      best={best}
      hint="tap / click the left grid to fire · red pips = sunk fleets · blue cells are your ships"
      overlayNote={
        status === "won"
          ? `enemy fleet sunk — ${score} accurate shots`
          : status === "over"
            ? `your fleet went down · ${score} hits landed`
            : undefined
      }
      onStart={start}
      canvasMax={480}
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={PIXELATED}
        className="block w-full touch-none"
        onPointerDown={(e) => {
          e.preventDefault();
          const el = e.currentTarget;
          const r = el.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          const y = ((e.clientY - r.top) / r.height) * H;
          const col = Math.floor((x - GAP) / CELL);
          const row = Math.floor((y - OY) / CELL);
          const offX = x - GAP - col * CELL;
          if (col >= 0 && col < N && row >= 0 && row < N && offX < CELL) {
            playerFire(row * N + col);
          }
        }}
      />
    </GameShell>
  );
}
