# Chat SDK Deploy Bot Template

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Fchat-sdk-deploy-bot&env=SLACK_BOT_TOKEN,SLACK_SIGNING_SECRET,GITHUB_TOKEN,GITHUB_WEBHOOK_SECRET,GITHUB_REPO_OWNER,GITHUB_REPO_NAME,GITHUB_WORKFLOW_ID,REDIS_URL)

A deploy orchestrator built with [Chat SDK](https://chat-sdk.dev) and [Vercel Workflow](https://vercel.com/workflow). Trigger deploys from Slack, gate production with approval, dispatch GitHub Actions, and notify GitHub and Linear when the run finishes.

## What It Does

- `/deploy staging` starts a staging deploy on `main` immediately.
- `/deploy production` (or `/deploy prod`) posts an approval card first, then runs only after approval.
- `/deploy` with no arguments opens a modal where you can pick an environment and optionally specify a branch (defaults to `main`).
- The workflow dispatches a GitHub Actions run, polls it (up to 60 minutes), posts status updates, and ends with a summary card.
- On successful deploys, if Linear is enabled, the bot finds issues from the deploy branch and commit messages, comments on them, and transitions production issues to your configured done state.
- On successful deploys, GitHub PRs touched by the commit are commented with the deploy summary.
- If a deploy fails to dispatch or the run can't be found, the triggerer receives a private notification.

## Setup

### Slack

The quickest way to get started is to create your app from the included manifest:

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** → **From a manifest**
2. Select your workspace, paste the contents of [`slack-manifest.json`](./slack-manifest.json), and create the app
3. Replace `https://example.com` in **Interactivity & Shortcuts** with your actual domain (or ngrok URL during development)
4. Install the app to your workspace
5. Copy the **Bot User OAuth Token** from **OAuth & Permissions** and the **Signing Secret** from **Basic Information** into your `.env.local`

<details>
<summary>Manual setup (without manifest)</summary>

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps).
2. Under **OAuth & Permissions**, add the bot token scopes: `chat:write`, `commands`, `im:write`, `channels:history`, `channels:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `users:read`
3. Add a slash command:
   - Command: `/deploy`
   - Request URL: `https://your-domain.vercel.app/api/webhooks/slack`
4. Enable **Interactivity & Shortcuts** and set the request URL to the same Slack webhook URL.
5. Install the app to your workspace and copy the bot token and signing secret.

</details>

### GitHub

1. Create a fine-grained PAT for the target repository.
2. Grant the repository permissions:
   - Actions: read and write
   - Contents: read
   - Issues: write
   - Pull requests: read
3. Set `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`, and `GITHUB_WORKFLOW_ID` (the workflow filename, e.g. `deploy.yml`, or its numeric ID).
4. Point the target workflow at a `workflow_dispatch`-enabled deploy workflow.

Your target workflow should ideally accept:

- `environment` (recommended)
- `deploy_id` (optional)

The bot gracefully degrades if the workflow doesn't accept all inputs — it tries `{ environment, deploy_id }`, then `{ environment }` alone, then no inputs.

Example:

```yaml
name: Deploy

on:
  workflow_dispatch:
    inputs:
      environment:
        description: Target environment
        required: true
        type: choice
        options:
          - staging
          - production
      deploy_id:
        description: Optional deploy correlation ID
        required: false
        type: string

run-name: Deploy ${{ inputs.environment }} (${{ inputs.deploy_id || github.sha }})
```

`deploy_id` is optional, but including it in `run-name` helps the bot reliably match the run it just dispatched.

5. If you want GitHub comment-thread support through the adapter, add a repository webhook pointing at `https://your-domain.vercel.app/api/webhooks/github` with content type `application/json` and the same secret as `GITHUB_WEBHOOK_SECRET`. Subscribe to `issue_comment` and `pull_request_review_comment`.

### Deploy Tags (required for Linear)

If Linear is enabled, your deploy pipeline must keep these tags moving in the target repo:

- `deploy/staging/previous`
- `deploy/staging/latest`
- `deploy/production/previous`
- `deploy/production/latest`

The bot compares `deploy/{environment}/previous` and `deploy/{environment}/latest` to find the commit range for Linear issue detection. It does not create or move those tags itself.

### Linear

