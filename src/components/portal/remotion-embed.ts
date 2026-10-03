import { useEffect, useState, type RefObject } from "react";

/**
 * Shared helpers for embedding Remotion players seamlessly into portal pages.
 * Players ship TWO compositions (desktop + mobile) and pick one by measured
 * CONTAINER width — a 1280px composition scaled onto a 390px phone renders
 * text at ~30%, which is unreadable; the mobile compositions re-layout the
 * same scenes at phone proportions instead.
 */

export type RemotionVariant = "desktop" | "mobile";

/** Container width below which the mobile composition is used. */
export const REMOTION_MOBILE_MAX = 640;

export function useRemotionVariant(ref: RefObject<HTMLElement | null>): RemotionVariant {
  const [variant, setVariant] = useState<RemotionVariant>("desktop");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setVariant(w > 0 && w < REMOTION_MOBILE_MAX ? "mobile" : "desktop");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return variant;
}

/** Style for the mount fade-in so the chunk swap never visibly pops. */
export const EMBED_FADE = { transition: "opacity 500ms ease" } as const;
