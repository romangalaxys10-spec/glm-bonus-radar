"use client";

/** zFun · BOMBER — plant the bomb, mind the cross, clear every wandering foe. */

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

const COLS = 13;
const ROWS = 11;
const CELL = 16;
const W = COLS * CELL; // 208
const H = ROWS * CELL; // 176

interface Actor {
  tx: number;
  ty: number;
  fx: number;
  fy: number;
  step: number;
  moveMs: number;
  dx: number;
  dy: number;
}

interface Bomb {
  tx: number;
  ty: number;
  t: number;
}

interface Blast {
  tx: number;
  ty: number;
  t: number;
}

function makeGrid(level: number): number[][] {
  const g: number[][] = [];
  for (let y = 0; y < ROWS; y++) {
    const row: number[] = [];
    for (let x = 0; x < COLS; x++) {
      if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) row.push(1);
      else if (x % 2 === 0 && y % 2 === 0) row.push(1);
      else if (
        x >= 3 || y >= 3 // keep the start corner open
      ) {
        row.push(Math.random() < 0.32 ? 2 : 0);
      } else row.push(0);
    }
    g.push(row);
  }
  // guarantee the start pocket
  g[1][1] = 0;
  g[1][2] = 0;
  g[2][1] = 0;
  if (level > 1) {
    // sprinkle extra soft blocks on later levels
    for (let y = 1; y < ROWS - 1; y++)
      for (let x = 1; x < COLS - 1; x++)
        if (g[y][x] === 0 && Math.random() < 0.08) g[y][x] = 2;
  }
  return g;
}

function passable(g: number[][], x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return false;
  return g[y][x] === 0 || g[y][x] === 5;
}

