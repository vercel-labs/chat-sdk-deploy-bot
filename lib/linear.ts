import { LinearClient } from "@linear/sdk";

// ---------------------------------------------------------------------------
// Linear API helpers
// ---------------------------------------------------------------------------

export const DEFAULT_LINEAR_TEAM_PREFIX = "ENG";
export const DEFAULT_LINEAR_PRODUCTION_STATE = "Done";

export const isLinearEnabled = (): boolean => {
  const value = process.env.LINEAR_API_KEY;
  return value !== undefined && value.trim() !== "";
};

export const getLinearTeamPrefix = (): string => {
  const value = process.env.LINEAR_TEAM_PREFIX;
  if (value === undefined || value.trim() === "") {
    return DEFAULT_LINEAR_TEAM_PREFIX;
  }
  return value.trim();
};

export const getLinearProductionState = (): string => {
  const value = process.env.LINEAR_PRODUCTION_STATE;
  if (value === undefined || value.trim() === "") {
    return DEFAULT_LINEAR_PRODUCTION_STATE;
  }
  return value.trim();
};

const getLinearClient = (): LinearClient => {
  const apiKey = process.env.LINEAR_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error("Missing required environment variable: LINEAR_API_KEY");
  }
  return new LinearClient({ apiKey });
};

// ---------------------------------------------------------------------------
// Extract issue keys from commit messages
//
// Matches patterns like ENG-123, TEAM-456 in commit messages and branch names.
// ---------------------------------------------------------------------------

export const extractIssueKeys = (
  texts: string[],
  prefix = getLinearTeamPrefix()
): string[] => {
  const pattern = new RegExp(`${prefix}-\\d+`, "gi");
  const keys = new Set<string>();

  for (const text of texts) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        keys.add(m.toUpperCase());
      }
    }
  }

  return [...keys];
};

// ---------------------------------------------------------------------------
// Look up issues by their identifier (e.g. ENG-123)
// ---------------------------------------------------------------------------

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
}

export const getIssuesByIdentifiers = async (
  identifiers: string[]
): Promise<LinearIssue[]> => {
  if (identifiers.length === 0) {
    return [];
  }

  const client = getLinearClient();
  const issues = await Promise.all(
    identifiers.map((identifier) => client.issue(identifier))
  );

  return issues.map((issue) => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
  }));
};

// ---------------------------------------------------------------------------
// Comment on a Linear issue
// ---------------------------------------------------------------------------

export const commentOnIssue = async (
  issueId: string,
  body: string
): Promise<void> => {
  const payload = await getLinearClient().createComment({ body, issueId });
  if (!payload.success) {
    throw new Error(`Failed to comment on Linear issue ${issueId}`);
  }
};

// ---------------------------------------------------------------------------
// Transition an issue to a target state name (e.g. "Done", "Deployed")
//
// Finds the matching workflow state for the issue's team, then updates.
// ---------------------------------------------------------------------------

export const transitionIssue = async (
  issueId: string,
  targetStateName: string
): Promise<boolean> => {
  const client = getLinearClient();
  const issue = await client.issue(issueId);
  const team = await issue.team;
  if (team === undefined) {
    throw new Error(`Linear issue ${issueId} has no team`);
  }

  const states = await team.states();
  const targetState = states.nodes.find(
    (s) => s.name.toLowerCase() === targetStateName.toLowerCase()
  );

  if (!targetState) {
    console.warn(
      `Linear issue ${issueId} team ${team.name} has no state named "${targetStateName}"`
    );
    return false;
  }

  const payload = await client.updateIssue(issueId, {
    stateId: targetState.id,
  });
  return payload.success;
};
