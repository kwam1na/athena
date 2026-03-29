import type { NormalizedIssue } from "./issue";

export function sortIssuesForDispatch(issues: NormalizedIssue[]): NormalizedIssue[] {
  return [...issues].sort((left, right) => {
    const leftPriority = normalizePriority(left.priority);
    const rightPriority = normalizePriority(right.priority);

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const leftCreated = Date.parse(left.created_at);
    const rightCreated = Date.parse(right.created_at);
    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }

    return left.identifier.localeCompare(right.identifier);
  });
}

export function isIssueDispatchEligible(
  issue: NormalizedIssue,
  options: {
    activeStates: Set<string>;
    terminalStates: Set<string>;
    claimedIssueIds: Set<string>;
    runningIssueIds: Set<string>;
  },
): boolean {
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) {
    return false;
  }

  if (!options.activeStates.has(issue.state)) {
    return false;
  }

  if (options.terminalStates.has(issue.state)) {
    return false;
  }

  if (options.claimedIssueIds.has(issue.id) || options.runningIssueIds.has(issue.id)) {
    return false;
  }

  if (issue.state === "Todo") {
    const hasNonTerminalBlockers = issue.blocked_by.some((blocker) => !options.terminalStates.has(blocker.state));
    if (hasNonTerminalBlockers) {
      return false;
    }
  }

  return true;
}

function normalizePriority(value: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Number.MAX_SAFE_INTEGER;
  }

  return value;
}
