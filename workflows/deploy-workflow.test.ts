import { beforeEach, describe, expect, it, vi } from "vitest";

const element = (type: string, props: Record<string, unknown> = {}) => ({
  type,
  ...props,
});

const mockThread = {
  adapter: { editMessage: vi.fn<() => Promise<void>>().mockResolvedValue() },
  id: "thread1",
  post: vi.fn<(message: unknown) => Promise<{ id: string }>>(),
  postEphemeral: vi.fn<() => Promise<void>>().mockResolvedValue(),
  setState: vi.fn<() => Promise<void>>().mockResolvedValue(),
};

const mockThreadFromJSON = vi.fn(() => mockThread);

const mockCreateHook = vi.fn();
const mockGetWorkflowMetadata = vi.fn(() => ({ workflowRunId: "wf-run-1" }));
const mockSleep = vi.fn<() => Promise<void>>().mockResolvedValue();

const mockTriggerWorkflow = vi.fn<() => Promise<void>>().mockResolvedValue();
const mockGetLatestRunId = vi.fn<() => Promise<number>>().mockResolvedValue(10);
const mockFindDispatchedRun = vi
  .fn<() => Promise<{ id: number } | null>>()
  .mockResolvedValue({ id: 123 });
const mockFetchRunWithJobs = vi.fn<
  () => Promise<{
    run: {
      conclusion: string | null;
      html_url: string;
      name: string;
      status: string;
    };
  }>
>();
const mockCompareCommits = vi.fn<() => Promise<{ message: string }[]>>();
const mockGetPRsForCommit = vi.fn<() => Promise<{ number: number }[]>>();
const mockCommentOnPR = vi.fn<() => Promise<void>>().mockResolvedValue();

const mockExtractIssueKeys =
  vi.fn<(texts: string[], prefix?: string) => string[]>();
const mockGetIssuesByIdentifiers =
  vi.fn<
    () => Promise<
      { id: string; identifier: string; title: string; url: string }[]
    >
  >();
const mockCommentOnIssue = vi.fn<() => Promise<void>>().mockResolvedValue();
const mockTransitionIssue = vi.fn<() => Promise<boolean>>();

const mockBot = {
  initialize: vi.fn<() => Promise<void>>().mockResolvedValue(),
};

vi.mock("chat", () => ({
  Actions: vi.fn((children: unknown[]) => element("Actions", { children })),
  Card: vi.fn((props: Record<string, unknown>) => element("Card", props)),
  Divider: vi.fn(() => element("Divider")),
  Field: vi.fn((props: Record<string, unknown>) => element("Field", props)),
  Fields: vi.fn((children: unknown[]) => element("Fields", { children })),
  LinkButton: vi.fn((props: Record<string, unknown>) =>
    element("LinkButton", props)
  ),
  Table: vi.fn((props: Record<string, unknown>) => element("Table", props)),
  ThreadImpl: { fromJSON: mockThreadFromJSON },
}));

vi.mock("workflow", () => ({
  createHook: mockCreateHook,
  getWorkflowMetadata: mockGetWorkflowMetadata,
  sleep: mockSleep,
}));

vi.mock("@/lib/bot", () => ({ bot: mockBot }));

vi.mock("@/lib/deploy-card", () => ({
  buildDeployCard: vi.fn(() => ({ card: { title: "Deploy to production" } })),
}));

vi.mock("@/lib/github", () => ({
  commentOnPR: mockCommentOnPR,
  compareCommits: mockCompareCommits,
  fetchRunWithJobs: mockFetchRunWithJobs,
  findDispatchedRun: mockFindDispatchedRun,
  getLatestRunId: mockGetLatestRunId,
  getPRsForCommit: mockGetPRsForCommit,
  triggerWorkflow: mockTriggerWorkflow,
}));

vi.mock("@/lib/linear", () => ({
  commentOnIssue: mockCommentOnIssue,
  extractIssueKeys: mockExtractIssueKeys,
  getIssuesByIdentifiers: mockGetIssuesByIdentifiers,
  transitionIssue: mockTransitionIssue,
}));

const makeApprovedHook = () => ({
  async *[Symbol.asyncIterator]() {
    yield { approved: true };
  },
  [Symbol.dispose]() {},
});

const makeSerializedThread = () => ({
  _type: "chat:Thread" as const,
  adapterName: "slack",
  channelId: "channel1",
  id: "thread1",
  isDM: false,
});

const makePayload = (
  overrides: Partial<{
    branch: string;
    commitSha: string;
    deployId: string;
    environment: "staging" | "production";
    linearProductionState: string;
    linearTeamPrefix: string;
    requestMessageId: string;
    triggeredBy: { id: string; name: string };
  }> = {}
) => ({
  branch: "main",
  commitSha: "abc1234567",
  deployId: "deploy-123",
  environment: "staging" as const,
  linearProductionState: "Done",
  linearTeamPrefix: "ENG",
  repo: { name: "repo", owner: "owner", workflowId: "deploy.yml" },
  requestMessageId: "request1",
  thread: makeSerializedThread(),
  triggeredBy: { id: "U1", name: "Test User" },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockThreadFromJSON.mockReturnValue(mockThread);
  mockThread.post.mockImplementation((message) =>
    Promise.resolve({
      id: typeof message === "string" ? "status-message" : "summary-message",
    })
  );
  mockFetchRunWithJobs.mockResolvedValue({
    run: {
      conclusion: "success",
      html_url: "https://github.com/acme/repo/actions/runs/123",
      name: "Deploy Workflow",
      status: "completed",
    },
  });
  mockCompareCommits.mockResolvedValue([{ message: "chore: cleanup" }]);
  mockExtractIssueKeys.mockReturnValue(["ENG-123"]);
  mockGetIssuesByIdentifiers.mockResolvedValue([
    {
      id: "lin1",
      identifier: "ENG-123",
      title: "Fix deploy",
      url: "https://linear.app/issue/ENG-123",
    },
  ]);
  mockGetPRsForCommit.mockResolvedValue([]);
  mockTransitionIssue.mockResolvedValue(true);
  mockCreateHook.mockImplementation(makeApprovedHook);
});

describe("deployWorkflow Linear integration", () => {
  it("extracts issue keys from the branch as well as compared commit messages", async () => {
    const { deployWorkflow } = await import("@/workflows/deploy-workflow");

    await deployWorkflow(
      JSON.stringify(
        makePayload({
          branch: "ENG-123-fix-deploy",
          environment: "staging",
        })
      )
    );

    expect(mockExtractIssueKeys).toHaveBeenCalledWith(
      ["ENG-123-fix-deploy", "chore: cleanup"],
      "ENG"
    );
  });

  it("uses the configured Linear production state for production transitions", async () => {
    const { deployWorkflow } = await import("@/workflows/deploy-workflow");

    await deployWorkflow(
      JSON.stringify(
        makePayload({
          environment: "production",
          linearProductionState: "Released",
        })
      )
    );

    expect(mockTransitionIssue).toHaveBeenCalledWith("lin1", "Released");
  });

  it("surfaces a missing Linear production state instead of failing silently", async () => {
    mockTransitionIssue.mockResolvedValue(false);
    const { deployWorkflow } = await import("@/workflows/deploy-workflow");

    await deployWorkflow(
      JSON.stringify(
        makePayload({
          environment: "production",
          linearProductionState: "Released",
        })
      )
    );

    expect(
      mockThread.post.mock.calls.some(
        ([message]) =>
          typeof message === "string" &&
          message.includes(
            'Failed to update some Linear issues: Linear workflow state "Released" was not found for issue ENG-123.'
          )
      )
    ).toBe(true);
  });
});
