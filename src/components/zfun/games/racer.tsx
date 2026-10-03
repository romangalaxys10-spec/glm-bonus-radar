"use client";

/** zFun · RACER — straight road, endless traffic, one speed curve: up. */

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
  pointerPos,
  useBest,
  useInput,
  useLoop,
} from "../engine";

const W = 140;
const H = 220;
const ROAD_L = 22;
const ROAD_R = W - 22;

interface Car {
  x: number;
  y: number;
  v: number;
  tone: string;
}

export default function RacerGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("racer");
  const canvasRef: CanvasRef = useRef(null);

  const px = useRef(W / 2 - 7);
  const cars = useRef<Car[]>([]);
  const dist = useRef(0);
  const spawnIn = useRef(400);
  const scroll = useRef(0);
  const speed = useRef(120);

  function reset() {
    px.current = W / 2 - 7;
    cars.current = [];
    dist.current = 0;
    spawnIn.current = 400;
    speed.current = 120;
    setScore(0);
    setStatus("playing");
  }

  const start = () => reset();

  function spawn() {
    const x = ROAD_L + 4 + Math.random() * (ROAD_R - ROAD_L - 18);
    // avoid unfair double-spawns at the same height
    for (const c of cars.current) if (Math.abs(c.y) < 26 && Math.abs(c.x - x) < 26) return;
    const tones = [C.red, C.yellow, C.green, "#f472b6"];
    cars.current.push({
      x,
      y: -22,
      v: 30 + Math.random() * 45,
      tone: tones[Math.floor(Math.random() * tones.length)],
    });
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // shoulders
    ctx.fillStyle = "#101012";
    ctx.fillRect(0, 0, ROAD_L, H);
    ctx.fillRect(ROAD_R, 0, W - ROAD_R, H);
    // road
    ctx.fillStyle = "#151517";
    ctx.fillRect(ROAD_L, 0, ROAD_R - ROAD_L, H);
    // edge posts
    ctx.fillStyle = C.red;
    for (let y = (scroll.current % 24) - 24; y < H; y += 24) {
      ctx.fillRect(ROAD_L - 5, y, 4, 10);
      ctx.fillRect(ROAD_R + 1, y, 4, 10);
    }
    // center dashes
    ctx.fillStyle = C.faint;
    for (let y = (scroll.current % 32) - 32; y < H; y += 32) {
      ctx.fillRect(W / 2 - 1, y, 2, 14);
    }
    // traffic
    for (const c of cars.current) {
      ctx.fillStyle = c.tone;
      ctx.fillRect(c.x, c.y, 14, 20);
      ctx.fillStyle = C.bg;
      ctx.fillRect(c.x + 2, c.y + 4, 10, 5);
      ctx.fillRect(c.x + 2, c.y + 13, 10, 4);
    }
    // player car
    ctx.fillStyle = C.brand;
    ctx.fillRect(px.current, H - 40, 14, 22);
    ctx.fillStyle = C.bright;
    ctx.fillRect(px.current + 3, H - 36, 8, 6);
    ctx.fillStyle = "#1d4ed8";
    ctx.fillRect(px.current + 2, H - 22, 3, 4);
    ctx.fillRect(px.current + 9, H - 22, 3, 4);
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    const sec = dt / 1000;
    input.drain();
    if (status === "playing") {
      speed.current = 120 + dist.current * 0.02;
      dist.current += speed.current * sec;
      scroll.current += speed.current * sec;
      setScore(Math.floor(dist.current / 10));

      if (input.held.has("left")) px.current -= 105 * sec;
      if (input.held.has("right")) px.current += 105 * sec;
      px.current = Math.max(ROAD_L + 2, Math.min(ROAD_R - 16, px.current));

      spawnIn.current -= dt;
      if (spawnIn.current <= 0) {
        spawn();
        spawnIn.current = Math.max(380, 900 - dist.current * 0.012);
      }

      for (const c of cars.current) c.y += (speed.current - c.v) * sec;
      cars.current = cars.current.filter((c) => c.y < H + 24);

      for (const c of cars.current) {
        if (
          px.current + 12 > c.x &&
          px.current + 2 < c.x + 14 &&
          H - 42 < c.y + 20 &&
          H - 18 > c.y
        ) {
          beep(90, 320, "sawtooth", 0.06);
          setStatus("over");
          submitBest(Math.floor(dist.current / 10));
          break;
        }
      }
    }
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  const dragging = useRef(false);
  return (
    <GameShell
      slug="racer"
      title="RACER"
      status={status}
      scoreLabel="M"
      score={score}
      best={best}
      hint="← → steer · drag on the road on mobile · speed only goes up"
      overlayNote={status === "over" ? `${score} m · best ${Math.max(best, score)} m` : undefined}
      onStart={start}
      pads={
        <>
          <Pad input={input} btn="left" label="←" ariaLabel="Steer left" />
          <Pad input={input} btn="right" label="→" ariaLabel="Steer right" />
        </>
      }
      canvasMax={Math.min(400, H)}
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={PIXELATED}
        className="block w-full touch-none"
        onPointerDown={(e) => {
          e.preventDefault();
          dragging.current = true;
          px.current = pointerPos(e).x - 7;
        }}
        onPointerMove={(e) => {
          if (!dragging.current || status !== "playing") return;
          px.current = Math.max(ROAD_L + 2, Math.min(ROAD_R - 16, pointerPos(e).x - 7));
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
      />
    </GameShell>
  );
}
