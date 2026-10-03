"use client";

/** zFun · RUNNER — endless jump-and-dodge. Hold to jump higher. */

import { useEffect, useRef, useState } from "react";
import {
  C,
  CanvasRef,
  GameShell,
  GameStatus,
  PIXELATED,
  beep,
  ctx2d,
  drawBitmap,
  useBest,
  useLoop,
} from "../engine";

const W = 240;
const H = 120;
const GROUND_Y = 96;

// 12×11 dino-ish runner, two leg frames
const DINO_A = [
  "001111100000",
  "001111110000",
  "001111110000",
  "001111000000",
  "001111111100",
  "011111111110",
  "111111111110",
  "110000111100",
  "110000110000",
  "011000110000",
  "011001100110",
];
const DINO_B = [
  "001111100000",
  "001111110000",
  "001111110000",
  "001111000000",
  "001111111100",
  "011111111110",
  "111111111110",
  "110000111100",
  "110000110000",
  "011000110000",
  "001100110110",
];
// cacti
const CACTUS_S = ["00011000", "00111100", "00111100", "00011000", "00011000", "00011000"];
const CACTUS_L = [
  "00011000",
  "01101100",
  "01101100",
  "00111100",
  "00011000",
  "00011000",
  "00011000",
  "00011000",
  "00011000",
  "00011000",
];
const BIRD_A = ["1111100000", "0111111110", "0011111000", "0001100000", "0000000000"];
const BIRD_B = ["0000000000", "0001100000", "0011111000", "0111111110", "1111100000"];

interface Obstacle {
  x: number;
  kind: "s" | "l" | "bird";
}

export default function RunnerGame() {
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("runner");
  const canvasRef: CanvasRef = useRef(null);

  const dy = useRef(GROUND_Y - 11);
  const dv = useRef(0);
  const held = useRef(false);
  const obstacles = useRef<Obstacle[]>([]);
  const spawnIn = useRef(60);
  const speed = useRef(150);
  const dist = useRef(0);
  const clock = useRef(0);
  const dead = useRef(false);

  function reset() {
    dy.current = GROUND_Y - 11;
    dv.current = 0;
    obstacles.current = [];
    spawnIn.current = 60;
    speed.current = 150;
    dist.current = 0;
    dead.current = false;
    setScore(0);
    setStatus("playing");
  }

  const start = () => reset();

  function jump() {
    if (status !== "playing") return;
    if (dy.current >= GROUND_Y - 11) {
      dv.current = -300;
      beep(440, 40);
    }
  }

  function die() {
    dead.current = true;
    beep(110, 300, "square", 0.05);
    setStatus("over");
    submitBest(score);
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // ground
    ctx.fillStyle = C.frame;
    ctx.fillRect(0, GROUND_Y, W, 1);
    // scrolling pebbles
    ctx.fillStyle = C.faint;
    for (let i = 0; i < 8; i++) {
      const px2 = (i * 43 - (dist.current % 344)) % (W + 20);
      ctx.fillRect(px2 < 0 ? px2 + W + 20 : px2, GROUND_Y + 5 + (i % 3), 3, 1);
    }
    // clouds
    ctx.fillStyle = C.grid;
    for (let i = 0; i < 3; i++) {
      const cx2 = (i * 110 - (dist.current * 0.2) % 330) % (W + 40);
      ctx.fillRect(cx2 < 0 ? cx2 + W + 40 : cx2, 18 + i * 14, 18, 4);
      ctx.fillRect((cx2 < 0 ? cx2 + W + 40 : cx2) + 4, 15 + i * 14, 10, 3);
    }
    // obstacles
    for (const o of obstacles.current) {
      const frame = Math.floor(clock.current / 180) % 2 === 0;
      if (o.kind === "s") drawBitmap(ctx, CACTUS_S, o.x, GROUND_Y - 6, 1, C.green);
      if (o.kind === "l") drawBitmap(ctx, CACTUS_L, o.x, GROUND_Y - 10, 1, C.green);
      if (o.kind === "bird") drawBitmap(ctx, frame ? BIRD_A : BIRD_B, o.x, GROUND_Y - 34, 1, C.brand);
    }
    // runner
    const legFrame = dy.current >= GROUND_Y - 11 ? (Math.floor(dist.current / 14) % 2 ? DINO_A : DINO_B) : DINO_A;
    drawBitmap(ctx, legFrame, 14, dy.current, 1, C.ink);
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    const s = dt / 1000;
    clock.current += dt;
    if (status !== "playing") {
      draw();
      return;
    }

    // physics: hold = floatier arc
    const g = dv.current < 0 && held.current ? 620 : 1150;
    dv.current += g * s;
    dy.current += dv.current * s;
    if (dy.current > GROUND_Y - 11) {
      dy.current = GROUND_Y - 11;
      dv.current = 0;
    }

    // speed + distance
    speed.current = Math.min(320, 150 + dist.current * 0.012);
    dist.current += speed.current * s;
    setScore(Math.floor(dist.current / 10));

    // spawn obstacles
    spawnIn.current -= speed.current * s;
    if (spawnIn.current <= 0) {
      const roll = Math.random();
      const kind: Obstacle["kind"] = roll < 0.5 ? "s" : roll < 0.8 ? "l" : "bird";
      obstacles.current.push({ x: W + 20, kind });
      // spawn gap shrinks with speed but stays clearable
      spawnIn.current = 90 + Math.random() * 90 + (speed.current / 320) * 60;
    }
    obstacles.current = obstacles.current.filter((o) => o.x > -30);
    for (const o of obstacles.current) o.x -= speed.current * s;

    // collision (dino box 9 wide starting x=14, 8 tall from dy+1)
    const dx0 = 14;
    const dx1 = dx0 + 9;
    const dyTop = dy.current + 1;
    const dyBot = dy.current + 9;
    for (const o of obstacles.current) {
      const ow = o.kind === "bird" ? 8 : o.kind === "l" ? 8 : 8;
      const oh = o.kind === "bird" ? 4 : o.kind === "l" ? 10 : 6;
      const oy = o.kind === "bird" ? GROUND_Y - 34 : GROUND_Y - oh;
      if (dx1 > o.x && dx0 < o.x + ow && dyBot > oy && dyTop < oy + oh) {
        return die();
      }
    }
    draw();
  });





  useEffect(() => {
    draw();
     
  }, []);

  return (
    <GameShell
      slug="runner"
      title="RUNNER"
      status={status}
      scoreLabel="M"
      score={score}
      best={best}
      hint="tap / space to jump — hold to jump higher · birds fly high, stay grounded under them"
      overlayNote={status === "over" ? `${score}m run · best ${Math.max(best, score)}m` : undefined}
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
          held.current = true;
          jump();
        }}
        onPointerUp={() => {
          held.current = false;
        }}
        onPointerLeave={() => {
          held.current = false;
        }}
      />
      {/* invisible keyboard hold tracker */}
      <KeyHold onDown={(d) => { held.current = d; if (d) jump(); }} />
    </GameShell>
  );
}

/** Tracks space hold for variable jump height (keyboard mirror of the canvas touch hold). */
function KeyHold({ onDown }: { onDown: (down: boolean) => void }) {
  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      if (e.code === "Space") onDown(true);
      if (e.code === "ArrowUp" || e.code === "KeyW") onDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") onDown(false);
    };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
    };
  }, [onDown]);
  return null;
}
