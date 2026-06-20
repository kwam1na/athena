export type AppActionBlockerPriority =
  | "critical-workflow"
  | "active-command"
  | "resume-required";

export type AppActionBlockerInput = {
  actionId: string;
  blockerId: string;
  priority: AppActionBlockerPriority;
  label: string;
  guidance: string;
};

export type AppActionBlocker = AppActionBlockerInput;

const priorityRank: Record<AppActionBlockerPriority, number> = {
  "critical-workflow": 0,
  "active-command": 1,
  "resume-required": 2,
};

export function sortAppActionBlockers(blockers: AppActionBlocker[]) {
  return [...blockers].sort(compareAppActionBlockers);
}

export function getSelectedAppActionBlocker(blockers: AppActionBlocker[]) {
  return sortAppActionBlockers(blockers)[0];
}

export function isValidAppActionBlockerInput(
  blocker: AppActionBlockerInput,
) {
  return (
    blocker.actionId.length > 0 &&
    blocker.blockerId.length > 0 &&
    blocker.label.length > 0 &&
    blocker.guidance.length > 0
  );
}

function compareAppActionBlockers(
  left: AppActionBlocker,
  right: AppActionBlocker,
) {
  return (
    priorityRank[left.priority] - priorityRank[right.priority] ||
    left.label.localeCompare(right.label) ||
    left.blockerId.localeCompare(right.blockerId)
  );
}
