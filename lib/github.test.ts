import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCompareCommitsWithBasehead,
  mockCreateComment,
  mockCreateWorkflowDispatch,
  mockGetRef,
  mockGetWorkflowRun,
  mockListCommits,
  mockListJobsForWorkflowRun,
  mockListPullRequestsAssociatedWithCommit,
  mockListWorkflowRuns,
  mockOctokit,
} = vi.hoisted(() => ({
  mockCompareCommitsWithBasehead: vi.fn(),
  mockCreateComment: vi.fn(),
  mockCreateWorkflowDispatch: vi.fn(),
  mockGetRef: vi.fn(),
  mockGetWorkflowRun: vi.fn(),
  mockListCommits: vi.fn(),
  mockListJobsForWorkflowRun: vi.fn(),
  mockListPullRequestsAssociatedWithCommit: vi.fn(),
  mockListWorkflowRuns: vi.fn(),
  mockOctokit: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    rest = {
      actions: {
        createWorkflowDispatch: mockCreateWorkflowDispatch,
        getWorkflowRun: mockGetWorkflowRun,
        listJobsForWorkflowRun: mockListJobsForWorkflowRun,
        listWorkflowRuns: mockListWorkflowRuns,
      },
      git: {
        getRef: mockGetRef,
      },
      issues: {
        createComment: mockCreateComment,
      },
      repos: {
        compareCommitsWithBasehead: mockCompareCommitsWithBasehead,
        listCommits: mockListCommits,
        listPullRequestsAssociatedWithCommit:
          mockListPullRequestsAssociatedWithCommit,
      },
    };

    constructor(options: {
      auth?: string;
      request?: { headers?: Record<string, string> };
    }) {
      mockOctokit(options);
    }
  },
}));

const github = await import("@/lib/github");

const repo = { name: "webapp", owner: "acme" };

const apiError = (
  status: number,
  data: unknown,
  message = "Request failed"
) => {
  const error = new Error(message) as Error & {
    response: { data: unknown };
    status: number;
  };
  error.response = { data };
  error.status = status;
  return error;
};

