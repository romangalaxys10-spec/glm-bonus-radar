"use client";

/** zFun · PINBALL — one ball, two flippers, three bumpers, honest gravity. */

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

const W = 200;
const H = 264;
const BR = 4;

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  e: number;
}

const WALLS: Seg[] = [
  { x1: 8, y1: 8, x2: 192, y2: 8, e: 0.7 }, // top
  { x1: 8, y1: 8, x2: 8, y2: 210, e: 0.7 }, // left
  { x1: 192, y1: 8, x2: 192, y2: 210, e: 0.7 }, // right
  { x1: 8, y1: 210, x2: 62, y2: 236, e: 0.6 }, // left ramp to flipper
  { x1: 192, y1: 210, x2: 138, y2: 236, e: 0.6 }, // right ramp
];

const BUMPERS = [
  { x: 62, y: 84, r: 11 },
  { x: 138, y: 84, r: 11 },
  { x: 100, y: 138, r: 12 },
];

const FLIP_L = { px: 62, py: 240, len: 36, rest: 0.5, up: -0.6 };
const FLIP_R = { px: 138, py: 240, len: 36, rest: Math.PI - 0.5, up: Math.PI + 0.6 };

export default function PinballGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("pinball");
  const canvasRef: CanvasRef = useRef(null);

  const ball = useRef({ x: 100, y: 20, vx: 0, vy: 0, live: false });
  const ballsLeft = useRef(3);
  const flipL = useRef(false);
  const flipR = useRef(false);
  const angL = useRef(FLIP_L.rest);
  const angR = useRef(FLIP_R.rest);
  const flash = useRef({ x: 0, y: 0, t: 0 });
  const serveIn = useRef(0);

  function reset() {
    ballsLeft.current = 3;
    setScore(0);
    serve();
    setStatus("playing");
  }

  function serve() {
    ball.current = { x: 100, y: 18, vx: (Math.random() - 0.5) * 60, vy: 0, live: true };
  }

  const start = () => reset();

  function flipperSeg(f: typeof FLIP_L, ang: number): Seg {
    return {
      x1: f.px,
      y1: f.py,
      x2: f.px + Math.cos(ang) * f.len,
      y2: f.py + Math.sin(ang) * f.len,
      e: 0.9,
    };
  }

  function collide(seg: Seg, kick: number) {
    const b = ball.current;
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((b.x - seg.x1) * dx + (b.y - seg.y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = seg.x1 + dx * t;
    const cy = seg.y1 + dy * t;
    const dist = Math.hypot(b.x - cx, b.y - cy);
    if (dist < BR + 1 && dist > 0.0001) {
      const nx = (b.x - cx) / dist;
      const ny = (b.y - cy) / dist;
      b.x = cx + nx * (BR + 1);
      b.y = cy + ny * (BR + 1);
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= (1 + seg.e) * vn * nx;
        b.vy -= (1 + seg.e) * vn * ny;
        if (kick > 0) {
          b.vy -= kick;
          beep(520, 30);
        } else if (Math.abs(vn) > 60) beep(300, 20);
      }
    }
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(59,130,246,0.05)";
    ctx.beginPath();
    ctx.moveTo(8, 8);
    ctx.lineTo(192, 8);
    ctx.lineTo(192, 210);
    ctx.lineTo(138, 236);
    ctx.lineTo(62, 236);
    ctx.lineTo(8, 210);
    ctx.closePath();
    ctx.fill();
    // walls
    ctx.strokeStyle = C.faint;
    ctx.lineWidth = 2;
    for (const s of WALLS) {
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    // bumpers
    for (const b of BUMPERS) {
      const lit = flash.current.t > 0 && Math.abs(flash.current.x - b.x) < 2;
      ctx.fillStyle = lit ? C.yellow : "#27272a";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.ink;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = C.bg;
      ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
    }
    // ball
    if (ball.current.live) {
      ctx.fillStyle = C.bright;
      ctx.fillRect(ball.current.x - BR, ball.current.y - BR, BR * 2, BR * 2);
    }
    // flippers
    ctx.strokeStyle = C.brand;
    ctx.lineWidth = 3;
    const sl = flipperSeg(FLIP_L, angL.current);
    const sr = flipperSeg(FLIP_R, angR.current);
    ctx.beginPath();
    ctx.moveTo(sl.x1, sl.y1);
    ctx.lineTo(sl.x2, sl.y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sr.x1, sr.y1);
    ctx.lineTo(sr.x2, sr.y2);
    ctx.stroke();
    ctx.lineWidth = 1;
    // balls-left pips
    for (let i = 0; i < ballsLeft.current; i++) {
      ctx.fillStyle = C.brand;
      ctx.fillRect(10 + i * 9, 14, 5, 5);
    }
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    const edges = input.drain();
    const sec = Math.min(0.033, dt / 1000);
    flipL.current = input.held.has("left");
    flipR.current = input.held.has("right");
    if (edges.includes("fire") && !ball.current.live && status === "playing") serve();

    // flipper angles animate fast
    const tgtL = flipL.current ? FLIP_L.up : FLIP_L.rest;
    const tgtR = flipR.current ? FLIP_R.up : FLIP_R.rest;
    angL.current += (tgtL - angL.current) * Math.min(1, dt / 55);
    angR.current += (tgtR - angR.current) * Math.min(1, dt / 55);

    if (status === "playing" && ball.current.live) {
      const b = ball.current;
      // substeps for stability
      const steps = 2;
      for (let s = 0; s < steps; s++) {
        b.vy += 165 * (sec / steps);
        b.vx *= 1 - 0.06 * (sec / steps);
        b.x += b.vx * (sec / steps);
        b.y += b.vy * (sec / steps);
        for (const wseg of WALLS) collide(wseg, 0);
        collide(flipperSeg(FLIP_L, angL.current), flipL.current ? 210 : 0);
        collide(flipperSeg(FLIP_R, angR.current), flipR.current ? 210 : 0);
        for (const bu of BUMPERS) {
          const dist = Math.hypot(b.x - bu.x, b.y - bu.y);
          if (dist < bu.r + BR) {
            const nx = (b.x - bu.x) / (dist || 1);
            const ny = (b.y - bu.y) / (dist || 1);
            b.x = bu.x + nx * (bu.r + BR);
            b.y = bu.y + ny * (bu.r + BR);
            const sp = Math.max(120, Math.hypot(b.vx, b.vy) * 1.1);
            b.vx = nx * sp;
            b.vy = ny * sp;
            flash.current = { x: bu.x, y: bu.y, t: 120 };
            setScore((v) => v + 15);
            beep(660, 50);
          }
        }
      }
      if (flash.current.t > 0) flash.current.t -= dt;
      // drain
      if (b.y > H + 10) {
        b.live = false;
        ballsLeft.current -= 1;
        beep(140, 260, "square", 0.05);
        if (ballsLeft.current <= 0) {
          setStatus("over");
          submitBest(score);
        } else {
          serveIn.current = 900;
        }
      }
    }
    if (serveIn.current > 0) {
      serveIn.current -= dt;
      if (serveIn.current <= 0 && !ball.current.live && ballsLeft.current > 0) serve();
    }
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  return (
    <GameShell
      slug="pinball"
      title="PINBALL"
      status={status}
      scoreLabel="PTS"
      score={score}
      best={best}
      hint="← → flippers (or tap the canvas halves) · space launches the next ball"
      overlayNote={
        status === "over"
          ? `table cleared of balls — ${score} points`
          : status === "ready"
            ? "three balls, three bumpers, one honest gravity"
            : undefined
      }
      onStart={start}
      pads={
        <>
          <Pad input={input} btn="left" label="FLIP ⟲" ariaLabel="Left flipper" />
          <Pad input={input} btn="fire" label="LAUNCH" ariaLabel="Launch ball" />
          <Pad input={input} btn="right" label="⟳ FLIP" ariaLabel="Right flipper" />
        </>
      }
      canvasMax={Math.min(420, H)}
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
          if (x < W / 2) input.press("left", true);
          else input.press("right", true);
          const release = () => {
            input.press("left", false);
            input.press("right", false);
          };
          el.addEventListener("pointerup", release, { once: true });
          el.addEventListener("pointercancel", release, { once: true });
        }}
      />
    </GameShell>
  );
}
