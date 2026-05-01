import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, userError } from "~/shared/commandResult";

import { runCommand, type ApprovalRequiredCommandResult } from "./runCommand";

describe("runCommand", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through ok results", async () => {
    const result = await runCommand(async () => ok({ terminalId: "terminal-1" }));

    expect(result).toEqual({
      kind: "ok",
      data: {
        terminalId: "terminal-1",
      },
    });
  });

  it("passes through user_error results", async () => {
    const result = await runCommand(async () =>
      userError({
        code: "authentication_failed",
        message: "Invalid staff credentials.",
      }),
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authentication_failed",
        message: "Invalid staff credentials.",
      },
    });
  });

  it("passes through approval-required results without treating them as failures", async () => {
    const approvalResult: ApprovalRequiredCommandResult = {
      kind: "approval_required",
      approval: {
        action: {
          key: "transaction.payment_method_correction",
          label: "Update payment method",
        },
        copy: {
          title: "Manager approval required",
          message: "Payment method changes need manager approval.",
        },
        reason: "Payment method changes need manager approval.",
        requiredRole: "manager",
        resolutionModes: [
          {
            kind: "inline_manager_proof",
          },
        ],
        subject: {
          id: "transaction-1",
          label: "Receipt #1001",
          type: "transaction",
        },
      },
    };

    const result = await runCommand(async () => approvalResult);

    expect(result).toEqual(approvalResult);
  });

  it("normalizes thrown faults to generic fallback copy", async () => {
    const result = await runCommand(async () => {
      throw new Error("[CONVEX] exploded with internal details");
    });

    expect(result).toEqual({
      kind: "unexpected_error",
      error: {
        title: "Something went wrong",
        message: "Please try again.",
        traceId: undefined,
      },
    });
  });
});
