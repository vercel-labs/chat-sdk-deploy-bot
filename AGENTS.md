# Chat SDK Deploy Bot

A deploy orchestrator built with Chat SDK and Vercel Workflow. Trigger deploys from Slack, gate production with approval, dispatch GitHub Actions, and notify GitHub and Linear when the run finishes.

## Stack

- **Chat SDK** (`chat` + `@chat-adapter/slack` + `@chat-adapter/github` + `@chat-adapter/linear` + `@chat-adapter/state-redis`) — Multi-platform bot framework
- **Next.js** (App Router) — Server and routing
- **Vercel Workflow** — Durable deploy orchestration
- **Octokit** — GitHub Actions dispatch and polling
- **Linear SDK** — Issue commenting and state transitions
- **Vitest** — Testing
- **Ultracite** — Linting and formatting

## Project Structure

```
app/
  api/
    webhooks/
      [platform]/
        route.ts        Dynamic webhook handler for Slack, GitHub, etc.
lib/
  bot.ts                Chat SDK bot instance with Slack, GitHub, and Linear adapters
  deploy-card.ts        Card builders for deploy status, approval, and summary
  deploy-handlers.ts    Slash command, action, and modal handlers
  env.ts                Environment variable validation
  github.ts             GitHub Actions dispatch, polling, and PR commenting
  linear.ts             Linear issue detection, commenting, and state transitions
  permissions.ts        Deploy permission checks (allowed users, approvers)
```

## Commands

```sh
pnpm dev              # Start Next.js dev server
pnpm build            # Production build
pnpm test             # Run tests with coverage
pnpm type-check       # Type-check without emitting
pnpm check            # Lint and format check (ultracite)
pnpm fix              # Auto-fix lint and format issues
pnpm validate         # Run check + type-check + test
```

## Skills

Use these skills when working on this project:

- **chat-sdk** — Chat SDK API, event handlers, cards, modals, streaming, and adapters
- **slack-agent** — Slack-specific development patterns, testing, and deployment
- **workflow** — Vercel Workflow for durable, resumable execution

## Key Patterns

- The bot registers Slack, GitHub, and (optionally) Linear adapters. Linear is conditionally enabled via `LINEAR_API_KEY`.
- Webhook route at `app/api/webhooks/[platform]/route.ts` handles all platforms dynamically via `bot.webhooks`.
- Chat SDK card components use JSX (`<Card>`, `<Button>`, etc.) — the tsconfig sets `jsxImportSource: "chat"`.
- Deploy orchestration uses Vercel Workflow for durable, resumable execution (approval gates, polling).
- The bot uses `bot.onSlashCommand()`, `bot.onAction()`, and `bot.onModalSubmit()` for interactivity.
