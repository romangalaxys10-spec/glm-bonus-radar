"use client";

/** zFun · SLOTS — three reels, six symbols, credits that exist only in your browser. */

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

const W = 210;
const H = 150;
const REEL_W = 52;
const REEL_H = 52;
const REEL_Y = 44;

/* 8×8 symbol bitmaps: "1" = symbol color, "2" = white detail */
const CHERRY = ["00000000", "00011000", "01101010", "00110000", "11111000", "11111100", "11111000", "01110000"];
const LEMON = ["00011110", "00111111", "01111111", "11111111", "11111111", "11111110", "01111100", "00111000"];
const BELL = ["00001000", "00011100", "00111110", "01111111", "11111111", "11111111", "00011100", "00000000"];
const STAR = ["00001000", "00011000", "11111111", "01111110", "00111100", "01111110", "11000011", "00000000"];
const SEVEN = ["11111111", "11111111", "00011100", "00011100", "00111000", "00110000", "01110000", "01110000"];
const GEM = ["00011000", "00111100", "01111110", "11111111", "11111111", "01111110", "00111100", "00011000"];

const SYMBOLS = [
  { bmp: CHERRY, color: C.red, pay: 6 },
  { bmp: LEMON, color: C.yellow, pay: 8 },
  { bmp: BELL, color: C.orange, pay: 12 },
  { bmp: GEM, color: C.brand, pay: 15 },
  { bmp: STAR, color: C.green, pay: 25 },
  { bmp: SEVEN, color: C.bright, pay: 40 },
];

const START_CREDITS = 20;

export default function SlotsGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [credits, setCredits] = useState(START_CREDITS);
  const [best, submitBest] = useBest("slots");
  const canvasRef: CanvasRef = useRef(null);

  const stopped = useRef([0, 1, 2]); // final symbol index per reel
  const spinning = useRef([false, false, false]);
  const spinT = useRef([0, 0, 0]); // remaining spin time per reel
  const offsets = useRef([0, 0, 0]); // scroll offsets for animation
  const lastMsg = useRef("");

  function reset() {
    setCredits(START_CREDITS);
    stopped.current = [0, 1, 2];
    spinning.current = [false, false, false];
    lastMsg.current = "";
    setStatus("playing");
  }

  const start = () => reset();

  function spin() {
    if (status !== "playing") return;
    if (credits < 1) return;
    setCredits((v) => v - 1);
    lastMsg.current = "";
    for (let i = 0; i < 3; i++) {
      spinning.current[i] = true;
      spinT.current[i] = 650 + i * 380;
      stopped.current[i] = Math.floor(Math.random() * 6);
      offsets.current[i] = Math.random() * 6;
    }
    beep(400, 30, "triangle", 0.03);
  }

  function settle() {
    const [a, b, c] = stopped.current;
    if (a === b && b === c) {
      const pay = SYMBOLS[a].pay;
      setCredits((v) => v + pay);
      lastMsg.current = `triple! +${pay}`;
      beep(880, 180);
    } else if (a === b || b === c || a === c) {
      setCredits((v) => v + 2);
      lastMsg.current = "pair +2";
      beep(620, 90);
    } else {
      lastMsg.current = "no luck";
      beep(200, 60, "triangle", 0.02);
    }
  }

  function drawSymbol(ctx: CanvasRenderingContext2D, idx: number, x: number, y: number) {
    const s = SYMBOLS[((idx % 6) + 6) % 6];
    drawBitmap(ctx, s.bmp, x + (REEL_W - 16) / 2, y + (REEL_H - 16) / 2, 2, s.color);
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // cabinet
    for (let i = 0; i < 3; i++) {
      const x = (W - 3 * REEL_W - 4 * 6) / 2 + 6 + i * (REEL_W + 6);
      ctx.fillStyle = "#141416";
      ctx.fillRect(x - 2, REEL_Y - 2, REEL_W + 4, REEL_H + 4);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, REEL_Y, REEL_W, REEL_H);
      ctx.clip();
      ctx.fillStyle = "#0d0d0e";
      ctx.fillRect(x, REEL_Y, REEL_W, REEL_H);
      if (spinning.current[i]) {
        // blur-scroll symbols
        const off = offsets.current[i];
        for (let k = -1; k < 2; k++) {
          const sy = REEL_Y + ((off + k) % 6) * (REEL_H / 2) - REEL_H / 2;
          drawSymbol(ctx, stopped.current[i] + k + (i % 2), x, sy);
        }
      } else {
        drawSymbol(ctx, stopped.current[i], x, REEL_Y);
      }
      ctx.restore();
      ctx.strokeStyle = i === 1 ? C.accent : C.frame;
      ctx.strokeRect(x - 0.5, REEL_Y - 0.5, REEL_W + 1, REEL_H + 1);
    }
    // payout line
    ctx.fillStyle = C.faint;
    ctx.fillRect(W / 2 - 40, REEL_Y + REEL_H / 2 - 1, 80, 2);
    // message + paytable hints
    ctx.fillStyle = C.dim;
    ctx.fillRect(W / 2 - 30, H - 22, 60, 12);
    ctx.fillStyle = C.bg;
    if (lastMsg.current === "no luck") {
      ctx.fillRect(W / 2 - 8, H - 19, 4, 4);
      ctx.fillRect(W / 2 + 4, H - 19, 4, 4);
      ctx.fillRect(W / 2 - 2, H - 14, 4, 4);
    }
    // credit pips
    ctx.fillStyle = C.yellow;
    for (let i = 0; i < Math.min(credits, 20); i++) {
      ctx.fillRect(8 + (i % 10) * 7, H - 12 - Math.floor(i / 10) * 8, 4, 4);
    }
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    const edges = input.drain();
    if (status === "playing" && edges.includes("fire")) spin();
    if (status === "playing") {
      for (let i = 0; i < 3; i++) {
        if (!spinning.current[i]) continue;
        spinT.current[i] -= dt;
        offsets.current[i] += dt * 0.02;
        if (spinT.current[i] <= 0) {
          spinning.current[i] = false;
          beep(500 + i * 90, 40);
          if (!spinning.current.some(Boolean)) settle();
        }
      }
      // bust check — runs after the reels settle with zero credits
      if (credits <= 0 && !spinning.current.some(Boolean) && lastMsg.current !== "") {
        beep(120, 300, "triangle", 0.05);
        setStatus("over");
      }
    }
    draw();
  });

  useEffect(() => {
    if (credits > 0) submitBest(credits);
  }, [credits, submitBest]);

  useEffect(() => {
    draw();
  }, []);

  return (
    <GameShell
      slug="slots"
      title="SLOTS"
      status={status}
      scoreLabel="CREDITS"
      score={credits}
      best={best}
      hint="tap the reels or press FIRE to spin — 1 credit a pull, triple pays 6–40"
      overlayNote={
        status === "over"
          ? "busted. the house always wins — press play to refill 20 credits"
          : status === "ready"
            ? "20 credits, pure luck, zero real money"
            : undefined
      }
      onStart={start}
      pads={
        <>
          <Pad input={input} btn="fire" label="SPIN" wide ariaLabel="Spin reels" />
        </>
      }
      canvasMax={420}
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={PIXELATED}
        className="block w-full touch-none"
        onPointerDown={(e) => {
          e.preventDefault();
          spin();
        }}
      />
    </GameShell>
  );
}
