import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mocks ----

const element = (type: string, props: Record<string, unknown> = {}) => ({
  type,
  ...props,
});

vi.mock("@/lib/env", () => ({
  checkReqEnv: vi.fn(),
}));

const mockGetHeadSha = vi.fn();
vi.mock("@/lib/github", () => ({
  getHeadSha: (...args: unknown[]) => mockGetHeadSha(...args) as unknown,
}));

vi.mock("@/lib/permissions", () => ({
  canApprove: (userId: string) => {
    if (userId === "denied") {
      return { allowed: false, reason: "Not approver" };
    }
    if (userId === "denied-no-reason") {
      return { allowed: false };
    }
    return { allowed: true };
  },
  canDeploy: (userId: string, _env: string) => {
    if (userId === "denied") {
      return { allowed: false, reason: "No access" };
    }
    if (userId === "denied-no-reason") {
      return { allowed: false };
    }
    return { allowed: true };
  },
  requiresApproval: (env: string) => env === "production",
}));

const mockResumeHook = vi.fn();
const mockStart = vi.fn();
const mockSetState = vi
  .fn<(state: Record<string, unknown>) => Promise<void>>()
  .mockResolvedValue();
const mockThreadFromJSON = vi.fn(() => ({ setState: mockSetState }));
vi.mock("workflow/api", () => ({
  resumeHook: (...args: unknown[]) => mockResumeHook(...args) as unknown,
  start: (...args: unknown[]) => mockStart(...args) as unknown,
}));

vi.mock("@/workflows/deploy-workflow", () => ({
  deployWorkflow: vi.fn(),
}));

type Handler = (...args: unknown[]) => Promise<unknown>;
const handlers: Record<string, Handler> = {};

const mockBot = {
  initialize: vi.fn<() => Promise<void>>().mockResolvedValue(),
  onAction: vi.fn((id: string, handler: Handler) => {
    handlers[`action:${id}`] = handler;
  }),
  onModalSubmit: vi.fn((id: string, handler: Handler) => {
    handlers[`modal:${id}`] = handler;
  }),
  onSlashCommand: vi.fn((cmd: string, handler: Handler) => {
    handlers[`slash:${cmd}`] = handler;
  }),
  registerSingleton: vi.fn().mockReturnThis(),
};

vi.mock("@/lib/bot", () => ({ bot: mockBot }));

vi.mock("@chat-adapter/github", () => ({ createGitHubAdapter: vi.fn() }));
vi.mock("@chat-adapter/linear", () => ({ createLinearAdapter: vi.fn() }));
vi.mock("@chat-adapter/slack", () => ({ createSlackAdapter: vi.fn() }));
vi.mock("@chat-adapter/state-redis", () => ({ createRedisState: vi.fn() }));
vi.mock("chat", () => {
  const MockChat = vi.fn(() => ({
    registerSingleton: vi.fn().mockReturnThis(),
  }));
  return {
    Actions: vi.fn((children: unknown[]) => element("Actions", { children })),
    Button: vi.fn((props: Record<string, unknown>) => element("Button", props)),
    Card: vi.fn((props: Record<string, unknown>) => element("Card", props)),
    CardText: vi.fn((text: string) => element("CardText", { text })),
    Chat: MockChat,
    Divider: vi.fn(() => element("Divider")),
    Field: vi.fn((props: Record<string, unknown>) => element("Field", props)),
    Fields: vi.fn((children: unknown[]) => element("Fields", { children })),
    Modal: vi.fn((props: Record<string, unknown>) => element("Modal", props)),
    Select: vi.fn((props: Record<string, unknown>) => element("Select", props)),
    SelectOption: vi.fn((props: Record<string, unknown>) =>
      element("SelectOption", props)
    ),
    TextInput: vi.fn((props: Record<string, unknown>) =>
      element("TextInput", props)
    ),
    ThreadImpl: {
      fromJSON: mockThreadFromJSON,
    },
  };
});

// ---- Import triggers handler registration ----

beforeEach(async () => {
  vi.clearAllMocks();
  await import("@/lib/deploy-handlers");
});

// ---- Helpers ----

const makeChannel = () => ({
  post: vi.fn().mockResolvedValue({ id: "m1", threadId: "t1" }),
  postEphemeral: vi.fn<() => Promise<void>>().mockResolvedValue(),
  toJSON: vi.fn(() => ({
    adapterName: "slack",
    id: "ch1",
    isDM: false,
  })),
});

