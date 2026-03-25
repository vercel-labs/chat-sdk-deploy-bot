import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadModule = () => import("@/lib/env");

describe("checkReqEnv", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("passes when all required vars are set", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_SIGNING_SECRET = "secret";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.GITHUB_REPO_NAME = "webapp";
    process.env.GITHUB_REPO_OWNER = "acme";
    process.env.GITHUB_WORKFLOW_ID = "deploy.yml";

    const { checkReqEnv } = await loadModule();
    expect(() => {
      checkReqEnv();
    }).not.toThrow();
  });

  it("throws listing all missing vars", async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.REDIS_URL;
    delete process.env.GITHUB_REPO_NAME;
    delete process.env.GITHUB_REPO_OWNER;
    delete process.env.GITHUB_WORKFLOW_ID;

    const { checkReqEnv } = await loadModule();
    expect(() => {
      checkReqEnv();
    }).toThrow("GITHUB_TOKEN");
    expect(() => {
      checkReqEnv();
    }).toThrow("GITHUB_WEBHOOK_SECRET");
    expect(() => {
      checkReqEnv();
    }).toThrow("SLACK_BOT_TOKEN");
  });

  it("rejects whitespace-only values", async () => {
    process.env.GITHUB_TOKEN = "   ";
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_SIGNING_SECRET = "secret";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.GITHUB_REPO_NAME = "webapp";
    process.env.GITHUB_REPO_OWNER = "acme";
    process.env.GITHUB_WORKFLOW_ID = "deploy.yml";

    const { checkReqEnv } = await loadModule();
    expect(() => {
      checkReqEnv();
    }).toThrow("GITHUB_TOKEN");
  });
});
