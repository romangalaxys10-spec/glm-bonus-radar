"use client";

/** zFun · XO — tic-tac-toe against a machine that reads every board. Draws are victories. */

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

const W = 180;
const H = 180;
const CELL = 56;
const OX = 6;
const OY = 6;

type Cell = "" | "X" | "O";

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function winner(b: Cell[]): Cell | "draw" | "" {
  for (const [a, c, d] of LINES) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  return b.every(Boolean) ? "draw" : "";
}

/** Minimax — the machine does not bluff and does not blunder. */
function minimax(b: Cell[], turn: Cell): { score: number; move: number } {
  const w = winner(b);
  if (w === "O") return { score: 10, move: -1 };
  if (w === "X") return { score: -10, move: -1 };
  if (w === "draw") return { score: 0, move: -1 };
  let bestScore = turn === "O" ? -Infinity : Infinity;
  let bestMove = -1;
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    b[i] = turn;
    const { score } = minimax(b, turn === "O" ? "X" : "O");
    b[i] = "";
    const s = score;
    if (turn === "O" ? s > bestScore : s < bestScore) {
      bestScore = s;
      bestMove = i;
    }
  }
  return { score: bestScore, move: bestMove };
}

export default function XoGame() {
  const [status, setStatus] = useState<GameStatus>("ready");
  const [streak, setStreak] = useState(0);
  const [best, submitBest] = useBest("xo");
  const canvasRef: CanvasRef = useRef(null);

  const board = useRef<Cell[]>(Array(9).fill(""));
  const cpuIn = useRef(0); // ms until the machine moves
  const drawReset = useRef(0);
  const flash = useRef<{ idx: number; t: number }[]>([]);

  function newBoard() {
    board.current = Array(9).fill("");
    cpuIn.current = 0;
    drawReset.current = 0;
  }

  function reset() {
    setStreak(0);
    newBoard();
    setStatus("playing");
  }

  const start = () => reset();

  function endRound(w: Cell | "draw" | "") {
    if (w === "O") {
      beep(110, 320, "square", 0.05);
      setStatus("over");
      submitBest(streak);
    } else if (w === "X") {
      // unreachable against perfect play — but honored if it happens
      beep(880, 240);
      setStatus("won");
      submitBest(streak + 1);
    } else {
      beep(560, 90);
      setStreak((s) => s + 1);
      flash.current = [];
      drawReset.current = 900;
    }
  }

  function play(idx: number) {
    if (status !== "playing" || board.current[idx]) return;
    board.current[idx] = "X";
    beep(500, 40);
    const w = winner(board.current);
    if (w) {
      endRound(w);
      return;
    }
    cpuIn.current = 420;
  }

  function drawX(x: number, y: number, pad: number, color: string) {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = color;
    for (let i = 0; i <= 10; i++) {
      ctx.fillRect(x + pad + i * 4, y + pad + i * 4, 5, 5);
      ctx.fillRect(x + CELL - pad - 5 - i * 4, y + pad + i * 4, 5, 5);
    }
  }

  function drawO(x: number, y: number, pad: number, color: string) {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = color;
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    const R = (CELL - pad * 2) / 2;
    for (let a = 0; a < 360; a += 6) {
      const rad = (a * Math.PI) / 180;
      ctx.fillRect(cx + Math.cos(rad) * R - 2, cy + Math.sin(rad) * R - 2, 4, 4);
    }
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.frame;
    for (let i = 1; i < 3; i++) {
      ctx.fillRect(OX + i * CELL - 1, OY, 2, CELL * 3);
      ctx.fillRect(OX, OY + i * CELL - 1, CELL * 3, 2);
    }
    board.current.forEach((v, i) => {
      const x = OX + (i % 3) * CELL;
      const y = OY + Math.floor(i / 3) * CELL;
      if (v === "X") drawX(x, y, 10, C.brand);
      if (v === "O") drawO(x, y, 10, C.red);
    });
    // last-move flash
    for (const f of flash.current) {
      const x = OX + (f.idx % 3) * CELL;
      const y = OY + Math.floor(f.idx / 3) * CELL;
      ctx.fillStyle = `rgba(250,204,21,${Math.max(0, f.t / 400)})`;
      ctx.fillRect(x, y, CELL, CELL);
    }
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    for (const f of flash.current) f.t -= dt;
    flash.current = flash.current.filter((f) => f.t > 0);
    if (status === "playing") {
      if (cpuIn.current > 0) {
        cpuIn.current -= dt;
        if (cpuIn.current <= 0) {
          const { move } = minimax([...board.current], "O");
          if (move >= 0) {
            board.current[move] = "O";
            flash.current.push({ idx: move, t: 400 });
            beep(360, 40);
            const w = winner(board.current);
            if (w) endRound(w);
          }
        }
      }
      if (drawReset.current > 0) {
        drawReset.current -= dt;
        if (drawReset.current <= 0) newBoard();
      }
    }
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  return (
    <GameShell
      slug="xo"
      title="XO"
      status={status}
      scoreLabel="STREAK"
      score={streak}
      best={best}
      hint="tap / click a square · the machine reads every branch — a draw is a win"
      overlayNote={
        status === "over"
          ? `the machine got you at streak ${streak} · best ${Math.max(best, streak)}`
          : status === "ready"
            ? "nobody has beaten it yet"
            : undefined
      }
      onStart={start}
      canvasMax={360}
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
          const col = Math.floor((x - OX) / CELL);
          const row = Math.floor((y - OY) / CELL);
          if (col >= 0 && col < 3 && row >= 0 && row < 3) play(row * 3 + col);
        }}
      />
    </GameShell>
  );
}
