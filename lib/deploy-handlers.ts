import { Modal, Select, SelectOption, TextInput, ThreadImpl } from "chat";
import type { Author, Channel, SerializedThread, Thread } from "chat";
import { resumeHook, start } from "workflow/api";

import type { DeployThreadState } from "@/lib/bot";
import { bot } from "@/lib/bot";
import { buildDeployCard, parseDeployCardActionValue } from "@/lib/deploy-card";
import type {
  DeployCardActionValue,
  DeployCardApprovalState,
  DeployCardData,
} from "@/lib/deploy-card";
import { getHeadSha } from "@/lib/github";
import {
  getLinearProductionState,
  getLinearTeamPrefix,
  isLinearEnabled,
} from "@/lib/linear";
import { canDeploy, canApprove } from "@/lib/permissions";
import { deployWorkflow } from "@/workflows/deploy-workflow";
import type {
  ApprovalPayload,
  DeployWorkflowPayload,
} from "@/workflows/deploy-workflow";

// ---------------------------------------------------------------------------
// Config from env
// ---------------------------------------------------------------------------

const REPO = {
  name: process.env.GITHUB_REPO_NAME ?? "",
  owner: process.env.GITHUB_REPO_OWNER ?? "",
  workflowId: process.env.GITHUB_WORKFLOW_ID ?? "",
};

// ---------------------------------------------------------------------------
// Helper: read thread state safely
// ---------------------------------------------------------------------------

const isDeployThreadState = (value: unknown): value is DeployThreadState =>
  value !== null && typeof value === "object";

const getThreadState = async (thread: {
  state: Promise<unknown>;
}): Promise<DeployThreadState> => {
  const raw = await thread.state;
  return isDeployThreadState(raw) ? raw : {};
};

const hasDeployCardState = (
  state: DeployThreadState
): state is DeployThreadState & Omit<DeployCardData, "triggeredById"> =>
  typeof state.branch === "string" &&
  typeof state.commitSha === "string" &&
  (state.environment === "staging" || state.environment === "production") &&
  typeof state.triggeredByName === "string";

const hasApprovalActionState = (
  state: DeployThreadState
): state is DeployThreadState &
  Omit<DeployCardData, "triggeredById"> & {
    runId: string;
  } => hasDeployCardState(state) && typeof state.runId === "string";

const getApprovalActionContext = (
  state: DeployThreadState,
  actionValue: string | undefined
): DeployCardActionValue | null => {
  if (hasApprovalActionState(state)) {
    return {
      branch: state.branch,
      commitSha: state.commitSha,
      environment: state.environment,
      runId: state.runId,
      triggeredById: state.triggeredBy ?? "",
      triggeredByName: state.triggeredByName,
    };
  }

  return parseDeployCardActionValue(actionValue);
};

const APPROVAL_CARD_UPDATE_ERROR =
  "Could not update the deploy card. Please try again.";

const postApprovalCardUpdateError = async (
  thread: {
    postEphemeral: Thread["postEphemeral"];
  },
  user: Author
): Promise<void> => {
  await thread.postEphemeral(user, APPROVAL_CARD_UPDATE_ERROR, {
    fallbackToDM: false,
  });
};

const completeApprovalAction = async (
  event: {
    messageId: string;
    thread: Pick<Thread, "adapter" | "id" | "postEphemeral">;
    user: Author;
    value?: string;
  },
  state: DeployThreadState,
  approvalState: Exclude<DeployCardApprovalState, { status: "pending" }>,
  payload: ApprovalPayload
): Promise<void> => {
  const actionContext = getApprovalActionContext(state, event.value);
  if (actionContext === null) {
    await postApprovalCardUpdateError(event.thread, event.user);
    return;
  }

  try {
    await event.thread.adapter.editMessage(
      event.thread.id,
      event.messageId,
      buildDeployCard(
        {
          branch: actionContext.branch,
          commitSha: actionContext.commitSha,
          environment: actionContext.environment,
          triggeredById: actionContext.triggeredById,
          triggeredByName: actionContext.triggeredByName,
        },
        approvalState
      )
    );
  } catch {
    await postApprovalCardUpdateError(event.thread, event.user);
    return;
  }

  await resumeHook<ApprovalPayload>(actionContext.runId, payload);
};

// ---------------------------------------------------------------------------
// Helper: resolve branch + build payload
// ---------------------------------------------------------------------------

const buildPayload = async (
  channel: Pick<Channel, "post">,
  opts: {
    environment: "staging" | "production";
    branch: string;
    triggeredBy: { id: string; name: string };
  }
): Promise<
  | {
      commitSha: string;
      deployId: string;
      payload: Omit<DeployWorkflowPayload, "requestMessageId">;
    }
  | undefined
> => {
  const deployId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let commitSha: string;
  try {
    commitSha = await getHeadSha(REPO, opts.branch);
  } catch {
    await channel.post(
      `Could not resolve branch \`${opts.branch}\`. Does it exist?`
    );
    return;
  }

  const payload: Omit<DeployWorkflowPayload, "requestMessageId"> = {
    branch: opts.branch,
    commitSha,
    deployId,
    environment: opts.environment,
    ...(isLinearEnabled()
      ? {
          linearProductionState: getLinearProductionState(),
          linearTeamPrefix: getLinearTeamPrefix(),
        }
      : {}),
    repo: REPO,
    triggeredBy: opts.triggeredBy,
  };

  return { commitSha, deployId, payload };
};

// ---------------------------------------------------------------------------
// Helper: post initial card and start the workflow with a proper Thread
// ---------------------------------------------------------------------------

