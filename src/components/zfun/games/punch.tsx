"use client";

/** zFun · PUNCH — telegraph, dodge, counter. The machine gets faster every KO. */

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
const H = 150;

type Phase = "idle" | "windup" | "strike" | "recover";

export default function PunchGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [kos, setKos] = useState(0);
  const [best, submitBest] = useBest("punch");
  const canvasRef: CanvasRef = useRef(null);

  const youHp = useRef(3);
  const cpuHp = useRef(4);
  const phase = useRef<Phase>("idle");
  const phaseT = useRef(800);
  const level = useRef(1);
  const dodgeFlash = useRef(0);
  const hitFlash = useRef(0);
  const playerPunch = useRef(0);
  const cpuPunch = useRef(0);

  function nextOpponent() {
    youHp.current = 3;
    cpuHp.current = 4 + level.current;
    phase.current = "idle";
    phaseT.current = 700;
    playerPunch.current = 0;
    cpuPunch.current = 0;
  }

  function reset() {
    level.current = 1;
    setKos(0);
    nextOpponent();
    setStatus("playing");
  }

  const start = () => reset();

  function koWin() {
    setKos((v) => {
      const n = v + 1;
      submitBest(n);
      return n;
    });
    level.current += 1;
    beep(880, 240);
    nextOpponent();
  }

  function lose() {
    beep(100, 340, "square", 0.06);
    setStatus("over");
    submitBest(kos);
  }

  function punch() {
    if (status !== "playing" || playerPunch.current > 0) return;
    playerPunch.current = 220;
    if (phase.current === "recover") {
      cpuHp.current -= 1;
      hitFlash.current = 240;
      beep(700, 70);
      if (cpuHp.current <= 0) koWin();
    } else if (phase.current === "strike") {
      // traded — you still eat the hit
      beep(300, 60, "triangle", 0.03);
    } else {
      beep(320, 40, "triangle", 0.02); // blocked
    }
  }

  function drawBoxer(x: number, y: number, color: string, armExtend: number, armColor: string) {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = color;
    ctx.fillRect(x - 8, y - 18, 16, 30); // torso
    ctx.fillRect(x - 5, y - 30, 10, 12); // head
    ctx.fillStyle = C.bg;
    ctx.fillRect(x - 3, y - 27, 2, 2);
    ctx.fillRect(x + 2, y - 27, 2, 2);
    ctx.fillStyle = armColor;
    ctx.fillRect(x + (x < W / 2 ? 8 : -8 - armExtend), y - 12, armExtend, 6);
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // ring floor + ropes
    ctx.fillStyle = "#141416";
    ctx.fillRect(0, 108, W, H - 108);
    ctx.fillStyle = C.frame;
    ctx.fillRect(0, 60, W, 1);
    ctx.fillRect(0, 84, W, 1);
    // hp bars
    ctx.fillStyle = C.frame;
    ctx.fillRect(10, 10, 90, 8);
    ctx.fillRect(W - 100, 10, 90, 8);
    ctx.fillStyle = C.brand;
    ctx.fillRect(11, 11, Math.max(0, youHp.current) * 30, 6);
    ctx.fillStyle = C.red;
    ctx.fillRect(W - 99, 11, Math.max(0, cpuHp.current) * (90 / (4 + level.current)), 6);
    // dodge/telegraph cues
    const tele = phase.current === "windup";
    ctx.fillStyle = tele ? C.yellow : "rgba(0,0,0,0)";
    if (tele) {
      ctx.fillRect(W - 118, 24, 26, 4);
      ctx.fillRect(W - 118, 24, 4, 14);
      ctx.fillRect(W - 96, 24, 4, 14);
    }
    const dodge = input.held.has("left") || input.held.has("right");
    if (dodge && dodgeFlash.current > 0) {
      ctx.fillStyle = "rgba(59,130,246,0.25)";
      ctx.fillRect(40, 70, 60, 40);
    }
    if (hitFlash.current > 0) {
      ctx.fillStyle = `rgba(248,113,113,${Math.min(0.5, hitFlash.current / 400)})`;
      ctx.fillRect(W - 130, 60, 60, 48);
    }
    // boxers (player left, cpu right); duck when dodging
    const dy = dodge ? 6 : 0;
    drawBoxer(70, 100 + dy, C.brand, playerPunch.current > 0 ? 26 : 8, C.brand);
    drawBoxer(W - 70, 100, phase.current === "windup" ? C.orange : C.red, cpuPunch.current > 0 ? 26 : 8, C.red);
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    const edges = input.drain();
    if (status === "playing") {
      if (edges.includes("fire")) punch();
      if (dodgeFlash.current > 0) dodgeFlash.current -= dt;
      if (hitFlash.current > 0) hitFlash.current -= dt;
      if (playerPunch.current > 0) playerPunch.current -= dt;
      if (cpuPunch.current > 0) cpuPunch.current -= dt;

      phaseT.current -= dt;
      const dodge = input.held.has("left") || input.held.has("right");
      if (phaseT.current <= 0) {
        switch (phase.current) {
          case "idle":
            phase.current = "windup";
            phaseT.current = Math.max(260, 520 - level.current * 40);
            beep(420, 60, "triangle", 0.02);
            break;
          case "windup":
            phase.current = "strike";
            phaseT.current = 200;
            cpuPunch.current = 200;
            if (!dodge) {
              youHp.current -= 1;
              hitFlash.current = 200;
              beep(160, 140, "square", 0.05);
              if (youHp.current <= 0) lose();
            } else {
              dodgeFlash.current = 300;
              beep(500, 40);
            }
            break;
          case "strike":
            phase.current = "recover";
            phaseT.current = Math.max(420, 760 - level.current * 40);
            break;
          default:
            phase.current = "idle";
            phaseT.current = 500 + Math.random() * 700;
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
      slug="punch"
      title="PUNCH"
      status={status}
      scoreLabel="KOS"
      score={kos}
      best={best}
      hint="hold ← / → (or DODGE pads) when yellow telegraphs — strike with FIRE during recover"
      overlayNote={
        status === "over"
          ? `knocked out at ${kos} KO${kos === 1 ? "" : "s"} · best ${Math.max(best, kos)}`
          : status === "ready"
            ? "dodge on yellow, counter on the stumble"
            : undefined
      }
      onStart={start}
      pads={
        <>
          <Pad input={input} btn="left" label="DODGE ⟲" ariaLabel="Dodge left" />
          <Pad input={input} btn="fire" label="PUNCH" wide ariaLabel="Punch" />
          <Pad input={input} btn="right" label="⟳ DODGE" ariaLabel="Dodge right" />
        </>
      }
      canvasMax={480}
    >
      <canvas ref={canvasRef} width={W} height={H} style={PIXELATED} className="block w-full touch-none" />
    </GameShell>
  );
}
