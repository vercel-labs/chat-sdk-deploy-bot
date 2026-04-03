# Slack Development Patterns

This document covers Slack-specific patterns and best practices for building agents with the Chat SDK.

## Rich UI

### JSX Components

Chat SDK uses JSX components instead of raw Block Kit JSON. Files using JSX must have the `.tsx` extension.

```tsx
import { Card, CardText as Text, Actions, Button, Divider } from "chat";

await thread.post(
  <Card title="Hello!">
    <Text>*Hello!* This is a formatted message.</Text>
    <Divider />
    <Text>Choose an option:</Text>
    <Actions>
      <Button id="button_click" value="button_value" style="primary">Click Me</Button>
    </Actions>
  </Card>
);
```

#### Interactive Actions

```tsx
import { Card, CardText as Text, Actions, Button, Select, Option } from "chat";

// Button with danger style
await thread.post(
  <Card>
    <Text>Are you sure you want to delete this?</Text>
    <Actions>
      <Button id="delete_item" value={itemId} style="danger">Delete</Button>
      <Button id="cancel">Cancel</Button>
    </Actions>
  </Card>
);

// Select menu
await thread.post(
  <Card>
    <Text>Select an option:</Text>
    <Actions>
      <Select id="select_option" placeholder="Choose...">
        <Option value="opt1">Option 1</Option>
        <Option value="opt2">Option 2</Option>
      </Select>
    </Actions>
  </Card>
);
```

---

## Message Formatting (mrkdwn)

Slack uses its own markdown variant called mrkdwn.

### Text Formatting
```
*bold text*
_italic text_
~strikethrough~
`inline code`
```code block```
> blockquote
```

### Links and Mentions
```
<https://example.com|Link Text>
<@U12345678>              # User mention
<#C12345678>              # Channel link
<!here>                   # @here mention
<!channel>                # @channel mention
<!date^1234567890^{date_short}|fallback>  # Date formatting
```

### Lists
```
Slack doesn't support markdown lists, use:
* Bullet point (use the actual bullet character)
1. Numbered manually
```

---

## Webhook / Events Endpoint

```typescript
// app/api/webhooks/[platform]/route.ts
import { after } from "next/server";
import { bot } from "@/lib/bot";

export async function POST(request: Request, context: { params: Promise<{ platform: string }> }) {
  const { platform } = await context.params;
  const handler = bot.webhooks[platform as keyof typeof bot.webhooks];
  if (!handler) return new Response("Unknown platform", { status: 404 });
  return handler(request, { waitUntil: (task) => after(() => task) });
}
```

The Chat SDK automatically handles:
- Content-type detection (JSON vs form-urlencoded)
- URL verification challenges
- Slack's 3-second ack timeout
- Background processing via `waitUntil`
- Signature verification using `SLACK_SIGNING_SECRET`

### Content Type Reference

| Event Type | Content-Type | Handled Automatically |
|------------|--------------|----------------------|
| Slash commands | `application/x-www-form-urlencoded` | Yes |
| Events API | `application/json` | Yes |
| Interactivity | `application/json` | Yes |
| URL verification | `application/json` | Yes |

---

## Event Handling Patterns

### Mention Handler

```typescript
bot.onNewMention(async (thread, message) => {
  try {
    const text = message.text; // Mention prefix already stripped
    await thread.subscribe();
    await thread.post(`Processing your request: "${text}"`);
    // Process with agent...
  } catch (error) {
    console.error("Error handling mention:", error);
    await thread.post("Sorry, I encountered an error processing your request.");
  }
});
```

### Subscribed / Follow-up Message Handler

```typescript
bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

### Slash Command Handler

```typescript
bot.onSlashCommand("/sample-command", async (event) => {
  try {
    // Chat SDK handles ack and background processing automatically
    await event.thread.startTyping();
    const result = await processCommand(event.text);
    await event.thread.post(`Result: ${result}`);
  } catch (error) {
    await event.thread.post("Sorry, something went wrong.");
  }
});
```

**No fire-and-forget pattern needed.** The Chat SDK acknowledges the request immediately and processes the handler in the background.

### Long-Running Slash Commands (AI, API calls)

```typescript
bot.onSlashCommand("/ai-command", async (event) => {
  await event.thread.startTyping();
  // This can take as long as needed - Chat SDK handles the ack automatically
  const result = await generateWithAI(event.text);
  await event.thread.post(result);
});
```

---

## Action Handlers

```typescript
bot.onAction("button_click", async (event) => {
  await event.thread.post(`You clicked: ${event.value}`);
});

bot.onAction("select_option", async (event) => {
  await event.thread.post(`You selected: ${event.value}`);
});
```

---

## Modal Patterns

```tsx
import { Modal, TextInput } from "chat";

// Opening a modal
bot.onSlashCommand("/open-form", async (event) => {
  await event.openModal(
    <Modal title="My Modal" submitLabel="Submit" callbackId="modal_submit">
      <TextInput id="input_value" label="Your Input" placeholder="Enter something..." />
    </Modal>
  );
});

// Handling submission
bot.onAction("modal_submit", async (event) => {
  const inputValue = event.values?.input_value;
  if (!inputValue || inputValue.length < 3) {
    return { errors: { input_value: "Please enter at least 3 characters" } };
  }
  await event.thread.post(`You submitted: ${inputValue}`);
});
```

---

## Thread Management

```typescript
bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post("I'm listening! Send me follow-up messages in this thread.");
});

bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`Got your message: ${message.text}`);
});
```

---

## Typing Indicators

```typescript
bot.onNewMention(async (thread, message) => {
  await thread.startTyping();
  const result = await processWithAI(message.text);
  await thread.post(result); // Typing clears automatically
});
```

The Chat SDK handles typing indicator refresh and timeout automatically.

---

## Error Handling

```typescript
bot.onNewMention(async (thread, message) => {
  try {
    await processMessage(thread, message);
  } catch (error) {
    console.error("Operation failed:", error);
    let userMessage = "Something went wrong. Please try again.";
    if (error instanceof Error) {
      if (error.message.includes("channel_not_found")) {
        userMessage = "I don't have access to that channel.";
      } else if (error.message.includes("not_in_channel")) {
        userMessage = "Please invite me to the channel first.";
      }
    }
    await thread.post(userMessage);
  }
});
```

---

## Best Practices Summary

1. **Handle errors gracefully** with user-friendly messages
2. **Use ephemeral messages** for sensitive or temporary information
3. **Log errors** with context for debugging
4. **Use threads** to keep channels clean
5. **Subscribe to threads** with `thread.subscribe()` for follow-up conversations
6. **Use JSX components** for rich messages instead of raw Block Kit JSON
7. **Use typing indicators** with `thread.startTyping()`
8. **Let Chat SDK handle ack** — no manual acknowledgment needed
9. **Use `.tsx` extension** for files with JSX components
10. **Configure tsconfig.json** with `"jsxImportSource": "chat"`
