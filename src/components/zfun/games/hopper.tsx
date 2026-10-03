"use client";

/** zFun · HOPPER — cross the road, ride the river, fill every lily slot. */

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
  pointerPos,
  useBest,
  useInput,
  useLoop,
} from "../engine";

const COLS = 9;
const ROWS = 12;
const CELL = 20;
const W = COLS * CELL; // 180
const H = ROWS * CELL; // 240

interface Row {
  kind: "goal" | "river" | "safe" | "road";
  dir: 1 | -1;
  speed: number;
  items: { x: number; len: number }[];
}

interface Pt {
  x: number;
  y: number;
}

function buildRows(level: number): Row[] {
  const rows: Row[] = [];
  for (let r = 0; r < ROWS; r++) {
    const kind: Row["kind"] =
      r === 0 ? "goal" : r <= 5 ? "river" : r === 6 ? "safe" : r === 11 ? "safe" : "road";
    const dir: 1 | -1 = r % 2 === 0 ? -1 : 1;
    const speed = ((r % 3) + 1.6) * (13 + level * 2.5);
    const items: { x: number; len: number }[] = [];
    if (kind === "road") {
      const len = 1 + (r % 2);
      for (let i = 0; i < 3; i++) items.push({ x: i * (W / 3) + r * 7, len: len * CELL });
    }
    if (kind === "river") {
      const len = r <= 2 ? 3 : 2;
      for (let i = 0; i < 3; i++) items.push({ x: i * (W / 3) + r * 11, len: len * CELL });
    }
    rows.push({ kind, dir, speed, items });
  }
  return rows;
}

