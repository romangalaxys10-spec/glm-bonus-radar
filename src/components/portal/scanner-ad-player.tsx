"use client";

/**
 * Remotion banner engine for the zScanner promo on the homepage.
 * An 11-second looping "scan simulation": URL typed → sweep line → six
 * scanner verdict stamps pop → end card. Fixed cinematic palette (same
 * doctrine as the /agent ad), mono type, no emoji, no invented product
 * claims — scanner names and "free / no signup" come from the scanner
 * page's own copy; the fictional site's grades are visibly a demo.
 *
 * TWO compositions ship here: a 1280×400 desktop cut and a 400×640 mobile
 * cut with phone-proportioned type and stacked layout (a uniformly scaled
 * desktop canvas would render ~6px text on a phone). The wrapper picks the
 * variant from measured container width. Playback has NO controls and NO
 * click-to-play: the wrapper overlays a real Link so the whole banner
 * navigates to /scanner. The player fades itself in on mount so the chunk
 * swap never visibly pops.
 */

import { Player } from "@remotion/player";
import { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { EMBED_FADE, type RemotionVariant } from "./remotion-embed";

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

/** Small caption pinned near the bottom of the frame. */
function Caption({
  text,
  delay,
  size = 16,
  bottom = 26,
}: {
  text: string;
  delay: number;
  size?: number;
  bottom?: number;
}) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [delay, delay + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <p
      style={{
        position: "absolute",
        bottom,
        left: 0,
        right: 0,
        textAlign: "center",
        fontFamily: MONO,
        fontSize: size,
        letterSpacing: "0.12em",
        color: C.dim,
        opacity,
        padding: "0 16px",
      }}
    >
      {text}
    </p>
  );
}

const TARGET_URL = "https://your-ai-startup.com";

const VERDICTS: Array<[string, string, string]> = [
  ["SECURITY", "A-", C.green],
  ["SEO · GEO · PERF", "88/100", C.green],
  ["QA AUDIT", "ok", C.green],
  ["AUTO QA", "9 E2E steps", C.text],
  ["CODE REVIEW", "2 leads", C.amber],
  ["ANTI AI-SLOP", "B+", C.amber],
];

/* ------------------------------------------------------------------ */
/* Desktop scenes (1280×400)                                           */
/* ------------------------------------------------------------------ */

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

  const sweep = interpolate(frame, [66, 100], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  const ring = (offset: number) => {
    const t = ((frame + offset) % 60) / 60;
    return { scale: 0.4 + t * 1.6, opacity: 0.35 * (1 - t) };
  };

  return (
    <FadeIn>
      <AbsoluteFill style={{ backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
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

        <Caption text="paste a URL or a GitHub repo — scans start instantly" delay={92} />
      </AbsoluteFill>
    </FadeIn>
  );
}

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

        <Caption text="findings re-verified · evidence quoted · fix prompt included" delay={96} />
      </AbsoluteFill>
    </FadeIn>
  );
}

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

