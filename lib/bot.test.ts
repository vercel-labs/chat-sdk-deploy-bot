import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  checkReqEnv: vi.fn(),
}));

vi.mock("@chat-adapter/github", () => ({
  createGitHubAdapter: vi.fn(() => ({ name: "github" })),
}));

vi.mock("@chat-adapter/linear", () => ({
  createLinearAdapter: vi.fn(() => ({ name: "linear" })),
}));

vi.mock("@chat-adapter/slack", () => ({
  createSlackAdapter: vi.fn(() => ({ name: "slack" })),
}));

vi.mock("@chat-adapter/state-redis", () => ({
  createRedisState: vi.fn(() => ({ name: "redis" })),
}));

const mockRegisterSingleton = vi.fn().mockReturnThis();
const chatConstructorCalls: unknown[][] = [];

vi.mock("chat", () => ({
  Chat: class Chat {
    constructor(...args: unknown[]) {
      chatConstructorCalls.push(args);
      mockRegisterSingleton.mockReturnValue(this);
    }
    registerSingleton = mockRegisterSingleton;
  },
}));

describe("bot", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    chatConstructorCalls.length = 0;
    mockRegisterSingleton.mockClear();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("creates a Chat instance with correct config and registers singleton", async () => {
    const { bot } = await import("@/lib/bot");

    expect(chatConstructorCalls.length).toBeGreaterThanOrEqual(1);
    const config = chatConstructorCalls[0]?.[0];
    expect(config).toHaveProperty("userName", "deploy-bot");
    expect(config).toHaveProperty("adapters");
    expect(mockRegisterSingleton).toHaveBeenCalledOnce();
    expect(bot).toBeDefined();
  });

  it("excludes linear adapter when LINEAR_API_KEY is not set", async () => {
    delete process.env.LINEAR_API_KEY;
    const { LINEAR_ENABLED } = await import("@/lib/bot");
    expect(LINEAR_ENABLED).toBe(false);

    const config = chatConstructorCalls[0]?.[0] as Record<string, unknown>;
    const adapters = config.adapters as Record<string, unknown>;
    expect(adapters).not.toHaveProperty("linear");
  });

  it("includes linear adapter when LINEAR_API_KEY is set", async () => {
    process.env.LINEAR_API_KEY = "lin_api_test";
    const { LINEAR_ENABLED } = await import("@/lib/bot");
    expect(LINEAR_ENABLED).toBe(true);

    const config = chatConstructorCalls[0]?.[0] as Record<string, unknown>;
    const adapters = config.adapters as Record<string, unknown>;
    expect(adapters).toHaveProperty("linear");
  });

  it("treats whitespace-only LINEAR_API_KEY as disabled", async () => {
    process.env.LINEAR_API_KEY = "   ";
    const { LINEAR_ENABLED } = await import("@/lib/bot");
    expect(LINEAR_ENABLED).toBe(false);
  });
});
