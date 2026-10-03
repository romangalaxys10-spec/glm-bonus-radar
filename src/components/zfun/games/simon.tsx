"use client";

/** zFun · SIMON — watch the colors sing, repeat the song. */

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
const H = 200;
const Q = 94; // quadrant size
const GAP = (W - Q * 2) / 3; // 4

const PADS = [
  { color: "#4ade80", dim: "#14532d", tone: 261.63 }, // green  — top-left
  { color: "#f87171", dim: "#7f1d1d", tone: 329.63 }, // red    — top-right
  { color: "#facc15", dim: "#713f12", tone: 392.0 }, // yellow — bottom-left
  { color: "#3b82f6", dim: "#1e3a8a", tone: 523.25 }, // blue   — bottom-right
];

export default function SimonGame() {
  const [status, setStatus] = useState<GameStatus>("ready");
  const [round, setRound] = useState(0);
  const [best, submitBest] = useBest("simon");
  const canvasRef: CanvasRef = useRef(null);

  const seq = useRef<number[]>([]);
  const phase = useRef<"show" | "input">("show");
  const showIdx = useRef(0);
  const showTimer = useRef(0);
  const litPad = useRef(-1);
  const litTimer = useRef(0);
  const inputIdx = useRef(0);
  const showEvery = useRef(420);

  function reset() {
    seq.current = [];
    phase.current = "show";
    showIdx.current = 0;
    showTimer.current = 400;
    litPad.current = -1;
    inputIdx.current = 0;
    showEvery.current = 420;
    setRound(0);
    setStatus("playing");
  }

  const start = () => reset();

  function nextRound() {
    seq.current.push(Math.floor(Math.random() * 4));
    setRound(seq.current.length);
    phase.current = "show";
    showIdx.current = 0;
    showTimer.current = 500;
    showEvery.current = Math.max(240, 440 - seq.current.length * 12);
  }

  function lightPad(p: number, dur = 220) {
    litPad.current = p;
    litTimer.current = dur;
    beep(PADS[p].tone, dur, "square", 0.05);
  }

  function fail() {
    beep(90, 400, "sawtooth", 0.06);
    setStatus("over");
    submitBest(seq.current.length - 1);
  }

  function tap(p: number) {
    if (status !== "playing" || phase.current !== "input") return;
    lightPad(p, 180);
    if (seq.current[inputIdx.current] === p) {
      inputIdx.current++;
      if (inputIdx.current >= seq.current.length) {
        phase.current = "show";
        showTimer.current = 700;
        showIdx.current = 0;
      }
    } else fail();
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    const pos: [number, number][] = [
      [GAP, GAP],
      [GAP * 2 + Q, GAP],
      [GAP, GAP * 2 + Q],
      [GAP * 2 + Q, GAP * 2 + Q],
    ];
    // show phase hint: pads pulse between shows
    const waiting = status === "playing" && phase.current === "show" && litPad.current === -1;
    for (let p = 0; p < 4; p++) {
      const [x, y] = pos[p];
      const lit = litPad.current === p;
      ctx.fillStyle = lit ? PADS[p].color : PADS[p].dim;
      if (waiting && Math.floor(Date.now() / 500) % 2 === 0) {
        ctx.globalAlpha = 0.8;
      }
      ctx.fillRect(x, y, Q, Q);
      ctx.globalAlpha = 1;
      // center marker when lit
      if (lit) {
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillRect(x + Q / 2 - 4, y + Q / 2 - 4, 8, 8);
      }
      ctx.strokeStyle = lit ? "rgba(255,255,255,0.6)" : C.frame;
      ctx.strokeRect(x + 0.5, y + 0.5, Q - 1, Q - 1);
    }
    // phase line
    ctx.fillStyle = status === "playing" ? (phase.current === "input" ? C.bright : C.dim) : C.faint;
    ctx.fillRect(W / 2 - 12, H / 2 - 1, 24, 2);
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    if (status === "playing") {
      litTimer.current -= dt;
      if (litTimer.current <= 0) litPad.current = -1;

      if (phase.current === "show") {
        showTimer.current -= dt;
        if (showTimer.current <= 0) {
          if (showIdx.current < seq.current.length) {
            lightPad(seq.current[showIdx.current]);
            showIdx.current++;
            showTimer.current = showEvery.current;
          } else {
            phase.current = "input";
            inputIdx.current = 0;
          }
        }
      }
    }
    draw();
  });



  useEffect(() => {
    draw();
     
  }, []);

  function tapFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    let p = -1;
    if (x < W / 2 && y < H / 2) p = 0;
    else if (x >= W / 2 && y < H / 2) p = 1;
    else if (x < W / 2 && y >= H / 2) p = 2;
    else p = 3;
    tap(p);
  }

  return (
    <GameShell
      slug="simon"
      title="SIMON"
      status={status}
      scoreLabel="ROUND"
      score={round}
      best={best}
      hint="watch the sequence, then tap the pads back in order"
      overlayNote={
        status === "over"
          ? `reached round ${round} · best ${Math.max(best, round)}`
          : status === "ready"
            ? "four tones, one song"
            : undefined
      }
      onStart={start}
      canvasMax={340}
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={PIXELATED}
        className="block w-full touch-none"
        onPointerDown={(e) => {
          e.preventDefault();
          tapFromEvent(e);
        }}
      />
    </GameShell>
  );
}
