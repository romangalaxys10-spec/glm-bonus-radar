import type { Metadata } from "next";
import { AgentChatApp } from "@/components/portal/agent-chat";

export const metadata: Metadata = {
  title: "Z-Assist — your z.ai support agent · GLM Bonus Radar",
  description:
    "A full chat experience for anything z.ai: GLM models, coding plans, API usage, quotas, bonus windows and technical guidelines — grounded in the official docs (docs.z.ai). Register with your name, get a personal access token and continue your chats anytime, on any device.",
  alternates: { canonical: "/agent" },
  openGraph: {
    title: "Z-Assist — your z.ai support agent",
    description:
      "Chat about GLM models and z.ai services with a docs-grounded agent. Personal access token, resumable threads, interactive answers.",
    type: "website",
  },
};

/**
 * /agent — the Z-Assist full-page chat (a chat.z.ai-style experience for
 * z.ai support). Fonts load globally in the root layout (IBM Plex Sans/Mono).
 */
export default function AgentChatPage() {
  return <AgentChatApp />;
}
