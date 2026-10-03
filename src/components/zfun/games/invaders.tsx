"use client";

/** zFun · INVADERS — one cannon, marching aliens, endless waves. */

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
  drawBitmap,
  useBest,
  useInput,
  useLoop,
} from "../engine";

const W = 240;
const H = 200;
const COLS = 8;
const ROWS = 4;
const ALIEN_W = 8;
const ALIEN_H = 8;
const GAP_X = 22;
const GAP_Y = 15;
const FLEET_W = COLS * GAP_X - (GAP_X - ALIEN_W);
const FLEET_X0 = (W - FLEET_W) / 2;
const FLEET_Y0 = 22;
const PLAYER_Y = H - 18;

// 8×8 invader, two frames (legs alternate)
const ALIEN_A = [
  "00100100",
  "00100100",
  "00111100",
  "01111110",
  "11011011",
  "11111111",
  "10111101",
  "10100101",
];
const ALIEN_B = [
  "00100100",
  "10100101",
  "10111101",
  "11111111",
  "01111110",
  "00111100",
  "01000010",
  "10000001",
];
// 12×6 player cannon
const CANNON = [
  "000001100000",
  "000001100000",
  "011111111110",
  "111111111111",
  "111111111111",
  "111111111111",
];

const ROW_POINTS = [30, 20, 20, 10];