export default function BomberGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("bomber");
  const canvasRef: CanvasRef = useRef(null);

  const grid = useRef<number[][]>(makeGrid(1));
  const player = useRef<Actor>({ tx: 1, ty: 1, fx: 1, fy: 1, step: 1, moveMs: 135, dx: 0, dy: 0 });
  const foes = useRef<Actor[]>([]);
  const bombs = useRef<Bomb[]>([]);
  const blasts = useRef<Blast[]>([]);
  const level = useRef(1);

  function buildLevel(n: number) {
    grid.current = makeGrid(n);
    player.current = { tx: 1, ty: 1, fx: 1, fy: 1, step: 1, moveMs: Math.max(110, 138 - n * 3), dx: 0, dy: 0 };
    foes.current = [];
    const spots: [number, number][] = [];
    for (let y = 1; y < ROWS - 1; y++)
      for (let x = 5; x < COLS - 1; x++) if (grid.current[y][x] === 0) spots.push([x, y]);
    for (let i = 0; i < n; i++) {
      const [x, y] = spots[Math.floor(Math.random() * spots.length)] ?? [COLS - 2, ROWS - 2];
      foes.current.push({
        tx: x,
        ty: y,
        fx: x,
        fy: y,
        step: 1,
        moveMs: Math.max(200, 290 - n * 12),
        dx: 0,
        dy: 0,
      });
    }
    bombs.current = [];
    blasts.current = [];
  }

  function reset() {
    level.current = 1;
    setScore(0);
    setStatus("playing");
    buildLevel(1);
  }

  const start = () => {
    if (status === "won" && level.current > 1) {
      buildLevel(level.current);
      setStatus("playing");
    } else reset();
  };

  function die() {
    beep(110, 300, "square", 0.05);
    setStatus("over");
    submitBest(score);
  }

  function explode(tx: number, ty: number) {
    beep(70, 260, "sawtooth", 0.06);
    const cells: [number, number][] = [[tx, ty]];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      for (let r = 1; r <= 2; r++) {
        const x = tx + dx * r;
        const y = ty + dy * r;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) break;
        const c = grid.current[y][x];
        if (c === 1) break;
        cells.push([x, y]);
        if (c === 2) {
          grid.current[y][x] = 0;
          setScore((v) => v + 5);
          break;
        }
      }
    }
    for (const [x, y] of cells) blasts.current.push({ tx: x, ty: y, t: 380 });
  }

  function stepActor(a: Actor, g: number[][], choose: () => void) {
    a.fx = a.tx;
    a.fy = a.ty;
    a.step = 0;
    const nx = a.tx + a.dx;
    const ny = a.ty + a.dy;
    if (passable(g, nx, ny)) {
      a.tx = nx;
      a.ty = ny;
    } else {
      a.step = 1;
      choose();
    }
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = grid.current[y][x];
        const px = x * CELL;
        const py = y * CELL;
        if (c === 1) {
          ctx.fillStyle = "#3f3f46";
          ctx.fillRect(px, py, CELL - 1, CELL - 1);
        } else if (c === 2) {
          ctx.fillStyle = "#7c5c3e";
          ctx.fillRect(px + 1, py + 1, CELL - 3, CELL - 3);
          ctx.fillStyle = "#5c4029";
          ctx.fillRect(px + 3, py + 3, CELL - 7, 2);
        } else if (c === 3) {
          ctx.fillStyle = C.bright;
          ctx.fillRect(px + 3, py + 4, CELL - 6, CELL - 8);
          ctx.fillStyle = C.red;
          const blink = Math.floor(Date.now() / 150) % 2 === 0;
          if (blink) ctx.fillRect(px + CELL / 2 - 1, py + 1, 2, 3);
        }
        if (c === 0 || c === 3) {
          // subtle floor dots
          ctx.fillStyle = C.grid;
          ctx.fillRect(px + CELL - 2, py + CELL - 2, 1, 1);
        }
      }
    }
    // blasts
    for (const bl of blasts.current) {
      ctx.fillStyle = "rgba(251,146,60,0.85)";
      ctx.fillRect(bl.tx * CELL, bl.ty * CELL, CELL - 1, CELL - 1);
      ctx.fillStyle = "rgba(250,204,21,0.9)";
      ctx.fillRect(bl.tx * CELL + 4, bl.ty * CELL + 4, CELL - 9, CELL - 9);
    }
    // foes
    for (const f of foes.current) {
      const t = Math.min(1, f.step);
      const x = ((f.fx + (f.tx - f.fx) * t) * CELL) | 0;
      const y = ((f.fy + (f.ty - f.fy) * t) * CELL) | 0;
      ctx.fillStyle = C.red;
      ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
      ctx.fillStyle = C.bright;
      ctx.fillRect(x + 5, y + 5, 2, 2);
      ctx.fillRect(x + 9, y + 5, 2, 2);
    }
    // player
    const p = player.current;
    const t = Math.min(1, p.step);
    const x = ((p.fx + (p.tx - p.fx) * t) * CELL) | 0;
    const y = ((p.fy + (p.ty - p.fy) * t) * CELL) | 0;
    ctx.fillStyle = C.brand;
    ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
    ctx.fillStyle = C.bright;
    ctx.fillRect(x + 5, y + 5, 2, 2);
    ctx.fillRect(x + 9, y + 5, 2, 2);
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    if (status === "playing") {
      const p = player.current;
      const g = grid.current;

      // bombs tick
      for (const b of bombs.current) b.t -= dt;
      const due = bombs.current.filter((b) => b.t <= 0);
      bombs.current = bombs.current.filter((b) => b.t > 0);
      for (const b of due) {
        grid.current[b.ty][b.tx] = 0;
        explode(b.tx, b.ty);
      }
      for (const bl of blasts.current) bl.t -= dt;
      blasts.current = blasts.current.filter((bl) => bl.t > 0);

      // player movement (hold to walk)
      if (p.step >= 1) {
        const dirs: [number, number][] = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (const [dx, dy] of dirs) {
          const btn = dx === 1 ? "right" : dx === -1 ? "left" : dy === 1 ? "down" : "up";
          if (input.held.has(btn) && passable(g, p.tx + dx, p.ty + dy)) {
            p.dx = dx;
            p.dy = dy;
            stepActor(p, g, () => {});
            break;
          }
        }
        if (p.step >= 1) {
          // edges: bomb placement
          if (input.drain().includes("fire") && bombs.current.length < 2 && g[p.ty][p.tx] === 0) {
            g[p.ty][p.tx] = 3;
            bombs.current.push({ tx: p.tx, ty: p.ty, t: 1800 });
            beep(300, 40, "triangle", 0.03);
          } else input.drain();
          p.dx = 0;
          p.dy = 0;
        }
      } else {
        p.step += dt / p.moveMs;
        if (p.step >= 1) p.step = 1;
      }

      // foes wander
      for (const f of foes.current) {
        if (f.step >= 1) {
          const all: [number, number][] = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          const opts = all.filter(([dx, dy]) => passable(g, f.tx + dx, f.ty + dy));
          const noReverse = opts.filter(([dx, dy]) => !(dx === -f.dx && dy === -f.dy));
          const pick = (noReverse.length ? noReverse : opts)[
            Math.floor(Math.random() * (noReverse.length ? noReverse.length : opts.length))
          ];
          if (pick) {
            f.dx = pick[0];
            f.dy = pick[1];
            stepActor(f, g, () => {});
          }
        } else {
          f.step += dt / f.moveMs;
          if (f.step >= 1) f.step = 1;
        }
      }

      // blasts kill
      const inBlast = (x: number, y: number) =>
        blasts.current.some((bl) => bl.tx === x && bl.ty === y);
      foes.current = foes.current.filter((f) => {
        const dead = f.step >= 0.5 && inBlast(f.tx, f.ty);
        if (dead) {
          setScore((v) => v + 100);
          beep(520, 90);
        }
        return !dead;
      });
      if (foes.current.length === 0) {
        level.current += 1;
        setScore((v) => v + 150);
        beep(880, 200);
        setStatus("won");
        submitBest(score + 150);
      }
      if (inBlast(player.current.tx, player.current.ty) && player.current.step > 0.4) return die();
      // foes catch you
      for (const f of foes.current) {
        if (f.tx === p.tx && f.ty === p.ty) return die();
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
      slug="bomber"
      title="BOMBER"
      status={status}
      scoreLabel="PTS"
      score={score}
      best={best}
      hint="arrows / WASD walk · space / FIRE plants a bomb — your own blasts count"
      overlayNote={
        status === "won"
          ? `sector cleared — the next one adds a foe`
          : status === "over"
            ? `score ${score} · best ${Math.max(best, score)}`
            : "crush every wanderer to open the next sector"
      }
      onStart={start}
      pads={
        <>
          <div className="flex flex-col items-center gap-2">
            <Pad input={input} btn="up" label="↑" ariaLabel="Walk up" />
            <div className="flex gap-2">
              <Pad input={input} btn="left" label="←" ariaLabel="Walk left" />
              <Pad input={input} btn="down" label="↓" ariaLabel="Walk down" />
              <Pad input={input} btn="right" label="→" ariaLabel="Walk right" />
            </div>
          </div>
          <Pad input={input} btn="fire" label="BOMB" wide ariaLabel="Plant bomb" />
        </>
      }
      canvasMax={Math.min(460, W * 2)}
    >
      <canvas ref={canvasRef} width={W} height={H} style={PIXELATED} className="block w-full touch-none" />
    </GameShell>
  );
}
