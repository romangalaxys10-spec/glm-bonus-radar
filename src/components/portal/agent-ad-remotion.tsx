"use client";

/**
 * Mount point for the immersive Remotion simulation ad on /agent.
 *
 * The player itself is client-only (dynamic import, ssr:false — the page
 * around it stays a server component). Seamless-embedding details: the
 * container width is measured with a ResizeObserver and the matching
 * composition variant (desktop 1280×720 / mobile 400×740) is rendered, so
 * phone visitors get phone-proportioned type instead of a shrunken desktop
 * canvas; the loading fallback reserves the same shape; and the player
 * fades itself in on mount so the chunk swap never visibly pops. Chrome
 * chips ("SIMULATED AD" / "Powered by xShredo") are real HTML pinned OVER
 * the player so the sponsorship and the simulation label stay visible.
 * Honors prefers-reduced-motion by not autoplaying; playback stays one tap
 * away via the player controls.
 */

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useRemotionVariant, type RemotionVariant } from "./remotion-embed";

const AgentAdPlayer = dynamic(() => import("./agent-ad-player"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      className="aspect-video w-full bg-[#0a0e0b] max-[640px]:aspect-[20/37]"
    />
  ),
});

export function AgentAdStage() {
  const measureRef = useRef<HTMLDivElement>(null);
  const variant = useRemotionVariant(measureRef);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <div ref={measureRef} className="relative overflow-hidden rounded-2xl border border-hair/10 bg-[#0a0e0b] shadow-[0_18px_55px_-30px_rgba(0,0,0,0.6)]">
      <AgentAdPlayer key={variant} autoPlay={!reducedMotion} variant={variant as RemotionVariant} />

      {/* persistent chrome — always visible, never covered by playback */}
      <div
        className="pointer-events-none absolute left-3 right-3 top-3 flex flex-wrap items-start justify-between gap-2 md:left-4 md:right-4 md:top-4"
        aria-hidden
      >
        <span className="rounded-full border border-hair/15 bg-canvas/85 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-soft backdrop-blur-sm md:text-[10px] md:tracking-[0.18em]">
          simulated ad · walkthrough
        </span>
        <span className="rounded-full border border-hair/15 bg-canvas/85 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-azure2 backdrop-blur-sm md:text-[10px] md:tracking-[0.18em]">
          powered by xShredo
        </span>
      </div>
    </div>
  );
}