describe("github", () => {
  beforeEach(() => {
    mockCompareCommitsWithBasehead.mockReset();
    mockCreateComment.mockReset();
    mockCreateWorkflowDispatch.mockReset();
    mockGetRef.mockReset();
    mockGetWorkflowRun.mockReset();
    mockListCommits.mockReset();
    mockListJobsForWorkflowRun.mockReset();
    mockListPullRequestsAssociatedWithCommit.mockReset();
    mockListWorkflowRuns.mockReset();
    mockOctokit.mockClear();
    process.env.GITHUB_TOKEN = "test-token";
  });

  describe("triggerWorkflow", () => {
    it("throws when GITHUB_TOKEN is missing", async () => {
      delete process.env.GITHUB_TOKEN;

      await expect(
        github.triggerWorkflow(repo, "deploy.yml", "main", {
          environment: "staging",
        })
      ).rejects.toThrow("GITHUB_TOKEN");

      expect(mockCreateWorkflowDispatch).not.toHaveBeenCalled();
    });

    it("dispatches successfully", async () => {
      mockCreateWorkflowDispatch.mockImplementationOnce(() =>
        Promise.resolve()
      );

      await github.triggerWorkflow(repo, "deploy.yml", "main", {
        environment: "staging",
      });

      expect(mockCreateWorkflowDispatch).toHaveBeenCalledWith({
        inputs: { environment: "staging" },
        owner: "acme",
        ref: "main",
        repo: "webapp",
        workflow_id: "deploy.yml",
      });
    });

    it("throws on failure", async () => {
      mockCreateWorkflowDispatch.mockRejectedValueOnce(
        apiError(400, "Bad request")
      );

      await expect(
        github.triggerWorkflow(repo, "deploy.yml", "main", {})
      ).rejects.toThrow("Failed to trigger workflow: 400 Bad request");
    });

    it("retries with only environment when GitHub rejects an extra input", async () => {
      mockCreateWorkflowDispatch
        .mockRejectedValueOnce(apiError(422, "Unexpected inputs provided"))
        .mockImplementationOnce(() => Promise.resolve());

      await github.triggerWorkflow(repo, "deploy.yml", "main", {
        deploy_id: "deploy-123",
        environment: "staging",
      });

      expect(mockCreateWorkflowDispatch).toHaveBeenCalledTimes(2);
      expect(mockCreateWorkflowDispatch.mock.calls[1]?.[0]).toEqual({
        inputs: { environment: "staging" },
        owner: "acme",
        ref: "main",
        repo: "webapp",
        workflow_id: "deploy.yml",
      });
    });

    it("retries without inputs when the workflow rejects all inputs", async () => {
      mockCreateWorkflowDispatch
        .mockRejectedValueOnce(apiError(422, "Unexpected inputs provided"))
        .mockImplementationOnce(() => Promise.resolve());

      await github.triggerWorkflow(repo, "deploy.yml", "main", {
        environment: "staging",
      });

      expect(mockCreateWorkflowDispatch).toHaveBeenCalledTimes(2);
      expect(mockCreateWorkflowDispatch.mock.calls[1]?.[0]).toEqual({
        inputs: undefined,
        owner: "acme",
        ref: "main",
        repo: "webapp",
        workflow_id: "deploy.yml",
      });
    });

    it("falls back all the way to no inputs when only environment is supported nowhere", async () => {
      mockCreateWorkflowDispatch
        .mockRejectedValueOnce(apiError(422, "Unexpected inputs provided"))
        .mockRejectedValueOnce(apiError(422, "Unexpected inputs provided"))
        .mockImplementationOnce(() => Promise.resolve());

      await github.triggerWorkflow(repo, "deploy.yml", "main", {
        deploy_id: "deploy-123",
        environment: "staging",
      });

      expect(mockCreateWorkflowDispatch).toHaveBeenCalledTimes(3);
      expect(mockCreateWorkflowDispatch.mock.calls[1]?.[0]).toEqual({
        inputs: { environment: "staging" },
        owner: "acme",
        ref: "main",
        repo: "webapp",
        workflow_id: "deploy.yml",
      });
      expect(mockCreateWorkflowDispatch.mock.calls[2]?.[0]).toEqual({
        inputs: undefined,
        owner: "acme",
        ref: "main",
        repo: "webapp",
        workflow_id: "deploy.yml",
      });
    });

    it("rethrows non-Error failures", async () => {
      mockCreateWorkflowDispatch.mockRejectedValueOnce("network down");

      await expect(
        github.triggerWorkflow(repo, "deploy.yml", "main", {
          environment: "staging",
        })
      ).rejects.toBe("network down");
    });

    it("rethrows a non-unexpected fallback failure", async () => {
      mockCreateWorkflowDispatch
        .mockRejectedValueOnce(apiError(422, "Unexpected inputs provided"))
        .mockRejectedValueOnce("network down");

      await expect(
        github.triggerWorkflow(repo, "deploy.yml", "main", {
          deploy_id: "deploy-123",
          environment: "staging",
        })
      ).rejects.toBe("network down");

      expect(mockCreateWorkflowDispatch).toHaveBeenCalledTimes(2);
    });
  });

  describe("getLatestRunId", () => {
    it("returns the latest run id", async () => {
      mockListWorkflowRuns.mockResolvedValueOnce({
        data: { workflow_runs: [{ id: 42 }] },
      });

      const id = await github.getLatestRunId(repo, "deploy.yml", "main");

      expect(id).toBe(42);
    });

    it("returns 0 when no runs exist", async () => {
      mockListWorkflowRuns.mockResolvedValueOnce({
        data: { workflow_runs: [] },
      });

      const id = await github.getLatestRunId(repo, "deploy.yml", "main");

      expect(id).toBe(0);
    });
  });

  describe("findDispatchedRun", () => {
    it("returns the exact deploy match when multiple runs qualify", async () => {
      mockListWorkflowRuns.mockResolvedValueOnce({
        data: {
          workflow_runs: [
            {
              conclusion: null,
              created_at: "2026-03-24T10:00:02.000Z",
              display_title: "Deploy staging (deploy-123)",
              head_branch: "main",
              head_sha: "sha-1",
              html_url: "",
              id: 10,
              status: "queued",
            },
            {
              conclusion: null,
              created_at: "2026-03-24T10:00:03.000Z",
              display_title: "Deploy staging (deploy-456)",
              head_branch: "main",
              head_sha: "sha-1",
              html_url: "",
              id: 11,
              status: "queued",
            },
          ],
        },
      });

      const run = await github.findDispatchedRun(repo, "deploy.yml", {
        afterRunId: 9,
        branch: "main",
        commitSha: "sha-1",
        deployId: "deploy-123",
        dispatchedAt: "2026-03-24T10:00:01.000Z",
      });

      expect(run?.id).toBe(10);
    });

    it("returns the single matching run when correlation is unambiguous", async () => {
      mockListWorkflowRuns.mockResolvedValueOnce({
        data: {
          workflow_runs: [
            {
              conclusion: null,
              created_at: "2026-03-24T10:00:02.000Z",
              display_title: "Deploy staging",
              head_branch: "main",
              head_sha: "sha-1",
              html_url: "",
              id: 10,
              status: "queued",
            },
            {
              conclusion: null,
              created_at: "2026-03-24T09:59:59.000Z",
              display_title: "Deploy staging",
              head_branch: "main",
              head_sha: "sha-1",
              html_url: "",
              id: 50,
              status: "queued",
            },
          ],
        },
      });

      const run = await github.findDispatchedRun(repo, "deploy.yml", {
        afterRunId: 9,
        branch: "main",
        commitSha: "sha-1",
        deployId: "deploy-123",
        dispatchedAt: "2026-03-24T10:00:00.000Z",
      });

      expect(run?.id).toBe(10);
    });

    it("returns null when multiple runs match but none carries the deploy id", async () => {
      mockListWorkflowRuns.mockResolvedValueOnce({
        data: {
          workflow_runs: [
            {
              conclusion: null,
              created_at: "2026-03-24T10:00:02.000Z",
              display_title: "Deploy staging",
              head_branch: "main",
              head_sha: "sha-1",
              html_url: "",
              id: 10,
              status: "queued",
            },
            {
              conclusion: null,
              created_at: "2026-03-24T10:00:03.000Z",
              display_title: "Deploy staging",
              head_branch: "main",
              head_sha: "sha-1",
              html_url: "",
              id: 11,
              status: "queued",
            },
          ],
        },
      });

      const run = await github.findDispatchedRun(repo, "deploy.yml", {
        afterRunId: 9,
        branch: "main",
        commitSha: "sha-1",
        deployId: "deploy-123",
        dispatchedAt: "2026-03-24T10:00:01.000Z",
      });

      expect(run).toBeNull();
    });
  });

  describe("fetchRunWithJobs", () => {
    it("returns run and jobs", async () => {
      const run = {
        conclusion: "success",
        created_at: "",
        html_url: "url",
        id: 1,
        status: "completed",
      };
      const jobs = [
        {
          completed_at: null,
          conclusion: "success",
          name: "build",
          started_at: null,
          status: "completed",
          steps: [
            {
              conclusion: "success",
              name: "Install",
              status: "completed",
            },
          ],
        },
        {
          completed_at: null,
          conclusion: "success",
          name: "lint",
          started_at: null,
          status: "completed",
        },
      ];

      mockGetWorkflowRun.mockResolvedValueOnce({ data: run });
      mockListJobsForWorkflowRun.mockResolvedValueOnce({ data: { jobs } });

      const result = await github.fetchRunWithJobs(repo, 1);

      expect(result.run).toEqual(run);
      expect(result.jobs).toEqual(jobs);
    });
  });

  describe("compareCommits", () => {
    it("returns mapped commits", async () => {
      mockCompareCommitsWithBasehead.mockResolvedValueOnce({
        data: {
          commits: [
            { commit: { message: "fix ENG-1" }, sha: "abc" },
            { commit: { message: "feat ENG-2" }, sha: "def" },
          ],
        },
      });

      const commits = await github.compareCommits(repo, "tag1", "tag2");

      expect(commits).toEqual([
        { message: "fix ENG-1", sha: "abc" },
        { message: "feat ENG-2", sha: "def" },
      ]);
    });

    it("throws on error", async () => {
      mockCompareCommitsWithBasehead.mockRejectedValueOnce(
        new Error("network error")
      );

      await expect(github.compareCommits(repo, "tag1", "tag2")).rejects.toThrow(
        "network error"
      );
    });
  });

  describe("getRecentCommits", () => {
    it("returns mapped commits", async () => {
      mockListCommits.mockResolvedValueOnce({
        data: [{ commit: { message: "msg1" }, sha: "abc" }],
      });

      const commits = await github.getRecentCommits(repo, "main", 5);

      expect(commits).toEqual([{ message: "msg1", sha: "abc" }]);
    });
  });

  describe("getHeadSha", () => {
    it("returns the sha", async () => {
      mockGetRef.mockResolvedValueOnce({
        data: { object: { sha: "abc123" } },
      });

      const sha = await github.getHeadSha(repo, "main");

      expect(sha).toBe("abc123");
    });
  });

  describe("getPRsForCommit", () => {
    it("returns mapped PRs", async () => {
      mockListPullRequestsAssociatedWithCommit.mockResolvedValueOnce({
        data: [
          { html_url: "url1", number: 1, title: "PR 1" },
          { html_url: "url2", number: 2, title: "PR 2" },
        ],
      });

      const prs = await github.getPRsForCommit(repo, "sha");

      expect(prs).toEqual([
        { html_url: "url1", number: 1, title: "PR 1" },
        { html_url: "url2", number: 2, title: "PR 2" },
      ]);
    });
  });

  describe("commentOnPR", () => {
    it("creates a comment", async () => {
      mockCreateComment.mockImplementationOnce(() => Promise.resolve());

      await github.commentOnPR(repo, 1, "deploy comment");

      expect(mockCreateComment).toHaveBeenCalledWith({
        body: "deploy comment",
        issue_number: 1,
        owner: "acme",
        repo: "webapp",
      });
    });

    it("throws when GitHub rejects the comment", async () => {
      mockCreateComment.mockRejectedValueOnce(apiError(403, "Forbidden"));

      await expect(
        github.commentOnPR(repo, 1, "deploy comment")
      ).rejects.toThrow("Failed to comment on PR #1: 403 Forbidden");
    });

    it("rethrows non-API comment failures", async () => {
      mockCreateComment.mockRejectedValueOnce(new Error("network down"));

      await expect(
        github.commentOnPR(repo, 1, "deploy comment")
      ).rejects.toThrow("network down");
    });
  });

  describe("Octokit client config", () => {
    it("includes auth and api version headers", async () => {
      mockGetRef.mockResolvedValueOnce({
        data: { object: { sha: "x" } },
      });

      await github.getHeadSha(repo, "main");

      expect(mockOctokit).toHaveBeenCalledWith({
        auth: "test-token",
        request: {
          headers: {
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      });
    });
  });

  describe("GitHub API error handling", () => {
    it("throws on API error", async () => {
      mockGetRef.mockRejectedValueOnce(apiError(404, "Not Found"));

      await expect(github.getHeadSha(repo, "missing")).rejects.toThrow(
        "GitHub API 404: Not Found"
      );
    });

    it("stringifies object error bodies", async () => {
      mockGetRef.mockRejectedValueOnce(apiError(500, { message: "Boom" }));

      await expect(github.getHeadSha(repo, "missing")).rejects.toThrow(
        'GitHub API 500: {"message":"Boom"}'
      );
    });

    it("falls back to the original error message when response data is absent", async () => {
      const error = new Error("boom") as Error & {
        response: Record<string, never>;
        status: number;
      };
      error.response = {};
      error.status = 500;
      mockGetRef.mockRejectedValueOnce(error);

      await expect(github.getHeadSha(repo, "missing")).rejects.toThrow(
        "GitHub API 500: boom"
      );
    });
  });
});
