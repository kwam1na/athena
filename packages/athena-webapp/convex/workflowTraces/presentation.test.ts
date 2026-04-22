import { describe, expect, it } from "vitest";

import { buildWorkflowTraceViewModel } from "./presentation";

describe("buildWorkflowTraceViewModel", () => {
  it("sorts events by occurredAt and sequence and preserves trace health", () => {
    const view = buildWorkflowTraceViewModel({
      trace: {
        traceId: "repair_order:job-42",
        workflowType: "repair_order",
        title: "Repair order JOB-42",
        status: "succeeded",
        health: "partial",
        primaryLookupType: "reference_number",
        primaryLookupValue: "JOB-42",
      },
      events: [
        {
          traceId: "repair_order:job-42",
          workflowType: "repair_order",
          occurredAt: 200,
          sequence: 2,
          kind: "system_action",
          step: "repair_order_persisted",
          status: "succeeded",
          message: "Repair order persisted",
          source: "workflow.shared",
        },
        {
          traceId: "repair_order:job-42",
          workflowType: "repair_order",
          occurredAt: 200,
          sequence: 1,
          kind: "milestone",
          step: "workflow_started",
          status: "started",
          message: "Workflow started",
          source: "workflow.shared",
        },
      ],
    });

    expect(view.header.traceId).toBe("repair_order:job-42");
    expect(view.header.health).toBe("partial");
    expect(view.events.map((event) => event.message)).toEqual([
      "Workflow started",
      "Repair order persisted",
    ]);
  });
});
