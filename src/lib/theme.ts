/**
 * Palette registry — 6 "trout stream" species × light/dark.
 * The CSS custom properties themselves live in globals.css; this module
 * feeds the theme switcher UI (dot colors + labels) and the boot script.
 */

export interface PaletteDef {
  id: string;
  label: string;
  /** Dot color shown in the switcher (dark variant accent). */
  dot: string;
}

export const PALETTES: PaletteDef[] = [
  { id: "brook", label: "brook", dot: "#e8533a" },
  { id: "cutthroat", label: "cutthroat", dot: "#e8633a" },
  { id: "gila", label: "gila", dot: "#e8a85c" },
  { id: "brown", label: "brown", dot: "#c9a936" },
  { id: "rainbow", label: "rainbow", dot: "#e86f8a" },
  { id: "mackinaw", label: "mackinaw", dot: "#35c48d" },
];

export const MODES = ["light", "system", "dark"] as const;
export type Mode = (typeof MODES)[number];

export const PALETTE_STORAGE_KEY = "br-palette";
export const MODE_STORAGE_KEY = "br-mode";

export function isPaletteId(v: string | null): v is string {
  return !!v && PALETTES.some((p) => p.id === v);
}

export function isMode(v: string | null): v is Mode {
  return v === "light" || v === "system" || v === "dark";
}
