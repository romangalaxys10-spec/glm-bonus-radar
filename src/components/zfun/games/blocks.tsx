"use client";

/**
 * zFun · BLOCKS — falling tetromino stacker.
 * 7 pieces, rotation with wall kicks, soft/hard drop, line-clear scoring,
 * level gravity curve, landing ghost, next-piece panel.
 */

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

const COLS = 10;
const ROWS = 18;
const CELL = 14;
const PLAY_W = COLS * CELL; // 140
const SIDE_W = 52; // next-piece panel
const W = PLAY_W + SIDE_W; // 192
const H = ROWS * CELL; // 252

// Piece shapes as matrices (1 = filled). Rotation = matrix rotate.
const PIECES: { m: number[][]; color: string }[] = [
  { m: [[1, 1, 1, 1]], color: C.brand }, // I
  {
    m: [
      [1, 0, 0],
      [1, 1, 1],
    ],
    color: C.brand, // J
  },
  {
    m: [
      [0, 0, 1],
      [1, 1, 1],
    ],
    color: C.orange, // L
  },
  {
    m: [
      [1, 1],
      [1, 1],
    ],
    color: C.yellow, // O
  },
  {
    m: [
      [0, 1, 1],
      [1, 1, 0],
    ],
    color: C.green, // S
  },
  {
    m: [
      [0, 1, 0],
      [1, 1, 1],
    ],
    color: C.accent, // T
  },
  {
    m: [
      [1, 1, 0],
      [0, 1, 1],
    ],
    color: C.red, // Z
  },
];

function rotate(m: number[][]): number[][] {
  const rows = m.length;
  const cols = m[0].length;
  const out: number[][] = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[c][rows - 1 - r] = m[r][c];
  return out;
}

interface Piece {
  m: number[][];
  color: string;
  x: number;
  y: number;
}

function newPiece(): Piece {
  const p = PIECES[Math.floor(Math.random() * PIECES.length)];
  return {
    m: p.m.map((r) => [...r]),
    color: p.color,
    x: Math.floor((COLS - p.m[0].length) / 2),
    y: 0,
  };
}

const LINE_SCORES = [0, 100, 300, 500, 800];

