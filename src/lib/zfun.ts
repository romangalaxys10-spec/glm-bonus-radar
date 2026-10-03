/**
 * zFun — the portal's built-in 8-bit arcade.
 *
 * Pure data registry shared by the lobby (server + client) and the tools
 * section. Every game is a local browser simulation: keyboard on desktop,
 * touch on phone, best scores in localStorage only — nothing leaves the
 * device, nothing is fetched, nothing is faked (the games ARE the content).
 */

export interface ZFunGame {
  /** URL slug, also the ?g= deep link and localStorage best-score key. */
  slug: string;
  /** Short display title, rendered uppercase in mono/pixel contexts. */
  title: string;
  /** Genre tag shown on the lobby card (mono, uppercase). */
  tag: string;
  /** One-line honest blurb for the lobby card. */
  blurb: string;
  /** Controls hint shown under the game canvas. */
  controls: string;
}

export const ZFUN_GAMES: ZFunGame[] = [
  {
    slug: "snake",
    title: "Snake",
    tag: "classic arcade",
    blurb: "Chase the food, grow the tail, never bite yourself. It speeds up as you grow.",
    controls: "arrows / WASD · swipe on the canvas on mobile",
  },
  {
    slug: "blocks",
    title: "Blocks",
    tag: "falling puzzle",
    blurb: "Stack falling tetrominoes, clear lines, survive the gravity curve.",
    controls: "←→ move · ↑ rotate · ↓ soft drop · space hard drop",
  },
  {
    slug: "breakout",
    title: "Breakout",
    tag: "arcade",
    blurb: "Bounce the ball into six rows of bricks. Three lives, endless levels.",
    controls: "drag / ←→ to move · tap or space to launch",
  },
  {
    slug: "pong",
    title: "Pong",
    tag: "versus cpu",
    blurb: "The oldest duel in video games. First to 7 points beats the machine.",
    controls: "drag / ←→ to move · first to 7 wins",
  },
  {
    slug: "invaders",
    title: "Invaders",
    tag: "shooter",
    blurb: "One cannon, 32 descending aliens, endless waves. Move or be overwritten.",
    controls: "←→ move · space / FIRE to shoot",
  },
  {
    slug: "flap",
    title: "Flap",
    tag: "one button",
    blurb: "One button, impossible pipes, brutally honest physics. You know the drill.",
    controls: "tap / space to flap",
  },
  {
    slug: "runner",
    title: "Runner",
    tag: "endless",
    blurb: "Jump the cacti, duck nothing, outrun the speed curve as long as you can.",
    controls: "tap / space to jump — hold to jump higher",
  },
  {
    slug: "merge",
    title: "Merge",
    tag: "slide puzzle",
    blurb: "Slide, merge, double. Every move spawns a tile — chase the 2048 square.",
    controls: "arrows / swipe any direction",
  },
  {
    slug: "mines",
    title: "Mines",
    tag: "logic",
    blurb: "9×9 field, ten mines, pure deduction. Numbers never lie.",
    controls: "tap to reveal · long-press / F / FLAG to mark",
  },
  {
    slug: "simon",
    title: "Simon",
    tag: "memory",
    blurb: "Watch the colors sing, repeat the song, round after round until it breaks you.",
    controls: "tap the pads in order",
  },
];

export const ZFUN_BY_SLUG: Record<string, ZFunGame> = Object.fromEntries(
  ZFUN_GAMES.map((g) => [g.slug, g]),
);

/** localStorage key for a game's best score. */
export function zfunBestKey(slug: string): string {
  return `zfun-best-${slug}`;
}
