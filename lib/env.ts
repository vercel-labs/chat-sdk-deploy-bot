const REQUIRED_ENV_VARS = [
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "GITHUB_TOKEN",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_REPO_NAME",
  "GITHUB_REPO_OWNER",
  "GITHUB_WORKFLOW_ID",
  "REDIS_URL",
] as const;

export const checkReqEnv = (): void => {
  const missing = REQUIRED_ENV_VARS.filter((key) => {
    const value = process.env[key];
    return value === undefined || value.trim() === "";
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join("\n")}`
    );
  }
};
