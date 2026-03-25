import {
  Actions,
  Card,
  Divider,
  Field,
  Fields,
  LinkButton,
  Table,
  ThreadImpl,
} from "chat";
import type { SerializedThread } from "chat";
import { createHook, getWorkflowMetadata, sleep } from "workflow";

import type { DeployThreadState } from "@/lib/bot";
import { buildDeployCard } from "@/lib/deploy-card";
import {
  triggerWorkflow,
  getLatestRunId,
  findDispatchedRun,
  fetchRunWithJobs,
  compareCommits,
  getPRsForCommit,
  commentOnPR,
} from "@/lib/github";
import {
  DEFAULT_LINEAR_PRODUCTION_STATE,
  extractIssueKeys,
  getIssuesByIdentifiers,
  commentOnIssue,
  transitionIssue,
} from "@/lib/linear";

// ---------------------------------------------------------------------------
// Payload passed into the workflow as serialized JSON
// ---------------------------------------------------------------------------

/**
 * Sent when a user clicks Approve or Cancel on a production deploy card.
 */
export interface ApprovalPayload {
  approved: boolean;
  approvedBy?: { id: string; name: string };
}

export interface DeployWorkflowPayload {
  branch: string;
  commitSha: string;
  deployId: string;
  environment: "staging" | "production";
  linearProductionState?: string;
  linearTeamPrefix?: string;
  repo: { name: string; owner: string; workflowId: string };
  requestMessageId: string;
  triggeredBy: { id: string; name: string };
}

const getBot = async () => {
  const mod = await import("@/lib/bot");
  return mod.bot;
};

const getThread = async (serializedThread: SerializedThread) => {
  const bot = await getBot();
  await bot.initialize();
  return ThreadImpl.fromJSON<DeployThreadState>(serializedThread);
};

interface StatusMessageRef {
  messageId: string;
  threadId: string;
}

const isSerializedThread = (value: unknown): value is SerializedThread => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  // The payload is validated before these property reads.
  // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const thread = value as Record<string, unknown>;
  return (
    thread._type === "chat:Thread" &&
    typeof thread.id === "string" &&
    typeof thread.adapterName === "string" &&
    typeof thread.channelId === "string" &&
    typeof thread.isDM === "boolean"
  );
};

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

const isRepoConfig = (
  value: unknown
): value is DeployWorkflowPayload["repo"] => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  // The value is checked above before narrowing property reads.
  // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const repo = value as Record<string, unknown>;
  return (
    typeof repo.name === "string" &&
    typeof repo.owner === "string" &&
    typeof repo.workflowId === "string"
  );
};

const isTriggeredBy = (
  value: unknown
): value is DeployWorkflowPayload["triggeredBy"] => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  // The value is checked above before narrowing property reads.
  // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const triggeredBy = value as Record<string, unknown>;
  return (
    typeof triggeredBy.id === "string" && typeof triggeredBy.name === "string"
  );
};

const isDeployWorkflowPayload = (
  value: unknown
): value is DeployWorkflowPayload & { thread: SerializedThread } => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  // The payload is validated before these property reads.
  // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.branch === "string" &&
    typeof payload.commitSha === "string" &&
    typeof payload.deployId === "string" &&
    (payload.environment === "staging" ||
      payload.environment === "production") &&
    isRepoConfig(payload.repo) &&
    typeof payload.requestMessageId === "string" &&
    isOptionalString(payload.linearProductionState) &&
    isOptionalString(payload.linearTeamPrefix) &&
    isTriggeredBy(payload.triggeredBy) &&
    isSerializedThread(payload.thread)
  );
};

// ---------------------------------------------------------------------------
// Steps: messaging helpers (full Node.js access)
// ---------------------------------------------------------------------------

const postMessage = async (
  serializedThread: SerializedThread,
  text: string
): Promise<StatusMessageRef> => {
  "use step";
  const thread = await getThread(serializedThread);
  const message = await thread.post(text);
  return { messageId: message.id, threadId: thread.id };
};

const updateStatusMessage = async (
  serializedThread: SerializedThread,
  message: StatusMessageRef,
  text: string
): Promise<void> => {
  "use step";
  const thread = await getThread(serializedThread);
  await thread.adapter.editMessage(message.threadId, message.messageId, {
    markdown: text,
  });
};

const notifyUserPrivately = async (
  serializedThread: SerializedThread,
  userId: string,
  text: string
): Promise<void> => {
  "use step";
  try {
    const thread = await getThread(serializedThread);
    await thread.postEphemeral(userId, text, { fallbackToDM: true });
  } catch {
    // Private notification may fail if the platform doesn't support it — non-critical
  }
};

