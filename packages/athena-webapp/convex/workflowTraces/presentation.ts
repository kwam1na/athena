import type { Doc } from "../_generated/dataModel";

export type WorkflowTracePresentationInput = {
  trace: Pick<
    Doc<"workflowTrace">,
    | "traceId"
    | "workflowType"
    | "title"
    | "status"
    | "health"
    | "primaryLookupType"
    | "primaryLookupValue"
    | "summary"
  >;
  events: Array<
    Pick<
      Doc<"workflowTraceEvent">,
      | "traceId"
      | "workflowType"
      | "occurredAt"
      | "sequence"
      | "kind"
      | "step"
      | "status"
      | "message"
      | "source"
    >
  >;
};

export function buildWorkflowTraceViewModel(input: WorkflowTracePresentationInput) {
  const events = [...input.events].sort((left, right) => {
    if (left.occurredAt !== right.occurredAt) {
      return left.occurredAt - right.occurredAt;
    }

    return left.sequence - right.sequence;
  });

  return {
    header: {
      traceId: input.trace.traceId,
      workflowType: input.trace.workflowType,
      title: input.trace.title,
      status: input.trace.status,
      health: input.trace.health,
      primaryLookupType: input.trace.primaryLookupType,
      primaryLookupValue: input.trace.primaryLookupValue,
      summary: input.trace.summary,
    },
    events,
  };
}
