"use client";

/** zFun · CUBES — hop the pyramid, flip every face, dodge what falls. */

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

const ROWS = 7; // pyramid rows 0..6
const W = 240;
const H = 208;
const CUBE_W = 34;
const CUBE_TOP = 14;
const CUBE_SIDE = 7;
const ROW_H = 24;

interface Pos {
  r: number;
  c: number;
}

function cubeXY(p: Pos): { x: number; y: number } {
  return {
    x: W / 2 + (p.c - p.r / 2) * 30 - CUBE_W / 2,
    y: 18 + p.r * ROW_H,
  };
}

interface Ball {
  p: Pos;
  t: number;
}

export default function CubesGame() {
  const input: Input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [best, submitBest] = useBest("cubes");
  const canvasRef: CanvasRef = useRef(null);

  const flipped = useRef<boolean[][]>([]);
  const player = useRef<Pos>({ r: 0, c: 0 });
  const hop = useRef<{ from: Pos; t: number } | null>(null);
  const balls = useRef<Ball[]>([]);
  const ballTimer = useRef(3200);
  const [level, setLevel] = useState(1);

  function buildLevel(n: number) {
    flipped.current = Array.from({ length: ROWS }, (_, r) => Array<boolean>(r + 1).fill(false));
    player.current = { r: 0, c: 0 };
    hop.current = null;
    balls.current = [];
    ballTimer.current = Math.max(1800, 3400 - n * 220);
  }

  function reset() {
    setLevel(1);
    setScore(0);
    setStatus("playing");
    buildLevel(1);
  }

  const start = () => {
    if (status === "won" && level > 1) {
      buildLevel(level);
      setStatus("playing");
    } else reset();
  };

  function die() {
    beep(110, 300, "square", 0.05);
    setStatus("over");
    submitBest(score);
  }

  function move(dir: "ul" | "ur" | "dl" | "dr") {
    if (status !== "playing" || hop.current) return;
    const p = player.current;
    const target: Pos =
      dir === "ul"
        ? { r: p.r - 1, c: p.c - 1 }
        : dir === "ur"
          ? { r: p.r - 1, c: p.c }
          : dir === "dl"
            ? { r: p.r + 1, c: p.c }
            : { r: p.r + 1, c: p.c + 1 };
    if (target.r < 0 || target.r >= ROWS || target.c < 0 || target.c > target.r) {
      beep(150, 70); // edge of the world — blocked, not fatal
      return;
    }
    hop.current = { from: { ...p }, t: 110 };
    player.current = target;
    beep(480, 30);
    if (!flipped.current[target.r][target.c]) {
      flipped.current[target.r][target.c] = true;
      setScore((v) => v + 25);
      if (flipped.current.every((row) => row.every(Boolean))) {
        setScore((v) => v + 200);
        setLevel((v) => v + 1);
        beep(880, 200);
        setStatus("won");
        submitBest(score + 225);
      }
    }
  }

  function drawCube(p: Pos, lit: boolean) {
    const { x, y } = cubeXY(p);
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    // top face (rhombus)
    ctx.fillStyle = lit ? C.accent : "#27272a";
    ctx.beginPath();
    ctx.moveTo(x + CUBE_W / 2, y);
    ctx.lineTo(x + CUBE_W, y + CUBE_TOP / 2);
    ctx.lineTo(x + CUBE_W / 2, y + CUBE_TOP);
    ctx.lineTo(x, y + CUBE_TOP / 2);
    ctx.closePath();
    ctx.fill();
    // left face
    ctx.fillStyle = lit ? "#1d4ed8" : "#1f1f22";
    ctx.fillRect(x, y + CUBE_TOP / 2, CUBE_W / 2, CUBE_SIDE);
    // right face
    ctx.fillStyle = lit ? "#2563eb" : "#18181b";
    ctx.fillRect(x + CUBE_W / 2, y + CUBE_TOP / 2, CUBE_W / 2, CUBE_SIDE);
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c <= r; c++) drawCube({ r, c }, flipped.current[r]?.[c] ?? false);
    // falling balls
    for (const b of balls.current) {
      const { x, y } = cubeXY(b.p);
      ctx.fillStyle = C.red;
      ctx.fillRect(x + 10, y + 2, CUBE_W - 20, CUBE_TOP - 2);
      ctx.fillStyle = C.bright;
      ctx.fillRect(x + 14, y + 5, 3, 3);
    }
    // player — drawn over its cube, with hop interpolation
    const pos = player.current;
    if (hop.current) {
      const t = 1 - hop.current.t / 110;
      const a = cubeXY(hop.current.from);
      const b = cubeXY(pos);
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      ctx.fillStyle = C.green;
      ctx.fillRect(x + 8, y - 4, CUBE_W - 16, CUBE_TOP + 4);
      ctx.fillStyle = C.bright;
      ctx.fillRect(x + 12, y - 1, 3, 3);
      ctx.fillRect(x + CUBE_W - 15, y - 1, 3, 3);
    } else {
      const { x, y } = cubeXY(pos);
      ctx.fillStyle = C.green;
      ctx.fillRect(x + 8, y - 4, CUBE_W - 16, CUBE_TOP + 4);
      ctx.fillStyle = C.bright;
      ctx.fillRect(x + 12, y - 1, 3, 3);
      ctx.fillRect(x + CUBE_W - 15, y - 1, 3, 3);
    }
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop((dt) => {
    if (status === "playing") {
      const edges = input.drain();
      for (const e of edges) {
        if (e === "ul") move("ul");
        else if (e === "ur") move("ur");
        else if (e === "dl") move("dl");
        else if (e === "dr") move("dr");
      }
      if (hop.current) {
        hop.current.t -= dt;
        if (hop.current.t <= 0) hop.current = null;
      }
      // ball spawns + descent
      ballTimer.current -= dt;
      if (ballTimer.current <= 0 && balls.current.length < 3) {
        if (!(balls.current.some((b) => b.p.r === 0 && b.p.c === 0) || (player.current.r === 0 && player.current.c === 0))) {
          balls.current.push({ p: { r: 0, c: 0 }, t: 700 });
        }
        ballTimer.current = Math.max(1700, 3300 - level * 220);
      }
      for (const b of balls.current) {
        b.t -= dt;
        if (b.t <= 0) {
          b.t = 680;
          const dirRight = Math.random() < 0.5;
          b.p = dirRight ? { r: b.p.r + 1, c: b.p.c + 1 } : { r: b.p.r + 1, c: b.p.c };
        }
      }
      // contact check before filtering
      for (const b of balls.current) {
        if (b.p.r === player.current.r && b.p.c === player.current.c && !hop.current) {
          die();
          break;
        }
      }
      balls.current = balls.current.filter((b) => b.p.r < ROWS);
    } else {
      input.drain();
    }
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  return (
    <GameShell
      slug="cubes"
      title="CUBES"
      status={status}
      scoreLabel="PTS"
      score={score}
      best={best}
      hint="Q/E/Z/C or the arrow pads to hop diagonally · flip all 28 cubes"
      overlayNote={
        status === "won"
          ? `pyramid cleared — level ${level} drops more balls`
          : status === "over"
            ? `score ${score} · best ${Math.max(best, score)}`
            : "hop off the edge? never — it just buzzes"
      }
      onStart={start}
      pads={
        <>
          <div className="flex items-center gap-2">
            <Pad input={input} btn="ul" label="↖" ariaLabel="Hop up-left" />
            <Pad input={input} btn="ur" label="↗" ariaLabel="Hop up-right" />
            <Pad input={input} btn="dl" label="↙" ariaLabel="Hop down-left" />
            <Pad input={input} btn="dr" label="↘" ariaLabel="Hop down-right" />
          </div>
        </>
      }
      canvasMax={480}
    >
      <canvas ref={canvasRef} width={W} height={H} style={PIXELATED} className="block w-full touch-none" />
    </GameShell>
  );
}
