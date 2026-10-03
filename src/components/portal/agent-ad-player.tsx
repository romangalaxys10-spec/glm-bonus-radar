"use client";

/**
 * Immersive Remotion simulation ad — the visual engine for the "24x7 Agent"
 * page's looping walkthrough (see agent-ad-remotion.tsx for the mount).
 *
 * 16 seconds @ 30fps, four scenes:
 *   1. 02:00 problem  — the laptop sleeps, the agent dies with it
 *   2. one command    — `xshredo deploy …` → live in 7m 42s
 *   3. always-on      — uptime ticking, tasks completing, traffic flowing
 *   4. end card       — "24x7 Agent · from $5.75/mo · Powered by xShredo"
 *
 * Doctrine: fixed cinematic palette (theme-independent, same family as the
 * static terminal demo), no emoji, mono type, and every number shown already
 * exists on the page — nothing invented. "SIMULATION" is stamped in the HTML
 * chrome around the player (agent-ad-remotion.tsx), always visible.
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

/* Fixed palette — mirrors the static terminal demo on the same page. */
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

/** 6-frame fade-in so scene cuts don't feel hard. */
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
  size = 17,
  bottom = 28,
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
        letterSpacing: "0.08em",
        color: C.dim,
        opacity,
        padding: "0 16px",
      }}
    >
      {text}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 1 — the 02:00 problem                                         */
/* ------------------------------------------------------------------ */

function SceneLaptopDies() {
  const frame = useCurrentFrame();

  /* Wall clock 01:59:57 → 02:00:10, one tick every 6 frames. */
  const s = 57 + Math.floor(frame / 6);
  const stamp = `01:59:${String(Math.min(s, 59)).padStart(2, "0")}`;
  const pastMidnight = s >= 60;

  /* Lid closes between f20 and f52 — screen squashes shut, glow dies. */
  const lidClose = interpolate(frame, [20, 52], [1, 0.04], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  const glow = interpolate(frame, [20, 50], [0.9, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const offlineBlink = pastMidnight ? (frame % 24 < 14 ? 1 : 0.25) : 0;

  return (
    <FadeIn>
      <AbsoluteFill style={{ backgroundColor: C.bg, justifyContent: "center" }}>
        {/* clock */}
        <p
          style={{
            position: "absolute",
            top: 56,
            width: "100%",
            textAlign: "center",
            fontFamily: MONO,
            fontSize: 30,
            color: pastMidnight ? C.red : C.dim,
            letterSpacing: "0.2em",
          }}
        >
          {pastMidnight ? "02:00:00" : stamp}
        </p>

        {/* laptop: screen squashes shut onto its base */}
        <div style={{ position: "absolute", top: 130, width: "100%" }}>
          <div
            style={{
              margin: "0 auto",
              width: 300,
              height: 190,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: 280,
                height: 170,
                transform: `scaleY(${lidClose})`,
                transformOrigin: "bottom",
                backgroundColor: "#101812",
                border: `2px solid ${C.border}`,
                borderRadius: 10,
                boxShadow: `0 0 ${44 * glow}px rgba(143,214,148,${0.35 * glow})`,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                overflow: "hidden",
              }}
            >
              {/* frozen task rows */}
              {["scrape-bonus-windows", "post-digest-to-channel", "watch-inbox"].map((t, i) => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: i === 0 ? C.amber : C.dim,
                      opacity: glow,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 13,
                      color: C.text,
                      opacity: glow,
                    }}
                  >
                    {t}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 12, color: C.dim, opacity: glow }}>
                    {i === 0 ? "running…" : "queued"}
                  </span>
                </div>
              ))}
              <div style={{ marginTop: "auto", height: 6, width: `${47 * glow}%`, background: C.amber, borderRadius: 999 }} />
            </div>
            {/* base */}
            <div style={{ width: 320, height: 12, background: "#182019", borderRadius: "0 0 12px 12px", border: `2px solid ${C.border}`, borderTop: "none" }} />
          </div>
        </div>

        {/* offline stamp */}
        {pastMidnight ? (
          <p
            style={{
              position: "absolute",
              top: 372,
              width: "100%",
              textAlign: "center",
              fontFamily: MONO,
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: "0.28em",
              color: C.red,
              opacity: offlineBlink,
            }}
          >
            AGENT OFFLINE
          </p>
        ) : null}

        <Caption text="your machine sleeps — your agent dies with it" delay={64} />
      </AbsoluteFill>
    </FadeIn>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 2 — one command                                               */