// ---------------------------------------------------------------------------
// Step: Post approval card and persist the run ID for the action handler
// ---------------------------------------------------------------------------

const postApprovalCard = async (
  serializedThread: SerializedThread,
  payload: DeployWorkflowPayload,
  workflowRunId: string
): Promise<void> => {
  "use step";
  const thread = await getThread(serializedThread);

  await thread.setState({
    branch: payload.branch,
    commitSha: payload.commitSha,
    deployId: payload.deployId,
    environment: payload.environment,
    runId: workflowRunId,
    triggeredBy: payload.triggeredBy.id,
    triggeredByName: payload.triggeredBy.name,
  });

  await thread.adapter.editMessage(
    thread.id,
    payload.requestMessageId,
    buildDeployCard(
      {
        branch: payload.branch,
        commitSha: payload.commitSha,
        environment: payload.environment,
        triggeredById: payload.triggeredBy.id,
        triggeredByName: payload.triggeredBy.name,
      },
      { status: "pending", workflowRunId }
    )
  );
};

Object.assign(postApprovalCard, { maxRetries: 0 });

// ---------------------------------------------------------------------------
// Step: Trigger the GitHub Actions workflow dispatch
// ---------------------------------------------------------------------------

interface DispatchMetadata {
  afterRunId: number;
  dispatchedAt: string;
}

const dispatchGitHubWorkflow = async (
  payload: DeployWorkflowPayload
): Promise<DispatchMetadata> => {
  "use step";

  const afterRunId = await getLatestRunId(
    payload.repo,
    payload.repo.workflowId,
    payload.branch
  );
  const dispatchedAt = new Date().toISOString();

  await triggerWorkflow(payload.repo, payload.repo.workflowId, payload.branch, {
    deploy_id: payload.deployId,
    environment: payload.environment,
  });

  return { afterRunId, dispatchedAt };
};

Object.assign(dispatchGitHubWorkflow, { maxRetries: 0 });

// ---------------------------------------------------------------------------
// Step: Check once for the dispatched run
// ---------------------------------------------------------------------------

const findDispatchedRunOnce = async (
  payload: DeployWorkflowPayload,
  dispatch: DispatchMetadata
): Promise<number | null> => {
  "use step";

  const run = await findDispatchedRun(payload.repo, payload.repo.workflowId, {
    afterRunId: dispatch.afterRunId,
    branch: payload.branch,
    commitSha: payload.commitSha,
    deployId: payload.deployId,
    dispatchedAt: dispatch.dispatchedAt,
  });

  return run?.id ?? null;
};

// ---------------------------------------------------------------------------
// Step: Fetch current run status and jobs
// ---------------------------------------------------------------------------

interface RunSnapshot {
  conclusion: string | null;
  htmlUrl: string;
  status: string;
  workflowName: string;
}

const fetchRunSnapshot = async (
  repo: DeployWorkflowPayload["repo"],
  githubRunId: number
): Promise<RunSnapshot> => {
  "use step";

  const { run } = await fetchRunWithJobs(repo, githubRunId);

  return {
    conclusion: run.conclusion ?? null,
    htmlUrl: run.html_url,
    status: run.status ?? "queued",
    workflowName: run.name ?? "GitHub Action",
  };
};

// ---------------------------------------------------------------------------
// Step: Resolve Linear issues from commits
// ---------------------------------------------------------------------------

interface PollResult {
  conclusion: string;
  durationMs: number;
  runUrl: string;
}

interface ResolvedIssues {
  issueKeys: string[];
  issues: { id: string; identifier: string; title: string; url: string }[];
}

const resolveLinearIssues = async (
  payload: DeployWorkflowPayload
): Promise<ResolvedIssues> => {
  "use step";

  const prevTag = `deploy/${payload.environment}/previous`;
  const currentTag = `deploy/${payload.environment}/latest`;

  const commits = await compareCommits(payload.repo, prevTag, currentTag);
  const searchTexts = [payload.branch, ...commits.map((c) => c.message)];
  const issueKeys = extractIssueKeys(searchTexts, payload.linearTeamPrefix);
  const issues = await getIssuesByIdentifiers(issueKeys);

  return { issueKeys, issues };
};

// ---------------------------------------------------------------------------
// Step: Comment on Linear issues
// ---------------------------------------------------------------------------

