// ---------------------------------------------------------------------------
// Permissions — who can deploy to which environments
// ---------------------------------------------------------------------------

type Environment = "staging" | "production";

interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

const prodAllowed = new Set(
  (process.env.DEPLOY_PROD_ALLOWED ?? "").split(",").filter(Boolean)
);

const prodApprovers = new Set(
  (process.env.DEPLOY_PROD_APPROVERS ?? "").split(",").filter(Boolean)
);

/**
 * Check whether a user can *trigger* a deploy to the given environment.
 */
export const canDeploy = (
  userId: string,
  env: Environment
): PermissionResult => {
  if (env === "staging") {
    return { allowed: true };
  }

  if (!prodAllowed.has(userId)) {
    return {
      allowed: false,
      reason:
        "You don't have permission to deploy to production. Ask an admin to add you.",
    };
  }

  return { allowed: true };
};

/**
 * Check whether a user can *approve* a production deploy.
 */
export const canApprove = (userId: string): PermissionResult => {
  if (!prodApprovers.has(userId)) {
    return {
      allowed: false,
      reason: "You're not authorized to approve production deploys.",
    };
  }

  return { allowed: true };
};

/**
 * Whether the given environment requires an explicit approval step.
 */
export const requiresApproval = (env: Environment): boolean =>
  env === "production";
