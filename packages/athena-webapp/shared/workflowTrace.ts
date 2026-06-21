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

export const WORKFLOW_TRACE_SENSITIVE_DETAIL_KEYS = [
  "rawPaymentPayload",
  "rawProviderPayload",
  "rawProviderResponse",
  "rawProviderError",
  "customerContact",
  "customerEmail",
  "customerPhone",
  "serviceNote",
  "serviceNotes",
] as const;

export type WorkflowTraceSensitiveDetailKey =
  (typeof WORKFLOW_TRACE_SENSITIVE_DETAIL_KEYS)[number];

const WORKFLOW_TRACE_SENSITIVE_DETAIL_KEY_SET = new Set(
  WORKFLOW_TRACE_SENSITIVE_DETAIL_KEYS.map((key) => key.toLowerCase())
);

function assertObjectKeysAreMinimized(value: unknown, path: string): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertObjectKeysAreMinimized(entry, `${path}[${index}]`);
    });
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (WORKFLOW_TRACE_SENSITIVE_DETAIL_KEY_SET.has(key.toLowerCase())) {
      throw new Error(
        `Workflow trace details must use refs or normalized summaries, not raw sensitive payloads (${path}.${key}).`
      );
    }

    assertObjectKeysAreMinimized(nestedValue, `${path}.${key}`);
  }
}

export function assertWorkflowTraceDetailsAreMinimized(
  details: Record<string, unknown> | undefined
) {
  assertObjectKeysAreMinimized(details, "details");
}

export function normalizeWorkflowTraceLookupValue(value: string) {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    throw new Error("Workflow trace lookup values must not be empty.");
  }

  return normalized;
}

export function normalizeWorkflowTraceEventKey(value: string) {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    throw new Error("Workflow trace event keys must not be empty.");
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
