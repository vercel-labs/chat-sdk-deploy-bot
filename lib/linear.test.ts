import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateComment, mockIssue, mockLinearClient, mockUpdateIssue } =
  vi.hoisted(() => ({
    mockCreateComment: vi.fn(),
    mockIssue: vi.fn(),
    mockLinearClient: vi.fn(),
    mockUpdateIssue: vi.fn(),
  }));

vi.mock("@linear/sdk", () => ({
  LinearClient: class {
    createComment = mockCreateComment;
    issue = mockIssue;
    updateIssue = mockUpdateIssue;

    constructor(options: { apiKey?: string }) {
      mockLinearClient(options);
    }
  },
}));

const linear = await import("@/lib/linear");

const makeIssue = (
  overrides?: Partial<{
    id: string;
    identifier: string;
    team: { states: ReturnType<typeof vi.fn> };
    title: string;
    url: string;
  }>
) => ({
  id: "issue-1",
  identifier: "ENG-1",
  team: {
    states: vi.fn().mockResolvedValue({
      nodes: [{ id: "state-1", name: "Done" }],
    }),
  },
  title: "Fix bug",
  url: "https://linear.app/issue/ENG-1",
  ...overrides,
});

describe("extractIssueKeys", () => {
  beforeEach(() => {
    process.env.LINEAR_API_KEY = "lin_api_test";
  });

  it("returns empty array for empty input", () => {
    expect(linear.extractIssueKeys([])).toEqual([]);
  });

  it("returns empty array when no keys match", () => {
    expect(linear.extractIssueKeys(["fix: typo in readme"])).toEqual([]);
  });

  it("extracts a single issue key", () => {
    expect(linear.extractIssueKeys(["fix: resolve ENG-123 bug"])).toEqual([
      "ENG-123",
    ]);
  });

  it("extracts multiple issue keys from multiple texts", () => {
    const texts = [
      "feat(ENG-100): add feature",
      "fix: resolve ENG-200 race condition",
    ];
    const result = linear.extractIssueKeys(texts);
    expect(result).toContain("ENG-100");
    expect(result).toContain("ENG-200");
    expect(result).toHaveLength(2);
  });

  it("deduplicates keys", () => {
    const texts = ["ENG-123 first mention", "ENG-123 second mention"];
    expect(linear.extractIssueKeys(texts)).toEqual(["ENG-123"]);
  });

  it("handles case-insensitive matching and uppercases results", () => {
    expect(linear.extractIssueKeys(["fix eng-99 issue"])).toEqual(["ENG-99"]);
  });

  it("uses a custom prefix", () => {
    const result = linear.extractIssueKeys(
      ["feat(TEAM-42): new thing"],
      "TEAM"
    );
    expect(result).toEqual(["TEAM-42"]);
  });

  it("does not match keys with wrong prefix", () => {
    expect(linear.extractIssueKeys(["fix OTHER-123 issue"], "ENG")).toEqual([]);
  });

  it("extracts multiple keys from a single text", () => {
    const result = linear.extractIssueKeys(["closes ENG-1 and ENG-2"]);
    expect(result).toContain("ENG-1");
    expect(result).toContain("ENG-2");
    expect(result).toHaveLength(2);
  });
});

describe("getIssuesByIdentifiers", () => {
  beforeEach(() => {
    mockCreateComment.mockReset();
    mockIssue.mockReset();
    mockLinearClient.mockClear();
    mockUpdateIssue.mockReset();
    process.env.LINEAR_API_KEY = "lin_api_test";
  });

  it("returns empty array for empty input", async () => {
    const result = await linear.getIssuesByIdentifiers([]);
    expect(result).toEqual([]);
    expect(mockIssue).not.toHaveBeenCalled();
    expect(mockLinearClient).not.toHaveBeenCalled();
  });

  it("returns issues from the Linear SDK", async () => {
    mockIssue.mockResolvedValueOnce(makeIssue());

    const result = await linear.getIssuesByIdentifiers(["ENG-1"]);

    expect(result).toEqual([
      {
        id: "issue-1",
        identifier: "ENG-1",
        title: "Fix bug",
        url: "https://linear.app/issue/ENG-1",
      },
    ]);
    expect(mockLinearClient).toHaveBeenCalledWith({ apiKey: "lin_api_test" });
    expect(mockIssue).toHaveBeenCalledWith("ENG-1");
  });

  it("looks up multiple identifiers", async () => {
    mockIssue.mockResolvedValueOnce(makeIssue());
    mockIssue.mockResolvedValueOnce(
      makeIssue({
        id: "issue-2",
        identifier: "ENG-2",
        title: "Add feature",
        url: "https://linear.app/issue/ENG-2",
      })
    );

    const result = await linear.getIssuesByIdentifiers(["ENG-1", "ENG-2"]);

    expect(result).toEqual([
      {
        id: "issue-1",
        identifier: "ENG-1",
        title: "Fix bug",
        url: "https://linear.app/issue/ENG-1",
      },
      {
        id: "issue-2",
        identifier: "ENG-2",
        title: "Add feature",
        url: "https://linear.app/issue/ENG-2",
      },
    ]);
    expect(mockIssue).toHaveBeenCalledTimes(2);
  });
});