export default function InvadersGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("invaders");
  const canvasRef: CanvasRef = useRef(null);

  const fleet = useRef<boolean[][]>([]);
  const fx = useRef(FLEET_X0);
  const fy = useRef(FLEET_Y0);
  const dirR = useRef(1);
  const stepAcc = useRef(0);
  const frame = useRef(0);
  const playerX = useRef(W / 2 - 6);
  const bullet = useRef<{ x: number; y: number } | null>(null);
  const bombs = useRef<{ x: number; y: number }[]>([]);
  const bombAcc = useRef(0);
  const lives = useRef(3);
  const [livesUi, setLivesUi] = useState(3);
  const invuln = useRef(0);
  const [wave, setWave] = useState(1);
  const alive = useRef(32);

  function buildFleet() {
    fleet.current = Array.from({ length: ROWS }, () => Array(COLS).fill(true));
    alive.current = ROWS * COLS;
    fx.current = FLEET_X0;
    fy.current = FLEET_Y0;
    dirR.current = 1;
    bombs.current = [];
    bullet.current = null;
  }

  function reset() {
    buildFleet();
    setWave(1);
    lives.current = 3;
    setLivesUi(3);
    setScore(0);
    invuln.current = 0;
    playerX.current = W / 2 - 6;
    setStatus("playing");
  }

  const start = () => reset();

  function fleetSpeed(): number {
    // few survivors march faster; base speed grows per wave
    const frac = alive.current / (ROWS * COLS);
    return 14 + (1 - frac) * 46 + (wave - 1) * 6;
  }

  function hitPlayer() {
    if (invuln.current > 0) return;
    lives.current--;
    setLivesUi(lives.current);
    invuln.current = 1500;
    beep(180, 150);
    if (lives.current <= 0) {
      beep(110, 300, "square", 0.05);
      setStatus("over");
      submitBest(score);
    }
  }

  function nextWave() {
    setWave((w) => w + 1);
    beep(660, 70);
    beep(880, 70);
    buildFleet();
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // fleet
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (!fleet.current[r]?.[c]) continue;
        const ax = fx.current + c * GAP_X;
        const ay = fy.current + r * GAP_Y;
        drawBitmap(ctx, frame.current ? ALIEN_A : ALIEN_B, ax, ay, 1, ROWS === 4 && r === 0 ? C.brand : C.ink);
      }
    // player cannon (blinks while invulnerable)
    if (!(invuln.current > 0 && Math.floor(invuln.current / 120) % 2 === 0)) {
      drawBitmap(ctx, CANNON, playerX.current, PLAYER_Y, 1, C.brand);
    }
    // bullet + bombs
    if (bullet.current) {
      ctx.fillStyle = C.bright;
      ctx.fillRect(bullet.current.x - 1, bullet.current.y - 4, 2, 5);
    }
    ctx.fillStyle = C.red;
    for (const b of bombs.current) ctx.fillRect(b.x - 1, b.y, 2, 5);
    // lives
    for (let i = 0; i < lives.current; i++) drawBitmap(ctx, CANNON, W - 16 - i * 18, 6, 1, C.faint);
    // wave marker
    ctx.fillStyle = C.faint;
    for (let i = 0; i < wave && i < 10; i++) ctx.fillRect(6 + i * 5, 8, 3, 3);
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    const s = dt / 1000;
    if (status !== "playing") {
      input.drain();
      draw();
      return;
    }
    invuln.current = Math.max(0, invuln.current - dt);

    // player move
    const sp = 120 * s;
    if (input.held.has("left")) playerX.current -= sp;
    if (input.held.has("right")) playerX.current += sp;
    playerX.current = Math.max(2, Math.min(W - 14, playerX.current));

    const edges = input.drain();
    // shoot: edge or held (one bullet on screen — classic limit)
    if (edges.includes("fire") || input.held.has("fire")) {
      if (!bullet.current) {
        bullet.current = { x: playerX.current + 6, y: PLAYER_Y - 4 };
        beep(880, 35);
      }
    }

    // fleet march
    stepAcc.current += dt;
    const stepMs = Math.max(90, 620 - fleetSpeed() * 6);
    while (stepAcc.current >= stepMs) {
      stepAcc.current -= stepMs;
      frame.current ^= 1;
      // edge check over living aliens
      let minX = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if (fleet.current[r]?.[c]) {
            const ax = fx.current + c * GAP_X;
            const ay = fy.current + r * GAP_Y;
            minX = Math.min(minX, ax);
            maxX = Math.max(maxX, ax + ALIEN_W);
            maxY = Math.max(maxY, ay + ALIEN_H);
          }
      if (maxX === -Infinity) {
        nextWave();
        break;
      }
      if ((dirR.current > 0 && maxX + 10 >= W) || (dirR.current < 0 && minX - 10 <= 0)) {
        dirR.current *= -1;
        fy.current += 7;
      } else {
        fx.current += dirR.current * 6;
      }
      if (maxY + 7 >= PLAYER_Y) {
        beep(110, 300, "square", 0.05);
        setStatus("over");
        submitBest(score);
      }
    }

    // player bullet
    if (bullet.current) {
      const bu = bullet.current;
      bu.y -= 260 * s;
      if (bu.y < 0) bullet.current = null;
      else {
        for (let r = ROWS - 1; r >= 0; r--)
          for (let c = 0; c < COLS; c++)
            if (fleet.current[r]?.[c]) {
              const ax = fx.current + c * GAP_X;
              const ay = fy.current + r * GAP_Y;
              const bx = bu.x;
              const by = bu.y;
              if (bx >= ax - 1 && bx <= ax + ALIEN_W + 1 && by >= ay - 1 && by <= ay + ALIEN_H + 1) {
                fleet.current[r][c] = false;
                alive.current--;
                bullet.current = null;
                const pts = ROW_POINTS[r]; // capture before r mutates below
                setScore((v) => v + pts);
                beep(520 + (ROWS - r) * 90, 40);
                r = -1;
                break;
              }
            }
        if (alive.current === 0) nextWave();
      }
    }

    // alien bombs
    bombAcc.current += dt;
    const bombEvery = Math.max(420, 1300 - (wave - 1) * 120 - (1 - alive.current / 32) * 500);
    if (bombAcc.current > bombEvery) {
      bombAcc.current = 0;
      // random living alien drops
      const living: [number, number][] = [];
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) if (fleet.current[r]?.[c]) living.push([r, c]);
      if (living.length) {
        const [r, c] = living[Math.floor(Math.random() * living.length)];
        bombs.current.push({ x: fx.current + c * GAP_X + ALIEN_W / 2, y: fy.current + r * GAP_Y + ALIEN_H });
      }
    }
    bombs.current = bombs.current.filter((b) => {
      b.y += 110 * s;
      if (b.y > H) return false;
      if (b.y >= PLAYER_Y && b.y <= PLAYER_Y + 10 && b.x >= playerX.current && b.x <= playerX.current + 12) {
        hitPlayer();
        return false;
      }
      return true;
    });

    draw();
  });



  useEffect(() => {
    buildFleet();
    draw();
     
  }, []);

  return (
    <GameShell
      slug="invaders"
      title="INVADERS"
      status={status}
      scoreLabel="PTS"
      score={score}
      best={best}
      hint="←→ move · space / FIRE to shoot · one bullet on screen"
      overlayNote={
        status === "over"
          ? `score ${score} · reached wave ${wave}`
          : `wave ${wave} · ${livesUi} lives`
      }
      onStart={start}
      pads={
        <>
          <Pad input={input} btn="left" label="←" ariaLabel="Move left" />
          <Pad input={input} btn="fire" label="FIRE" wide ariaLabel="Shoot" />
          <Pad input={input} btn="right" label="→" ariaLabel="Move right" />
        </>
      }
      canvasMax={480}
    >
      <canvas ref={canvasRef} width={W} height={H} style={PIXELATED} className="block w-full touch-none" />
    </GameShell>
  );
}