const postCardAndStartWorkflow = async (
  channel: Pick<Channel, "post" | "toJSON">,
  payload: Omit<DeployWorkflowPayload, "requestMessageId">
) => {
  const sentMsg = await channel.post(
    buildDeployCard({
      branch: payload.branch,
      commitSha: payload.commitSha,
      environment: payload.environment,
      triggeredById: payload.triggeredBy.id,
      triggeredByName: payload.triggeredBy.name,
    })
  );

  const channelJson = channel.toJSON();
  const serializedThread: SerializedThread = {
    _type: "chat:Thread",
    adapterName: channelJson.adapterName,
    channelId: channelJson.id,
    id: sentMsg.threadId,
    isDM: channelJson.isDM,
  };

  await bot.initialize();
  const thread = ThreadImpl.fromJSON<DeployThreadState>(serializedThread);
  await thread.setState({
    branch: payload.branch,
    commitSha: payload.commitSha,
    deployId: payload.deployId,
    environment: payload.environment,
    triggeredBy: payload.triggeredBy.id,
    triggeredByName: payload.triggeredBy.name,
  });

  await start(deployWorkflow, [
    JSON.stringify({
      ...payload,
      requestMessageId: sentMsg.id,
      thread: serializedThread,
    }),
  ]);
};

// ---------------------------------------------------------------------------
// /deploy [environment] — slash command
// ---------------------------------------------------------------------------

bot.onSlashCommand("/deploy", async (event) => {
  const args = event.text.trim().toLowerCase();

  if (!args) {
    await event.openModal(
      Modal({
        callbackId: "deploy_form",
        children: [
          Select({
            id: "environment",
            label: "Environment",
            options: [
              SelectOption({ label: "Staging", value: "staging" }),
              SelectOption({ label: "Production", value: "production" }),
            ],
          }),
          TextInput({
            id: "branch",
            label: "Branch",
            optional: true,
            placeholder: "main",
          }),
        ],
        submitLabel: "Deploy",
        title: "Deploy",
      })
    );
    return;
  }

  const environment =
    args === "production" || args === "prod"
      ? ("production" as const)
      : ("staging" as const);
  const branch = "main";

  const perm = canDeploy(event.user.userId, environment);
  if (!perm.allowed) {
    await event.channel.postEphemeral(
      event.user,
      perm.reason ?? "Permission denied",
      {
        fallbackToDM: false,
      }
    );
    return;
  }

  const result = await buildPayload(event.channel, {
    branch,
    environment,
    triggeredBy: {
      id: event.user.userId,
      name: event.user.fullName ?? event.user.userId,
    },
  });

  if (!result) {
    return;
  }

  await postCardAndStartWorkflow(event.channel, result.payload);
});

// ---------------------------------------------------------------------------
// Modal submit: deploy_form
// ---------------------------------------------------------------------------

bot.onModalSubmit("deploy_form", async (event): Promise<undefined> => {
  const environment =
    event.values.environment === "production"
      ? ("production" as const)
      : ("staging" as const);
  const branch = event.values.branch?.trim() || "main";

  const perm = canDeploy(event.user.userId, environment);
  if (!perm.allowed) {
    if (event.relatedChannel) {
      await event.relatedChannel.postEphemeral(
        event.user,
        perm.reason ?? "Permission denied",
        {
          fallbackToDM: false,
        }
      );
    }
    return undefined;
  }

  const target = event.relatedChannel;
  if (!target) {
    return undefined;
  }

  const result = await buildPayload(target, {
    branch,
    environment,
    triggeredBy: {
      id: event.user.userId,
      name: event.user.fullName ?? event.user.userId,
    },
  });

  if (!result) {
    return undefined;
  }

  await postCardAndStartWorkflow(target, result.payload);
  return undefined;
});

// ---------------------------------------------------------------------------
// Action: Approve a production deploy
// ---------------------------------------------------------------------------

bot.onAction("deploy_approve", async (event) => {
  const perm = canApprove(event.user.userId);

  if (!perm.allowed) {
    if (event.thread) {
      await event.thread.postEphemeral(
        event.user,
        perm.reason ?? "Permission denied",
        {
          fallbackToDM: false,
        }
      );
    }
    return;
  }

  if (!event.thread) {
    return;
  }
  const state = await getThreadState(event.thread);
  await completeApprovalAction(
    {
      messageId: event.messageId,
      thread: event.thread,
      user: event.user,
      value: event.value,
    },
    state,
    {
      approvedBy: event.user.fullName ?? event.user.userId,
      status: "approved",
    },
    {
      approved: true,
      approvedBy: {
        id: event.user.userId,
        name: event.user.fullName ?? event.user.userId,
      },
    }
  );
});

// ---------------------------------------------------------------------------
// Action: Cancel a production deploy
// ---------------------------------------------------------------------------

bot.onAction("deploy_cancel", async (event) => {
  if (!event.thread) {
    return;
  }

  const state = await getThreadState(event.thread);
  const actionContext = getApprovalActionContext(state, event.value);
  const triggererId = state.triggeredBy ?? actionContext?.triggeredById;

  if (
    triggererId !== undefined &&
    triggererId !== "" &&
    event.user.userId !== triggererId
  ) {
    await event.thread.postEphemeral(
      event.user,
      "Only the person who triggered this deploy can cancel it.",
      { fallbackToDM: false }
    );
    return;
  }

  const cancelledBy = event.user.fullName ?? event.user.userId;
  await completeApprovalAction(
    {
      messageId: event.messageId,
      thread: event.thread,
      user: event.user,
      value: event.value,
    },
    state,
    { cancelledBy, status: "cancelled" },
    {
      approved: false,
    }
  );
});
