import { describe, expect, it } from "vitest";

import { createWorkflowTraceId } from "~/shared/workflowTrace";

describe("createWorkflowTraceId", () => {
  it("normalizes workflow type and primary lookup value into a stable trace id", () => {
    expect(
      createWorkflowTraceId({
        workflowType: "pos_sale",
        primaryLookupValue: " POS-123456 ",
      })
    ).toBe("pos_sale:pos-123456");
  });

  it("rejects empty workflow types", () => {
    expect(() =>
      createWorkflowTraceId({
        workflowType: "   ",
        primaryLookupValue: "POS-123456",
      })
    ).toThrow("Workflow trace workflow types must not be empty.");
  });

  it("rejects empty lookup values", () => {
    expect(() =>
      createWorkflowTraceId({
        workflowType: "pos_sale",
        primaryLookupValue: "   ",
      })
    ).toThrow("Workflow trace lookup values must not be empty.");
  });
});
