import { describe, expect, it } from "vitest";
import { v } from "convex/values";

import { commandResultValidator } from "./commandResultValidators";

describe("command result validators", () => {
  it("keeps ok and user_error result variants compatible", () => {
    const validatorJson = (commandResultValidator(v.string()) as any).json;

    expect(validatorJson.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: expect.objectContaining({
            kind: expect.objectContaining({
              fieldType: { type: "literal", value: "ok" },
              optional: false,
            }),
            data: expect.objectContaining({
              fieldType: { type: "string" },
              optional: false,
            }),
          }),
        }),
        expect.objectContaining({
          value: expect.objectContaining({
            kind: expect.objectContaining({
              fieldType: { type: "literal", value: "user_error" },
              optional: false,
            }),
            error: expect.objectContaining({
              optional: false,
            }),
          }),
        }),
      ])
    );
  });

  it("accepts approval-required results with inline manager proof resolution", () => {
    const approvalVariant = (commandResultValidator(v.null()) as any).json.value.find(
      (variant: { value?: Record<string, unknown> }) =>
        JSON.stringify(variant.value).includes("approval_required")
    );

    expect(approvalVariant).toEqual(
      expect.objectContaining({
        value: expect.objectContaining({
          kind: expect.objectContaining({
            fieldType: { type: "literal", value: "approval_required" },
            optional: false,
          }),
          approval: expect.objectContaining({
            optional: false,
            fieldType: expect.objectContaining({
              value: expect.objectContaining({
                action: expect.objectContaining({ optional: false }),
                subject: expect.objectContaining({ optional: false }),
                requiredRole: expect.objectContaining({ optional: false }),
                reason: expect.objectContaining({ optional: false }),
                copy: expect.objectContaining({ optional: false }),
                resolutionModes: expect.objectContaining({ optional: false }),
              }),
            }),
          }),
        }),
      })
    );

    expect(JSON.stringify(approvalVariant)).toContain("inline_manager_proof");
  });

  it("accepts approval-required results with async request resolution", () => {
    const validatorJson = (commandResultValidator(v.null()) as any).json;

    expect(JSON.stringify(validatorJson)).toContain("async_request");
    expect(JSON.stringify(validatorJson)).toContain("requestType");
    expect(JSON.stringify(validatorJson)).toContain("approvalRequestId");
  });
});
