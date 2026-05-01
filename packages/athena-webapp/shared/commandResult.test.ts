import { describe, expect, it } from "vitest";

import {
  approvalRequired,
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  GENERIC_UNEXPECTED_ERROR_TITLE,
  isApprovalRequiredResult,
  isUserErrorResult,
  ok,
  userError,
} from "./commandResult";

describe("command result helpers", () => {
  it("wraps success payloads with the ok discriminant", () => {
    expect(ok({ serviceCaseId: "service-case-1" })).toEqual({
      kind: "ok",
      data: { serviceCaseId: "service-case-1" },
    });
  });

  it("wraps user-facing failures with the user_error discriminant", () => {
    expect(
      userError({
        code: "validation_failed",
        message: "A service title is required.",
      }),
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "A service title is required.",
      },
    });
  });

  it("detects user error results without inspecting exception text", () => {
    const result = userError({
      code: "authentication_failed",
      message: "Invalid staff credentials.",
    });

    expect(isUserErrorResult(result)).toBe(true);
  });

  it("wraps approval requirements with action, subject, role, copy, and resolution modes", () => {
    const result = approvalRequired({
      action: {
        key: "pos.transaction.payment_method.correct",
        label: "Correct payment method",
      },
      subject: {
        type: "pos_transaction",
        id: "transaction-1",
        label: "Receipt 1001",
      },
      requiredRole: "manager",
      reason: "Completed transactions require manager approval.",
      copy: {
        title: "Manager approval required",
        message: "Ask a manager to approve this correction.",
      },
      resolutionModes: [
        {
          kind: "inline_manager_proof",
          proofTtlMs: 300_000,
        },
        {
          kind: "async_request",
          requestType: "payment_method_correction",
        },
      ],
    });

    expect(result).toEqual({
      kind: "approval_required",
      approval: {
        action: {
          key: "pos.transaction.payment_method.correct",
          label: "Correct payment method",
        },
        subject: {
          type: "pos_transaction",
          id: "transaction-1",
          label: "Receipt 1001",
        },
        requiredRole: "manager",
        reason: "Completed transactions require manager approval.",
        copy: {
          title: "Manager approval required",
          message: "Ask a manager to approve this correction.",
        },
        resolutionModes: [
          {
            kind: "inline_manager_proof",
            proofTtlMs: 300_000,
          },
          {
            kind: "async_request",
            requestType: "payment_method_correction",
          },
        ],
      },
    });
    expect(isApprovalRequiredResult(result)).toBe(true);
  });

  it("exports the generic fallback copy for unexpected faults", () => {
    expect(GENERIC_UNEXPECTED_ERROR_TITLE).toBe("Something went wrong");
    expect(GENERIC_UNEXPECTED_ERROR_MESSAGE).toBe("Please try again.");
  });
});
