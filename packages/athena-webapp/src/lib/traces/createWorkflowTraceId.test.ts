import { describe, expect, it } from "vitest";

import { createWorkflowTraceId } from "~/shared/workflowTrace";

describe("createWorkflowTraceId", () => {
  it("normalizes workflow type and primary lookup value into a stable trace id", () => {
    expect(
      createWorkflowTraceId({
        workflowType: "example_flow",
        primaryLookupValue: " POS-123456 ",
      })
    ).toBe("example_flow:pos-123456");
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
        workflowType: "example_flow",
        primaryLookupValue: "   ",
      })
    ).toThrow("Workflow trace lookup values must not be empty.");
  });
});
