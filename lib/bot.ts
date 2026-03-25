import { createGitHubAdapter } from "@chat-adapter/github";
import { createLinearAdapter } from "@chat-adapter/linear";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat } from "chat";

import { checkReqEnv } from "@/lib/env";
import { isLinearEnabled } from "@/lib/linear";

checkReqEnv();

export const LINEAR_ENABLED = isLinearEnabled();

export interface DeployThreadState {
  /** Workflow run ID — used to resume the approval hook */
  runId?: string;
  /** Internal deploy identifier */
  deployId?: string;
  /** Target environment */
  environment?: "staging" | "production";
  /** Git branch being deployed */
  branch?: string;
  /** HEAD commit SHA */
  commitSha?: string;
  /** Slack user ID of the person who triggered the deploy */
  triggeredBy?: string;
  /** Display name of the person who triggered the deploy */
  triggeredByName?: string;
}

const adapters = {
  github: createGitHubAdapter(),
  ...(LINEAR_ENABLED ? { linear: createLinearAdapter() } : {}),
  slack: createSlackAdapter(),
};

export const bot = new Chat<typeof adapters, DeployThreadState>({
  adapters,
  fallbackStreamingPlaceholderText: "Starting deploy…",
  state: createRedisState(),
  streamingUpdateIntervalMs: 500,
  userName: "deploy-bot",
}).registerSingleton();