const makeUser = (id = "U1", name = "Test User") => ({
  fullName: name,
  userId: id,
});

const makeActionValue = (
  overrides: Partial<{
    branch: string;
    commitSha: string;
    environment: "staging" | "production";
    runId: string;
    triggeredById: string;
    triggeredByName: string;
  }> = {}
) =>
  JSON.stringify({
    branch: "main",
    commitSha: "abc1234567",
    environment: "production",
    runId: "run1",
    triggeredById: "U1",
    triggeredByName: "Test User",
    ...overrides,
  });

const getCard = (value: unknown): Record<string, unknown> | undefined => {
  if (value === null || typeof value !== "object") {
    return undefined;
  }

  const { card } = value as Record<string, unknown>;
  return card !== null && typeof card === "object"
    ? (card as Record<string, unknown>)
    : undefined;
};

const getCardChildren = (value: unknown): Record<string, unknown>[] => {
  const card = getCard(value);
  const { children } = card ?? {};
  return Array.isArray(children) ? (children as Record<string, unknown>[]) : [];
};

const getCardText = (value: unknown): string | undefined => {
  const cardText = getCardChildren(value).find(
    (child) => child.type === "CardText"
  );
  return typeof cardText?.text === "string" ? cardText.text : undefined;
};

const getActions = (value: unknown): Record<string, unknown> | undefined =>
  getCardChildren(value).find((child) => child.type === "Actions");

const getFieldLabels = (value: unknown): string[] => {
  const [fields] = getCardChildren(value);
  const children = Array.isArray(fields?.children)
    ? (fields.children as Record<string, unknown>[])
    : [];
  return children.flatMap((child) =>
    typeof child.label === "string" ? [child.label] : []
  );
};

// ---- Tests ----

