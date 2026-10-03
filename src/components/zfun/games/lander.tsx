"use client";

/** zFun · LANDER — gravity is honest. Touch down soft, or become a crater. */

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

const W = 240;
const H = 200;
const GROUND = 170;

interface Terrain {
  pts: { x: number; y: number }[];
  padX: number;
  padW: number;
}

function makeTerrain(level: number): Terrain {
  const padW = Math.max(18, 44 - level * 5);
  const padX = 24 + Math.random() * (W - 48 - padW);
  const pts: { x: number; y: number }[] = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * W;
    const inPad = x >= padX && x <= padX + padW;
    const y = inPad ? GROUND : GROUND - 14 - Math.random() * 42;
    pts.push({ x, y });
  }
  // flatten around the pad edges
  for (const p of pts) {
    if (p.x >= padX - 8 && p.x <= padX + padW + 8) p.y = GROUND;
  }
  return { pts, padX, padW };
}

export default function LanderGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("lander");
  const canvasRef: CanvasRef = useRef(null);

  const terrain = useRef<Terrain>(makeTerrain(1));
  const ship = useRef({ x: 40, y: 30, vx: 8, vy: 0, a: 0, fuel: 100 });
  const level = useRef(1);

  function reset(full: boolean) {
    if (full) {
      level.current = 1;
      setScore(0);
      terrain.current = makeTerrain(1);
    }
    ship.current = { x: 40, y: 26, vx: 10, vy: 0, a: 0, fuel: 100 };
    setStatus("playing");
  }

  const start = () => reset(status !== "won");

  function groundAt(x: number): number {
    const pts = terrain.current.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      if (x >= pts[i].x && x <= pts[i + 1].x) {
        const t = (x - pts[i].x) / (pts[i + 1].x - pts[i].x);
        return pts[i].y + t * (pts[i + 1].y - pts[i].y);
      }
    }
    return GROUND;
  }

  function landed(): boolean {
    const s = ship.current;
    const onPad = s.x >= terrain.current.padX - 2 && s.x <= terrain.current.padX + terrain.current.padW + 2;
    const soft = Math.abs(s.vy) < 26 && Math.abs(s.vx) < 20 && Math.abs(s.a) < 0.35;
    return onPad && soft;
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // stars
    ctx.fillStyle = C.grid;
    for (let i = 0; i < 20; i++) ctx.fillRect((i * 83) % W, (i * 41) % 120, 1, 1);
    // terrain
    ctx.fillStyle = C.dim;
    const pts = terrain.current.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const steps = Math.max(1, Math.round(b.x - a.x));
      for (let k = 0; k <= steps; k++) {
        const x = a.x + ((b.x - a.x) * k) / steps;
        const y = a.y + ((b.y - a.y) * k) / steps;
        ctx.fillRect(x, y, 1, H - y);
      }
    }
    // landing pad
    ctx.fillStyle = C.accent;
    ctx.fillRect(terrain.current.padX, GROUND, terrain.current.padW, 3);
    // ship
    const s = ship.current;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.a);
    ctx.fillStyle = C.brand;
    ctx.fillRect(-4, -5, 8, 8);
    ctx.fillRect(-2, -8, 4, 3);
    ctx.fillRect(-6, 3, 3, 2);
    ctx.fillRect(3, 3, 3, 2);
    if (input.held.has("fire") && s.fuel > 0 && status === "playing") {
      ctx.fillStyle = C.yellow;
      ctx.fillRect(-2, 6, 4, 3 + Math.round(Math.random() * 2));
    }
    ctx.restore();
    // HUD: fuel bar + velocity safety dots
    ctx.fillStyle = C.frame;
    ctx.fillRect(6, 6, 52, 5);
    ctx.fillStyle = s.fuel > 25 ? C.green : C.red;
    ctx.fillRect(7, 7, Math.max(0, s.fuel * 0.5), 3);
    const safe = Math.abs(s.vy) < 26 && Math.abs(s.vx) < 20;
    ctx.fillStyle = safe ? C.green : C.red;
    ctx.fillRect(64, 6, 5, 5);
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    const sec = dt / 1000;
    input.drain();
    if (status === "playing") {
      const s = ship.current;
      if (input.held.has("left")) s.a -= 2.2 * sec;
      if (input.held.has("right")) s.a += 2.2 * sec;
      if (input.held.has("fire") && s.fuel > 0) {
        s.vx += Math.sin(s.a) * 42 * sec;
        s.vy -= Math.cos(s.a) * 42 * sec;
        s.fuel = Math.max(0, s.fuel - 7 * sec);
      }
      s.vy += (20 + level.current * 1.5) * sec; // gravity tightens each level
      s.x += s.vx * sec;
      s.y += s.vy * sec;
      s.x = Math.max(6, Math.min(W - 6, s.x));

      const gy = groundAt(s.x);
      if (s.y + 4 >= gy) {
        s.y = gy - 4;
        if (landed()) {
          const gain = 100 + level.current * 50 + Math.round(s.fuel);
          setScore((v) => v + gain);
          beep(660, 120);
          beep(880, 160);
          submitBest(score + gain);
          level.current += 1;
          terrain.current = makeTerrain(level.current);
          ship.current = { x: 40, y: 26, vx: 10, vy: 0, a: 0, fuel: 100 };
        } else {
          beep(90, 350, "sawtooth", 0.06);
          setStatus("over");
          submitBest(score);
        }
      }
    }
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  return (
    <GameShell
      slug="lander"
      title="LANDER"
      status={status}
      scoreLabel="PTS"
      score={score}
      best={best}
      hint="← → rotate · hold FIRE/↑ to thrust · land slow and level on the blue pad"
      overlayNote={
        status === "won" || (status === "over" && score > 0)
          ? `score ${score} · best ${Math.max(best, score)}`
          : status === "ready"
            ? "keep the green dot lit until touchdown"
            : "too fast, too crooked, or not on the pad"
      }
      onStart={start}
      pads={
        <>
          <Pad input={input} btn="left" label="⟲" ariaLabel="Rotate left" />
          <Pad input={input} btn="fire" label="THRUST" wide ariaLabel="Thrust" />
          <Pad input={input} btn="right" label="⟳" ariaLabel="Rotate right" />
        </>
      }
      canvasMax={480}
    >
      <canvas ref={canvasRef} width={W} height={H} style={PIXELATED} className="block w-full touch-none" />
    </GameShell>
  );
}
