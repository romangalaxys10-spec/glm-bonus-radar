"use client";

/** zFun · STACKER — stop the slider on the stack. Miss by one cell, lose a row's worth. */

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

const COLS = 7;
const ROWS_N = 12;
const CELL = 20;
const W = COLS * CELL + 40; // 180
const H = ROWS_N * CELL + 40; // 280
const OX = 20;
const OY = 28;

export default function StackerGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("stacker");
  const canvasRef: CanvasRef = useRef(null);

  const stack = useRef<{ row: number; cols: number[] }[]>([]);
  const curRow = useRef(0);
  const curCols = useRef<number[]>([2, 3, 4]);
  const pos = useRef(0); // left edge of slider in cell units (float)
  const dir = useRef(1);
  const speed = useRef(1.35); // cells per frame-ish (per 16ms)
  const moving = useRef(false);

  function reset() {
    stack.current = [];
    curRow.current = 0;
    curCols.current = [2, 3, 4];
    pos.current = 0;
    dir.current = 1;
    speed.current = 1.35;
    moving.current = true;
    setScore(0);
    setStatus("playing");
  }

  const start = () => reset();

  function lockIn() {
    const row = curRow.current;
    const prev = stack.current.length ? stack.current[stack.current.length - 1].cols : null;
    let keep = curCols.current;
    if (prev) {
      keep = curCols.current.filter((c) => prev.includes(c));
    }
    if (keep.length === 0) {
      beep(90, 300, "sawtooth", 0.06);
      setStatus("over");
      submitBest(score);
      return;
    }
    stack.current.push({ row, cols: keep });
    setScore((v) => v + 10);
    beep(500 + row * 30, 45);
    curRow.current += 1;
    if (curRow.current >= ROWS_N) {
      beep(880, 260);
      setStatus("won");
      submitBest(score + 10);
      moving.current = false;
      return;
    }
    // next slider width shrinks on the second half of the tower
    const width = row >= 5 ? Math.min(keep.length, 2) : Math.min(keep.length + 1, 3);
    const startCol = Math.floor(Math.random() * (COLS - width));
    curCols.current = Array.from({ length: width }, (_, i) => startCol + i);
    pos.current = startCol;
    dir.current = 1;
    speed.current = 1.35 + row * 0.16;
    moving.current = true;
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // prize zone
    ctx.fillStyle = "rgba(250,204,21,0.12)";
    ctx.fillRect(OX, OY, COLS * CELL, CELL);
    ctx.fillStyle = C.yellow;
    ctx.fillRect(OX, OY, 6, CELL);
    ctx.fillRect(OX + COLS * CELL - 6, OY, 6, CELL);
    // grid frame
    ctx.strokeStyle = C.grid;
    for (let r = 0; r < ROWS_N; r++) {
      ctx.strokeRect(OX + 0.5, OY + r * CELL + 0.5, COLS * CELL - 1, CELL - 1);
    }
    // stacked rows
    for (const s of stack.current) {
      for (const c of s.cols) {
        const y = OY + (ROWS_N - 1 - s.row) * CELL;
        ctx.fillStyle = C.accent;
        ctx.fillRect(OX + c * CELL + 1, y + 1, CELL - 2, CELL - 2);
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.fillRect(OX + c * CELL + 1, y + 1, CELL - 2, 3);
      }
    }
    // moving slider
    if (status === "playing" && curRow.current < ROWS_N) {
      const y = OY + (ROWS_N - 1 - curRow.current) * CELL;
      for (const c of curCols.current) {
        ctx.fillStyle = C.brand;
        ctx.fillRect(OX + c * CELL + 1, y + 1, CELL - 2, CELL - 2);
      }
      ctx.fillStyle = C.bright;
      ctx.fillRect(OX + curCols.current[0] * CELL + 1, y + 1, 3, CELL - 2);
    }
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    const edges = input.drain();
    if (status === "playing") {
      if (edges.includes("fire")) {
        moving.current = false;
        lockIn();
      } else if (moving.current) {
        pos.current += dir.current * speed.current * (dt / 16.7);
        const width = curCols.current.length;
        if (pos.current <= 0) {
          pos.current = 0;
          dir.current = 1;
        }
        if (pos.current >= COLS - width) {
          pos.current = COLS - width;
          dir.current = -1;
        }
        curCols.current = Array.from({ length: width }, (_, i) => Math.round(pos.current) + i);
      }
    }
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  return (
    <GameShell
      slug="stacker"
      title="STACKER"
      status={status}
      scoreLabel="HEIGHT"
      score={score}
      best={best}
      hint="tap / space locks the slider — overlap keeps you alive, a full miss ends it"
      overlayNote={
        status === "won"
          ? "major prize! the tower touches the top"
          : status === "over"
            ? `height ${score} · best ${Math.max(best, score)}`
            : "reach the yellow zone at the top"
      }
      onStart={start}
      pads={
        <>
          <Pad input={input} btn="fire" label="LOCK" wide ariaLabel="Lock slider" />
        </>
      }
      canvasMax={Math.min(420, H)}
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={PIXELATED}
        className="block w-full touch-none"
        onPointerDown={(e) => {
          e.preventDefault();
          if (status === "playing") {
            input.press("fire", true);
            input.press("fire", false);
          }
        }}
      />
    </GameShell>
  );
}
