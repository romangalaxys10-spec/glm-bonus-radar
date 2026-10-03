"use client";

/** zFun · BREAKOUT — paddle, ball, six brick rows, endless levels. */

import { useEffect, useRef, useState } from "react";
import {
  C,
  CanvasRef,
  GameShell,
  GameStatus,
  Input,
  PIXELATED,
  beep,
  ctx2d,
  pointerPos,
  useBest,
  useInput,
  useLoop,
} from "../engine";

const W = 240;
const H = 180;
const COLS = 8;
const ROWS = 6;
const BRICK_W = 26;
const BRICK_H = 8;
const GRID_X = (W - COLS * (BRICK_W + 2) + 2) / 2;
const GRID_Y = 22;
const PADDLE_W = 36;
const PADDLE_H = 5;
const PADDLE_Y = H - 16;
const ROW_COLORS = [C.red, C.orange, C.yellow, C.green, C.brand, C.accent];

export default function BreakoutGame() {
  const input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("breakout");
  const canvasRef: CanvasRef = useRef(null);

  const bricks = useRef<boolean[][]>([]);
  const px = useRef(W / 2 - PADDLE_W / 2);
  const ball = useRef({ x: W / 2, y: PADDLE_Y - 4, vx: 0, vy: 0, stuck: true });
  const speed = useRef(120);
  const lives = useRef(3);
  const [livesUi, setLivesUi] = useState(3);
  const clock = useRef(0);

  function buildBricks() {
    bricks.current = Array.from({ length: ROWS }, () => Array(COLS).fill(true));
  }

  function reset(full: boolean) {
    buildBricks();
    speed.current = 120;
    if (full) {
      lives.current = 3;
      setLivesUi(3);
      setScore(0);
    }
    serve();
  }

  function serve() {
    ball.current = { x: px.current + PADDLE_W / 2, y: PADDLE_Y - 4, vx: 0, vy: 0, stuck: true };
  }

  function launch() {
    const b = ball.current;
    if (!b.stuck) return;
    b.stuck = false;
    const dir = Math.random() > 0.5 ? 1 : -1;
    b.vx = dir * speed.current * 0.6;
    b.vy = -speed.current;
    beep(520, 40);
  }

  const start = () => {
    reset(true);
    setStatus("playing");
  };

  function die() {
    lives.current--;
    setLivesUi(lives.current);
    if (lives.current <= 0) {
      beep(110, 280, "square", 0.05);
      setStatus("over");
      submitBest(score);
    } else {
      beep(180, 120);
      serve();
    }
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // bricks
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (!bricks.current[r]?.[c]) continue;
        ctx.fillStyle = ROW_COLORS[r];
        ctx.fillRect(GRID_X + c * (BRICK_W + 2), GRID_Y + r * (BRICK_H + 2), BRICK_W, BRICK_H);
      }
    // paddle
    ctx.fillStyle = C.ink;
    ctx.fillRect(px.current, PADDLE_Y, PADDLE_W, PADDLE_H);
    // ball (pulsing white square when stuck)
    const b = ball.current;
    ctx.fillStyle = b.stuck && status === "playing" ? (Math.floor(clock.current / 300) % 2 ? C.brand : C.bright) : C.bright;
    ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
    // lives as small paddles
    for (let i = 0; i < lives.current; i++) {
      ctx.fillStyle = C.faint;
      ctx.fillRect(W - 10 - i * 14, 8, 10, 3);
    }
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    const s = dt / 1000;
    clock.current += dt;
    if (status !== "playing") {
      if (status === "ready") {
        // idle: ball rests on paddle
        ball.current.x = px.current + PADDLE_W / 2;
        ball.current.y = PADDLE_Y - 4;
      }
      input.drain();
      draw();
      return;
    }

    const edges = input.drain();
    if (edges.includes("fire")) launch();

    // paddle: keyboard + held
    const pSpeed = 220 * s;
    if (input.held.has("left")) px.current -= pSpeed;
    if (input.held.has("right")) px.current += pSpeed;
    px.current = Math.max(2, Math.min(W - PADDLE_W - 2, px.current));

    const b = ball.current;
    if (b.stuck) {
      b.x = px.current + PADDLE_W / 2;
      b.y = PADDLE_Y - 4;
    } else {
      b.x += b.vx * s;
      b.y += b.vy * s;
      // walls
      if (b.x < 2) {
        b.x = 2;
        b.vx = Math.abs(b.vx);
        beep(330, 25);
      }
      if (b.x > W - 5) {
        b.x = W - 5;
        b.vx = -Math.abs(b.vx);
        beep(330, 25);
      }
      if (b.y < 2) {
        b.y = 2;
        b.vy = Math.abs(b.vy);
        beep(330, 25);
      }
      // paddle
      if (b.vy > 0 && b.y >= PADDLE_Y - 3 && b.y <= PADDLE_Y + PADDLE_H && b.x >= px.current - 2 && b.x <= px.current + PADDLE_W + 2) {
        const hit = (b.x - (px.current + PADDLE_W / 2)) / (PADDLE_W / 2); // -1..1
        const ang = hit * 1.1; // radians off vertical
        const sp = Math.min(280, Math.hypot(b.vx, b.vy) + 6);
        b.vx = Math.sin(ang) * sp;
        b.vy = -Math.abs(Math.cos(ang) * sp);
        b.y = PADDLE_Y - 4;
        beep(440, 30);
      }
      // bricks
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          if (!bricks.current[r]?.[c]) continue;
          const bx = GRID_X + c * (BRICK_W + 2);
          const by = GRID_Y + r * (BRICK_H + 2);
          if (b.x >= bx - 2 && b.x <= bx + BRICK_W + 2 && b.y >= by - 2 && b.y <= by + BRICK_H + 2) {
            bricks.current[r][c] = false;
            // bounce axis by penetration depth
            const fromSide =
              b.x < bx + 1 || b.x > bx + BRICK_W - 1 ? true : false;
            if (fromSide) b.vx = -b.vx;
            else b.vy = -b.vy;
            setScore((v) => v + 10);
            beep(660 + r * 60, 35);
            r = ROWS;
            break;
          }
        }
      // floor
      if (b.y > H - 4) die();
      // level cleared?
      if (bricks.current.every((row) => row.every((v) => !v))) {
        beep(660, 70);
        beep(880, 70);
        reset(false);
      }
    }
    draw();
  });



  useEffect(() => {
    buildBricks();
    draw();
     
  }, []);

  return (
    <GameShell
      slug="breakout"
      title="BREAKOUT"
      status={status}
      scoreLabel="PTS"
      score={score}
      best={best}
      hint="drag / ←→ to move · tap or space to launch"
      overlayNote={status === "over" ? `score ${score} · best ${Math.max(best, score)}` : `${livesUi} lives left`}
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
          if (status !== "playing") return;
          launch();
          px.current = pointerPos(e).x - PADDLE_W / 2;
        }}
        onPointerMove={(e) => {
          // Desktop: hover steers the paddle (classic). Touch: finger drag.
          if (status !== "playing") return;
          px.current = pointerPos(e).x - PADDLE_W / 2;
        }}
      />
    </GameShell>
  );
}
