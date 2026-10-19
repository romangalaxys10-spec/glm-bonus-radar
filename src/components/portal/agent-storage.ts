/**
 * Shared storage keys + identity type for the Z-Assist full-page chat.
 * Kept in its own module so agent-chat.tsx (root) and agent-shell.tsx
 * (workspace) never import each other in a cycle.
 */

export const TOKEN_KEY = "br-agent-token";
export const NAME_KEY = "br-agent-name";
export const CONV_KEY = "br-agent-conv";
export const MODEL_KEY = "br-agent-model";

export interface AgentUser {
  name: string;
  token: string;
}
