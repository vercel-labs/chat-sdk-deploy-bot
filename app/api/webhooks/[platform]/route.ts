// ---------------------------------------------------------------------------
// Webhook route — handles incoming events from all platforms
//
// Slack:  POST /api/webhooks/slack
// GitHub: POST /api/webhooks/github
// Linear: POST /api/webhooks/linear
// ---------------------------------------------------------------------------

// Import the side-effect module so handlers are registered before the first
// webhook fires. This is the same pattern from the durable sessions guide.
import "@/lib/deploy-handlers";
import { after } from "next/server";

import { bot } from "@/lib/bot";

interface RouteContext {
  params: Promise<{ platform: string }>;
}

type Platform = keyof typeof bot.webhooks;

const isPlatform = (value: string): value is Platform =>
  Object.hasOwn(bot.webhooks, value);

export const POST = async (request: Request, context: RouteContext) => {
  const { platform } = await context.params;

  if (!isPlatform(platform)) {
    return new Response(`Unknown platform: ${platform}`, { status: 404 });
  }

  const handler = bot.webhooks[platform];
  if (handler === undefined) {
    return new Response(`Platform not configured: ${platform}`, {
      status: 404,
    });
  }

  return handler(request, {
    waitUntil: (task) => {
      after(() => task);
    },
  });
};
