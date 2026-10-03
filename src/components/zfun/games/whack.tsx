"use client";

/** zFun · WHACK — forty-five seconds, nine holes, zero mercy on the moles. */

import { useEffect, useRef, useState } from "react";
import {
  C,
  CanvasRef,
  GameShell,
  GameStatus,
  PIXELATED,
  beep,
  ctx2d,
  useBest,
  useLoop,
} from "../engine";

const W = 200;
const H = 210;
const ROUND_MS = 45_000;

const HOLES = [
  [36, 78],
  [100, 70],
  [164, 78],
  [36, 132],
  [100, 124],
  [164, 132],
  [36, 186],
  [100, 178],
  [164, 186],
];

interface Mole {
  up: boolean;
  t: number;
  total: number;
  hit: boolean;
}

export default function WhackGame() {
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("whack");
  const canvasRef: CanvasRef = useRef(null);

  const moles = useRef<Mole[]>(HOLES.map(() => ({ up: false, t: 0, total: 0, hit: false })));
  const spawnIn = useRef(500);
  const timeLeft = useRef(ROUND_MS);
  const flashes = useRef<{ x: number; y: number; t: number }[]>([]);

  function reset() {
    moles.current = HOLES.map(() => ({ up: false, t: 0, total: 0, hit: false }));
    spawnIn.current = 500;
    timeLeft.current = ROUND_MS;
    flashes.current = [];
    setScore(0);
    setStatus("playing");
  }

  const start = () => reset();

  function whack(hx: number, hy: number) {
    if (status !== "playing") return;
    let hitAny = false;
    moles.current.forEach((m, i) => {
      const [x, y] = HOLES[i];
      if (m.up && !m.hit && Math.abs(x - hx) < 28 && hy > y - 32 && hy < y + 8) {
        m.hit = true;
        m.t = Math.min(m.t, 260);
        hitAny = true;
        setScore((v) => v + 10);
        flashes.current.push({ x, y: y - 14, t: 220 });
        beep(700, 50);
      }
    });
    if (!hitAny) beep(180, 40, "triangle", 0.02);
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#0f1410";
    ctx.fillRect(0, 40, W, H - 40);
    // holes + moles
    moles.current.forEach((m, i) => {
      const [x, y] = HOLES[i];
      ctx.fillStyle = "#050505";
      ctx.beginPath();
      ctx.ellipse(x, y, 24, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.frame;
      ctx.beginPath();
      ctx.ellipse(x, y, 24, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (m.up) {
        const rise = m.hit ? 4 : 14;
        ctx.fillStyle = m.hit ? "#7c5c3e" : "#9a6b3f";
        ctx.fillRect(x - 12, y - rise, 24, rise);
        ctx.fillStyle = "#c98d5a";
        ctx.fillRect(x - 12, y - rise, 24, 3);
        if (!m.hit) {
          ctx.fillStyle = C.bright;
          ctx.fillRect(x - 7, y - rise + 4, 4, 4);
          ctx.fillRect(x + 3, y - rise + 4, 4, 4);
          ctx.fillStyle = "#f472b6";
          ctx.fillRect(x - 2, y - rise + 9, 4, 2);
        }
      }
    });
    // hit stars
    for (const f of flashes.current) {
      ctx.fillStyle = C.yellow;
      ctx.fillRect(f.x - 1, f.y - 12, 2, 8);
      ctx.fillRect(f.x - 7, f.y - 6, 14, 2);
      ctx.fillRect(f.x - 5, f.y - 10, 10, 2);
      ctx.fillRect(f.x - 5, f.y - 2, 10, 2);
    }
    // timer bar
    const frac = timeLeft.current / ROUND_MS;
    ctx.fillStyle = C.frame;
    ctx.fillRect(6, 8, W - 12, 8);
    ctx.fillStyle = frac > 0.3 ? C.accent : C.red;
    ctx.fillRect(7, 9, (W - 14) * frac, 6);
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    if (status === "playing") {
      timeLeft.current -= dt;
      if (timeLeft.current <= 0) {
        timeLeft.current = 0;
        beep(220, 300, "triangle", 0.05);
        setStatus("over");
        submitBest(score);
      }
      const scoreNow = score;
      const upMs = Math.max(430, 900 - scoreNow * 2.2);
      const every = Math.max(380, 950 - scoreNow * 2);
      spawnIn.current -= dt;
      if (spawnIn.current <= 0) {
        const hidden = moles.current.filter((m) => !m.up);
        if (hidden.length) {
          const m = hidden[Math.floor(Math.random() * hidden.length)];
          m.up = true;
          m.hit = false;
          m.t = upMs + 200;
          m.total = m.t;
        }
        spawnIn.current = every + Math.random() * 260;
      }
      for (const m of moles.current) {
        if (m.up) {
          m.t -= dt;
          if (m.t <= 0) {
            m.up = false;
            m.hit = false;
          }
        }
      }
      for (const f of flashes.current) f.t -= dt;
      flashes.current = flashes.current.filter((f) => f.t > 0);
    }
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  return (
    <GameShell
      slug="whack"
      title="WHACK"
      status={status}
      scoreLabel="HITS"
      score={score}
      best={best}
      hint="tap / click the moles before they duck — 45 seconds on the clock"
      overlayNote={
        status === "over"
          ? `time! ${score} whacks · best ${Math.max(best, score)}`
          : status === "ready"
            ? "they pop up. you pop back."
            : undefined
      }
      onStart={start}
      canvasMax={400}
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
          const y = ((e.clientY - r.top) / r.height) * H;
          whack(x, y);
        }}
      />
    </GameShell>
  );
}