export default function HopperGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("hopper");
  const canvasRef: CanvasRef = useRef(null);

  const rows = useRef<Row[]>(buildRows(1));
  const pos = useRef<Pt>({ x: 4, y: 11 });
  const slots = useRef<boolean[]>([false, false, false, false, false]); // cols 0,2,4,6,8
  const level = useRef(1);
  const lives = useRef(3);
  const clock = useRef(0);
  const hopT = useRef(0);
  const from = useRef<Pt>({ x: 4, y: 11 });

  function resetPlayer() {
    pos.current = { x: 4, y: 11 };
    from.current = { x: 4, y: 11 };
    hopT.current = 0;
  }

  function reset() {
    rows.current = buildRows(1);
    slots.current = [false, false, false, false, false];
    level.current = 1;
    lives.current = 3;
    setScore(0);
    setStatus("playing");
    resetPlayer();
  }

  const start = () => reset();

  function die() {
    lives.current -= 1;
    beep(110, 250, "square", 0.05);
    if (lives.current <= 0) {
      setStatus("over");
      submitBest(score);
    } else resetPlayer();
  }

  function hop(dx: number, dy: number) {
    if (hopT.current > 0) return;
    const p = pos.current;
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (ny < 0 || ny > 11) return;
    if (nx < 0 || nx > COLS - 1) return;
    if (ny === 0) {
      // goal row: only even cols are lily slots
      if (nx % 2 !== 0) {
        beep(160, 80);
        return;
      }
      const slot = nx / 2;
      if (slots.current[slot]) {
        beep(160, 80);
        return;
      }
      slots.current[slot] = true;
      setScore((s) => s + 50);
      beep(660, 80);
      if (slots.current.every(Boolean)) {
        setScore((s) => s + 200);
        level.current += 1;
        rows.current = buildRows(level.current);
        slots.current = [false, false, false, false, false];
        beep(880, 160);
      }
      resetPlayer();
      return;
    }
    from.current = { ...p };
    pos.current = { x: nx, y: ny };
    hopT.current = 90;
    beep(440, 25);
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < ROWS; r++) {
      const row = rows.current[r];
      const y = r * CELL;
      if (row.kind === "river") {
        ctx.fillStyle = "rgba(59,130,246,0.16)";
        ctx.fillRect(0, y, W, CELL);
      }
      if (row.kind === "road") {
        ctx.fillStyle = "#141416";
        ctx.fillRect(0, y, W, CELL);
      }
      if (row.kind === "goal") {
        ctx.fillStyle = "#0e1f12";
        ctx.fillRect(0, y, W, CELL);
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = slots.current[i] ? C.brand : C.frame;
          ctx.fillRect(i * 2 * CELL + 5, y + 5, CELL - 10, CELL - 10);
        }
      }
      for (const it of row.items) {
        const x = it.x;
        if (row.kind === "road") {
          ctx.fillStyle = r % 2 ? C.red : C.yellow;
          ctx.fillRect(x + 2, y + 5, it.len - 4, CELL - 10);
          ctx.fillStyle = C.bg;
          ctx.fillRect(x + 5, y + 7, it.len - 10, 4);
        }
        if (row.kind === "river") {
          ctx.fillStyle = "#9a6b3f";
          ctx.fillRect(x, y + 4, it.len, CELL - 8);
          ctx.fillStyle = "#b98a58";
          ctx.fillRect(x + 2, y + 6, it.len - 4, 3);
        }
      }
    }
    // player (interpolated hop)
    const t = 1 - hopT.current / 90;
    const px = (from.current.x + (pos.current.x - from.current.x) * t) * CELL;
    const py = (from.current.y + (pos.current.y - from.current.y) * t) * CELL;
    const lift = hopT.current > 0 ? -3 : 0;
    ctx.fillStyle = C.green;
    ctx.fillRect(px + 4, py + 6 + lift, CELL - 8, CELL - 10);
    ctx.fillStyle = C.bright;
    ctx.fillRect(px + 6, py + 8 + lift, 3, 3);
    ctx.fillRect(px + CELL - 9, py + 8 + lift, 3, 3);
    // lives
    for (let i = 0; i < lives.current; i++) {
      ctx.fillStyle = C.green;
      ctx.fillRect(5 + i * 9, H - 7, 5, 5);
    }
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    clock.current += dt;
    const edges = input.drain();
    if (status === "playing") {
      for (const e of edges) {
        if (e === "up") hop(0, -1);
        if (e === "down") hop(0, 1);
        if (e === "left") hop(-1, 0);
        if (e === "right") hop(1, 0);
      }
      if (hopT.current > 0) hopT.current -= dt;

      // move lanes
      for (const row of rows.current) {
        for (const it of row.items) {
          it.x += row.dir * row.speed * (dt / 1000);
          if (row.dir > 0 && it.x > W) it.x -= W + it.len;
          if (row.dir < 0 && it.x + it.len < 0) it.x += W + it.len;
        }
      }

      const p = pos.current;
      if (hopT.current <= 0 && p.y > 0) {
        const row = rows.current[p.y];
        const px = p.x * CELL;
        if (row.kind === "road") {
          for (const it of row.items) {
            if (px + 3 < it.x + it.len && px + CELL - 3 > it.x) return die();
          }
        }
        if (row.kind === "river") {
          let onLog = false;
          for (const it of row.items) {
            if (px + 2 < it.x + it.len && px + CELL - 2 > it.x) onLog = true;
          }
          if (!onLog) return die();
        }
        // log drift
        if (row.kind === "river") {
          const drift = (row.dir * row.speed * dt) / 1000;
          const cur = p.x * CELL + drift;
          const next = Math.round(cur / CELL);
          const row2 = rows.current[p.y];
          let still = false;
          for (const it of row2.items) {
            if (cur + 2 < it.x + it.len && cur + CELL - 2 > it.x) still = true;
          }
          if (!still || next < 0 || next > COLS - 1) return die();
          p.x = next;
          from.current.x = next;
        }
      }
    }
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  const swipe = useRef<Pt | null>(null);
  return (
    <GameShell
      slug="hopper"
      title="HOPPER"
      status={status}
      scoreLabel="PTS"
      score={score}
      best={best}
      hint="arrows / WASD hop · swipe on the canvas on mobile"
      overlayNote={status === "over" ? `score ${score} · best ${Math.max(best, score)}` : undefined}
      onStart={start}
      pads={
        <>
          <div className="flex flex-col items-center gap-2">
            <Pad input={input} btn="up" label="↑" ariaLabel="Hop up" />
            <div className="flex gap-2">
              <Pad input={input} btn="left" label="←" ariaLabel="Hop left" />
              <Pad input={input} btn="down" label="↓" ariaLabel="Hop down" />
              <Pad input={input} btn="right" label="→" ariaLabel="Hop right" />
            </div>
          </div>
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
          swipe.current = pointerPos(e);
        }}
        onPointerMove={(e) => {
          if (!swipe.current || status !== "playing") return;
          const p = pointerPos(e);
          const dx = p.x - swipe.current.x;
          const dy = p.y - swipe.current.y;
          if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
          if (Math.abs(dx) > Math.abs(dy)) hop(dx > 0 ? 1 : -1, 0);
          else hop(0, dy > 0 ? 1 : -1);
          swipe.current = p;
        }}
        onPointerUp={() => {
          swipe.current = null;
        }}
      />
    </GameShell>
  );
}
