"use client";

/**
 * Homepage zScanner Remotion banner — mount point.
 * The ENTIRE banner is one <Link href="/scanner">: the player renders
 * beneath it with pointer-events disabled (no controls, no click-to-play),
 * so every click navigates to the scanner suite. Honors
 * prefers-reduced-motion by pausing on frame 0 (the typed-URL scene still
 * reads as a static key visual); playback resumes only via the banner link.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";

const ScannerAdPlayer = dynamic(() => import("./scanner-ad-player"), {
  ssr: false,
  loading: () => (
    <div aria-hidden className="flex aspect-[16/5] w-full items-center justify-center bg-[#0a0e0b]">
      <p className="font-mono text-[13px] tracking-[0.14em] text-[#7e8a7e]">
        loading scanners<span className="animate-pulse">▍</span>
      </p>
    </div>
  ),
});

export function ScannerAdBanner() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <div className="mt-3">
      <Link
        href="/scanner"
        aria-label="Open zScanner — six free AI scanners for any URL or GitHub repo: security, SEO/GEO/performance, QA, Auto QA, code review and the Anti AI-Slop Reviewer. No signup."
        className="group relative block overflow-hidden rounded-3xl border border-[#2c3326] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)] transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <div className="pointer-events-none">
          <ScannerAdPlayer autoPlay={!reducedMotion} />
        </div>

        {/* persistent chrome over the animation */}
        <div className="pointer-events-none absolute left-4 top-4" aria-hidden>
          <span className="rounded-full border border-[#3a4437] bg-[#0a0e0b]/85 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#cfdccf] backdrop-blur-sm">
            simulated demo
          </span>
        </div>
        <div className="pointer-events-none absolute right-4 top-4" aria-hidden>
          <span className="rounded-full border border-[#3a4437] bg-[#0a0e0b]/85 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#8fd694] backdrop-blur-sm">
            free · no signup
          </span>
        </div>

        {/* hover affordance */}
        <div className="pointer-events-none absolute bottom-4 right-4 opacity-90 transition-opacity group-hover:opacity-100" aria-hidden>
          <span className="rounded-full bg-[var(--rc-accent)] px-3.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--rc-on-accent)] shadow-[0_6px_18px_-6px_rgba(0,0,0,0.5)]">
            open zScanner →
          </span>
        </div>
      </Link>
    </div>
  );
}