const commentOnLinearIssues = async (
  resolved: ResolvedIssues,
  payload: DeployWorkflowPayload,
  runUrl: string
): Promise<void> => {
  "use step";

  const productionState =
    payload.linearProductionState ?? DEFAULT_LINEAR_PRODUCTION_STATE;

  for (const issue of resolved.issues) {
    const body = [
      `**Deployed to ${payload.environment}**`,
      "",
      `Branch: \`${payload.branch}\``,
      `Commit: \`${payload.commitSha.slice(0, 7)}\``,
      `Triggered by: ${payload.triggeredBy.name}`,
      `[View workflow run](${runUrl})`,
    ].join("\n");

    await commentOnIssue(issue.id, body);

    if (payload.environment === "production") {
      const transitioned = await transitionIssue(issue.id, productionState);
      if (!transitioned) {
        throw new Error(
          `Linear workflow state "${productionState}" was not found for issue ${issue.identifier}.`
        );
      }
    }
  }
};

Object.assign(commentOnLinearIssues, { maxRetries: 0 });

// ---------------------------------------------------------------------------
// Step: Comment on GitHub PRs
// ---------------------------------------------------------------------------

const commentOnGitHubPRs = async (
  payload: DeployWorkflowPayload,
  runUrl: string
): Promise<number> => {
  "use step";

  const prs = await getPRsForCommit(payload.repo, payload.commitSha);

  for (const pr of prs) {
    const body = [
      `**Deployed to ${payload.environment}**`,
      "",
      `| | |`,
      `|---|---|`,
      `| Branch | \`${payload.branch}\` |`,
      `| Commit | \`${payload.commitSha.slice(0, 7)}\` |`,
      `| Triggered by | ${payload.triggeredBy.name} |`,
      `| Workflow | [View run](${runUrl}) |`,
    ].join("\n");

    await commentOnPR(payload.repo, pr.number, body);
  }

  return prs.length;
};

Object.assign(commentOnGitHubPRs, { maxRetries: 0 });

// ---------------------------------------------------------------------------
// Step: Post final summary
// ---------------------------------------------------------------------------

const postFinalSummary = async (
  serializedThread: SerializedThread,
  payload: DeployWorkflowPayload,
  result: PollResult,
  resolved: ResolvedIssues,
  prCount: number
): Promise<void> => {
  "use step";
  const thread = await getThread(serializedThread);

  const succeeded = result.conclusion === "success";
  const status = succeeded ? "Succeeded" : "Failed";
  const durationSec = Math.round(result.durationMs / 1000);
  const durationStr =
    durationSec > 60
      ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
      : `${durationSec}s`;

  const issueRows: string[][] = resolved.issues.map((issue) => [
    issue.identifier,
    issue.title.length > 50 ? `${issue.title.slice(0, 47)}…` : issue.title,
  ]);

  await thread.post(
    Card({
      children: [
        Fields([
          Field({ label: "Environment", value: payload.environment }),
          Field({ label: "Branch", value: payload.branch }),
          Field({ label: "Commit", value: payload.commitSha.slice(0, 7) }),
          Field({ label: "Duration", value: durationStr }),
          Field({ label: "Triggered by", value: payload.triggeredBy.name }),
          Field({
            label: "Linked issues",
            value: String(resolved.issues.length),
          }),
          Field({ label: "PRs notified", value: String(prCount) }),
        ]),
        ...(issueRows.length > 0
          ? [Divider(), Table({ headers: ["Issue", "Title"], rows: issueRows })]
          : []),
        Divider(),
        Actions([
          LinkButton({ label: "View Workflow Run", url: result.runUrl }),
        ]),
      ],
      subtitle: `${payload.environment} — ${payload.branch}`,
      title: `Deploy ${status}`,
    })
  );
};

// ---------------------------------------------------------------------------
// Workflow-level orchestration helpers (reduce complexity of main function)
// ---------------------------------------------------------------------------

const runApprovalGate = async (
  serializedThread: SerializedThread,
  deploy: DeployWorkflowPayload
): Promise<boolean> => {
  const { workflowRunId } = getWorkflowMetadata();
  await postApprovalCard(serializedThread, deploy, workflowRunId);

  using hook = createHook<ApprovalPayload>({ token: workflowRunId });

  for await (const event of hook) {
    if (event.approved) {
      return true;
    }
    return false;
  }

  return false;
};

