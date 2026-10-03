"use client";

/** zFun · SNAKE — the grid classic. Swipe or arrows, speed scales with length. */

import { useEffect, useRef, useState } from "react";
import {
  C,
  CanvasRef,
  GameShell,
  GameStatus,
  Input,
  Pad,
  PIXELATED,
  ctx2d,
  beep,
  pointerPos,
  useBest,
  useInput,
  useLoop,
} from "../engine";

const N = 20; // grid cells per side
const CELL = 12; // px per cell
const W = N * CELL;
const H = N * CELL;

interface Pt {
  x: number;
  y: number;
}

function spawnFood(snake: Pt[]): Pt {
  let p: Pt;
  do {
    p = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) };
  } while (snake.some((s) => s.x === p.x && s.y === p.y));
  return p;
}

export default function SnakeGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("snake");
  const canvasRef: CanvasRef = useRef(null);

  const snake = useRef<Pt[]>([]);
  const dir = useRef<Pt>({ x: 1, y: 0 });
  const queued = useRef<Pt[]>([]);
  const food = useRef<Pt>({ x: 12, y: 10 });
  const stepMs = useRef(140);
  const acc = useRef(0);
  const clock = useRef(0);
  const moving = useRef(false); // waits for the first direction input

  function reset() {
    snake.current = [
      { x: 8, y: 10 },
      { x: 7, y: 10 },
      { x: 6, y: 10 },
    ];
    dir.current = { x: 1, y: 0 };
    queued.current = [];
    food.current = spawnFood(snake.current);
    stepMs.current = 140;
    acc.current = 0;
    moving.current = false;
    setScore(0);
    setStatus("playing");
  }

  const start = () => reset();

  function turn(nd: Pt) {
    const last = queued.current.length ? queued.current[queued.current.length - 1] : dir.current;
    if (last.x === -nd.x && last.y === -nd.y) return; // no 180°
    if (last.x === nd.x && last.y === nd.y) return;
    if (queued.current.length < 2) queued.current.push(nd);
  }

  function die() {
    beep(110, 250, "square", 0.05);
    setStatus("over");
    submitBest(score);
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // subtle dot grid every 2 cells
    ctx.fillStyle = C.grid;
    for (let y = 2; y < N; y += 2)
      for (let x = 2; x < N; x += 2) ctx.fillRect(x * CELL - 1, y * CELL - 1, 1, 1);
    // food — pulsing white square
    const pulse = 2 + Math.round(Math.sin(clock.current / 150) * 1.5);
    ctx.fillStyle = C.bright;
    ctx.fillRect(
      food.current.x * CELL + (CELL - pulse) / 2,
      food.current.y * CELL + (CELL - pulse) / 2,
      pulse,
      pulse,
    );
    // snake
    snake.current.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? C.brand : C.accent;
      const pad = i === 0 ? 0 : 1;
      ctx.fillRect(s.x * CELL + pad, s.y * CELL + pad, CELL - pad * 2, CELL - pad * 2);
    });
    // frame
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    const edges = input.drain();
    for (const e of edges) {
      if (e === "up") {
        turn({ x: 0, y: -1 });
        moving.current = true;
      }
      if (e === "down") {
        turn({ x: 0, y: 1 });
        moving.current = true;
      }
      if (e === "left") {
        turn({ x: -1, y: 0 });
        moving.current = true;
      }
      if (e === "right") {
        turn({ x: 1, y: 0 });
        moving.current = true;
      }
    }
    clock.current += dt;

    if (status === "playing" && moving.current) {
      acc.current += dt;
      while (acc.current >= stepMs.current) {
        acc.current -= stepMs.current;
        if (queued.current.length) dir.current = queued.current.shift()!;
        const head = snake.current[0];
        const nh = { x: head.x + dir.current.x, y: head.y + dir.current.y };
        if (nh.x < 0 || nh.y < 0 || nh.x >= N || nh.y >= N) return die();
        if (snake.current.some((s) => s.x === nh.x && s.y === nh.y)) return die();
        snake.current.unshift(nh);
        if (nh.x === food.current.x && nh.y === food.current.y) {
          setScore((s) => s + 10);
          food.current = spawnFood(snake.current);
          stepMs.current = Math.max(70, stepMs.current - 2);
          beep(660, 50);
        } else {
          snake.current.pop();
        }
      }
    }
    draw();
  });





  useEffect(() => {
    draw();
     
  }, []);

  // swipe support
  const swipe = useRef<Pt | null>(null);
  return (
    <GameShell
      slug="snake"
      title="SNAKE"
      status={status}
      scoreLabel="FOOD"
      score={score}
      best={best}
      hint="arrows / WASD · swipe on the canvas on mobile"
      overlayNote={status === "over" ? `score ${score} · best ${Math.max(best, score)}` : undefined}
      onStart={start}
      pads={
        <>
          <div className="flex flex-col items-center gap-2">
            <Pad input={input} btn="up" label="↑" ariaLabel="Snake up" />
            <div className="flex gap-2">
              <Pad input={input} btn="left" label="←" ariaLabel="Snake left" />
              <Pad input={input} btn="down" label="↓" ariaLabel="Snake down" />
              <Pad input={input} btn="right" label="→" ariaLabel="Snake right" />
            </div>
          </div>
        </>
      }
      canvasMax={Math.min(480, W * 2)}
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={PIXELATED}
        className="block w-full touch-none"
        onPointerDown={(e) => {
          swipe.current = pointerPos(e);
        }}
        onPointerMove={(e) => {
          if (!swipe.current || status !== "playing") return;
          const p = pointerPos(e);
          const dx = p.x - swipe.current.x;
          const dy = p.y - swipe.current.y;
          if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
          if (Math.abs(dx) > Math.abs(dy)) turn({ x: dx > 0 ? 1 : -1, y: 0 });
          else turn({ x: 0, y: dy > 0 ? 1 : -1 });
          moving.current = true;
          swipe.current = p;
        }}
        onPointerUp={() => {
          swipe.current = null;
        }}
      />
    </GameShell>
  );
}
