"use client";

/** zFun · FLAP — one button, honest pipes. Tap or space to stay airborne. */

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
  drawBitmap,
  useBest,
  useInput,
  useLoop,
} from "../engine";

const W = 240;
const H = 300;
const GROUND_Y = H - 14;
const BIRD_X = 70;
const PIPE_W = 30;

const BIRD_A = ["0011110", "1111111", "1011111", "0011100", "0001100"]; // wing down
const BIRD_B = ["0011110", "1111111", "1110111", "0011100", "0001100"]; // wing up

export default function FlapGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("flap");
  const canvasRef: CanvasRef = useRef(null);

  const y = useRef(H / 2);
  const v = useRef(0);
  const pipes = useRef<{ x: number; gapY: number; passed: boolean }[]>([]);
  const speed = useRef(92);
  const clock = useRef(0);
  const wing = useRef(0);

  function reset() {
    y.current = H / 2 - 30;
    v.current = 0;
    pipes.current = [
      { x: W + 40, gapY: 120, passed: false },
      { x: W + 40 + 150, gapY: 90, passed: false },
    ];
    speed.current = 92;
    setScore(0);
    setStatus("playing");
  }

  const flap = () => {
    if (status !== "playing") return;
    v.current = -235;
    beep(500, 45);
  };

  const start = () => reset();

  function gapForDraw(): number {
    return Math.max(74, 96 - score * 1.2);
  }

  function die() {
    beep(110, 300, "square", 0.05);
    setStatus("over");
    submitBest(score);
  }

  function draw(gap: number) {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // pipes
    for (const p of pipes.current) {
      ctx.fillStyle = C.green;
      ctx.fillRect(p.x, 0, PIPE_W, p.gapY);
      ctx.fillRect(p.x, p.gapY + gap, PIPE_W, GROUND_Y - p.gapY - gap);
      // pipe lips
      ctx.fillStyle = C.brand;
      ctx.fillRect(p.x - 2, p.gapY - 5, PIPE_W + 4, 5);
      ctx.fillRect(p.x - 2, p.gapY + gap, PIPE_W + 4, 5);
    }
    // ground
    ctx.fillStyle = C.faint;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.fillStyle = C.grid;
    for (let i = 0; i < W; i += 8) {
      const off = status === "playing" ? (clock.current / (160 / speed.current)) % 8 : 0;
      ctx.fillRect(i - off, GROUND_Y + 5, 4, 2);
    }
    // bird
    const bob = status === "playing" ? 0 : Math.sin(clock.current / 240) * 3;
    drawBitmap(ctx, wing.current ? BIRD_B : BIRD_A, BIRD_X, y.current + bob, 1, C.yellow);
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    const s = dt / 1000;
    clock.current += dt;
    const edges = input.drain();
    if (edges.includes("fire")) flap();
    if (status === "playing") {
      // physics
      v.current += 880 * s;
      y.current += v.current * s;
      if (y.current < 4) {
        y.current = 4;
        v.current = 0;
      }
      wing.current = v.current < 0 ? 1 : 0;

      // pipes
      speed.current = Math.min(165, 92 + score * 2.2);
      for (const p of pipes.current) p.x -= speed.current * s;
      const gap = Math.max(74, 96 - score * 1.2);
      if (pipes.current[0] && pipes.current[0].x + PIPE_W < 0) {
        pipes.current.shift();
        const last = pipes.current[pipes.current.length - 1];
        const gapY = Math.max(30, Math.min(GROUND_Y - gap - 30, (last?.gapY ?? 120) + (Math.random() * 120 - 60)));
        pipes.current.push({ x: last ? last.x + 150 : W + 40, gapY, passed: false });
      }
      // scoring + collision
      for (const p of pipes.current) {
        if (!p.passed && p.x + PIPE_W < BIRD_X) {
          p.passed = true;
          setScore((v2) => v2 + 1);
          beep(700, 40);
        }
        const inX = BIRD_X + 7 > p.x && BIRD_X < p.x + PIPE_W;
        if (inX && (y.current < p.gapY || y.current + 7 > p.gapY + gap)) {
          return die();
        }
      }
      if (y.current + 7 >= GROUND_Y) return die();
    }
    draw(gapForDraw());
  });







  useEffect(() => {
    pipes.current = [];
    draw(96);
     
  }, []);

  return (
    <GameShell
      slug="flap"
      title="FLAP"
      status={status}
      scoreLabel="PIPES"
      score={score}
      best={best}
      hint="tap anywhere / space to flap"
      overlayNote={status === "over" ? `${score} pipes cleared · best ${Math.max(best, score)}` : undefined}
      onStart={start}
      canvasMax={340}
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={PIXELATED}
        className="block w-full touch-none"
        onPointerDown={(e) => {
          e.preventDefault();
          if (status === "playing") flap();
        }}
      />
    </GameShell>
  );
}