function ScannerAdCompositionDesktop() {
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

/* ------------------------------------------------------------------ */
/* Mobile scenes (400×640) — phone proportions, stacked layout         */
/* ------------------------------------------------------------------ */

function MobileSceneSweep() {
  const frame = useCurrentFrame();

  const chars = Math.floor(
    interpolate(frame, [6, 54], [0, TARGET_URL.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const typed = TARGET_URL.slice(0, chars);
  const cursorOn = frame % 16 < 9;

  const sweep = interpolate(frame, [66, 100], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  const ring = (offset: number) => {
    const t = ((frame + offset) % 60) / 60;
    return { scale: 0.4 + t * 1.5, opacity: 0.3 * (1 - t) };
  };

  return (
    <FadeIn>
      <AbsoluteFill style={{ backgroundColor: C.bg, alignItems: "center" }}>
        {[0, 20, 40].map((off) => {
          const r = ring(off);
          return (
            <span
              key={off}
              style={{
                position: "absolute",
                top: 300,
                width: 90,
                height: 90,
                borderRadius: 999,
                border: `2px solid ${C.green}`,
                transform: `scale(${r.scale})`,
                opacity: r.opacity,
              }}
            />
          );
        })}

        <div
          style={{
            position: "absolute",
            top: 128,
            width: 344,
            border: `1px solid ${C.border}`,
            background: C.panel,
            borderRadius: 10,
            padding: "10px 14px",
            fontFamily: MONO,
            fontSize: 15,
            color: C.bright,
            textAlign: "left",
          }}
        >
          <span style={{ color: C.green, marginRight: 8 }}>◎</span>
          {typed}
          {cursorOn ? <span style={{ opacity: 0.85 }}>▍</span> : null}
        </div>

        <div
          style={{
            position: "absolute",
            top: 216,
            width: 344,
            height: 230,
            border: `1px solid ${C.border}`,
            background: C.panel,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {[220, 290, 250, 180].map((w, i) => (
            <div
              key={i}
              style={{
                margin: "16px 18px 0",
                height: i === 0 ? 22 : 10,
                width: w,
                borderRadius: 5,
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
              boxShadow: `0 0 18px ${C.green}`,
            }}
          />
        </div>

        <Caption text="paste a URL or a GitHub repo — scans start instantly" delay={92} size={12.5} bottom={34} />
      </AbsoluteFill>
    </FadeIn>
  );
}

function MobileSceneVerdicts() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <FadeIn>
      <AbsoluteFill style={{ backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
        <p
          style={{
            position: "absolute",
            top: 40,
            width: "100%",
            textAlign: "center",
            fontFamily: MONO,
            fontSize: 13,
            letterSpacing: "0.2em",
            color: C.dim,
          }}
        >
          SIX SCANNERS · ONE TARGET
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 11, width: 344, paddingTop: 30 }}>
          {VERDICTS.map(([name, verdict, color], i) => {
            const pop = spring({ frame: frame - i * 11, fps, config: { damping: 12, mass: 0.55 } });
            return (
              <div
                key={name}
                style={{
                  border: `1px solid ${C.border}`,
                  background: C.panel,
                  borderRadius: 11,
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  transform: `scale(${0.75 + 0.25 * pop})`,
                  opacity: pop,
                }}
              >
                <span style={{ fontFamily: MONO, fontSize: 13.5, letterSpacing: "0.06em", color: C.text }}>
                  {name}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: color as string,
                    border: `1px solid ${C.border}`,
                    borderRadius: 999,
                    padding: "3px 10px",
                    background: "#11170f",
                  }}
                >
                  {verdict}
                </span>
              </div>
            );
          })}
        </div>

        <Caption text="findings re-verified · evidence quoted · fix prompt included" delay={96} size={12} bottom={30} />
      </AbsoluteFill>
    </FadeIn>
  );
}

function MobileSceneEndCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, mass: 0.7 } });
  const glow = 0.5 + 0.5 * Math.sin(frame / 6);
  const arrowNudge = Math.sin(frame / 8) * 5;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.bg,
        alignItems: "center",
        justifyContent: "center",
        backgroundImage: `radial-gradient(300px 200px at 50% 46%, rgba(232,83,58,${0.1 + 0.05 * glow}), transparent 70%)`,
      }}
    >
      <div style={{ textAlign: "center", padding: "0 20px", transform: `scale(${0.9 + 0.1 * pop})` }}>
        <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em", color: C.bright, lineHeight: 1.15 }}>
          Six AI scanners.
          <br />
          One paste. Zero signup.
        </h2>
        <p style={{ fontFamily: MONO, fontSize: 12.5, color: C.text, marginTop: 14, lineHeight: 1.7 }}>
          security · seo/geo/perf · qa
          <br />
          auto qa · code · anti ai-slop
        </p>
        <p
          style={{
            display: "inline-block",
            fontFamily: MONO,
            fontSize: 13.5,
            fontWeight: 700,
            color: C.bright,
            border: `1px solid ${C.border}`,
            background: C.panel,
            borderRadius: 999,
            padding: "9px 18px",
            marginTop: 20,
          }}
        >
          scan your site free{" "}
          <span style={{ display: "inline-block", transform: `translateX(${arrowNudge}px)` }}>→</span>
        </p>
        <p style={{ fontFamily: MONO, fontSize: 11.5, color: C.dim, marginTop: 14, letterSpacing: "0.08em" }}>
          zhelp.space-z.ai/scanner
        </p>
      </div>
    </AbsoluteFill>
  );
}

function ScannerAdCompositionMobile() {
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: "inherit" }}>
      <Sequence from={0} durationInFrames={110}>
        <MobileSceneSweep />
      </Sequence>
      <Sequence from={110} durationInFrames={140}>
        <MobileSceneVerdicts />
      </Sequence>
      <Sequence from={250} durationInFrames={80}>
        <MobileSceneEndCard />
      </Sequence>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ */
/* Responsive Player                                                   */
/* ------------------------------------------------------------------ */

export default function ScannerAdPlayer({
  autoPlay = true,
  variant = "desktop",
}: {
  autoPlay?: boolean;
  variant?: RemotionVariant;
}) {
  const mobile = variant === "mobile";
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div style={{ ...EMBED_FADE, opacity: shown ? 1 : 0 }}>
      <Player
        component={mobile ? ScannerAdCompositionMobile : ScannerAdCompositionDesktop}
        durationInFrames={330}
        compositionWidth={mobile ? 400 : 1280}
        compositionHeight={mobile ? 640 : 400}
        fps={30}
        style={{ width: "100%", aspectRatio: mobile ? "5 / 8" : "16 / 5", display: "block" }}
        loop
        autoPlay={autoPlay}
        initiallyMuted
        acknowledgeRemotionLicense
      />
    </div>
  );
}