Linear is optional. Set `LINEAR_API_KEY` to enable it. No separate Linear webhook setup is required.

Behavior:

- Issue keys are extracted from the deploy branch and commit messages using `LINEAR_TEAM_PREFIX`.
- `LINEAR_TEAM_PREFIX` defaults to `ENG`.
- `LINEAR_PRODUCTION_STATE` defaults to `Done`.
- On successful deploys, staging deploys comment on linked issues.
- On successful deploys, production deploys comment on linked issues and transition them to the configured production state.
- If the tag comparison fails, the bot skips Linear updates rather than guessing from unrelated commits.
- If the configured production state does not exist on a team, the workflow fails that Linear step instead of silently pretending it succeeded.

## Environment Variables

Required:

- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `GITHUB_TOKEN`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_REPO_OWNER`
- `GITHUB_REPO_NAME`
- `GITHUB_WORKFLOW_ID`
- `REDIS_URL`

Optional:

- `LINEAR_API_KEY`
- `LINEAR_TEAM_PREFIX`
- `LINEAR_PRODUCTION_STATE`
- `DEPLOY_PROD_ALLOWED`
- `DEPLOY_PROD_APPROVERS`

## Permissions

- `DEPLOY_PROD_ALLOWED` controls who can start production deploys (comma-separated Slack user IDs). If empty or unset, nobody can trigger production deploys.
- `DEPLOY_PROD_APPROVERS` controls who can approve production deploys (comma-separated Slack user IDs). If empty or unset, nobody can approve.
- Only the person who triggered a deploy can cancel it.
- Staging deploys are available to everyone.

## How It Works

1. A Slack slash command or modal submission creates a deploy request.
2. For production deploys, the bot edits the initial deploy card to add an approval prompt with Approve and Cancel buttons, then pauses the workflow until someone responds.
3. The workflow dispatches a GitHub Actions run and polls until it completes (up to 60 minutes).
4. On successful runs, the bot comments on GitHub PRs and (if Linear is enabled) on linked Linear issues.
5. A final summary card is posted back to Slack with environment, branch, commit, duration, linked issues, and a link to the workflow run.

## Local Development

```bash
git clone <repo-url>
cd <repo-dir>
pnpm install
cp .env.example .env.local
pnpm dev
```

## Deploying

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Fchat-sdk-deploy-bot&env=SLACK_BOT_TOKEN,SLACK_SIGNING_SECRET,GITHUB_TOKEN,GITHUB_WEBHOOK_SECRET,GITHUB_REPO_OWNER,GITHUB_REPO_NAME,GITHUB_WORKFLOW_ID,REDIS_URL)

Or deploy manually:

```bash
vercel deploy
```

## Scripts

| Command           | Description                      |
| ----------------- | -------------------------------- |
| `pnpm dev`        | Start dev server with hot reload |
| `pnpm build`      | Production build via Next.js     |
| `pnpm test`       | Run tests with coverage          |
| `pnpm type-check` | Type-check without emitting      |
| `pnpm check`      | Lint and format check            |
| `pnpm fix`        | Auto-fix lint and format issues  |
| `pnpm validate`   | Run check, type-check, and tests |

## Adding Other Platforms

Chat SDK supports multiple platforms. You can extend this bot to post deploy cards to Microsoft Teams, Google Chat, Discord, or Telegram by registering additional adapters:

```typescript
// lib/bot.ts
import { createTeamsAdapter } from "@chat-adapter/teams";
import { createGoogleChatAdapter } from "@chat-adapter/gchat";

export const bot = new Chat({
  adapters: {
    slack: createSlackAdapter(),
    teams: createTeamsAdapter(),
    gchat: createGoogleChatAdapter(),
  },
  state: createRedisState(),
  userName: "deploy-bot",
});
```

Then add a webhook route for each platform — the existing `app/api/webhooks/[platform]/route.ts` dynamic route already supports any adapter name registered above.

Cards, fields, and buttons render natively on each platform (Block Kit on Slack, Adaptive Cards on Teams, Google Chat Cards, etc.). Note that **modals are currently Slack-only**, so the `/deploy` modal (no arguments) will only work on Slack.

See the [Chat SDK adapter docs](https://chat-sdk.dev/adapters) for the full list of supported platforms and their feature matrices.

## License

Apache-2.0
