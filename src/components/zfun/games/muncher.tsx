"use client";

/** zFun · MUNCHER — a maze, 150 dots, three hungry ghosts. You are faster. Barely. */

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

const TILE = 12;
const MAZE = [
  "###################",
  "#........#........#",
  "#.##.###.#.###.##.#",
  "#.................#",
  "#.##.#.#####.#.##.#",
  "#....#...#...#....#",
  "####.###.#.###.####",
  "####.#.......#.####",
  "####.#.#####.#.####",
  "#........#........#",
  "#.##.###.#.###.##.#",
  "#........#........#",
  "#.##.###.#.###.##.#",
  "#.................#",
  "###################",
];
const ROWS = MAZE.length; // 15
const COLS = MAZE[0].length; // 19
const W = COLS * TILE; // 228
const H = ROWS * TILE; // 180

interface Pt {
  x: number;
  y: number;
}

interface Actor {
  tx: number;
  ty: number;
  fx: number; // from tile for interpolation
  fy: number;
  dx: number;
  dy: number;
  step: number; // progress 0..1
  moveMs: number;
}

const DIRS: Pt[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function wall(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return true;
  return MAZE[y][x] === "#";
}

function makeActor(tx: number, ty: number, moveMs: number, dx = 0, dy = 0): Actor {
  return { tx, ty, fx: tx, fy: ty, dx, dy, step: 1, moveMs };
}

function actorPixel(a: Actor): Pt {
  const t = Math.min(1, a.step);
  return {
    x: (a.fx + (a.tx - a.fx) * t) * TILE + TILE / 2,
    y: (a.fy + (a.ty - a.fy) * t) * TILE + TILE / 2,
  };
}

export default function MuncherGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("muncher");
  const canvasRef: CanvasRef = useRef(null);

  const dots = useRef<Set<string>>(new Set());
  const total = useRef(0);
  const level = useRef(1);
  const player = useRef<Actor>(makeActor(9, 11, 130));
  const want = useRef<Pt>({ x: 0, y: 0 });
  const ghosts = useRef<Actor[]>([]);
  const ghostColors = [C.red, C.orange, "#f472b6"];

  function buildLevel(n: number) {
    dots.current = new Set();
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) if (MAZE[y][x] === ".") dots.current.add(`${x},${y}`);
    total.current = dots.current.size;
    player.current = makeActor(9, 11, Math.max(95, 132 - n * 4));
    want.current = { x: 0, y: 0 };
    ghosts.current = [
      makeActor(9, 7, Math.max(115, 175 - n * 7), -1, 0),
      makeActor(1, 1, Math.max(120, 185 - n * 7)),
      makeActor(17, 13, Math.max(125, 195 - n * 7)),
    ];
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

  function stepActor(a: Actor, chooseDir?: () => void) {
    a.fx = a.tx;
    a.fy = a.ty;
    a.step = 0;
    if (a.dx === 0 && a.dy === 0) chooseDir?.();
    const nx = a.tx + a.dx;
    const ny = a.ty + a.dy;
    if (wall(nx, ny)) {
      a.dx = 0;
      a.dy = 0;
      a.step = 1;
    } else {
      a.tx = nx;
      a.ty = ny;
    }
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // walls
    ctx.fillStyle = "#1c2c5e";
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) if (MAZE[y][x] === "#") ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    // dots
    ctx.fillStyle = C.bright;
    for (const key of dots.current) {
      const [x, y] = key.split(",").map(Number);
      ctx.fillRect(x * TILE + TILE / 2 - 1, y * TILE + TILE / 2 - 1, 2, 2);
    }
    // ghosts
    ghosts.current.forEach((g, i) => {
      const gp = actorPixel(g);
      ctx.fillStyle = ghostColors[i];
      ctx.fillRect(gp.x - 5, gp.y - 5, 10, 8);
      ctx.fillRect(gp.x - 5, gp.y + 3, 2, 2);
      ctx.fillRect(gp.x - 1, gp.y + 3, 2, 2);
      ctx.fillRect(gp.x + 3, gp.y + 3, 2, 2);
      ctx.fillStyle = C.bright;
      ctx.fillRect(gp.x - 3, gp.y - 3, 2, 2);
      ctx.fillRect(gp.x + 1, gp.y - 3, 2, 2);
    });
    // player — yellow wedge facing travel direction
    const pp = actorPixel(player.current);
    ctx.fillStyle = C.yellow;
    const open = Math.floor(Date.now() / 140) % 2 === 0 ? 3 : 1;
    ctx.fillRect(pp.x - 5, pp.y - 5, 10, open);
    ctx.fillRect(pp.x - 5, pp.y - 5 + open, 4, 10 - open * 2);
    ctx.fillRect(pp.x - 5, pp.y + 5 - open, 10, open);
    ctx.fillRect(pp.x - 1, pp.y - 5 + open, 6, 10 - open * 2);
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    if (status === "playing") {
      const p = player.current;
      // arrived at a tile center → pick next direction
      if (p.step >= 1) {
        for (const e of input.drain()) {
          if (e === "up") want.current = { x: 0, y: -1 };
          if (e === "down") want.current = { x: 0, y: 1 };
          if (e === "left") want.current = { x: -1, y: 0 };
          if (e === "right") want.current = { x: 1, y: 0 };
        }
        const wd = want.current;
        if (!wall(p.tx + wd.x, p.ty + wd.y)) {
          p.dx = wd.x;
          p.dy = wd.y;
        }
        if (p.dx === 0 && p.dy === 0 || wall(p.tx + p.dx, p.ty + p.dy)) {
          p.dx = 0;
          p.dy = 0;
        }
        if (p.dx !== 0 || p.dy !== 0) stepActor(p);
      } else {
        p.step += dt / p.moveMs;
        if (p.step >= 1) {
          p.step = 1;
          // eat on arrival
          const key = `${p.tx},${p.ty}`;
          if (dots.current.has(key)) {
            dots.current.delete(key);
            setScore((s) => s + 10);
            beep(700, 25, "square", 0.02);
            if (dots.current.size === 0) {
              level.current += 1;
              beep(880, 200);
              setStatus("won");
              submitBest(score + 100);
            }
          }
        }
      }

      for (const g of ghosts.current) {
        if (g.step >= 1) {
          // pick direction at intersections: chase, never reverse unless forced
          const opts = DIRS.filter(
            (d) => !wall(g.tx + d.x, g.ty + d.y) && !(d.x === -g.dx && d.y === -g.dy),
          );
          let choice: Pt;
          if (opts.length === 0) choice = { x: -g.dx, y: -g.dy };
          else {
            const pl = player.current;
            let bestD = Infinity;
            choice = opts[0];
            for (const d of opts) {
              const dist = Math.abs(g.tx + d.x - pl.tx) + Math.abs(g.ty + d.y - pl.ty);
              const jitter = Math.random() * (3 - Math.min(2, level.current)) * 0.9;
              if (dist + jitter < bestD) {
                bestD = dist + jitter;
                choice = d;
              }
            }
          }
          g.dx = choice.x;
          g.dy = choice.y;
          stepActor(g);
        } else g.step += dt / g.moveMs;
      }

      // collision: pixel distance
      const pp = actorPixel(p);
      for (const g of ghosts.current) {
        const gp = actorPixel(g);
        if (Math.hypot(pp.x - gp.x, pp.y - gp.y) < 8) return die();
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
      slug="muncher"
      title="MUNCHER"
      status={status}
      scoreLabel="DOTS"
      score={score}
      best={best}
      hint="arrows / WASD steer · eat every dot — ghosts never stop"
      overlayNote={
        status === "won"
          ? `maze cleared — the next one is faster`
          : status === "over"
            ? `score ${score} · best ${Math.max(best, score)}`
            : "three ghosts, zero excuses"
      }
      onStart={start}
      pads={
        <>
          <div className="flex flex-col items-center gap-2">
            <Pad input={input} btn="up" label="↑" ariaLabel="Steer up" />
            <div className="flex gap-2">
              <Pad input={input} btn="left" label="←" ariaLabel="Steer left" />
              <Pad input={input} btn="down" label="↓" ariaLabel="Steer down" />
              <Pad input={input} btn="right" label="→" ariaLabel="Steer right" />
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
