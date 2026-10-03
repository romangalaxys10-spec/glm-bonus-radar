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
  {
    slug: "asteroids",
    title: "Asteroids",
    tag: "shooter",
    blurb: "Rotate, thrust, shoot. Rocks split into faster rocks and the screen wraps.",
    controls: "⟲ ⟳ rotate · ↑ thrust · space / FIRE to shoot",
  },
  {
    slug: "hopper",
    title: "Hopper",
    tag: "classic arcade",
    blurb: "Cross five lanes of traffic, ride the river logs, fill every lily slot.",
    controls: "arrows / WASD hop · swipe on the canvas on mobile",
  },
  {
    slug: "muncher",
    title: "Muncher",
    tag: "maze chase",
    blurb: "150 dots, a tight maze, three ghosts that read your position. You are faster. Barely.",
    controls: "arrows / WASD steer · eat every dot",
  },
  {
    slug: "kong",
    title: "Kong",
    tag: "platformer",
    blurb: "Climb the girders past rolling barrels. The ape never tires, the barrels never slow.",
    controls: "← → walk · ↑↓ climb ladders",
  },
  {
    slug: "lander",
    title: "Lander",
    tag: "physics",
    blurb: "Gravity is honest. Touch down slow, level, and on the pad — or become a crater.",
    controls: "⟲ ⟳ rotate · hold FIRE to thrust",
  },
  {
    slug: "missile",
    title: "Missile",
    tag: "defense",
    blurb: "Command the battery, intercept the warheads, decide which city survives the wave.",
    controls: "aim with pointer · tap / space to fire",
  },
  {
    slug: "racer",
    title: "Racer",
    tag: "endless",
    blurb: "A straight road, endless traffic, one speed curve: up. Meters are the score.",
    controls: "← → steer · drag on the road on mobile",
  },
  {
    slug: "cycle",
    title: "Cycle",
    tag: "versus cpu",
    blurb: "Your light is the wall. Box in the red rider without touching anything, ever.",
    controls: "arrows / WASD turn — walls kill on touch",
  },
  {
    slug: "bomber",
    title: "Bomber",
    tag: "arcade",
    blurb: "Plant bombs, mind the cross, clear every wandering foe — your own blasts count.",
    controls: "arrows / WASD walk · space / FIRE plants a bomb",
  },
  {
    slug: "cubes",
    title: "Cubes",
    tag: "isometric",
    blurb: "Hop the 28-cube pyramid, flip every face, dodge what tumbles down the rows.",
    controls: "Q/E/Z/C or ↖↗↙↘ pads to hop diagonally",
  },
  {
    slug: "memory",
    title: "Memory",
    tag: "puzzle",
    blurb: "Sixteen cards, eight pairs, no timer. Fewer moves is the whole art.",
    controls: "tap / click two cards per move",
  },
  {
    slug: "whack",
    title: "Whack",
    tag: "reaction",
    blurb: "Forty-five seconds, nine holes, moles that pop faster the better you get.",
    controls: "tap / click the moles",
  },
  {
    slug: "stacker",
    title: "Stacker",
    tag: "one button",
    blurb: "Stop the slider on the stack. Overlap keeps you alive, a full miss ends it.",
    controls: "tap / LOCK to stop the slider",
  },
  {
    slug: "xo",
    title: "XO",
    tag: "board",
    blurb: "Tic-tac-toe against a machine that reads every branch. A draw is a win.",
    controls: "tap / click a square",
  },
  {
    slug: "ships",
    title: "Ships",
    tag: "board",
    blurb: "Battleship on two grids: find the fleet before it finds yours. Red pips sink.",
    controls: "tap / click the left grid to fire",
  },
  {
    slug: "slots",
    title: "Slots",
    tag: "luck",
    blurb: "Three reels, six symbols, twenty credits. Pure luck, zero real money.",
    controls: "tap the reels or press SPIN / FIRE",
  },
  {
    slug: "pinball",
    title: "Pinball",
    tag: "arcade",
    blurb: "One ball, two flippers, three bumpers, one honest gravity. Three balls a run.",
    controls: "← → flippers · space launches · tap canvas halves",
  },
  {
    slug: "hangman",
    title: "Hangman",
    tag: "word",
    blurb: "Retro tech and far-away places. Six wrong letters and the figure gets its hat.",
    controls: "type letters · tap the letter chips on mobile",
  },
  {
    slug: "punch",
    title: "Punch",
    tag: "versus cpu",
    blurb: "Telegraph, dodge, counter. Each KO brings a faster opponent with a longer chin.",
    controls: "hold ← / → to dodge · FIRE to punch",
  },
  {
    slug: "maze",
    title: "Maze",
    tag: "puzzle",
    blurb: "A fresh labyrinth every level and a clock that refuses to slow down.",
    controls: "arrows / WASD — hold to run · reach the blue exit",
  },
];

export const ZFUN_BY_SLUG: Record<string, ZFunGame> = Object.fromEntries(
  ZFUN_GAMES.map((g) => [g.slug, g]),
);

/** localStorage key for a game's best score. */
export function zfunBestKey(slug: string): string {
  return `zfun-best-${slug}`;
}
