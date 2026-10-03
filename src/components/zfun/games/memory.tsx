"use client";

/** zFun · MEMORY — sixteen cards, eight pairs, fewer moves is the whole art. */

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

const COLS = 4;
const CELL = 46;
const GAP = 4;
const W = COLS * CELL + (COLS + 1) * GAP; // 200
const H = W;

interface Card {
  kind: number;
  state: 0 | 1 | 2; // hidden | revealed | matched
}

const KIND_COLORS = [
  C.red,
  C.orange,
  C.yellow,
  C.green,
  C.accent,
  "#f472b6",
  C.brand,
  "#a78bfa",
];

function drawSymbol(ctx: CanvasRenderingContext2D, kind: number, x: number, y: number) {
  ctx.fillStyle = KIND_COLORS[kind];
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  switch (kind) {
    case 0: // heart-ish
      ctx.fillRect(cx - 8, cy - 6, 6, 6);
      ctx.fillRect(cx + 2, cy - 6, 6, 6);
      ctx.fillRect(cx - 8, cy, 16, 4);
      ctx.fillRect(cx - 5, cy + 4, 10, 3);
      ctx.fillRect(cx - 2, cy + 7, 4, 2);
      break;
    case 1: // diamond
      for (let i = 0; i < 8; i++) {
        ctx.fillRect(cx - i, cy - 8 + i, i * 2, 2);
        ctx.fillRect(cx - i, cy + 8 - i, i * 2, 2);
      }
      break;
    case 2: // ring
      ctx.fillRect(cx - 8, cy - 4, 4, 8);
      ctx.fillRect(cx + 4, cy - 4, 4, 8);
      ctx.fillRect(cx - 4, cy - 8, 8, 4);
      ctx.fillRect(cx - 4, cy + 4, 8, 4);
      break;
    case 3: // cross
      ctx.fillRect(cx - 2, cy - 9, 4, 18);
      ctx.fillRect(cx - 9, cy - 2, 18, 4);
      break;
    case 4: // square in square
      ctx.fillRect(cx - 9, cy - 9, 18, 18);
      ctx.fillStyle = C.bg;
      ctx.fillRect(cx - 5, cy - 5, 10, 10);
      ctx.fillStyle = KIND_COLORS[kind];
      ctx.fillRect(cx - 2, cy - 2, 4, 4);
      break;
    case 5: // chevron
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(cx - 9 + i * 2, cy - 2 + i, 2, 2);
        ctx.fillRect(cx + 7 - i * 2, cy - 2 + i, 2, 2);
        ctx.fillRect(cx - 9 + i * 2, cy - i * 2 - 4, 2, 2);
        ctx.fillRect(cx + 7 - i * 2, cy - i * 2 - 4, 2, 2);
      }
      break;
    case 6: // steps
      for (let i = 0; i < 4; i++) ctx.fillRect(cx - 9, cy + 6 - i * 5, 6 + i * 5, 4);
      break;
    default: // dot cluster
      ctx.fillRect(cx - 7, cy - 7, 4, 4);
      ctx.fillRect(cx + 3, cy - 7, 4, 4);
      ctx.fillRect(cx - 7, cy + 3, 4, 4);
      ctx.fillRect(cx + 3, cy + 3, 4, 4);
      ctx.fillRect(cx - 2, cy - 2, 4, 4);
      break;
  }
}

function shuffled(): Card[] {
  const kinds = [...Array(8).keys(), ...Array(8).keys()];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  return kinds.map((kind) => ({ kind, state: 0 as 0 }));
}

export default function MemoryGame() {
  const [status, setStatus] = useState<GameStatus>("ready");
  const [moves, setMoves] = useState(0);
  const [best, submitBest] = useBest("memory", "min");
  const canvasRef: CanvasRef = useRef(null);

  const cards = useRef<Card[]>(shuffled());
  const open = useRef<number[]>([]);
  const flipBack = useRef(0);

  function reset() {
    cards.current = shuffled();
    open.current = [];
    flipBack.current = 0;
    setMoves(0);
    setStatus("playing");
  }

  const start = () => reset();

  function clickCell(idx: number) {
    if (status !== "playing" || flipBack.current > 0) return;
    const card = cards.current[idx];
    if (card.state !== 0 || open.current.length >= 2) return;
    card.state = 1;
    open.current.push(idx);
    beep(560, 30);
    if (open.current.length === 2) {
      setMoves((m) => m + 1);
      const [a, b] = open.current;
      if (cards.current[a].kind === cards.current[b].kind) {
        cards.current[a].state = 2;
        cards.current[b].state = 2;
        open.current = [];
        beep(760, 60);
        if (cards.current.every((c) => c.state === 2)) {
          beep(920, 200);
          setStatus("won");
          submitBest(moves + 1);
        }
      } else {
        flipBack.current = 650;
      }
    }
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    cards.current.forEach((card, i) => {
      const x = GAP + (i % COLS) * (CELL + GAP);
      const y = GAP + Math.floor(i / COLS) * (CELL + GAP);
      if (card.state === 0) {
        ctx.fillStyle = "#1c1c1f";
        ctx.fillRect(x, y, CELL, CELL);
        ctx.strokeStyle = C.frame;
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        // card back motif
        ctx.fillStyle = C.faint;
        ctx.fillRect(x + CELL / 2 - 5, y + CELL / 2 - 1, 10, 2);
        ctx.fillRect(x + CELL / 2 - 1, y + CELL / 2 - 5, 2, 10);
      } else {
        ctx.fillStyle = card.state === 2 ? "rgba(59,130,246,0.12)" : "#101012";
        ctx.fillRect(x, y, CELL, CELL);
        ctx.strokeStyle = card.state === 2 ? C.accent : C.dim;
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        drawSymbol(ctx, card.kind, x, y);
      }
    });
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    if (flipBack.current > 0) {
      flipBack.current -= dt;
      if (flipBack.current <= 0) {
        for (const i of open.current) cards.current[i].state = 0;
        open.current = [];
      }
    }
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  return (
    <GameShell
      slug="memory"
      title="MEMORY"
      status={status}
      scoreLabel="MOVES"
      score={moves}
      best={best}
      hint="tap / click two cards — match all eight pairs in as few moves as you can"
      overlayNote={
        status === "won"
          ? `cleared in ${moves} moves · best ${best === 0 ? moves : Math.min(best, moves)}`
          : status === "ready"
            ? "eight pairs, no timer, no mercy on your memory"
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
          const col = Math.floor(x / (CELL + GAP));
          const row = Math.floor(y / (CELL + GAP));
          const inX = x - col * (CELL + GAP) > GAP;
          const inY = y - row * (CELL + GAP) > GAP;
          if (col >= 0 && col < COLS && row >= 0 && row < COLS && inX && inY) {
            clickCell(row * COLS + col);
          }
        }}
      />
    </GameShell>
  );
}
