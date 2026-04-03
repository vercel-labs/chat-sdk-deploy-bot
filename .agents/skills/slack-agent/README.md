# Slack Agent Skill

An agent-agnostic skill for building and deploying Slack agents on Vercel using **[Chat SDK](https://www.chat-sdk.dev/)** — `chat` + `@chat-adapter/slack` with Next.js.

## Features

- **Interactive Setup Wizard**: Step-by-step guidance from project creation to production deployment
- **Chat SDK Framework**: JSX components, thread subscriptions, and modern Slack patterns
- **Custom Implementation Planning**: Generates a tailored plan based on your agent's purpose before scaffolding
- **Quality Standards**: Embedded testing and code quality requirements
- **AI Integration**: Support for Vercel AI Gateway and direct provider SDKs
- **Comprehensive Patterns**: Slack-specific development patterns and best practices
- **Testing Framework**: Vitest configuration and sample tests

## Installation

### Via skills.sh (Recommended)

npx skills add vercel-labs/slack-agent-skill

### Manual Installation

Clone the repository into your skills directory. For example, with Claude Code:

git clone https://github.com/vercel-labs/slack-agent-skill.git ~/.claude/skills/slack-agent-skill

## Usage

### Starting a New Project

Run the slash command:

```
/slack-agent

Or with arguments:
/slack-agent new       # Start fresh project (recommends Chat SDK)
/slack-agent configure # Configure existing project (auto-detects framework)
/slack-agent deploy    # Deploy to production
/slack-agent test      # Set up testing
```

The wizard will guide you through:
1. Framework selection and project setup
2. Custom implementation plan generation and approval
3. Slack app creation with customized manifest
4. Environment configuration
5. Local testing with ngrok
6. Production deployment to Vercel
7. Test framework setup

### Development

When working on an existing Slack agent project, the skill automatically detects Chat SDK from `"chat"` in your `package.json` dependencies and provides:
- Code quality standards (linting, testing, TypeScript)
- Slack-specific patterns (event handlers, slash commands, UI components)
- AI integration guidance (Vercel AI Gateway, direct providers)
- Deployment best practices

## Key Commands

```bash
# Development
pnpm dev              # Start local dev server
ngrok http 3000       # Expose local server

# Quality
pnpm lint             # Check linting
pnpm lint --write     # Auto-fix lint issues
pnpm typecheck        # TypeScript check
pnpm test             # Run tests

# Deployment
vercel                # Deploy to Vercel
vercel --prod         # Production deployment
```

## Quality Standards

The skill enforces these requirements:

- **Unit tests** for all exported functions
- **E2E tests** for user-facing changes
- **Linting** must pass (Biome)
- **TypeScript** must compile without errors
- **All tests** must pass before completion

## Related Resources

- [Chat SDK Documentation](https://www.chat-sdk.dev/)
- [AI SDK Documentation](https://ai-sdk.dev)
- [Slack API Documentation](https://api.slack.com)
- [Vercel Documentation](https://vercel.com/docs)

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.