export default function BlocksGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [lines, setLines] = useState(0);
  const [best, submitBest] = useBest("blocks");
  const canvasRef: CanvasRef = useRef(null);

  const grid = useRef<number[][]>(Array.from({ length: ROWS }, () => Array(COLS).fill(0)));
  const piece = useRef<Piece>(newPiece());
  const next = useRef<Piece>(newPiece());
  const acc = useRef(0);
  const softAcc = useRef(0);
  const moveAcc = useRef(0);

  const level = 1 + Math.floor(lines / 10);
  const fallMs = Math.max(120, 620 - (level - 1) * 55);

  function collides(m: number[][], px: number, py: number): boolean {
    for (let r = 0; r < m.length; r++)
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const x = px + c;
        const y = py + r;
        if (x < 0 || x >= COLS || y >= ROWS) return true;
        if (y >= 0 && grid.current[y][x]) return true;
      }
    return false;
  }

  function over() {
    beep(110, 280, "square", 0.05);
    setStatus("over");
  }

  function reset() {
    grid.current = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    piece.current = newPiece();
    next.current = newPiece();
    acc.current = 0;
    softAcc.current = 0;
    setScore(0);
    setLines(0);
    setStatus("playing");
  }

  const start = () => reset();

  function tryMove(dx: number) {
    const p = piece.current;
    if (!collides(p.m, p.x + dx, p.y)) p.x += dx;
  }

  function tryRotate() {
    const p = piece.current;
    const rm = rotate(p.m);
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!collides(rm, p.x + kick, p.y)) {
        p.m = rm;
        p.x += kick;
        beep(440, 30);
        return;
      }
    }
  }

  function lock() {
    const p = piece.current;
    for (let r = 0; r < p.m.length; r++)
      for (let c = 0; c < p.m[r].length; c++)
        if (p.m[r][c]) {
          const y = p.y + r;
          const x = p.x + c;
          if (y < 0) return over();
          grid.current[y][x] = 1;
        }
    // clear completed lines
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (grid.current[y].every(Boolean)) {
        grid.current.splice(y, 1);
        grid.current.unshift(Array(COLS).fill(0));
        cleared++;
        y++;
      }
    }
    if (cleared) {
      setScore((s) => s + LINE_SCORES[cleared] * level);
      setLines((l) => l + cleared);
      beep(660, 60);
      beep(880, 60);
    }
    piece.current = next.current;
    next.current = newPiece();
    if (collides(piece.current.m, piece.current.x, piece.current.y)) over();
  }

  function hardDrop() {
    const p = piece.current;
    let cells = 0;
    while (!collides(p.m, p.x, p.y + 1)) {
      p.y++;
      cells++;
    }
    setScore((s) => s + cells * 2);
    beep(220, 40);
    lock();
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // checker playfield
    ctx.fillStyle = C.grid;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if ((x + y) % 2 === 0) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    // settled cells
    ctx.fillStyle = C.ink;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (grid.current[y]?.[x]) ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
    // active piece + landing ghost
    if (status === "playing") {
      const p = piece.current;
      let gy = p.y;
      while (!collides(p.m, p.x, gy + 1)) gy++;
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      for (let r = 0; r < p.m.length; r++)
        for (let c = 0; c < p.m[r].length; c++)
          if (p.m[r][c] && gy + r >= 0)
            ctx.fillRect((p.x + c) * CELL + 2, (gy + r) * CELL + 2, CELL - 4, CELL - 4);
      ctx.fillStyle = p.color;
      for (let r = 0; r < p.m.length; r++)
        for (let c = 0; c < p.m[r].length; c++)
          if (p.m[r][c] && p.y + r >= 0)
            ctx.fillRect((p.x + c) * CELL + 1, (p.y + r) * CELL + 1, CELL - 2, CELL - 2);
    }
    // next panel
    const nx = PLAY_W + 6;
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(nx + 0.5, 4.5, SIDE_W - 12, 40);
    const nm = next.current.m;
    const ox = nx + Math.floor((SIDE_W - 12 - nm[0].length * CELL) / 2);
    const oy = 4 + Math.floor((40 - nm.length * CELL) / 2);
    ctx.fillStyle = next.current.color;
    for (let r = 0; r < nm.length; r++)
      for (let c = 0; c < nm[r].length; c++)
        if (nm[r][c]) ctx.fillRect(ox + c * CELL + 1, oy + r * CELL + 1, CELL - 2, CELL - 2);
    // playfield frame
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, PLAY_W - 1, H - 1);
  }

  useLoop((dt) => {
    if (status !== "playing" || !grid.current.length) return draw();

    const edges = input.drain();
    for (const e of edges) {
      if (e === "left") tryMove(-1);
      if (e === "right") tryMove(1);
      if (e === "action" || e === "up") tryRotate();
      if (e === "fire") hardDrop();
    }

    // held left/right: delayed auto-repeat
    moveAcc.current += dt;
    const holdDir = input.held.has("left") ? -1 : input.held.has("right") ? 1 : 0;
    if (holdDir !== 0 && moveAcc.current > 140) {
      moveAcc.current = 90; // faster repeats after the initial delay
      tryMove(holdDir);
    } else if (holdDir === 0) {
      moveAcc.current = 0;
    }

    // soft drop
    softAcc.current += dt;
    if (input.held.has("down") && softAcc.current > 40) {
      softAcc.current = 0;
      if (!collides(piece.current.m, piece.current.x, piece.current.y + 1)) {
        piece.current.y++;
        setScore((s) => s + 1);
      }
    }

    // gravity
    acc.current += dt;
    while (acc.current >= fallMs) {
      acc.current -= fallMs;
      if (!collides(piece.current.m, piece.current.x, piece.current.y + 1)) piece.current.y++;
      else {
        beep(180, 35);
        lock();
        break;
      }
    }
    draw();
  });



  useEffect(() => {
    draw();
     
  }, []);

  // submit best when a run ends
  useEffect(() => {
    if (status === "over") submitBest(score);
     
  }, [status]);

  return (
    <GameShell
      slug="blocks"
      title="BLOCKS"
      status={status}
      scoreLabel="PTS"
      score={score}
      best={best}
      hint="←→ move · ↑/K rotate · ↓ soft drop · space hard drop"
      overlayNote={
        status === "over"
          ? `score ${score} · ${lines} lines · level ${level}`
          : `level ${level} · ${lines} lines`
      }
      onStart={start}
      pads={
        <>
          <Pad input={input} btn="left" label="←" ariaLabel="Move left" />
          <Pad input={input} btn="action" label="↻" ariaLabel="Rotate" />
          <Pad input={input} btn="right" label="→" ariaLabel="Move right" />
          <Pad input={input} btn="down" label="↓" ariaLabel="Soft drop" />
          <Pad input={input} btn="fire" label="DROP" wide ariaLabel="Hard drop" />
        </>
      }
      canvasMax={280}
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={PIXELATED}
        className="mx-auto block w-full touch-none"
      />
    </GameShell>
  );
}
