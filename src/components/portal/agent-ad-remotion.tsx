"use client";

/**
 * Mount point for the immersive Remotion simulation ad on /agent.
 *
 * The player itself is client-only (dynamic import, ssr:false — the page
 * around it stays a server component). Chrome chips ("SIMULATED AD" /
 * "Powered by xShredo") are real HTML pinned OVER the player so the
 * sponsorship and the simulation label are visible even before the first
 * frame paints. Honors prefers-reduced-motion by not autoplaying; playback
 * stays one tap away via the player controls.
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const AgentAdPlayer = dynamic(() => import("./agent-ad-player"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      className="flex aspect-video w-full items-center justify-center bg-[#0a0e0b]"
    >
      <p className="font-mono text-[13px] tracking-[0.14em] text-[#7e8a7e]">
        loading simulation<span className="animate-pulse">▍</span>
      </p>
    </div>
  ),
});

export function AgentAdStage() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-[#2c3326] bg-[#0a0e0b] shadow-[0_24px_70px_-30px_rgba(0,0,0,0.65)]">
      <AgentAdPlayer autoPlay={!reducedMotion} />

      {/* persistent chrome — always visible, never covered by playback */}
      <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-2" aria-hidden>
        <span className="rounded-full border border-[#3a4437] bg-[#0a0e0b]/85 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#cfdccf] backdrop-blur-sm">
          simulated ad · walkthrough
        </span>
      </div>
      <div className="pointer-events-none absolute right-4 top-4" aria-hidden>
        <span className="rounded-full border border-[#3a4437] bg-[#0a0e0b]/85 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#8fd694] backdrop-blur-sm">
          powered by xShredo
        </span>
      </div>
    </div>
  );
}
