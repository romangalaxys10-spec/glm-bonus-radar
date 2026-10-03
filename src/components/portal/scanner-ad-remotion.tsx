"use client";

/**
 * Homepage zScanner Remotion banner — mount point.
 * The ENTIRE banner is one <Link href="/scanner">: the player renders
 * beneath it with pointer-events disabled (no controls, no click-to-play),
 * so every click navigates to the scanner suite.
 *
 * Seamless-embedding details: the container width is measured with a
 * ResizeObserver and the matching composition variant (desktop 1280×400 /
 * mobile 400×640) is rendered, so phone visitors get phone-proportioned
 * type instead of a shrunken desktop canvas; the loading fallback reserves
 * the same shape the player will take; and the player fades itself in on
 * mount so the chunk swap never visibly pops. Honors prefers-reduced-motion
 * by pausing on frame 0 (the typed-URL scene still reads as a static key
 * visual).
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRemotionVariant, type RemotionVariant } from "./remotion-embed";

const ScannerAdPlayer = dynamic(() => import("./scanner-ad-player"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      className="aspect-[16/5] w-full bg-[#0a0e0b] max-[640px]:aspect-[5/8]"
    />
  ),
});

export function ScannerAdBanner() {
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
    <div ref={measureRef} className="mt-3">
      <Link
        href="/scanner"
        aria-label="Open zScanner — six free AI scanners for any URL or GitHub repo: security, SEO/GEO/performance, QA, Auto QA, code review and the Anti AI-Slop Reviewer. No signup."
        className="group relative block overflow-hidden rounded-2xl border border-white/10 shadow-[0_16px_50px_-30px_rgba(0,0,0,0.55)] transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <div className="pointer-events-none">
          <ScannerAdPlayer key={variant} autoPlay={!reducedMotion} variant={variant as RemotionVariant} />
        </div>

        {/* persistent chrome over the animation */}
        <div
          className="pointer-events-none absolute left-3 right-3 top-3 flex flex-wrap items-start justify-between gap-2 md:left-4 md:right-4 md:top-4"
          aria-hidden
        >
          <span className="rounded-full border border-white/15 bg-[#050505]/85 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#d4d4d8] backdrop-blur-sm md:text-[10px] md:tracking-[0.18em]">
            simulated demo
          </span>
          <span className="rounded-full border border-white/15 bg-[#050505]/85 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#60a5fa] backdrop-blur-sm md:text-[10px] md:tracking-[0.18em]">
            free · no signup
          </span>
        </div>

        {/* hover affordance */}
        <div
          className="pointer-events-none absolute bottom-3 right-3 opacity-90 transition-opacity group-hover:opacity-100 md:bottom-4 md:right-4"
          aria-hidden
        >
          <span className="rounded-full bg-[var(--rc-accent)] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--rc-on-accent)] shadow-[0_6px_18px_-6px_rgba(0,0,0,0.5)] md:px-3.5 md:text-[11px] md:tracking-[0.14em]">
            open zScanner →
          </span>
        </div>
      </Link>
    </div>
  );
}
