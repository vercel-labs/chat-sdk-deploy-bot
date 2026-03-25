import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadModule = () => import("@/lib/permissions");

describe("permissions", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe("canDeploy", () => {
    it("allows anyone to deploy to staging", async () => {
      const { canDeploy } = await loadModule();
      expect(canDeploy("U999", "staging")).toEqual({ allowed: true });
    });

    it("denies production deploy for unlisted users", async () => {
      process.env.DEPLOY_PROD_ALLOWED = "U001,U002";
      const { canDeploy } = await loadModule();
      const result = canDeploy("U999", "production");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it("allows production deploy for listed users", async () => {
      process.env.DEPLOY_PROD_ALLOWED = "U001,U002";
      const { canDeploy } = await loadModule();
      expect(canDeploy("U001", "production")).toEqual({ allowed: true });
    });

    it("denies production deploy when env var is empty", async () => {
      process.env.DEPLOY_PROD_ALLOWED = "";
      const { canDeploy } = await loadModule();
      expect(canDeploy("U001", "production").allowed).toBe(false);
    });
  });

  describe("canApprove", () => {
    it("allows listed approvers", async () => {
      process.env.DEPLOY_PROD_APPROVERS = "U100,U200";
      const { canApprove } = await loadModule();
      expect(canApprove("U100")).toEqual({ allowed: true });
    });

    it("denies unlisted users", async () => {
      process.env.DEPLOY_PROD_APPROVERS = "U100";
      const { canApprove } = await loadModule();
      const result = canApprove("U999");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe("requiresApproval", () => {
    it("returns true for production", async () => {
      const { requiresApproval } = await loadModule();
      expect(requiresApproval("production")).toBe(true);
    });

    it("returns false for staging", async () => {
      const { requiresApproval } = await loadModule();
      expect(requiresApproval("staging")).toBe(false);
    });
  });
});