const findGitHubRun = async (
  serializedThread: SerializedThread,
  deploy: DeployWorkflowPayload
): Promise<number | null> => {
  let dispatch: DispatchMetadata;
  try {
    dispatch = await dispatchGitHubWorkflow(deploy);
  } catch (error) {
    await postMessage(
      serializedThread,
      `Failed to trigger GitHub Actions: ${error instanceof Error ? error.message : "unknown error"}`
    );
    await notifyUserPrivately(
      serializedThread,
      deploy.triggeredBy.id,
      `Deploy to ${deploy.environment} failed to start.`
    );
    return null;
  }

  let githubRunId: number | null = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep("3s");
    githubRunId = await findDispatchedRunOnce(deploy, dispatch);
    if (githubRunId !== null) {
      break;
    }
  }

  if (githubRunId === null) {
    await postMessage(
      serializedThread,
      "Could not safely identify the dispatched workflow run after 30 seconds."
    );
    await notifyUserPrivately(
      serializedThread,
      deploy.triggeredBy.id,
      `Deploy to ${deploy.environment} failed to start.`
    );
  }

  return githubRunId;
};

// 60 minutes
const MAX_POLL_DURATION_MS = 60 * 60 * 1000;

const pollUntilComplete = async (
  deploy: DeployWorkflowPayload,
  githubRunId: number
): Promise<PollResult> => {
  const startTime = Date.now();

  // eslint-disable-next-line no-constant-condition -- poll loop
  while (true) {
    await sleep("5s");

    if (Date.now() - startTime > MAX_POLL_DURATION_MS) {
      return {
        conclusion: "timed_out",
        durationMs: Date.now() - startTime,
        runUrl: `https://github.com/${deploy.repo.owner}/${deploy.repo.name}/actions/runs/${githubRunId}`,
      };
    }

    const snapshot = await fetchRunSnapshot(deploy.repo, githubRunId);

    if (snapshot.status === "completed") {
      return {
        conclusion: snapshot.conclusion ?? "unknown",
        durationMs: Date.now() - startTime,
        runUrl: snapshot.htmlUrl,
      };
    }
  }
};

const notifyExternalSystems = async (
  serializedThread: SerializedThread,
  deploy: DeployWorkflowPayload,
  result: PollResult
): Promise<{ prCount: number; resolved: ResolvedIssues }> => {
  let resolved: ResolvedIssues = { issueKeys: [], issues: [] };

  if (deploy.linearTeamPrefix !== undefined) {
    try {
      resolved = await resolveLinearIssues(deploy);
    } catch (error) {
      await postMessage(
        serializedThread,
        `Could not resolve Linear issues: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }

    if (resolved.issues.length > 0 && result.conclusion === "success") {
      try {
        await commentOnLinearIssues(resolved, deploy, result.runUrl);
      } catch (error) {
        await postMessage(
          serializedThread,
          `Failed to update some Linear issues: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }
  }

  let prCount = 0;
  if (result.conclusion === "success") {
    try {
      prCount = await commentOnGitHubPRs(deploy, result.runUrl);
    } catch (error) {
      await postMessage(
        serializedThread,
        `Failed to comment on some PRs: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  return { prCount, resolved };
};

// ---------------------------------------------------------------------------
// Main workflow — orchestrates steps using workflow primitives
// ---------------------------------------------------------------------------

export const deployWorkflow = async (rawPayload: string) => {
  "use workflow";

  const parsed: unknown = JSON.parse(rawPayload);
  if (!isDeployWorkflowPayload(parsed)) {
    throw new Error("Invalid deploy workflow payload");
  }

  const payload = parsed;

  const { thread: serializedThread, ...deploy } = payload;
  let statusMessage: StatusMessageRef | null = null;

  if (deploy.environment === "production") {
    const approved = await runApprovalGate(serializedThread, deploy);
    if (!approved) {
      return;
    }
  }

  statusMessage = await postMessage(serializedThread, "Starting deploy...");

  // --- Trigger & find GitHub Actions run ---
  const githubRunId = await findGitHubRun(serializedThread, deploy);
  if (githubRunId === null) {
    return;
  }

  const initialSnapshot = await fetchRunSnapshot(deploy.repo, githubRunId);
  const workflowStatusLabel = initialSnapshot.workflowName;

  if (statusMessage === null) {
    statusMessage = await postMessage(
      serializedThread,
      `Running ${workflowStatusLabel}`
    );
  } else {
    await updateStatusMessage(
      serializedThread,
      statusMessage,
      `Running ${workflowStatusLabel}`
    );
  }

  // --- Poll for progress ---
  const result = await pollUntilComplete(deploy, githubRunId);

  if (statusMessage !== null) {
    await updateStatusMessage(
      serializedThread,
      statusMessage,
      `Completed ${workflowStatusLabel}`
    );
  }

  // --- Notify external systems ---
  const { prCount, resolved } = await notifyExternalSystems(
    serializedThread,
    deploy,
    result
  );

  // --- Final summary & DM ---
  await postFinalSummary(serializedThread, deploy, result, resolved, prCount);
};
