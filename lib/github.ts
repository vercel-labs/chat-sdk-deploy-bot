import { Octokit } from "@octokit/rest";

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

interface Repo {
  owner: string;
  name: string;
}

const getGitHubClient = (): Octokit => {
  const githubToken = process.env.GITHUB_TOKEN;
  if (githubToken === undefined || githubToken.trim() === "") {
    throw new Error("Missing required environment variable: GITHUB_TOKEN");
  }

  return new Octokit({
    auth: githubToken,
    request: {
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  });
};

const isGitHubRequestError = (
  error: unknown
): error is Error & {
  response?: { data?: unknown };
  status: number;
} =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  typeof error.status === "number";

const getGitHubErrorBody = (error: {
  message: string;
  response?: { data?: unknown };
}): string => {
  const data = error.response?.data;
  if (typeof data === "string") {
    return data;
  }

  if (data !== undefined) {
    return JSON.stringify(data);
  }

  return error.message;
};

const asGitHubApiError = (error: unknown): Error | undefined => {
  if (!isGitHubRequestError(error)) {
    return undefined;
  }

  return new Error(`GitHub API ${error.status}: ${getGitHubErrorBody(error)}`);
};

const stripGitHubApiPrefix = (message: string): string =>
  message.replace(/^GitHub API (\d+): /, "$1 ");

const callGitHub = async <T>(
  operation: (client: Octokit) => Promise<T>
): Promise<T> => {
  try {
    return await operation(getGitHubClient());
  } catch (error) {
    const apiError = asGitHubApiError(error);
    if (apiError !== undefined) {
      throw apiError;
    }

    throw error;
  }
};

// ---------------------------------------------------------------------------
// Trigger a workflow_dispatch
// ---------------------------------------------------------------------------

export const triggerWorkflow = async (
  repo: Repo,
  workflowId: string,
  ref: string,
  inputs?: Record<string, string>
): Promise<void> => {
  const dispatch = async (dispatchInputs?: Record<string, string>) => {
    try {
      await getGitHubClient().rest.actions.createWorkflowDispatch({
        inputs: dispatchInputs,
        owner: repo.owner,
        ref,
        repo: repo.name,
        workflow_id: workflowId,
      });
    } catch (error) {
      const apiError = asGitHubApiError(error);
      if (apiError !== undefined) {
        throw new Error(
          `Failed to trigger workflow: ${stripGitHubApiPrefix(apiError.message)}`,
          { cause: error }
        );
      }

      throw error;
    }
  };

  try {
    await dispatch(inputs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      inputs !== undefined &&
      message.includes("Unexpected inputs provided")
    ) {
      const { environment, ...rest } = inputs;

      if (environment !== undefined && Object.keys(rest).length > 0) {
        try {
          await dispatch({ environment });
          return;
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError);

          if (fallbackMessage.includes("Unexpected inputs provided")) {
            await dispatch();
            return;
          }

          throw fallbackError;
        }
      }

      await dispatch();
      return;
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Find the workflow run created by our dispatch
// ---------------------------------------------------------------------------

interface WorkflowRun {
  display_title?: string;
  id: number;
  head_branch?: string;
  head_sha?: string;
  name?: string;
  status: string | null;
  conclusion: string | null;
  html_url: string;
  created_at: string;
}

const listWorkflowRuns = async (
  repo: Repo,
  workflowId: string,
  branch: string,
  perPage: number
): Promise<WorkflowRun[]> => {
  const data = await callGitHub((client) =>
    client.rest.actions.listWorkflowRuns({
      branch,
      event: "workflow_dispatch",
      owner: repo.owner,
      per_page: perPage,
      repo: repo.name,
      workflow_id: workflowId,
    })
  );

  return data.data.workflow_runs.map((run) => ({
    conclusion: run.conclusion,
    created_at: run.created_at,
    display_title: run.display_title ?? undefined,
    head_branch: run.head_branch ?? undefined,
    head_sha: run.head_sha ?? undefined,
    html_url: run.html_url,
    id: run.id,
    name: run.name ?? undefined,
    status: run.status,
  }));
};

export const getLatestRunId = async (
  repo: Repo,
  workflowId: string,
  branch: string
): Promise<number> => {
  const runs = await listWorkflowRuns(repo, workflowId, branch, 1);
  return runs[0]?.id ?? 0;
};

export const findDispatchedRun = async (
  repo: Repo,
  workflowId: string,
  options: {
    afterRunId: number;
    branch: string;
    commitSha: string;
    deployId: string;
    dispatchedAt: string;
  }
): Promise<WorkflowRun | null> => {
  const runs = await listWorkflowRuns(repo, workflowId, options.branch, 10);

  const dispatchedAtMs = Date.parse(options.dispatchedAt);
  const candidates = runs.filter((run) => {
    const createdAtMs = Date.parse(run.created_at);

    return (
      run.id > options.afterRunId &&
      run.head_branch === options.branch &&
      run.head_sha === options.commitSha &&
      !Number.isNaN(dispatchedAtMs) &&
      !Number.isNaN(createdAtMs) &&
      createdAtMs >= dispatchedAtMs
    );
  });

  const exactDeployMatch = candidates.find(
    (run) => run.display_title?.includes(options.deployId) === true
  );
  if (exactDeployMatch !== undefined) {
    return exactDeployMatch;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  return null;
};

// ---------------------------------------------------------------------------
// Poll a specific run
// ---------------------------------------------------------------------------

export interface JobStatus {
  name: string;
  status: string | null;
  conclusion: string | null;
  steps?: {
    name: string;
    status: string | null;
    conclusion: string | null;
  }[];
  started_at: string | null;
  completed_at: string | null;
}

interface RunWithJobs {
  run: WorkflowRun;
  jobs: JobStatus[];
}

export const fetchRunWithJobs = async (
  repo: Repo,
  runId: number
): Promise<RunWithJobs> => {
  const [run, jobsData] = await Promise.all([
    callGitHub((client) =>
      client.rest.actions.getWorkflowRun({
        owner: repo.owner,
        repo: repo.name,
        run_id: runId,
      })
    ),
    callGitHub((client) =>
      client.rest.actions.listJobsForWorkflowRun({
        owner: repo.owner,
        per_page: 100,
        repo: repo.name,
        run_id: runId,
      })
    ),
  ]);

  return {
    jobs: jobsData.data.jobs.map((job) => ({
      completed_at: job.completed_at,
      conclusion: job.conclusion,
      name: job.name,
      started_at: job.started_at,
      status: job.status,
      steps:
        job.steps?.map((step) => ({
          conclusion: step.conclusion,
          name: step.name,
          status: step.status,
        })) ?? undefined,
    })),
    run: {
      conclusion: run.data.conclusion,
      created_at: run.data.created_at,
      display_title: run.data.display_title ?? undefined,
      head_branch: run.data.head_branch ?? undefined,
      head_sha: run.data.head_sha ?? undefined,
      html_url: run.data.html_url,
      id: run.data.id,
      name: run.data.name ?? undefined,
      status: run.data.status,
    },
  };
};

// ---------------------------------------------------------------------------
// Compare commits between two refs (for Linear issue resolution)
// ---------------------------------------------------------------------------

export interface CommitInfo {
  sha: string;
  message: string;
}

export const compareCommits = async (
  repo: Repo,
  base: string,
  head: string
): Promise<CommitInfo[]> => {
  const data = await callGitHub((client) =>
    client.rest.repos.compareCommitsWithBasehead({
      basehead: `${base}...${head}`,
      owner: repo.owner,
      repo: repo.name,
    })
  );

  return data.data.commits.map((c) => ({
    message: c.commit.message,
    sha: c.sha,
  }));
};

/**
 * Fallback: get recent commits on a branch when deploy tags don't exist.
 */
export const getRecentCommits = async (
  repo: Repo,
  branch: string,
  count = 20
): Promise<CommitInfo[]> => {
  const data = await callGitHub((client) =>
    client.rest.repos.listCommits({
      owner: repo.owner,
      per_page: count,
      repo: repo.name,
      sha: branch,
    })
  );

  return data.data.map((c) => ({
    message: c.commit.message,
    sha: c.sha,
  }));
};

// ---------------------------------------------------------------------------
// Get HEAD SHA for a branch
// ---------------------------------------------------------------------------

export const getHeadSha = async (
  repo: Repo,
  branch: string
): Promise<string> => {
  const data = await callGitHub((client) =>
    client.rest.git.getRef({
      owner: repo.owner,
      ref: `heads/${branch}`,
      repo: repo.name,
    })
  );

  return data.data.object.sha;
};

// ---------------------------------------------------------------------------
// Get PRs associated with commits (for reporting)
// ---------------------------------------------------------------------------

export interface PullRequestInfo {
  number: number;
  title: string;
  html_url: string;
}

export const getPRsForCommit = async (
  repo: Repo,
  sha: string
): Promise<PullRequestInfo[]> => {
  const data = await callGitHub((client) =>
    client.rest.repos.listPullRequestsAssociatedWithCommit({
      commit_sha: sha,
      mediaType: {
        previews: ["groot"],
      },
      owner: repo.owner,
      repo: repo.name,
    })
  );

  return data.data.map((pr) => ({
    html_url: pr.html_url,
    number: pr.number,
    title: pr.title,
  }));
};

// ---------------------------------------------------------------------------
// Comment on a PR
// ---------------------------------------------------------------------------

export const commentOnPR = async (
  repo: Repo,
  prNumber: number,
  body: string
): Promise<void> => {
  try {
    await getGitHubClient().rest.issues.createComment({
      body,
      issue_number: prNumber,
      owner: repo.owner,
      repo: repo.name,
    });
  } catch (error) {
    const apiError = asGitHubApiError(error);
    if (apiError !== undefined) {
      throw new Error(
        `Failed to comment on PR #${prNumber}: ${stripGitHubApiPrefix(apiError.message)}`,
        { cause: error }
      );
    }

    throw error;
  }
};
