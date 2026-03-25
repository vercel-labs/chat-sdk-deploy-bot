import { Actions, Button, Card, CardText, Divider, Field, Fields } from "chat";
import type { AdapterPostableMessage, CardChild } from "chat";

export interface DeployCardData {
  branch: string;
  commitSha: string;
  environment: "staging" | "production";
  triggeredById: string;
  triggeredByName: string;
}

export type DeployCardApprovalState =
  | { status: "pending"; workflowRunId: string }
  | { status: "approved"; approvedBy: string }
  | { status: "cancelled"; cancelledBy: string };

export interface DeployCardActionValue {
  branch: string;
  commitSha: string;
  environment: "staging" | "production";
  runId: string;
  triggeredById: string;
  triggeredByName: string;
}

const PENDING_APPROVAL_MESSAGE =
  "A production deploy requires approval before proceeding.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const getApprovalMessage = (approval: DeployCardApprovalState): string => {
  switch (approval.status) {
    case "approved": {
      return `Approved by ${approval.approvedBy}.`;
    }
    case "cancelled": {
      return `Cancelled by ${approval.cancelledBy}.`;
    }
    case "pending": {
      return PENDING_APPROVAL_MESSAGE;
    }
    default: {
      return PENDING_APPROVAL_MESSAGE;
    }
  }
};

const encodeDeployCardActionValue = (
  data: DeployCardData,
  workflowRunId: string
): string =>
  JSON.stringify({
    branch: data.branch,
    commitSha: data.commitSha,
    environment: data.environment,
    runId: workflowRunId,
    triggeredById: data.triggeredById,
    triggeredByName: data.triggeredByName,
  } satisfies DeployCardActionValue);

export const parseDeployCardActionValue = (
  value: string | undefined
): DeployCardActionValue | null => {
  if (value === undefined || value.trim() === "") {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) {
      return null;
    }

    if (
      typeof parsed.branch === "string" &&
      typeof parsed.commitSha === "string" &&
      (parsed.environment === "staging" ||
        parsed.environment === "production") &&
      typeof parsed.runId === "string" &&
      typeof parsed.triggeredById === "string" &&
      typeof parsed.triggeredByName === "string"
    ) {
      return {
        branch: parsed.branch,
        commitSha: parsed.commitSha,
        environment: parsed.environment,
        runId: parsed.runId,
        triggeredById: parsed.triggeredById,
        triggeredByName: parsed.triggeredByName,
      };
    }

    return null;
  } catch {
    return null;
  }
};

export const buildDeployCard = (
  data: DeployCardData,
  approval?: DeployCardApprovalState
): AdapterPostableMessage => {
  const shortSha = data.commitSha.slice(0, 7);
  const children: CardChild[] = [
    Fields([
      Field({ label: "Environment", value: data.environment }),
      Field({ label: "Branch", value: data.branch }),
      Field({ label: "Commit", value: shortSha }),
      Field({ label: "Requested by", value: data.triggeredByName }),
    ]),
  ];

  if (approval !== undefined) {
    children.push(Divider(), CardText(getApprovalMessage(approval)));

    if (approval.status === "pending") {
      children.push(
        Actions([
          Button({
            id: "deploy_approve",
            label: "Approve",
            style: "primary",
            value: encodeDeployCardActionValue(data, approval.workflowRunId),
          }),
          Button({
            id: "deploy_cancel",
            label: "Cancel",
            style: "danger",
            value: encodeDeployCardActionValue(data, approval.workflowRunId),
          }),
        ])
      );
    }
  }

  return {
    card: Card({
      children,
      subtitle: `${data.branch} @ ${shortSha}`,
      title: `Deploy to ${data.environment}`,
    }),
    fallbackText: [
      `Deploy to ${data.environment}`,
      `${data.branch} @ ${shortSha}`,
      ...(approval === undefined ? [] : [getApprovalMessage(approval)]),
    ].join(" - "),
  };
};
