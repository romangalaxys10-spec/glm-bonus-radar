/**
 * Color mode registry — the portal ships the xShredo promo dark design as
 * the default; a matching light/white mode can be toggled from the header
 * (Task 55). The CSS custom properties themselves live in globals.css:
 * :root / .dark resolve to the fixed dark xShredo values, html.light to the
 * white-paper counterpart. The legacy br-palette storage key is kept harmless.
 */

export const MODES = ["light", "dark"] as const;
export type Mode = (typeof MODES)[number];

export const MODE_STORAGE_KEY = "br-mode";
export const PALETTE_STORAGE_KEY = "br-palette"; // legacy — boot script keeps it, nothing reads it

export function isMode(v: string | null): v is Mode {
  return v === "light" || v === "dark";
}
