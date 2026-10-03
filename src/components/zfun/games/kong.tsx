"use client";

/** zFun · KONG — climb the girders, dodge the barrels, reach the top. */

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
const H = 224;
const FLOORS = [40, 80, 120, 160, 200];
const PW = 10;
const PH = 12;
const BW = 10;
const BH = 8;

const LADDERS = [
  { x: 30, top: 160, bottom: 200 },
  { x: 152, top: 160, bottom: 200 },
  { x: 62, top: 120, bottom: 160 },
  { x: 172, top: 120, bottom: 160 },
  { x: 24, top: 80, bottom: 120 },
  { x: 112, top: 80, bottom: 120 },
  { x: 70, top: 40, bottom: 80 },
  { x: 160, top: 40, bottom: 80 },
];

interface Barrel {
  x: number;
  y: number;
  floor: number;
  dir: 1 | -1;
  falling: boolean;
}

export default function KongGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("kong");
  const canvasRef: CanvasRef = useRef(null);

  const px = useRef(90);
  const py = useRef(200 - PH);
  const climb = useRef<{ dir: -1 | 1; target: number } | null>(null);
  const level = useRef(1);
  const barrels = useRef<Barrel[]>([]);
  const spawnIn = useRef(1200);
  const clock = useRef(0);

  function resetLevel(keepScore: boolean) {
    px.current = 90;
    py.current = 200 - PH;
    climb.current = null;
    barrels.current = [];
    spawnIn.current = 1400;
    if (!keepScore) {
      level.current = 1;
      setScore(0);
    }
    setStatus("playing");
  }

  const start = () => {
    if (status === "won") {
      resetLevel(true);
    } else resetLevel(false);
  };

  function die() {
    beep(110, 280, "square", 0.05);
    setStatus("over");
    submitBest(score);
  }

  function barrelSpeed() {
    return 46 + level.current * 9;
  }

  function updateBarrels(dt: number) {
    const s = dt / 1000;
    spawnIn.current -= dt;
    if (spawnIn.current <= 0 && barrels.current.length < 6) {
      barrels.current.push({ x: 40, y: FLOORS[0] - BH, floor: 0, dir: 1, falling: false });
      spawnIn.current = Math.max(1100, 2100 - level.current * 160);
      beep(200, 40, "triangle", 0.03);
    }
    for (const b of barrels.current) {
      if (b.falling) {
        b.y += 62 * s;
        const nextFloor = FLOORS[b.floor + 1];
        if (nextFloor !== undefined && b.y >= nextFloor - BH) {
          b.y = nextFloor - BH;
          b.floor += 1;
          b.falling = false;
          b.dir = b.floor % 2 === 0 ? 1 : -1;
        }
        continue;
      }
      b.x += b.dir * barrelSpeed() * s;
      // chance to take a ladder down
      if (!b.falling) {
        for (const l of LADDERS) {
          const floorY = FLOORS[b.floor];
          if (l.top === floorY && Math.abs(b.x + BW / 2 - l.x) < 4 && Math.random() < 0.012) {
            b.falling = true;
            break;
          }
        }
      }
      // forced drop at girder ends
      if ((b.x < 3 && b.dir === -1) || (b.x > W - BW - 3 && b.dir === 1)) {
        if (b.floor < FLOORS.length - 1) b.falling = true;
      }
    }
    barrels.current = barrels.current.filter((b) => {
      const gone = b.floor === FLOORS.length - 1 && (b.x < -BW || b.x > W + BW);
      if (gone && status === "playing") setScore((v) => v + 10);
      return !gone;
    });
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // girders
    for (const f of FLOORS) {
      ctx.fillStyle = C.faint;
      ctx.fillRect(0, f, W, 2);
      ctx.fillStyle = C.frame;
      for (let x = 2; x < W; x += 8) ctx.fillRect(x, f + 2, 4, 2);
    }
    // ladders
    ctx.fillStyle = C.yellow;
    for (const l of LADDERS) {
      ctx.fillRect(l.x - 3, l.top, 2, l.bottom - l.top);
      ctx.fillRect(l.x + 2, l.top, 2, l.bottom - l.top);
      for (let y = l.top + 3; y < l.bottom; y += 6) ctx.fillRect(l.x - 3, y, 7, 1);
    }
    // ape — the reason you climb
    ctx.fillStyle = C.red;
    ctx.fillRect(8, FLOORS[0] - 16, 18, 16);
    ctx.fillStyle = C.bright;
    ctx.fillRect(11, FLOORS[0] - 12, 3, 3);
    ctx.fillRect(19, FLOORS[0] - 12, 3, 3);
    // rescue marker
    ctx.fillStyle = C.brand;
    ctx.fillRect(W - 18, FLOORS[0] - 14, 8, 6);
    ctx.fillRect(W - 15, FLOORS[0] - 8, 2, 8);
    // barrels
    for (const b of barrels.current) {
      ctx.fillStyle = C.orange;
      ctx.fillRect(b.x, b.y, BW, BH);
      ctx.fillStyle = "#7c2d12";
      ctx.fillRect(b.x + 2, b.y + 3, BW - 4, 2);
    }
    // player
    ctx.fillStyle = C.brand;
    ctx.fillRect(px.current, py.current, PW, PH);
    ctx.fillStyle = C.bright;
    ctx.fillRect(px.current + 2, py.current + 2, 2, 2);
    ctx.fillRect(px.current + PW - 4, py.current + 2, 2, 2);
    // level chip
    ctx.fillStyle = C.dim;
    ctx.fillRect(W - 34, H - 10, 3, 3);
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    clock.current += dt;
    input.drain();
    if (status === "playing") {
      const s = dt / 1000;
      if (climb.current) {
        const targetY = climb.current.target - PH;
        py.current += climb.current.dir * 48 * s;
        if (
          (climb.current.dir === -1 && py.current <= targetY) ||
          (climb.current.dir === 1 && py.current >= targetY)
        ) {
          py.current = targetY;
          climb.current = null;
        }
      } else {
        if (input.held.has("left")) px.current -= 66 * s;
        if (input.held.has("right")) px.current += 66 * s;
        px.current = Math.max(3, Math.min(W - PW - 3, px.current));
        if (input.held.has("up") || input.held.has("down")) {
          const feet = py.current + PH;
          for (const l of LADDERS) {
            const near = Math.abs(px.current + PW / 2 - l.x) < 7;
            if (!near) continue;
            if (input.held.has("up") && Math.abs(feet - l.bottom) < 3) {
              climb.current = { dir: -1, target: l.top };
              break;
            }
            if (input.held.has("down") && Math.abs(feet - l.top) < 3) {
              climb.current = { dir: 1, target: l.bottom };
              break;
            }
          }
        }
      }
      updateBarrels(dt);

      // barrel collision
      for (const b of barrels.current) {
        if (Math.abs(b.y - py.current) < 9 && Math.abs(b.x - px.current) < 9) return die();
      }
      // rescue at top-right
      if (py.current === FLOORS[0] - PH && px.current > W - 30) {
        setScore((v) => v + 100 * level.current);
        level.current += 1;
        beep(880, 200);
        setStatus("won");
        submitBest(score + 100 * (level.current - 1));
      }
    }
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  return (
    <GameShell
      slug="kong"
      title="KONG"
      status={status}
      scoreLabel="PTS"
      score={score}
      best={best}
      hint="← → walk · ↑↓ climb ladders · dodge everything orange"
      overlayNote={
        status === "won"
          ? `rescued! the next kong rolls faster`
          : status === "over"
            ? `score ${score} · best ${Math.max(best, score)}`
            : "the ape never tires"
      }
      onStart={start}
      pads={
        <>
          <div className="flex flex-col items-center gap-2">
            <Pad input={input} btn="up" label="↑" ariaLabel="Climb up" />
            <div className="flex gap-2">
              <Pad input={input} btn="left" label="←" ariaLabel="Walk left" />
              <Pad input={input} btn="down" label="↓" ariaLabel="Nothing to see here" />
              <Pad input={input} btn="right" label="→" ariaLabel="Walk right" />
            </div>
          </div>
        </>
      }
      canvasMax={Math.min(440, H)}
    >
      <canvas ref={canvasRef} width={W} height={H} style={PIXELATED} className="block w-full touch-none" />
    </GameShell>
  );
}
