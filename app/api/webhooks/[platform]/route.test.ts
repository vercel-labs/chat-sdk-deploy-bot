import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHandler = vi.fn();
const mockAfter = vi.fn((callback: () => unknown) => callback());
const mockBot = {
  webhooks: {
    slack: mockHandler,
  },
};

vi.mock("@/lib/deploy-handlers", () => ({}));
vi.mock("next/server", () => ({
  after: mockAfter,
}));
vi.mock("@/lib/bot", () => ({
  bot: mockBot,
}));

const { POST } = await import("./route");

describe("webhook route", () => {
  beforeEach(() => {
    mockAfter.mockClear();
    mockHandler.mockReset();
  });

  it("returns 404 for inherited object keys", async () => {
    const response = await POST(new Request("https://example.com"), {
      params: Promise.resolve({ platform: "toString" }),
    });

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toContain("Unknown platform");
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it("dispatches configured webhook handlers", async () => {
    const expected = new Response("ok");
    mockHandler.mockResolvedValueOnce(expected);

    const response = await POST(new Request("https://example.com"), {
      params: Promise.resolve({ platform: "slack" }),
    });

    expect(response).toBe(expected);
    expect(mockHandler).toHaveBeenCalledOnce();
    expect(mockHandler.mock.calls[0]?.[1]).toHaveProperty("waitUntil");
  });
});
