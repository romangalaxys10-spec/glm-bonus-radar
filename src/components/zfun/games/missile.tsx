"use client";

/** zFun · MISSILE — command the battery, intercept the warheads, save six cities. */

import { useEffect, useRef, useState } from "react";
import {
  C,
  CanvasRef,
  GameShell,
  GameStatus,
  PIXELATED,
  beep,
  ctx2d,
  pointerPos,
  useBest,
  useInput,
  useLoop,
} from "../engine";

const W = 280;
const H = 200;
const GY = 184;

interface City {
  x: number;
  alive: boolean;
}

interface Warhead {
  x: number;
  y: number;
  vx: number;
  vy: number;
  sx: number;
  sy: number;
}

interface Interceptor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
}

interface Boom {
  x: number;
  y: number;
  r: number;
  growing: boolean;
}

const CITY_X = [24, 64, 104, 176, 216, 256];

const sy0 = (x: number) => 6 + ((x * 13) % 24);

export default function MissileGame() {
  const input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("missile");
  const canvasRef: CanvasRef = useRef(null);

  const cities = useRef<City[]>(CITY_X.map((x) => ({ x, alive: true })));
  const warheads = useRef<Warhead[]>([]);
  const shots = useRef<Interceptor[]>([]);
  const booms = useRef<Boom[]>([]);
  const aim = useRef({ x: W / 2, y: 70 });
  const [wave, setWave] = useState(1);
  const toSpawn = useRef(0);
  const spawnIn = useRef(0);

  function startWave(n: number) {
    toSpawn.current = 4 + n * 2;
    spawnIn.current = 600;
    setWave(n);
  }

  function reset() {
    cities.current = CITY_X.map((x) => ({ x, alive: true }));
    warheads.current = [];
    shots.current = [];
    booms.current = [];
    setScore(0);
    setStatus("playing");
    startWave(1);
  }

  const start = () => reset();

  function fire(tx: number, ty: number) {
    if (status !== "playing" || shots.current.length >= 4) return;
    const bx = W / 2;
      const by = GY - 10;
    const d = Math.hypot(tx - bx, ty - by) || 1;
    shots.current.push({
      x: bx,
      y: by,
      vx: ((tx - bx) / d) * 190,
      vy: ((ty - by) / d) * 190,
      tx,
      ty,
    });
    beep(760, 30);
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.grid;
    for (let i = 0; i < 26; i++) ctx.fillRect((i * 71) % W, (i * 37) % 150, 1, 1);
    // ground
    ctx.fillStyle = C.faint;
    ctx.fillRect(0, GY, W, H - GY);
    // battery
    ctx.fillStyle = C.brand;
    ctx.fillRect(W / 2 - 8, GY - 10, 16, 10);
    // cities
    for (const c of cities.current) {
      ctx.fillStyle = c.alive ? C.ink : "#27272a";
      ctx.fillRect(c.x - 9, GY - 9, 18, 9);
      if (c.alive) {
        ctx.fillStyle = C.yellow;
        ctx.fillRect(c.x - 4, GY - 12, 3, 3);
        ctx.fillRect(c.x + 2, GY - 13, 3, 4);
      }
    }
    // warheads + trails
    for (const wh of warheads.current) {
      ctx.strokeStyle = "rgba(248,113,113,0.35)";
      ctx.beginPath();
      ctx.moveTo(wh.sx, wh.sy);
      ctx.lineTo(wh.x, wh.y);
      ctx.stroke();
      ctx.fillStyle = C.red;
      ctx.fillRect(wh.x - 1, wh.y - 1, 3, 3);
    }
    // interceptors + trails
    for (const s of shots.current) {
      ctx.strokeStyle = "rgba(59,130,246,0.45)";
      ctx.beginPath();
      ctx.moveTo(W / 2, GY - 10);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.fillStyle = C.brand;
      ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
    }
    // explosions
    for (const b of booms.current) {
      ctx.fillStyle = "rgba(250,204,21,0.8)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(248,113,113,0.5)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, Math.max(1, b.r * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }
    // crosshair
    ctx.strokeStyle = C.bright;
    ctx.strokeRect(aim.current.x - 4, aim.current.y - 4, 8, 8);
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    const sec = dt / 1000;
    const edges = input.drain();
    if (status === "playing") {
      if (edges.includes("fire")) fire(aim.current.x, aim.current.y);
      // spawn warheads
      spawnIn.current -= dt;
      if (spawnIn.current <= 0 && toSpawn.current > 0) {
        toSpawn.current -= 1;
        const sx = 10 + Math.random() * (W - 20);
        const alive = cities.current.filter((c) => c.alive);
        const targetX = alive.length
          ? alive[Math.floor(Math.random() * alive.length)].x
          : W / 2;
        const speed = 22 + wave * 4;
        const dy = GY - 6 - sy0(sx);
        const d = Math.hypot(targetX - sx, dy) || 1;
        warheads.current.push({
          x: sx,
          y: sy0(sx),
          sx,
          sy: sy0(sx),
          vx: ((targetX - sx) / d) * speed,
          vy: (dy / d) * speed,
        });
        spawnIn.current = Math.max(320, 900 - wave * 60);
      }

      // move interceptors → boom on arrival
      for (const s of shots.current) {
        s.x += s.vx * sec;
        s.y += s.vy * sec;
        if (Math.hypot(s.x - s.tx, s.y - s.ty) < 6 || s.y < 2 || s.x < 2 || s.x > W - 2) {
          booms.current.push({ x: s.x, y: s.y, r: 2, growing: true });
          beep(300, 60, "triangle", 0.03);
        }
      }
      shots.current = shots.current.filter(
        (s) => Math.hypot(s.x - s.tx, s.y - s.ty) >= 6 && s.y >= 2 && s.x >= 2 && s.x <= W - 2,
      );

      // explosions grow/shrink
      for (const b of booms.current) {
        if (b.growing) {
          b.r += 40 * sec;
          if (b.r >= 22) b.growing = false;
        } else {
          b.r -= 26 * sec;
        }
      }
      booms.current = booms.current.filter((b) => b.r > 2 || b.growing);

      // warheads move; die in explosions; hit ground
      warheads.current = warheads.current.filter((wh) => {
        wh.x += wh.vx * sec;
        wh.y += wh.vy * sec;
        for (const b of booms.current) {
          if (Math.hypot(wh.x - b.x, wh.y - b.y) < b.r) {
            setScore((v) => v + 25);
            beep(500, 50, "square", 0.03);
            return false;
          }
        }
        if (wh.y >= GY - 6) {
          // impact
          for (const c of cities.current) {
            if (c.alive && Math.abs(c.x - wh.x) < 12) {
              c.alive = false;
              beep(80, 320, "sawtooth", 0.06);
              break;
            }
          }
          booms.current.push({ x: wh.x, y: GY - 4, r: 14, growing: false });
          return false;
        }
        return true;
      });

      // wave clear / game over
      if (toSpawn.current === 0 && warheads.current.length === 0) {
        const saved = cities.current.filter((c) => c.alive).length;
        setScore((v) => v + saved * 50);
        startWave(wave + 1);
      }
      if (cities.current.every((c) => !c.alive)) {
        setStatus("over");
        submitBest(score);
      }
    }
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  return (
    <GameShell
      slug="missile"
      title="MISSILE"
      status={status}
      scoreLabel="PTS"
      score={score}
      best={best}
      hint="move the mouse to aim · tap/click or space to fire — cities are precious"
      overlayNote={
        status === "over"
          ? `the last city fell at wave ${wave} · score ${score}`
          : status === "ready"
            ? "interceptors explode where you point"
            : undefined
      }
      onStart={start}
      canvasMax={480}
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={PIXELATED}
        className="block w-full touch-none"
        onPointerMove={(e) => {
          aim.current = pointerPos(e);
        }}
        onPointerDown={(e) => {
          const p = pointerPos(e);
          aim.current = p;
          fire(p.x, p.y);
        }}
      />
    </GameShell>
  );
}
