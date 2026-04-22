export const WORKFLOW_TRACE_KINDS = [
  "milestone",
  "system_action",
  "gap",
] as const;

export const WORKFLOW_TRACE_STATUSES = [
  "started",
  "succeeded",
  "failed",
  "blocked",
  "info",
] as const;

export const WORKFLOW_TRACE_HEALTHS = [
  "healthy",
  "partial",
  "degraded",
] as const;

export type WorkflowTraceKind = (typeof WORKFLOW_TRACE_KINDS)[number];
export type WorkflowTraceStatus = (typeof WORKFLOW_TRACE_STATUSES)[number];
export type WorkflowTraceHealth = (typeof WORKFLOW_TRACE_HEALTHS)[number];

export function normalizeWorkflowTraceLookupValue(value: string) {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    throw new Error("Workflow trace lookup values must not be empty.");
  }

  return normalized;
}

export function createWorkflowTraceId(args: {
  workflowType: string;
  primaryLookupValue: string;
}) {
  const workflowType = args.workflowType.trim().toLowerCase();

  if (!workflowType) {
    throw new Error("Workflow trace workflow types must not be empty.");
  }

  return `${workflowType}:${normalizeWorkflowTraceLookupValue(
    args.primaryLookupValue
  )}`;
}
