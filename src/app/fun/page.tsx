import type { Metadata } from "next";
import { FunClient } from "@/components/zfun/fun-client";

export const metadata: Metadata = {
  title: "zFun — Thirty 8-bit games · GLM Bonus Radar",
  description:
    "The radar's built-in arcade: thirty playable 8-bit classics — snake, blocks, breakout, pong, invaders, asteroids, hopper, muncher, kong, lander, missile, racer, cycle, bomber, cubes, flap, runner, merge, mines, simon, memory, whack, stacker, xo, ships, slots, pinball, hangman, punch and maze — running entirely in your browser on desktop and phone. Keyboard and touch controls, best scores stored locally.",
  keywords: [
    "8-bit games",
    "browser games",
    "arcade",
    "snake",
    "tetromino",
    "breakout",
    "pong",
    "space invaders",
    "asteroids",
    "frogger",
    "lunar lander",
    "missile command",
    "light cycles",
    "bomberman",
    "tic-tac-toe",
    "battleship",
    "pinball",
    "hangman",
    "minesweeper",
    "zFun",
  ],
  alternates: { canonical: "/fun" },
  openGraph: {
    title: "zFun — Thirty 8-bit games, played right here",
    description:
      "A built-in arcade for the GLM Bonus Radar: thirty pixel classics, keyboard on desktop, touch on phone, scores that never leave your device.",
    type: "website",
  },
};

export default function FunPage() {
  return (
    <>
      {/* zFun uses the Press Start 2P pixel face for HUD chrome, page-locally,
          exactly like /search loads IBM Plex locally: the global bundle stays
          untouched (accepted no-page-custom-font warning, same precedent). */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap"
        rel="stylesheet"
      />
      <FunClient />
    </>
  );
}
