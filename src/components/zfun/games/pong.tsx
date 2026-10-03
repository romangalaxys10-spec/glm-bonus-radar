"use client";

/** zFun · PONG — the oldest duel. You vs a CPU with honest reflex limits. */

import { useEffect, useRef, useState } from "react";
import {
  C,
  CanvasRef,
  GameShell,
  GameStatus,
  PIXELATED,
  beep,
  ctx2d,
  drawGlyphText,
  pointerPos,
  useBest,
  useInput,
  useLoop,
} from "../engine";

const W = 240;
const H = 160;
const PAD_W = 4;
const PAD_H = 28;
const PLAYER_X = 10;
const CPU_X = W - 10 - PAD_W;
const WIN = 7;

export default function PongGame() {
  const input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [you, setYou] = useState(0);
  const [cpu, setCpu] = useState(0);
  const [best, submitBest] = useBest("pong");
  const canvasRef: CanvasRef = useRef(null);

  const py = useRef(H / 2 - PAD_H / 2);
  const cy = useRef(H / 2 - PAD_H / 2);
  const ball = useRef({ x: W / 2, y: H / 2, vx: 0, vy: 0 });
  const serveIn = useRef(0);
  const clock = useRef(0);

  function serve(toRight: boolean) {
    ball.current = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    serveIn.current = 800;
    // store pending direction in vx sign; released when serveIn hits 0
    ball.current.vx = toRight ? 150 : -150;
  }

  function reset() {
    setYou(0);
    setCpu(0);
    py.current = H / 2 - PAD_H / 2;
    cy.current = H / 2 - PAD_H / 2;
    serve(true);
    setStatus("playing");
  }

  const start = () => reset();

  function point(forPlayer: boolean) {
    beep(forPlayer ? 660 : 180, 120);
    if (forPlayer) {
      setYou((v) => {
        const n = v + 1;
        if (n >= WIN) {
          beep(880, 200);
          setStatus("won");
          submitBest(n);
        }
        return n;
      });
      serve(false);
    } else {
      setCpu((v) => {
        const n = v + 1;
        if (n >= WIN) {
          beep(110, 280, "square", 0.05);
          setStatus("over");
          submitBest(you);
        }
        return n;
      });
      serve(true);
    }
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // center net
    ctx.fillStyle = C.frame;
    for (let y = 4; y < H - 4; y += 12) ctx.fillRect(W / 2 - 1, y, 2, 6);
    // paddles
    ctx.fillStyle = C.brand;
    ctx.fillRect(PLAYER_X, py.current, PAD_W, PAD_H);
    ctx.fillStyle = C.red;
    ctx.fillRect(CPU_X, cy.current, PAD_W, PAD_H);
    // ball
    const b = ball.current;
    if (serveIn.current <= 0 || Math.floor(clock.current / 200) % 2 === 0) {
      ctx.fillStyle = C.bright;
      ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
    }
    // score
    drawGlyphText(ctx, String(you), W / 2 - 24, 8, 2, C.brand, "center");
    drawGlyphText(ctx, ":", W / 2, 8, 2, C.dim, "center");
    drawGlyphText(ctx, String(cpu), W / 2 + 24, 8, 2, C.red, "center");
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    const s = dt / 1000;
    clock.current += dt;
    input.drain(); // paddle uses held state only

    if (status !== "playing") {
      draw();
      return;
    }

    // player paddle: keyboard hold
    const sp = 200 * s;
    if (input.held.has("up")) py.current -= sp;
    if (input.held.has("down")) py.current += sp;
    py.current = Math.max(2, Math.min(H - PAD_H - 2, py.current));

    // serve countdown
    if (serveIn.current > 0) {
      serveIn.current -= dt;
    } else {
      const b = ball.current;
      b.x += b.vx * s;
      b.y += b.vy * s;
      if (b.y < 3) {
        b.y = 3;
        b.vy = Math.abs(b.vy);
        beep(330, 20);
      }
      if (b.y > H - 3) {
        b.y = H - 3;
        b.vy = -Math.abs(b.vy);
        beep(330, 20);
      }
      // player paddle collision
      if (
        b.vx < 0 &&
        b.x <= PLAYER_X + PAD_W + 2 &&
        b.x >= PLAYER_X - 2 &&
        b.y >= py.current - 3 &&
        b.y <= py.current + PAD_H + 3
      ) {
        const hit = (b.y - (py.current + PAD_H / 2)) / (PAD_H / 2);
        const speed = Math.min(300, Math.hypot(b.vx, b.vy) * 1.06 + 8);
        b.vx = Math.abs(Math.cos(hit * 0.9) * speed);
        b.vy = Math.sin(hit * 0.9) * speed;
        beep(440, 30);
      }
      // cpu paddle collision
      if (
        b.vx > 0 &&
        b.x >= CPU_X - 2 &&
        b.x <= CPU_X + PAD_W + 2 &&
        b.y >= cy.current - 3 &&
        b.y <= cy.current + PAD_H + 3
      ) {
        const hit = (b.y - (cy.current + PAD_H / 2)) / (PAD_H / 2);
        const speed = Math.min(300, Math.hypot(b.vx, b.vy) * 1.06 + 8);
        b.vx = -Math.abs(Math.cos(hit * 0.9) * speed);
        b.vy = Math.sin(hit * 0.9) * speed;
        beep(392, 30);
      }
      // goals
      if (b.x < 2) point(true);
      if (b.x > W - 2) point(false);
    }

    // cpu: max speed + dead zone = beatable but honest
    const target = serveIn.current > 0 ? H / 2 : ball.current.y;
    const center = cy.current + PAD_H / 2;
    const diff = target - center;
    const cpuSpeed = 95 * s;
    if (Math.abs(diff) > 5) cy.current += Math.sign(diff) * Math.min(cpuSpeed, Math.abs(diff));
    cy.current = Math.max(2, Math.min(H - PAD_H - 2, cy.current));

    draw();
  });



  useEffect(() => {
    draw();
     
  }, []);

  return (
    <GameShell
      slug="pong"
      title="PONG"
      status={status}
      scoreLabel="YOU"
      score={you}
      best={best}
      hint="drag / ←→ (↑↓ on desktop) · first to 7 wins"
      overlayNote={
        status === "ready"
          ? "beat the machine to 7 points"
          : status === "won"
            ? `you ${you} : ${cpu} — machine loses`
            : `you ${you} : ${cpu}`
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
        onPointerDown={(e) => {
          if (status !== "playing") return;
          py.current = pointerPos(e).y - PAD_H / 2;
        }}
        onPointerMove={(e) => {
          if (status !== "playing") return;
          py.current = pointerPos(e).y - PAD_H / 2;
        }}
      />
    </GameShell>
  );
}
