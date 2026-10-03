"use client";

/**
 * Remotion banner engine for the zScanner promo on the homepage.
 * An 11-second looping "scan simulation": URL typed → sweep line → six
 * scanner verdict stamps pop → end card. Fixed cinematic palette (same
 * doctrine as the /agent ad), mono type, no emoji, no invented product
 * claims — scanner names and "free / no signup" come from the scanner
 * page's own copy; the fictional site's grades are visibly a demo.
 *
 * Playback has NO controls and NO click-to-play: the wrapper
 * (scanner-ad-remotion.tsx) overlays a real Link so the whole banner
 * navigates to /scanner.
 */

import { Player } from "@remotion/player";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const C = {
  bg: "#0a0e0b",
  panel: "#0c110d",
  border: "#2c3326",
  borderDim: "#232a22",
  dim: "#7e8a7e",
  text: "#cfdccf",
  bright: "#eef4ee",
  green: "#8fd694",
  red: "#e8533a",
  amber: "#a8822d",
} as const;

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function FadeIn({ children }: { children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

/* ------------------------------------------------------------------ */
/* Scene 1 — type URL, sweep the page                                  */
/* ------------------------------------------------------------------ */

const TARGET_URL = "https://your-ai-startup.com";

function SceneSweep() {
  const frame = useCurrentFrame();

  const chars = Math.floor(
    interpolate(frame, [6, 54], [0, TARGET_URL.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const typed = TARGET_URL.slice(0, chars);
  const cursorOn = frame % 16 < 9;

  /* scan sweep across the skeleton page, f66 → f100 */
  const sweep = interpolate(frame, [66, 100], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  /* radar rings behind */
  const ring = (offset: number) => {
    const t = ((frame + offset) % 60) / 60;
    return { scale: 0.4 + t * 1.6, opacity: 0.35 * (1 - t) };
  };

  return (
    <FadeIn>
      <AbsoluteFill style={{ backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
        {/* radar rings */}
        {[0, 20, 40].map((off) => {
          const r = ring(off);
          return (
            <span
              key={off}
              style={{
                position: "absolute",
                width: 120,
                height: 120,
                borderRadius: 999,
                border: `2px solid ${C.green}`,
                transform: `scale(${r.scale})`,
                opacity: r.opacity,
              }}
            />
          );
        })}

        {/* url bar */}
        <div
          style={{
            position: "absolute",
            top: 74,
            width: 640,
            border: `1px solid ${C.border}`,
            background: C.panel,
            borderRadius: 12,
            padding: "12px 18px",
            fontFamily: MONO,
            fontSize: 20,
            color: C.bright,
            textAlign: "left",
          }}
        >
          <span style={{ color: C.green, marginRight: 10 }}>◎</span>
          {typed}
          {cursorOn ? <span style={{ opacity: 0.85 }}>▍</span> : null}
        </div>

        {/* skeleton page under sweep */}
        <div
          style={{
            position: "absolute",
            top: 160,
            width: 640,
            height: 190,
            border: `1px solid ${C.border}`,
            background: C.panel,
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          {[210, 520, 400, 300].map((w, i) => (
            <div
              key={i}
              style={{
                margin: "18px 22px 0",
                height: i === 0 ? 26 : 12,
                width: w,
                borderRadius: 6,
                background: i === 0 ? "#1c261c" : "#141b14",
              }}
            />
          ))}
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${sweep}%`,
              width: 3,
              background: C.green,
              boxShadow: `0 0 22px ${C.green}`,
            }}
          />
        </div>

        <p
          style={{
            position: "absolute",
            bottom: 26,
            width: "100%",
            textAlign: "center",
            fontFamily: MONO,
            fontSize: 16,
            letterSpacing: "0.12em",
            color: C.dim,
          }}
        >
          paste a URL or a GitHub repo — scans start instantly
        </p>
      </AbsoluteFill>
    </FadeIn>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 2 — six verdict stamps                                        */
/* ------------------------------------------------------------------ */

const VERDICTS: Array<[string, string, string]> = [
  ["SECURITY", "A-", C.green],
  ["SEO · GEO · PERF", "88/100", C.green],
  ["QA AUDIT", "ok", C.green],
  ["AUTO QA", "9 E2E steps", C.text],
  ["CODE REVIEW", "2 leads", C.amber],
  ["ANTI AI-SLOP", "B+", C.amber],
];

function SceneVerdicts() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <FadeIn>
      <AbsoluteFill style={{ backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
        <p
          style={{
            position: "absolute",
            top: 48,
            width: "100%",
            textAlign: "center",
            fontFamily: MONO,
            fontSize: 17,
            letterSpacing: "0.22em",
            color: C.dim,
          }}
        >
          SIX SCANNERS · ONE TARGET
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, width: 760 }}>
          {VERDICTS.map(([name, verdict, color], i) => {
            const pop = spring({ frame: frame - i * 14, fps, config: { damping: 12, mass: 0.55 } });
            return (
              <div
                key={name}
                style={{
                  border: `1px solid ${C.border}`,
                  background: C.panel,
                  borderRadius: 14,
                  padding: "18px 22px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  transform: `scale(${0.7 + 0.3 * pop})`,
                  opacity: pop,
                }}
              >
                <span style={{ fontFamily: MONO, fontSize: 17, letterSpacing: "0.08em", color: C.text }}>
                  {name}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 16,
                    fontWeight: 700,
                    color: color as string,
                    border: `1px solid ${C.border}`,
                    borderRadius: 999,
                    padding: "4px 12px",
                    background: "#11170f",
                  }}
                >
                  {verdict}
                </span>
              </div>
            );
          })}
        </div>

        <p
          style={{
            position: "absolute",
            bottom: 26,
            width: "100%",
            textAlign: "center",
            fontFamily: MONO,
            fontSize: 16,
            letterSpacing: "0.12em",
            color: C.dim,
          }}
        >
          findings re-verified · evidence quoted · fix prompt included
        </p>
      </AbsoluteFill>
    </FadeIn>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 3 — end card                                                  */
/* ------------------------------------------------------------------ */

function SceneEndCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, mass: 0.7 } });
  const glow = 0.5 + 0.5 * Math.sin(frame / 6);
  const arrowNudge = Math.sin(frame / 8) * 6;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.bg,
        alignItems: "center",
        justifyContent: "center",
        backgroundImage: `radial-gradient(460px 240px at 50% 48%, rgba(232,83,58,${0.1 + 0.05 * glow}), transparent 70%)`,
      }}
    >
      <div style={{ textAlign: "center", transform: `scale(${0.88 + 0.12 * pop})` }}>
        <h2 style={{ fontSize: 62, fontWeight: 800, letterSpacing: "-0.03em", color: C.bright, lineHeight: 1.05 }}>
          Six AI scanners.
          <br />
          One paste. Zero signup.
        </h2>
        <p style={{ fontFamily: MONO, fontSize: 19, color: C.text, marginTop: 18 }}>
          security · seo/geo/perf · qa · auto qa · code · anti ai-slop
        </p>
        <p
          style={{
            display: "inline-block",
            fontFamily: MONO,
            fontSize: 18,
            fontWeight: 700,
            color: C.bright,
            border: `1px solid ${C.border}`,
            background: C.panel,
            borderRadius: 999,
            padding: "10px 24px",
            marginTop: 24,
          }}
        >
          scan your site free <span style={{ display: "inline-block", transform: `translateX(${arrowNudge}px)` }}>→</span> zhelp.space-z.ai/scanner
        </p>
      </div>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ */
/* Composition + Player                                                */
/* ------------------------------------------------------------------ */

function ScannerAdComposition() {
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: "inherit" }}>
      <Sequence from={0} durationInFrames={110}>
        <SceneSweep />
      </Sequence>
      <Sequence from={110} durationInFrames={140}>
        <SceneVerdicts />
      </Sequence>
      <Sequence from={250} durationInFrames={80}>
        <SceneEndCard />
      </Sequence>
    </AbsoluteFill>
  );
}

export default function ScannerAdPlayer({ autoPlay = true }: { autoPlay?: boolean }) {
  return (
    <Player
      component={ScannerAdComposition}
      durationInFrames={330}
      compositionWidth={1280}
      compositionHeight={400}
      fps={30}
      style={{ width: "100%", aspectRatio: "16 / 5", display: "block" }}
      loop
      autoPlay={autoPlay}
      initiallyMuted
      acknowledgeRemotionLicense
    />
  );
}