describe("commentOnIssue", () => {
  beforeEach(() => {
    mockCreateComment.mockReset();
    mockIssue.mockReset();
    mockLinearClient.mockClear();
    mockUpdateIssue.mockReset();
    process.env.LINEAR_API_KEY = "lin_api_test";
  });

  it("creates a comment with the SDK", async () => {
    mockCreateComment.mockResolvedValueOnce({ success: true });

    await linear.commentOnIssue("issue-1", "deployed");

    expect(mockCreateComment).toHaveBeenCalledWith({
      body: "deployed",
      issueId: "issue-1",
    });
  });

  it("throws when comment creation is unsuccessful", async () => {
    mockCreateComment.mockResolvedValueOnce({ success: false });

    await expect(linear.commentOnIssue("issue-1", "deployed")).rejects.toThrow(
      "Failed to comment on Linear issue issue-1"
    );
  });
});

describe("transitionIssue", () => {
  beforeEach(() => {
    mockCreateComment.mockReset();
    mockIssue.mockReset();
    mockLinearClient.mockClear();
    mockUpdateIssue.mockReset();
    process.env.LINEAR_API_KEY = "lin_api_test";
  });

  it("transitions when target state exists", async () => {
    mockIssue.mockResolvedValueOnce(
      makeIssue({
        team: {
          states: vi.fn().mockResolvedValue({
            nodes: [
              { id: "state-1", name: "In Progress" },
              { id: "state-2", name: "Done" },
            ],
          }),
        },
      })
    );
    mockUpdateIssue.mockResolvedValueOnce({ success: true });

    const result = await linear.transitionIssue("issue-1", "Done");

    expect(result).toBe(true);
    expect(mockUpdateIssue).toHaveBeenCalledWith("issue-1", {
      stateId: "state-2",
    });
  });

  it("returns false when target state not found", async () => {
    mockIssue.mockResolvedValueOnce(
      makeIssue({
        team: {
          states: vi.fn().mockResolvedValue({
            nodes: [{ id: "state-1", name: "In Progress" }],
          }),
        },
      })
    );

    const result = await linear.transitionIssue("issue-1", "Deployed");

    expect(result).toBe(false);
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  it("returns the SDK success value for updates", async () => {
    mockIssue.mockResolvedValueOnce(makeIssue());
    mockUpdateIssue.mockResolvedValueOnce({ success: false });

    const result = await linear.transitionIssue("issue-1", "Done");

    expect(result).toBe(false);
  });

  it("throws when the issue has no team", async () => {
    mockIssue.mockResolvedValueOnce(makeIssue({ team: undefined }));

    await expect(linear.transitionIssue("issue-1", "Done")).rejects.toThrow(
      "Linear issue issue-1 has no team"
    );
  });
});

describe("SDK error handling", () => {
  beforeEach(() => {
    mockCreateComment.mockReset();
    mockIssue.mockReset();
    mockLinearClient.mockClear();
    mockUpdateIssue.mockReset();
    process.env.LINEAR_API_KEY = "lin_api_test";
  });

  it("throws when LINEAR_API_KEY is missing", async () => {
    delete process.env.LINEAR_API_KEY;

    await expect(linear.getIssuesByIdentifiers(["ENG-1"])).rejects.toThrow(
      "LINEAR_API_KEY"
    );
    expect(mockLinearClient).not.toHaveBeenCalled();
  });

  it("propagates SDK lookup errors", async () => {
    mockIssue.mockRejectedValueOnce(new Error("sdk lookup failed"));

    await expect(linear.getIssuesByIdentifiers(["ENG-1"])).rejects.toThrow(
      "sdk lookup failed"
    );
  });
});
