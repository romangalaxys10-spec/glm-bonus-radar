"use client";

/** zFun · ASTEROIDS — rotate, thrust, shoot, wrap. The rocks split, you don't. */

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

const W = 280;
const H = 200;

interface Rock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: 3 | 2 | 1;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

const ROCK_POINTS: Record<3 | 2 | 1, number> = { 3: 20, 2: 50, 1: 100 };
const ROCK_SPEED: Record<3 | 2 | 1, number> = { 3: 42, 2: 62, 1: 88 };

function wrap(v: number, max: number) {
  return v < 0 ? v + max : v >= max ? v - max : v;
}

export default function AsteroidsGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("asteroids");
  const canvasRef: CanvasRef = useRef(null);

  const ship = useRef({ x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2 });
  const bullets = useRef<Bullet[]>([]);
  const rocks = useRef<Rock[]>([]);
  const level = useRef(1);
  const lives = useRef(3);
  const invuln = useRef(0);
  const cooldown = useRef(0);
  const clock = useRef(0);

  function spawnLevel(n: number) {
    rocks.current = [];
    for (let i = 0; i < n + 2; i++) {
      // keep rocks away from the ship at spawn
      let x = 0;
      let y = 0;
      do {
        x = Math.random() * W;
        y = Math.random() * H;
      } while (Math.hypot(x - ship.current.x, y - ship.current.y) < 70);
      const a = Math.random() * Math.PI * 2;
      rocks.current.push({ x, y, vx: Math.cos(a) * 42, vy: Math.sin(a) * 42, size: 3 });
    }
  }

  function reset() {
    ship.current = { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2 };
    bullets.current = [];
    level.current = 1;
    lives.current = 3;
    invuln.current = 1500;
    cooldown.current = 0;
    setScore(0);
    setStatus("playing");
    spawnLevel(1);
  }

  const start = () => reset();

  function die() {
    lives.current -= 1;
    beep(110, 280, "square", 0.05);
    if (lives.current <= 0) {
      setStatus("over");
      submitBest(score);
    } else {
      ship.current = { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2 };
      invuln.current = 2000;
    }
  }

  function split(r: Rock) {
    setScore((s) => s + ROCK_POINTS[r.size]);
    beep(r.size === 3 ? 180 : r.size === 2 ? 260 : 380, 60);
    const idx = rocks.current.indexOf(r);
    if (idx >= 0) rocks.current.splice(idx, 1);
    if (r.size > 1) {
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = ROCK_SPEED[(r.size - 1) as 2 | 1];
        rocks.current.push({
          x: r.x,
          y: r.y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          size: (r.size - 1) as 2 | 1,
        });
      }
    }
    if (rocks.current.length === 0) {
      level.current += 1;
      spawnLevel(level.current);
      beep(660, 120);
    }
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // starfield
    ctx.fillStyle = C.grid;
    for (let i = 0; i < 24; i++) {
      const sx = (i * 97) % W;
      const sy = (i * 53) % H;
      ctx.fillRect(sx, sy, 1, 1);
    }
    // ship (blinks while invulnerable)
    const s = ship.current;
    const blink = invuln.current > 0 && Math.floor(clock.current / 100) % 2 === 0;
    if (!blink) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.a);
      ctx.fillStyle = C.brand;
      ctx.fillRect(-2, -2, 8, 4);
      ctx.fillRect(2, -4, 4, 8);
      ctx.fillRect(-6, -1, 4, 2);
      if (input.held.has("up") && status === "playing") {
        ctx.fillStyle = C.yellow;
        ctx.fillRect(-8, -1, 3, 2);
      }
      ctx.restore();
    }
    // bullets
    ctx.fillStyle = C.bright;
    for (const b of bullets.current) ctx.fillRect(b.x - 1, b.y - 1, 2, 2);
    // rocks
    for (const r of rocks.current) {
      ctx.fillStyle = r.size === 3 ? C.dim : r.size === 2 ? C.ink : C.bright;
      const rad = r.size * 4 + 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.bg;
      ctx.beginPath();
      ctx.arc(r.x - rad * 0.25, r.y - rad * 0.25, rad * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    // lives as small chips
    for (let i = 0; i < lives.current; i++) {
      ctx.fillStyle = C.brand;
      ctx.fillRect(6 + i * 10, 6, 6, 6);
    }
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    const sec = dt / 1000;
    clock.current += dt;
    const edges = input.drain();

    if (status === "playing") {
      const s = ship.current;
      if (input.held.has("left")) s.a -= 3.4 * sec;
      if (input.held.has("right")) s.a += 3.4 * sec;
      if (input.held.has("up")) {
        s.vx += Math.cos(s.a) * 95 * sec;
        s.vy += Math.sin(s.a) * 95 * sec;
      }
      s.vx *= 1 - 0.35 * sec;
      s.vy *= 1 - 0.35 * sec;
      s.x = wrap(s.x + s.vx * sec, W);
      s.y = wrap(s.y + s.vy * sec, H);

      cooldown.current -= dt;
      if (edges.includes("fire") && bullets.current.length < 4 && cooldown.current <= 0) {
        bullets.current.push({
          x: s.x + Math.cos(s.a) * 8,
          y: s.y + Math.sin(s.a) * 8,
          vx: Math.cos(s.a) * 220 + s.vx,
          vy: Math.sin(s.a) * 220 + s.vy,
          life: 900,
        });
        cooldown.current = 180;
        beep(520, 30);
      }

      for (const b of bullets.current) {
        b.x = wrap(b.x + b.vx * sec, W);
        b.y = wrap(b.y + b.vy * sec, H);
        b.life -= dt;
      }
      bullets.current = bullets.current.filter((b) => b.life > 0);

      for (const r of rocks.current) {
        r.x = wrap(r.x + r.vx * sec, W);
        r.y = wrap(r.y + r.vy * sec, H);
      }

      // bullet vs rock
      for (const r of [...rocks.current]) {
        const rad = r.size * 4 + 2;
        for (const b of bullets.current) {
          if (Math.hypot(b.x - r.x, b.y - r.y) < rad + 2) {
            bullets.current = bullets.current.filter((x) => x !== b);
            split(r);
            break;
          }
        }
      }

      // ship vs rock
      if (invuln.current > 0) invuln.current -= dt;
      else {
        for (const r of rocks.current) {
          const rad = r.size * 4 + 2;
          if (Math.hypot(ship.current.x - r.x, ship.current.y - r.y) < rad + 3) {
            die();
            break;
          }
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
      slug="asteroids"
      title="ASTEROIDS"
      status={status}
      scoreLabel="PTS"
      score={score}
      best={best}
      hint="← → rotate · ↑ thrust · space / FIRE to shoot — screen wraps, rocks split"
      overlayNote={status === "over" ? `score ${score} · best ${Math.max(best, score)}` : undefined}
      onStart={start}
      pads={
        <>
          <Pad input={input} btn="left" label="⟲" ariaLabel="Rotate left" />
          <Pad input={input} btn="up" label="▲" ariaLabel="Thrust" />
          <Pad input={input} btn="right" label="⟳" ariaLabel="Rotate right" />
          <Pad input={input} btn="fire" label="FIRE" wide ariaLabel="Shoot" />
        </>
      }
      canvasMax={480}
    >
      <canvas ref={canvasRef} width={W} height={H} style={PIXELATED} className="block w-full touch-none" />
    </GameShell>
  );
}
