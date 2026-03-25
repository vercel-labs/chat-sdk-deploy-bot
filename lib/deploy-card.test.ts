import { describe, expect, it, vi } from "vitest";

import { buildDeployCard, parseDeployCardActionValue } from "@/lib/deploy-card";

const element = (type: string, props: Record<string, unknown> = {}) => ({
  type,
  ...props,
});

vi.mock("chat", () => ({
  Actions: vi.fn((children: unknown[]) => element("Actions", { children })),
  Button: vi.fn((props: Record<string, unknown>) => element("Button", props)),
  Card: vi.fn((props: Record<string, unknown>) => element("Card", props)),
  CardText: vi.fn((text: string) => element("CardText", { text })),
  Divider: vi.fn(() => element("Divider")),
  Field: vi.fn((props: Record<string, unknown>) => element("Field", props)),
  Fields: vi.fn((children: unknown[]) => element("Fields", { children })),
}));

const deployCardData = {
  branch: "main",
  commitSha: "abc1234567",
  environment: "production" as const,
  triggeredById: "U1",
  triggeredByName: "Test User",
};

const getCard = (value: unknown): Record<string, unknown> => {
  const { card } = value as { card: Record<string, unknown> };
  return card;
};

const getCardChildren = (value: unknown): Record<string, unknown>[] =>
  getCard(value).children as Record<string, unknown>[];

describe("buildDeployCard", () => {
  it("renders the same base field order for staging and production", () => {
    const staging = buildDeployCard({
      ...deployCardData,
      environment: "staging",
    });
    const production = buildDeployCard(deployCardData);

    expect(getCard(staging)).toMatchObject({
      subtitle: "main @ abc1234",
      title: "Deploy to staging",
    });
    expect(getCard(production)).toMatchObject({
      subtitle: "main @ abc1234",
      title: "Deploy to production",
    });

    const stagingFields = getCardChildren(staging)[0]?.children as {
      label: string;
    }[];
    const productionFields = getCardChildren(production)[0]?.children as {
      label: string;
    }[];

    expect(stagingFields.map((field) => field.label)).toEqual([
      "Environment",
      "Branch",
      "Commit",
      "Requested by",
    ]);
    expect(productionFields.map((field) => field.label)).toEqual([
      "Environment",
      "Branch",
      "Commit",
      "Requested by",
    ]);
  });

  it("renders pending approval with footer text and buttons", () => {
    const message = buildDeployCard(deployCardData, {
      status: "pending",
      workflowRunId: "run1",
    });

    expect(getCard(message)).toMatchObject({
      subtitle: "main @ abc1234",
      title: "Deploy to production",
    });
    expect(getCardChildren(message)).toEqual([
      expect.objectContaining({ type: "Fields" }),
      expect.objectContaining({ type: "Divider" }),
      expect.objectContaining({
        text: "A production deploy requires approval before proceeding.",
        type: "CardText",
      }),
      expect.objectContaining({
        children: [
          expect.objectContaining({
            id: "deploy_approve",
            label: "Approve",
            style: "primary",
          }),
          expect.objectContaining({
            id: "deploy_cancel",
            label: "Cancel",
            style: "danger",
          }),
        ],
        type: "Actions",
      }),
    ]);

    const actions = getCardChildren(message)[3]?.children as {
      value: string;
    }[];
    expect(parseDeployCardActionValue(actions[0]?.value)).toEqual({
      branch: "main",
      commitSha: "abc1234567",
      environment: "production",
      runId: "run1",
      triggeredById: "U1",
      triggeredByName: "Test User",
    });
    expect(parseDeployCardActionValue(actions[1]?.value)).toEqual({
      branch: "main",
      commitSha: "abc1234567",
      environment: "production",
      runId: "run1",
      triggeredById: "U1",
      triggeredByName: "Test User",
    });
  });

  it("renders approved without buttons", () => {
    const message = buildDeployCard(deployCardData, {
      approvedBy: "Test User",
      status: "approved",
    });

    expect(getCardChildren(message)).toEqual([
      expect.objectContaining({ type: "Fields" }),
      expect.objectContaining({ type: "Divider" }),
      expect.objectContaining({
        text: "Approved by Test User.",
        type: "CardText",
      }),
    ]);
  });

  it("renders cancelled without buttons", () => {
    const message = buildDeployCard(deployCardData, {
      cancelledBy: "Test User",
      status: "cancelled",
    });

    expect(getCardChildren(message)).toEqual([
      expect.objectContaining({ type: "Fields" }),
      expect.objectContaining({ type: "Divider" }),
      expect.objectContaining({
        text: "Cancelled by Test User.",
        type: "CardText",
      }),
    ]);
  });

  it("falls back to the pending approval copy for an unknown approval state", () => {
    const message = buildDeployCard(deployCardData, {
      status: "unexpected",
    } as unknown as Parameters<typeof buildDeployCard>[1]);

    expect(getCardChildren(message)).toEqual([
      expect.objectContaining({ type: "Fields" }),
      expect.objectContaining({ type: "Divider" }),
      expect.objectContaining({
        text: "A production deploy requires approval before proceeding.",
        type: "CardText",
      }),
    ]);
  });

  it("returns null for a non-object action payload", () => {
    expect(parseDeployCardActionValue('"not-an-object"')).toBeNull();
  });

  it("returns null for an invalid object action payload", () => {
    expect(
      parseDeployCardActionValue(
        JSON.stringify({
          branch: "main",
          commitSha: "abc1234567",
          environment: "invalid",
          runId: "run1",
          triggeredById: "U1",
          triggeredByName: "Test User",
        })
      )
    ).toBeNull();
  });

  it("returns null for a malformed action payload", () => {
    expect(parseDeployCardActionValue("{bad json")).toBeNull();
  });
});