/* ------------------------------------------------------------------ */

const DEPLOY_CMD = "xshredo deploy ollama-open-webui --size m";

function SceneTerminal() {
  const frame = useCurrentFrame(); // local to the Sequence

  /* typing: ~0.6 chars/frame starting f8 */
  const chars = Math.floor(interpolate(frame, [8, 78], [0, DEPLOY_CMD.length], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  const typed = DEPLOY_CMD.slice(0, chars);
  const cursorOn = frame % 16 < 9;

  const lines: Array<[string, number]> = [
    ["→ provisioning KVM VM in TPA01 … done (42s)", 84],
    ["→ mounting 200 GB ceph-nvme … done (3s)", 100],
    ["→ installing ollama · open-webui … pre-built", 116],
    ["→ opening firewall 11434/3000 … done (1s)", 132],
  ];

  const barPct = interpolate(frame, [140, 158], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const livePop = spring({ frame: frame - 160, fps: 30, config: { damping: 12, mass: 0.6 } });
  const liveVisible = frame >= 161;

  return (
    <FadeIn>
      <AbsoluteFill style={{ backgroundColor: C.panel, justifyContent: "center", padding: "0 96px" }}>
        <div
          style={{
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            background: "#0c110d",
            overflow: "hidden",
            boxShadow: "0 24px 60px -30px rgba(0,0,0,0.8)",
          }}
        >
          {/* title bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${C.borderDim}`, padding: "10px 16px" }}>
            {["#e8533a", "#a8822d", "#5d7a52"].map((dot) => (
              <span key={dot} style={{ width: 11, height: 11, borderRadius: 999, background: dot }} />
            ))}
            <span style={{ marginLeft: 10, fontFamily: MONO, fontSize: 13, color: C.dim }}>root@portal — 80×24</span>
          </div>

          <div style={{ fontFamily: MONO, fontSize: 19, lineHeight: 2, padding: "22px 26px", minHeight: 300 }}>
            <p style={{ color: C.bright }}>
              $ {typed}
              {cursorOn && chars < DEPLOY_CMD.length ? <span style={{ opacity: 0.85 }}>▍</span> : null}
            </p>
            {lines.map(([line, at]) => (
              <p key={line} style={{ color: C.dim, opacity: frame >= at ? 1 : 0 }}>
                {line}
              </p>
            ))}
            {frame >= 140 ? (
              <div style={{ marginTop: 6, height: 10, width: "62%", background: "#141b14", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${barPct}%`, background: C.green, borderRadius: 999 }} />
              </div>
            ) : null}
            {liveVisible ? (
              <p style={{ color: C.green, fontWeight: 700, transform: `scale(${0.9 + 0.1 * livePop})`, transformOrigin: "left" }}>
                ✓ live in 7m 42s — http://10.0.0.14:3000
              </p>
            ) : null}
          </div>
        </div>

        <Caption text="one command · ~10 minutes · full root" delay={150} />
      </AbsoluteFill>
    </FadeIn>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 3 — always-on dashboard                                       */
/* ------------------------------------------------------------------ */

function SceneDashboard() {
  const frame = useCurrentFrame();

  /* uptime: 14d 06:32:11 + one simulated second every 3 frames */
  const simSeconds = 14 * 86400 + 6 * 3600 + 32 * 60 + 11 + Math.floor(frame / 3);
  const d = Math.floor(simSeconds / 86400);
  const h = Math.floor((simSeconds % 86400) / 3600);
  const m = Math.floor((simSeconds % 3600) / 60);
  const s = simSeconds % 60;
  const uptime = `${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  const tasks = 312 + Math.floor(frame / 12);
  const cpu = 22 + 18 * Math.sin(frame / 7);
  const ram = 41 + 6 * Math.sin(frame / 11 + 2);
  const trafficPct = Math.min(74, 68 + frame * 0.06);
  const pingPulse = 0.5 + 0.5 * Math.sin(frame / 5);

  const stacks = ["Ollama", "Open WebUI", "n8n", "ComfyUI", "Qdrant", "Whisper"];

  return (
    <FadeIn>
      <AbsoluteFill style={{ backgroundColor: C.bg, justifyContent: "center", padding: "0 96px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          {/* uptime */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.panel, padding: "20px 24px" }}>
            <p style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.18em", color: C.dim }}>UPTIME</p>
            <p style={{ fontFamily: MONO, fontSize: 40, fontWeight: 700, color: C.bright, marginTop: 8 }}>{uptime}</p>
            <p style={{ fontFamily: MONO, fontSize: 13, color: C.green, marginTop: 6 }}>● tpa01 · 2N power · 10 Gbps</p>
          </div>

          {/* tasks */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.panel, padding: "20px 24px" }}>
            <p style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.18em", color: C.dim }}>TASKS COMPLETED</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 8 }}>
              <p style={{ fontFamily: MONO, fontSize: 40, fontWeight: 700, color: C.bright }}>{tasks}</p>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: C.green,
                  opacity: 0.4 + 0.6 * pingPulse,
                  boxShadow: `0 0 ${10 * pingPulse}px ${C.green}`,
                  alignSelf: "center",
                }}
              />
            </div>
            <p style={{ fontFamily: MONO, fontSize: 13, color: C.dim, marginTop: 6 }}>overnight queue · zero babysitting</p>
          </div>

          {/* gauges */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.panel, padding: "20px 24px", gridColumn: "1 / -1" }}>
            {[
              ["CPU", `${Math.round(cpu)}%`, cpu, C.green],
              ["RAM", `${Math.round(ram)}%`, ram, C.amber],
            ].map(([label, val, pct, color]) => (
              <div key={label as string} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
                <span style={{ fontFamily: MONO, fontSize: 13, color: C.dim, width: 44 }}>{label}</span>
                <div style={{ flex: 1, height: 8, background: "#141b14", borderRadius: 999 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: color as string, borderRadius: 999 }} />
                </div>
                <span style={{ fontFamily: MONO, fontSize: 13, color: C.text, width: 40, textAlign: "right" }}>{val}</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ fontFamily: MONO, fontSize: 13, color: C.dim, width: 44 }}>NET</span>
              <div style={{ flex: 1, height: 8, background: "#141b14", borderRadius: 999 }}>
                <div style={{ height: "100%", width: `${trafficPct}%`, background: C.green, borderRadius: 999 }} />
              </div>
              <span style={{ fontFamily: MONO, fontSize: 13, color: C.text, width: 92, textAlign: "right" }}>1.4 / 2 TB</span>
            </div>
          </div>
        </div>

        {/* stack chips */}
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 20 }}>
          {stacks.map((name, i) => {
            const on = frame >= 26 + i * 6;
            return (
              <span
                key={name}
                style={{
                  fontFamily: MONO,
                  fontSize: 14,
                  color: on ? C.text : "transparent",
                  border: `1px solid ${on ? C.border : "transparent"}`,
                  background: on ? "#11170f" : "transparent",
                  borderRadius: 999,
                  padding: "6px 14px",
                  transition: "none",
                }}
              >
                {name}
              </span>
            );
          })}
        </div>

        <Caption text="it never sleeps — neither do your agents" delay={70} />
      </AbsoluteFill>
    </FadeIn>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 4 — end card                                                  */
/* ------------------------------------------------------------------ */

function SceneEndCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, mass: 0.7 } });
  const glow = 0.5 + 0.5 * Math.sin(frame / 6);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.bg,
        alignItems: "center",
        justifyContent: "center",
        backgroundImage: `radial-gradient(420px 260px at 50% 46%, rgba(232,83,58,${0.10 + 0.05 * glow}), transparent 70%)`,
      }}
    >
      <div style={{ textAlign: "center", transform: `scale(${0.86 + 0.14 * pop})` }}>
        <p style={{ fontFamily: MONO, fontSize: 17, letterSpacing: "0.3em", color: C.red, marginBottom: 18 }}>
          24×7
        </p>
        <h1 style={{ fontSize: 88, fontWeight: 800, letterSpacing: "-0.03em", color: C.bright, lineHeight: 1 }}>
          24x7 Agent
        </h1>
        <p style={{ fontFamily: MONO, fontSize: 20, color: C.text, marginTop: 20 }}>
          an AI agent computer that never sleeps
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
            padding: "10px 22px",
            marginTop: 26,
          }}
        >
          from $5.75/mo · powered by xShredo
        </p>
        <p style={{ fontFamily: MONO, fontSize: 15, color: C.dim, marginTop: 22 }}>zhelp.space-z.ai/agent</p>
      </div>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ */
/* Composition + Player                                                */
/* ------------------------------------------------------------------ */

const FPS = 30;

function AgentAdCompositionDesktop() {
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: "inherit" }}>
      <Sequence from={0} durationInFrames={100}>
        <SceneLaptopDies />
      </Sequence>
      <Sequence from={100} durationInFrames={165}>
        <SceneTerminal />
      </Sequence>
      <Sequence from={265} durationInFrames={150}>
        <SceneDashboard />
      </Sequence>
      <Sequence from={415} durationInFrames={65}>
        <SceneEndCard />
      </Sequence>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile scenes (400×740) — phone proportions, stacked layout         */
/* ------------------------------------------------------------------ */

function MobileSceneLaptopDies() {
  const frame = useCurrentFrame();

  const s = 57 + Math.floor(frame / 6);
  const pastMidnight = s >= 60;
  const lidClose = interpolate(frame, [20, 52], [1, 0.04], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  const glow = interpolate(frame, [20, 50], [0.9, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const offlineBlink = pastMidnight ? (frame % 24 < 14 ? 1 : 0.25) : 0;

  return (
    <FadeIn>
      <AbsoluteFill style={{ backgroundColor: C.bg }}>
        <p
          style={{
            position: "absolute",
            top: 96,
            width: "100%",
            textAlign: "center",
            fontFamily: MONO,
            fontSize: 20,
            color: pastMidnight ? C.red : C.dim,
            letterSpacing: "0.2em",
          }}
        >
          {pastMidnight ? "02:00:00" : `01:59:${String(Math.min(s, 59)).padStart(2, "0")}`}
        </p>

        <div style={{ position: "absolute", top: 190, width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div
            style={{
              width: 236,
              height: 148,
              transform: `scaleY(${lidClose})`,
              transformOrigin: "bottom",
              backgroundColor: "#101812",
              border: `2px solid ${C.border}`,
              borderRadius: 9,
              boxShadow: `0 0 ${34 * glow}px rgba(143,214,148,${0.35 * glow})`,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              overflow: "hidden",
            }}
          >
            {["scrape-bonus-windows", "post-digest", "watch-inbox"].map((t, i) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: i === 0 ? C.amber : C.dim,
                    opacity: glow,
                  }}
                />
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.text, opacity: glow }}>{t}</span>
              </div>
            ))}
            <div style={{ marginTop: "auto", height: 5, width: `${47 * glow}%`, background: C.amber, borderRadius: 999 }} />
          </div>
          <div style={{ width: 264, height: 10, background: "#182019", borderRadius: "0 0 10px 10px", border: `2px solid ${C.border}`, borderTop: "none" }} />
        </div>

        {pastMidnight ? (
          <p
            style={{
              position: "absolute",
              top: 430,
              width: "100%",
              textAlign: "center",
              fontFamily: MONO,
              fontSize: 21,
              fontWeight: 700,
              letterSpacing: "0.24em",
              color: C.red,
              opacity: offlineBlink,
            }}
          >
            AGENT OFFLINE
          </p>
        ) : null}

        <Caption text="your machine sleeps — your agent dies with it" delay={64} size={12.5} bottom={36} />
      </AbsoluteFill>
    </FadeIn>
  );
}

function MobileSceneTerminal() {
  const frame = useCurrentFrame();

  const chars = Math.floor(
    interpolate(frame, [8, 78], [0, DEPLOY_CMD.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const typed = DEPLOY_CMD.slice(0, chars);
  const cursorOn = frame % 16 < 9;

  const lines: Array<[string, number]> = [
    ["→ provisioning KVM VM in TPA01 … done (42s)", 84],
    ["→ mounting 200 GB ceph-nvme … done (3s)", 100],
    ["→ installing ollama · open-webui … pre-built", 116],
    ["→ opening firewall 11434/3000 … done (1s)", 132],
  ];

  const barPct = interpolate(frame, [140, 158], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const livePop = spring({ frame: frame - 160, fps: 30, config: { damping: 12, mass: 0.6 } });
  const liveVisible = frame >= 161;

  return (
    <FadeIn>
      <AbsoluteFill style={{ backgroundColor: C.panel, padding: "0 16px", justifyContent: "center" }}>
        <div
          style={{
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            background: "#0c110d",
            overflow: "hidden",
            boxShadow: "0 20px 50px -30px rgba(0,0,0,0.8)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, borderBottom: `1px solid ${C.borderDim}`, padding: "9px 14px" }}>
            {["#e8533a", "#a8822d", "#5d7a52"].map((dot) => (
              <span key={dot} style={{ width: 9, height: 9, borderRadius: 999, background: dot }} />
            ))}
            <span style={{ marginLeft: 8, fontFamily: MONO, fontSize: 11, color: C.dim }}>root@portal</span>
          </div>

          <div style={{ fontFamily: MONO, fontSize: 13, lineHeight: 1.95, padding: "16px 15px", minHeight: 320 }}>
            <p style={{ color: C.bright }}>
              $ {typed}
              {cursorOn && chars < DEPLOY_CMD.length ? <span style={{ opacity: 0.85 }}>▍</span> : null}
            </p>
            {lines.map(([line, at]) => (
              <p key={line} style={{ color: C.dim, opacity: frame >= at ? 1 : 0 }}>
                {line}
              </p>
            ))}
            {frame >= 140 ? (
              <div style={{ marginTop: 6, height: 8, width: "88%", background: "#141b14", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${barPct}%`, background: C.green, borderRadius: 999 }} />
              </div>
            ) : null}
            {liveVisible ? (
              <p style={{ color: C.green, fontWeight: 700, transform: `scale(${0.9 + 0.1 * livePop})`, transformOrigin: "left" }}>
                ✓ live in 7m 42s
              </p>
            ) : null}
          </div>
        </div>

        <Caption text="one command · ~10 minutes · full root" delay={150} size={12.5} bottom={34} />
      </AbsoluteFill>
    </FadeIn>
  );
}

function MobileSceneDashboard() {
  const frame = useCurrentFrame();

  const simSeconds = 14 * 86400 + 6 * 3600 + 32 * 60 + 11 + Math.floor(frame / 3);
  const d = Math.floor(simSeconds / 86400);
  const h = Math.floor((simSeconds % 86400) / 3600);
  const m = Math.floor((simSeconds % 3600) / 60);
  const s = simSeconds % 60;
  const uptime = `${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  const tasks = 312 + Math.floor(frame / 12);
  const cpu = 22 + 18 * Math.sin(frame / 7);
  const ram = 41 + 6 * Math.sin(frame / 11 + 2);
  const trafficPct = Math.min(74, 68 + frame * 0.06);
  const pingPulse = 0.5 + 0.5 * Math.sin(frame / 5);

  const stacks = ["Ollama", "n8n", "ComfyUI", "Whisper", "Qdrant"];

  const card = {
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    background: C.panel,
    padding: "14px 18px",
  } as const;

  return (
    <FadeIn>
      <AbsoluteFill style={{ backgroundColor: C.bg, padding: "0 20px", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={card}>
            <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", color: C.dim }}>UPTIME</p>
            <p style={{ fontFamily: MONO, fontSize: 27, fontWeight: 700, color: C.bright, marginTop: 6 }}>{uptime}</p>
          </div>

          <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", color: C.dim }}>TASKS COMPLETED</p>
              <p style={{ fontFamily: MONO, fontSize: 27, fontWeight: 700, color: C.bright, marginTop: 6 }}>{tasks}</p>
            </div>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: C.green,
                opacity: 0.4 + 0.6 * pingPulse,
                boxShadow: `0 0 ${10 * pingPulse}px ${C.green}`,
              }}
            />
          </div>

          <div style={card}>
            {[
              ["CPU", `${Math.round(cpu)}%`, cpu, C.green],
              ["RAM", `${Math.round(ram)}%`, ram, C.amber],
              ["NET", "1.4 / 2 TB", trafficPct, C.green],
            ].map(([label, val, pct, color]) => (
              <div key={label as string} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 9 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim, width: 36 }}>{label}</span>
                <div style={{ flex: 1, height: 7, background: "#141b14", borderRadius: 999 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: color as string, borderRadius: 999 }} />
                </div>
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.text, width: 66, textAlign: "right" }}>{val}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 7 }}>
            {stacks.map((name, i) => {
              const on = frame >= 26 + i * 5;
              return (
                <span
                  key={name}
                  style={{
                    fontFamily: MONO,
                    fontSize: 11.5,
                    color: on ? C.text : "transparent",
                    border: `1px solid ${on ? C.border : "transparent"}`,
                    background: on ? "#11170f" : "transparent",
                    borderRadius: 999,
                    padding: "5px 11px",
                  }}
                >
                  {name}
                </span>
              );
            })}
          </div>
        </div>

        <Caption text="it never sleeps — neither do your agents" delay={70} size={12.5} bottom={30} />
      </AbsoluteFill>
    </FadeIn>
  );
}

function MobileSceneEndCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, mass: 0.7 } });
  const glow = 0.5 + 0.5 * Math.sin(frame / 6);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.bg,
        alignItems: "center",
        justifyContent: "center",
        backgroundImage: `radial-gradient(280px 200px at 50% 44%, rgba(232,83,58,${0.1 + 0.05 * glow}), transparent 70%)`,
      }}
    >
      <div style={{ textAlign: "center", padding: "0 18px", transform: `scale(${0.88 + 0.12 * pop})` }}>
        <p style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.3em", color: C.red, marginBottom: 12 }}>24×7</p>
        <h1 style={{ fontSize: 46, fontWeight: 800, letterSpacing: "-0.02em", color: C.bright, lineHeight: 1.05 }}>
          24x7 Agent
        </h1>
        <p style={{ fontFamily: MONO, fontSize: 13.5, color: C.text, marginTop: 14 }}>
          an AI agent computer that never sleeps
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
            padding: "8px 16px",
            marginTop: 18,
          }}
        >
          from $5.75/mo · xShredo
        </p>
        <p style={{ fontFamily: MONO, fontSize: 12, color: C.dim, marginTop: 14 }}>zhelp.space-z.ai/agent</p>
      </div>
    </AbsoluteFill>
  );
}

function AgentAdCompositionMobile() {
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: "inherit" }}>
      <Sequence from={0} durationInFrames={100}>
        <MobileSceneLaptopDies />
      </Sequence>
      <Sequence from={100} durationInFrames={165}>
        <MobileSceneTerminal />
      </Sequence>
      <Sequence from={265} durationInFrames={150}>
        <MobileSceneDashboard />
      </Sequence>
      <Sequence from={415} durationInFrames={65}>
        <MobileSceneEndCard />
      </Sequence>
    </AbsoluteFill>
  );
}

export default function AgentAdPlayer({
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
        component={mobile ? AgentAdCompositionMobile : AgentAdCompositionDesktop}
        durationInFrames={480}
        compositionWidth={mobile ? 400 : 1280}
        compositionHeight={mobile ? 740 : 720}
        fps={FPS}
        style={{
          width: "100%",
          aspectRatio: mobile ? "20 / 37" : "16 / 9",
          display: "block",
        }}
        loop
        autoPlay={autoPlay}
        initiallyMuted
        controls
        clickToPlay
        doubleClickToFullscreen
        spaceKeyToPlayOrPause
        acknowledgeRemotionLicense
      />
    </div>
  );
}