describe("deploy-handlers", () => {
  describe("/deploy slash command", () => {
    it("opens modal when no args provided", async () => {
      const openModal = vi.fn();
      await handlers["slash:/deploy"]({
        channel: makeChannel(),
        openModal,
        text: "",
        user: makeUser(),
      });
      expect(openModal).toHaveBeenCalledOnce();
    });

    it("deploys staging with args", async () => {
      mockGetHeadSha.mockResolvedValueOnce("abc1234567");
      const channel = makeChannel();
      await handlers["slash:/deploy"]({
        channel,
        openModal: vi.fn(),
        text: "staging",
        user: makeUser(),
      });
      expect(channel.post).toHaveBeenCalled();
      expect(mockStart).toHaveBeenCalled();
    });

    it("posts the same base card structure for staging and production", async () => {
      mockGetHeadSha
        .mockResolvedValueOnce("abc1234567")
        .mockResolvedValueOnce("abc1234567");
      const stagingChannel = makeChannel();
      const productionChannel = makeChannel();

      await handlers["slash:/deploy"]({
        channel: stagingChannel,
        openModal: vi.fn(),
        text: "staging",
        user: makeUser(),
      });
      await handlers["slash:/deploy"]({
        channel: productionChannel,
        openModal: vi.fn(),
        text: "production",
        user: makeUser(),
      });

      const stagingMessage: unknown = stagingChannel.post.mock.calls[0]?.[0];
      const productionMessage: unknown =
        productionChannel.post.mock.calls[0]?.[0];
      expect(getCard(stagingMessage)).toMatchObject({
        subtitle: "main @ abc1234",
        title: "Deploy to staging",
      });
      expect(getCard(productionMessage)).toMatchObject({
        subtitle: "main @ abc1234",
        title: "Deploy to production",
      });
      expect(getFieldLabels(stagingMessage)).toEqual([
        "Environment",
        "Branch",
        "Commit",
        "Requested by",
      ]);
      expect(getFieldLabels(productionMessage)).toEqual([
        "Environment",
        "Branch",
        "Commit",
        "Requested by",
      ]);
    });

    it("seeds thread state before starting the workflow", async () => {
      mockGetHeadSha.mockResolvedValueOnce("abc1234567");
      const channel = makeChannel();
      await handlers["slash:/deploy"]({
        channel,
        openModal: vi.fn(),
        text: "production",
        user: makeUser(),
      });

      expect(mockBot.initialize).toHaveBeenCalledOnce();
      expect(mockThreadFromJSON).toHaveBeenCalledOnce();
      const seededState = mockSetState.mock.calls[0]?.[0] as
        | Record<string, unknown>
        | undefined;
      expect(seededState?.branch).toBe("main");
      expect(seededState?.commitSha).toBe("abc1234567");
      expect(typeof seededState?.deployId).toBe("string");
      expect(seededState?.environment).toBe("production");
      expect(seededState?.triggeredBy).toBe("U1");
      expect(seededState?.triggeredByName).toBe("Test User");
      expect(mockStart).toHaveBeenCalledOnce();
    });

    it("deploys production with 'prod' alias", async () => {
      mockGetHeadSha.mockResolvedValueOnce("abc1234567");
      const channel = makeChannel();
      await handlers["slash:/deploy"]({
        channel,
        openModal: vi.fn(),
        text: "prod",
        user: makeUser(),
      });
      expect(mockStart).toHaveBeenCalled();
    });

    it("deploys production with 'production'", async () => {
      mockGetHeadSha.mockResolvedValueOnce("abc1234567");
      const channel = makeChannel();
      await handlers["slash:/deploy"]({
        channel,
        openModal: vi.fn(),
        text: "production",
        user: makeUser(),
      });
      expect(mockStart).toHaveBeenCalled();
    });

    it("posts ephemeral when permission denied", async () => {
      const channel = makeChannel();
      await handlers["slash:/deploy"]({
        channel,
        openModal: vi.fn(),
        text: "production",
        user: makeUser("denied"),
      });
      expect(channel.postEphemeral).toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
    });

    it("handles branch resolution failure", async () => {
      mockGetHeadSha.mockRejectedValueOnce(new Error("not found"));
      const channel = makeChannel();
      await handlers["slash:/deploy"]({
        channel,
        openModal: vi.fn(),
        text: "staging",
        user: makeUser(),
      });
      expect(channel.post).toHaveBeenCalledWith(
        expect.stringContaining("Could not resolve branch")
      );
      expect(mockStart).not.toHaveBeenCalled();
    });

    it("uses userId as name when fullName is null", async () => {
      mockGetHeadSha.mockResolvedValueOnce("abc1234567");
      const channel = makeChannel();
      await handlers["slash:/deploy"]({
        channel,
        openModal: vi.fn(),
        text: "staging",
        user: { fullName: null, userId: "U1" },
      });
      expect(mockStart).toHaveBeenCalled();
    });

    it("falls back to 'Permission denied' when reason is undefined", async () => {
      const channel = makeChannel();
      await handlers["slash:/deploy"]({
        channel,
        openModal: vi.fn(),
        text: "production",
        user: makeUser("denied-no-reason"),
      });
      expect(channel.postEphemeral).toHaveBeenCalledWith(
        expect.anything(),
        "Permission denied",
        expect.anything()
      );
    });
  });

  describe("deploy_form modal submit", () => {
    it("deploys with form values", async () => {
      mockGetHeadSha.mockResolvedValueOnce("abc1234567");
      const channel = makeChannel();
      const result = await handlers["modal:deploy_form"]({
        relatedChannel: channel,
        user: makeUser(),
        values: { branch: "feature-branch", environment: "staging" },
      });
      expect(result).toBeUndefined();
      expect(mockStart).toHaveBeenCalled();
    });

    it("defaults branch to main when empty", async () => {
      mockGetHeadSha.mockResolvedValueOnce("abc1234567");
      const channel = makeChannel();
      await handlers["modal:deploy_form"]({
        relatedChannel: channel,
        user: makeUser(),
        values: { branch: "", environment: "staging" },
      });
      expect(mockStart).toHaveBeenCalled();
    });

    it("handles production environment from form", async () => {
      mockGetHeadSha.mockResolvedValueOnce("abc1234567");
      const channel = makeChannel();
      await handlers["modal:deploy_form"]({
        relatedChannel: channel,
        user: makeUser(),
        values: { branch: "main", environment: "production" },
      });
      expect(mockStart).toHaveBeenCalled();
    });

    it("posts ephemeral when denied and relatedChannel exists", async () => {
      const channel = makeChannel();
      const result = await handlers["modal:deploy_form"]({
        relatedChannel: channel,
        user: makeUser("denied"),
        values: { branch: "main", environment: "production" },
      });
      expect(result).toBeUndefined();
      expect(channel.postEphemeral).toHaveBeenCalled();
    });

    it("returns undefined when denied and no relatedChannel", async () => {
      const result = await handlers["modal:deploy_form"]({
        relatedChannel: null,
        user: makeUser("denied"),
        values: { branch: "main", environment: "production" },
      });
      expect(result).toBeUndefined();
    });

    it("returns undefined when no relatedChannel (allowed)", async () => {
      const result = await handlers["modal:deploy_form"]({
        relatedChannel: null,
        user: makeUser(),
        values: { branch: "main", environment: "staging" },
      });
      expect(result).toBeUndefined();
      expect(mockStart).not.toHaveBeenCalled();
    });

    it("returns undefined when buildPayload fails", async () => {
      mockGetHeadSha.mockRejectedValueOnce(new Error("not found"));
      const channel = makeChannel();
      const result = await handlers["modal:deploy_form"]({
        relatedChannel: channel,
        user: makeUser(),
        values: { branch: "bad-branch", environment: "staging" },
      });
      expect(result).toBeUndefined();
      expect(mockStart).not.toHaveBeenCalled();
    });

    it("uses userId as name when fullName is null", async () => {
      mockGetHeadSha.mockResolvedValueOnce("abc1234567");
      const channel = makeChannel();
      await handlers["modal:deploy_form"]({
        relatedChannel: channel,
        user: { fullName: null, userId: "U1" },
        values: { branch: "main", environment: "staging" },
      });
      expect(mockStart).toHaveBeenCalled();
    });

    it("falls back to 'Permission denied' when reason is undefined", async () => {
      const channel = makeChannel();
      await handlers["modal:deploy_form"]({
        relatedChannel: channel,
        user: makeUser("denied-no-reason"),
        values: { branch: "main", environment: "production" },
      });
      expect(channel.postEphemeral).toHaveBeenCalledWith(
        expect.anything(),
        "Permission denied",
        expect.anything()
      );
    });
  });

  describe("deploy_approve action", () => {
    it("edits the existing card to approved before resuming the hook", async () => {
      const editMessage =
        vi.fn<
          (
            threadId: string,
            messageId: string,
            message: unknown
          ) => Promise<void>
        >();
      const thread = {
        adapter: { editMessage },
        id: "thread1",
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve({
          branch: "main",
          commitSha: "abc1234567",
          environment: "production",
          runId: "run1",
          triggeredByName: "Test User",
        }),
      };
      await handlers["action:deploy_approve"]({
        messageId: "msg1",
        thread,
        user: makeUser(),
      });
      const editedMessage: unknown = editMessage.mock.calls[0]?.[2];
      expect(editMessage).toHaveBeenCalledWith(
        "thread1",
        "msg1",
        expect.anything()
      );
      expect(getCard(editedMessage)).toMatchObject({
        subtitle: "main @ abc1234",
        title: "Deploy to production",
      });
      expect(getCardText(editedMessage)).toBe("Approved by Test User.");
      expect(getActions(editedMessage)).toBeUndefined();
      expect(mockResumeHook).toHaveBeenCalledWith("run1", {
        approved: true,
        approvedBy: { id: "U1", name: "Test User" },
      });
      expect(editMessage.mock.invocationCallOrder[0]).toBeLessThan(
        mockResumeHook.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
    });

    it("posts an ephemeral error when the card edit fails", async () => {
      const thread = {
        adapter: {
          editMessage: vi
            .fn<() => Promise<void>>()
            .mockRejectedValueOnce(new Error("boom")),
        },
        id: "thread1",
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve({
          branch: "main",
          commitSha: "abc1234567",
          environment: "production",
          runId: "run1",
          triggeredByName: "Test User",
        }),
      };

      await handlers["action:deploy_approve"]({
        messageId: "msg1",
        thread,
        user: makeUser(),
      });

      expect(thread.postEphemeral).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("Could not update the deploy card"),
        expect.anything()
      );
      expect(mockResumeHook).not.toHaveBeenCalled();
    });

    it("posts ephemeral when denied with thread", async () => {
      const thread = {
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve({}),
      };
      await handlers["action:deploy_approve"]({
        thread,
        user: makeUser("denied"),
      });
      expect(thread.postEphemeral).toHaveBeenCalled();
      expect(mockResumeHook).not.toHaveBeenCalled();
    });

    it("returns early when denied with no thread", async () => {
      await handlers["action:deploy_approve"]({
        thread: null,
        user: makeUser("denied"),
      });
      expect(mockResumeHook).not.toHaveBeenCalled();
    });

    it("returns early when no thread (allowed)", async () => {
      await handlers["action:deploy_approve"]({
        thread: null,
        user: makeUser(),
      });
      expect(mockResumeHook).not.toHaveBeenCalled();
    });

    it("fails closed when runId is missing", async () => {
      const thread = {
        adapter: { editMessage: vi.fn() },
        id: "thread1",
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve({
          branch: "main",
          commitSha: "abc1234567",
          environment: "production",
          triggeredByName: "Test User",
        }),
      };
      await handlers["action:deploy_approve"]({
        messageId: "msg1",
        thread,
        user: makeUser(),
      });
      expect(thread.postEphemeral).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("Could not update the deploy card"),
        expect.anything()
      );
      expect(mockResumeHook).not.toHaveBeenCalled();
      expect(thread.adapter.editMessage).not.toHaveBeenCalled();
    });

    it("uses the button value when approval state is missing from thread.state", async () => {
      const editMessage =
        vi.fn<
          (
            threadId: string,
            messageId: string,
            message: unknown
          ) => Promise<void>
        >();
      const thread = {
        adapter: { editMessage },
        id: "thread1",
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve({ runId: "run1" }),
      };
      await handlers["action:deploy_approve"]({
        messageId: "msg1",
        thread,
        user: makeUser(),
        value: makeActionValue(),
      });

      const editedMessage: unknown = editMessage.mock.calls[0]?.[2];
      expect(getCardText(editedMessage)).toBe("Approved by Test User.");
      expect(mockResumeHook).toHaveBeenCalledWith("run1", {
        approved: true,
        approvedBy: { id: "U1", name: "Test User" },
      });
    });

    it("fails closed when card state and button value are both missing", async () => {
      const editMessage =
        vi.fn<
          (
            threadId: string,
            messageId: string,
            message: unknown
          ) => Promise<void>
        >();
      const thread = {
        adapter: { editMessage },
        id: "thread1",
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve({ runId: "run1" }),
      };
      await handlers["action:deploy_approve"]({
        messageId: "msg1",
        thread,
        user: makeUser(),
      });

      expect(thread.postEphemeral).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("Could not update the deploy card"),
        expect.anything()
      );
      expect(mockResumeHook).not.toHaveBeenCalled();
      expect(editMessage).not.toHaveBeenCalled();
    });

    it("handles null state", async () => {
      const thread = {
        adapter: { editMessage: vi.fn() },
        id: "thread1",
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve(null),
      };
      await handlers["action:deploy_approve"]({
        messageId: "msg1",
        thread,
        user: makeUser(),
      });
      expect(thread.postEphemeral).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("Could not update the deploy card"),
        expect.anything()
      );
      expect(mockResumeHook).not.toHaveBeenCalled();
    });

    it("uses userId as name when fullName is null", async () => {
      const editMessage =
        vi.fn<
          (
            threadId: string,
            messageId: string,
            message: unknown
          ) => Promise<void>
        >();
      const thread = {
        adapter: { editMessage },
        id: "thread1",
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve({
          branch: "main",
          commitSha: "abc1234567",
          environment: "production",
          runId: "run1",
          triggeredByName: "U1",
        }),
      };
      await handlers["action:deploy_approve"]({
        messageId: "msg1",
        thread,
        user: { fullName: null, userId: "U1" },
      });
      const editedMessage: unknown = editMessage.mock.calls[0]?.[2];
      expect(getCardText(editedMessage)).toBe("Approved by U1.");
      expect(mockResumeHook).toHaveBeenCalledWith("run1", {
        approved: true,
        approvedBy: { id: "U1", name: "U1" },
      });
    });

    it("falls back to 'Permission denied' when reason is undefined", async () => {
      const thread = {
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve({}),
      };
      await handlers["action:deploy_approve"]({
        thread,
        user: makeUser("denied-no-reason"),
      });
      expect(thread.postEphemeral).toHaveBeenCalledWith(
        expect.anything(),
        "Permission denied",
        expect.anything()
      );
    });
  });

  describe("deploy_cancel action", () => {
    it("returns early when no thread", async () => {
      await handlers["action:deploy_cancel"]({
        thread: null,
        user: makeUser(),
      });
      expect(mockResumeHook).not.toHaveBeenCalled();
    });

    it("rejects cancel from non-triggerer", async () => {
      const thread = {
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve({ runId: "run1", triggeredBy: "U_ORIGINAL" }),
      };
      await handlers["action:deploy_cancel"]({
        thread,
        user: makeUser("U_OTHER"),
      });
      expect(thread.postEphemeral).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("Only the person who triggered"),
        expect.anything()
      );
      expect(mockResumeHook).not.toHaveBeenCalled();
    });

    it("allows cancel from triggerer", async () => {
      const editMessage =
        vi.fn<
          (
            threadId: string,
            messageId: string,
            message: unknown
          ) => Promise<void>
        >();
      const thread = {
        adapter: { editMessage },
        id: "thread1",
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve({
          branch: "main",
          commitSha: "abc1234567",
          environment: "production",
          runId: "run1",
          triggeredBy: "U1",
          triggeredByName: "Test User",
        }),
        threadId: "thread1",
      };
      await handlers["action:deploy_cancel"]({
        messageId: "msg1",
        thread,
        user: makeUser("U1"),
      });
      expect(editMessage).toHaveBeenCalledWith(
        "thread1",
        "msg1",
        expect.anything()
      );
      const editedMessage: unknown = editMessage.mock.calls[0]?.[2];
      expect(getCard(editedMessage)).toMatchObject({
        subtitle: "main @ abc1234",
        title: "Deploy to production",
      });
      expect(getCardText(editedMessage)).toBe("Cancelled by Test User.");
      expect(getActions(editedMessage)).toBeUndefined();
      expect(mockResumeHook).toHaveBeenCalledWith("run1", { approved: false });
      expect(editMessage.mock.invocationCallOrder[0]).toBeLessThan(
        mockResumeHook.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
    });

    it("uses userId as name when fullName is null", async () => {
      const editMessage =
        vi.fn<
          (
            threadId: string,
            messageId: string,
            message: unknown
          ) => Promise<void>
        >();
      const thread = {
        adapter: { editMessage },
        id: "thread1",
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve({
          branch: "main",
          commitSha: "abc1234567",
          environment: "production",
          runId: "run1",
          triggeredBy: "U1",
          triggeredByName: "Test User",
        }),
        threadId: "thread1",
      };
      await handlers["action:deploy_cancel"]({
        messageId: "msg1",
        thread,
        user: { fullName: null, userId: "U1" },
      });
      const threadId = editMessage.mock.calls[0]?.[0];
      const messageId = editMessage.mock.calls[0]?.[1];
      const message: unknown = editMessage.mock.calls[0]?.[2];
      expect(threadId).toBe("thread1");
      expect(messageId).toBe("msg1");
      expect(getCardText(message)).toBe("Cancelled by U1.");
    });

    it("allows cancel when triggeredBy is not set", async () => {
      const editMessage =
        vi.fn<
          (
            threadId: string,
            messageId: string,
            message: unknown
          ) => Promise<void>
        >();
      const thread = {
        adapter: { editMessage },
        id: "thread1",
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve({
          branch: "main",
          commitSha: "abc1234567",
          environment: "production",
          runId: "run1",
          triggeredByName: "Test User",
        }),
        threadId: "thread1",
      };
      await handlers["action:deploy_cancel"]({
        messageId: "msg1",
        thread,
        user: makeUser(),
      });
      const editedMessage: unknown = editMessage.mock.calls[0]?.[2];
      expect(getCardText(editedMessage)).toBe("Cancelled by Test User.");
      expect(mockResumeHook).toHaveBeenCalledWith("run1", { approved: false });
    });

    it("uses the button value when cancel state is missing from thread.state", async () => {
      const editMessage =
        vi.fn<
          (
            threadId: string,
            messageId: string,
            message: unknown
          ) => Promise<void>
        >();
      const thread = {
        adapter: { editMessage },
        id: "thread1",
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve({}),
        threadId: "thread1",
      };
      await handlers["action:deploy_cancel"]({
        messageId: "msg1",
        thread,
        user: makeUser(),
        value: makeActionValue(),
      });

      const editedMessage: unknown = editMessage.mock.calls[0]?.[2];
      expect(getCardText(editedMessage)).toBe("Cancelled by Test User.");
      expect(mockResumeHook).toHaveBeenCalledWith("run1", { approved: false });
    });

    it("fails closed when cancel card state and button value are both missing", async () => {
      const thread = {
        adapter: { editMessage: vi.fn() },
        id: "thread1",
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve({ runId: "run1", triggeredBy: "U1" }),
        threadId: "thread1",
      };
      await handlers["action:deploy_cancel"]({
        messageId: "msg1",
        thread,
        user: makeUser(),
      });
      expect(thread.postEphemeral).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("Could not update the deploy card"),
        expect.anything()
      );
      expect(mockResumeHook).not.toHaveBeenCalled();
      expect(thread.adapter.editMessage).not.toHaveBeenCalled();
    });

    it("handles null state", async () => {
      const thread = {
        adapter: { editMessage: vi.fn() },
        id: "thread1",
        post: vi.fn(),
        postEphemeral: vi.fn(),
        state: Promise.resolve(null),
        threadId: "thread1",
      };
      await handlers["action:deploy_cancel"]({
        messageId: "msg1",
        thread,
        user: makeUser(),
      });
      expect(thread.postEphemeral).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("Could not update the deploy card"),
        expect.anything()
      );
      expect(mockResumeHook).not.toHaveBeenCalled();
    });
  });

  describe("Linear payload config", () => {
    it("omits Linear fields when LINEAR_API_KEY is not set", async () => {
      delete process.env.LINEAR_API_KEY;
      delete process.env.LINEAR_TEAM_PREFIX;
      delete process.env.LINEAR_PRODUCTION_STATE;
      vi.resetModules();
      await import("@/lib/deploy-handlers");

      mockGetHeadSha.mockResolvedValueOnce("abc1234567");
      const channel = makeChannel();
      await handlers["slash:/deploy"]({
        channel,
        openModal: vi.fn(),
        text: "staging",
        user: makeUser(),
      });

      const [, [payloadArg]] = mockStart.mock.calls[0] as [unknown, string[]];
      expect(payloadArg).not.toContain('"linearTeamPrefix"');
      expect(payloadArg).not.toContain('"linearProductionState"');
    });

    it("includes default Linear fields when enabled without overrides", async () => {
      process.env.LINEAR_API_KEY = "lin_api_test";
      delete process.env.LINEAR_TEAM_PREFIX;
      delete process.env.LINEAR_PRODUCTION_STATE;
      vi.resetModules();
      await import("@/lib/deploy-handlers");

      mockGetHeadSha.mockResolvedValueOnce("abc1234567");
      const channel = makeChannel();
      await handlers["slash:/deploy"]({
        channel,
        openModal: vi.fn(),
        text: "staging",
        user: makeUser(),
      });

      const [, [payloadArg]] = mockStart.mock.calls[0] as [unknown, string[]];
      expect(payloadArg).toContain('"linearTeamPrefix":"ENG"');
      expect(payloadArg).toContain('"linearProductionState":"Done"');

      delete process.env.LINEAR_API_KEY;
    });

    it("includes configured Linear fields when env vars are set", async () => {
      process.env.LINEAR_API_KEY = "lin_api_test";
      process.env.LINEAR_TEAM_PREFIX = "TEAM";
      process.env.LINEAR_PRODUCTION_STATE = "Released";
      vi.resetModules();
      await import("@/lib/deploy-handlers");

      mockGetHeadSha.mockResolvedValueOnce("abc1234567");
      const channel = makeChannel();
      await handlers["slash:/deploy"]({
        channel,
        openModal: vi.fn(),
        text: "staging",
        user: makeUser(),
      });

      const [, [payloadArg]] = mockStart.mock.calls[0] as [unknown, string[]];
      expect(payloadArg).toContain('"linearTeamPrefix":"TEAM"');
      expect(payloadArg).toContain('"linearProductionState":"Released"');

      delete process.env.LINEAR_API_KEY;
      delete process.env.LINEAR_TEAM_PREFIX;
      delete process.env.LINEAR_PRODUCTION_STATE;
    });
  });
});
