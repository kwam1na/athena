import { describe, expect, it } from "vitest";

import { buildWorkflowTraceViewModel } from "./presentation";

describe("buildWorkflowTraceViewModel", () => {
  it("sorts events by occurredAt and sequence and preserves trace health", () => {
    const view = buildWorkflowTraceViewModel({
      trace: {
        traceId: "pos_sale:pos-123456",
        workflowType: "pos_sale",
        title: "POS sale POS-123456",
        status: "succeeded",
        health: "partial",
        primaryLookupType: "transaction_number",
        primaryLookupValue: "POS-123456",
      },
      events: [
        {
          traceId: "pos_sale:pos-123456",
          workflowType: "pos_sale",
          occurredAt: 200,
          sequence: 2,
          kind: "system_action",
          step: "transaction_persisted",
          status: "succeeded",
          message: "Transaction persisted",
          source: "workflow.posSale",
        },
        {
          traceId: "pos_sale:pos-123456",
          workflowType: "pos_sale",
          occurredAt: 200,
          sequence: 1,
          kind: "milestone",
          step: "sale_completion_started",
          status: "started",
          message: "Sale completion started",
          source: "workflow.posSale",
        },
      ],
    });

    expect(view.header.traceId).toBe("pos_sale:pos-123456");
    expect(view.header.health).toBe("partial");
    expect(view.events.map((event) => event.message)).toEqual([
      "Sale completion started",
      "Transaction persisted",
    ]);
  });
});
