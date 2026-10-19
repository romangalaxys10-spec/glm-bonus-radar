"use client";

/** zFun · HANGMAN — six wrong letters and the pixel-figure gets its hat. */

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
  useInput,
  useLoop,
} from "../engine";

const W = 200;
const H = 170;

const WORDS = [
  "pixel", "joystick", "cartridge", "arcade", "raster", "sprite", "console",
  "cassette", "bitmap", "polygon", "scanline", "palette", "chiptune", "dungeon",
  "wizard", "rocket", "castle", "phantom", "voyage", "quantum", "network",
  "server", "kernel", "browser", "planet", "meteor", "comet", "nebula",
  "galaxy", "thunder", "shadow", "crystal", "harbor", "meadow", "summit",
  "canyon", "island", "falcon", "dragon", "knight",
];

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export default function HangmanGame() {
  const input = useInput();
  const [status, setStatus] = useState<GameStatus>("ready");
  const [streak, setStreak] = useState(0);
  const [best, submitBest] = useBest("hangman");
  const canvasRef: CanvasRef = useRef(null);

  const [word, setWord] = useState("");
  const [used, setUsed] = useState<Set<string>>(() => new Set());
  const shown = useRef<string[]>([]);
  const wrong = useRef(0);

  function newWord(keepStreak: boolean) {
    const w = WORDS[Math.floor(Math.random() * WORDS.length)];
    setWord(w);
    shown.current = w.split("").map(() => "_");
    wrong.current = 0;
    setUsed(new Set());
    if (!keepStreak) setStreak(0);
    setStatus("playing");
  }

  const start = () => {
    newWord(status === "won");
  };

  function guess(letter: string) {
    if (status !== "playing") return;
    const L = letter.toUpperCase();
    if (used.has(L)) return;
    const next = new Set(used);
    next.add(L);
    setUsed(next);
    if (word.toUpperCase().includes(L)) {
      for (let i = 0; i < word.length; i++) {
        if (word[i].toUpperCase() === L) shown.current[i] = word[i];
      }
      beep(620, 50);
      if (shown.current.join("") === word) {
        beep(880, 220);
        setStreak((s) => s + 1);
        setStatus("won");
        submitBest(streak + 1);
      }
    } else {
      wrong.current += 1;
      beep(190, 70, "triangle", 0.03);
      if (wrong.current >= 6) {
        beep(110, 320, "square", 0.05);
        setStatus("over");
        submitBest(streak);
      }
    }
  }

  function draw() {
    const ctx = ctx2d(canvasRef);
    if (!ctx) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // gallows
    ctx.strokeStyle = C.dim;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(30, 150);
    ctx.lineTo(70, 150);
    ctx.moveTo(50, 150);
    ctx.lineTo(50, 20);
    ctx.lineTo(105, 20);
    ctx.lineTo(105, 34);
    ctx.stroke();
    ctx.lineWidth = 1;
    const parts = wrong.current;
    if (parts >= 1) {
      ctx.fillStyle = C.brand; // head
      ctx.fillRect(97, 34, 16, 16);
      ctx.fillStyle = C.bg;
      ctx.fillRect(101, 40, 2, 2);
      ctx.fillRect(107, 40, 2, 2);
    }
    if (parts >= 2) {
      ctx.fillStyle = C.brand; // body
      ctx.fillRect(101, 50, 8, 26);
    }
    if (parts >= 3) {
      ctx.fillStyle = C.brand; // left arm
      ctx.fillRect(90, 52, 11, 4);
    }
    if (parts >= 4) {
      ctx.fillStyle = C.brand; // right arm
      ctx.fillRect(109, 52, 11, 4);
    }
    if (parts >= 5) {
      ctx.fillStyle = C.brand; // left leg
      ctx.fillRect(99, 76, 4, 18);
    }
    if (parts >= 6) {
      ctx.fillStyle = C.brand; // right leg + hat
      ctx.fillRect(107, 76, 4, 18);
      ctx.fillStyle = C.red;
      ctx.fillRect(95, 30, 20, 3);
    }
    // word blanks
    const n = word.length || 6;
    const bw = Math.min(14, (W - 30) / n - 2);
    const startX = (W - n * (bw + 3)) / 2;
    for (let i = 0; i < n; i++) {
      const x = startX + i * (bw + 3);
      ctx.fillStyle = shown.current[i] === "_" ? C.faint : C.bright;
      if (shown.current[i] !== "_") {
        // 3×5-ish blocks: mark revealed with a bright block
        ctx.fillRect(x, 116, bw, 5);
      }
      ctx.fillStyle = C.dim;
      ctx.fillRect(x, 130, bw, 2);
    }
    // wrong-letter pips
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i < wrong.current ? C.red : C.frame;
      ctx.fillRect(W - 30 + (i % 3) * 8, 150 + Math.floor(i / 3) * 8, 5, 5);
    }
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  useLoop(() => {
    // keyboard letters (additive channel; WASD etc. also map to buttons, harmless here)
    for (const L of input.drainLetters()) guess(L);
    input.drain();
    draw();
  });

  useEffect(() => {
    draw();
  }, []);

  return (
    <GameShell
      slug="hangman"
      title="HANGMAN"
      status={status}
      scoreLabel="STREAK"
      score={streak}
      best={best}
      hint="type letters on desktop · tap the letter chips below on mobile"
      overlayNote={
        status === "won"
          ? `saved! the word was “${word}” — streak ${streak}`
          : status === "over"
            ? `the word was “${word}” · streak ${streak}`
            : "retro tech and far-away places — six misses allowed"
      }
      onStart={start}
      canvasMax={400}
      pads={
        <div className="mx-auto grid max-w-[340px] grid-cols-7 gap-1.5 sm:grid-cols-9">
          {ALPHA.map((L) => {
            const isUsed = used.has(L);
            return (
              <button
                key={L}
                type="button"
                disabled={isUsed || status !== "playing"}
                onClick={() => guess(L)}
                aria-label={`Guess letter ${L}`}
                className={`h-9 rounded-md border font-mono text-[11px] transition-colors ${
                  isUsed
                    ? "border-transparent bg-transparent text-zinc-700"
                    : "border-hair/10 bg-hair/[0.03] text-soft hover:border-hair/30 active:bg-[rgba(59,130,246,0.14)]"
                }`}
              >
                {L}
              </button>
            );
          })}
        </div>
      }
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={PIXELATED}
        className="block w-full touch-none"
      />
    </GameShell>
  );
}
