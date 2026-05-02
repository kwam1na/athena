import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildRegisterSessionCloseoutReview,
  buildRegisterSessionVarianceApprovalRequirement,
  correctRegisterSessionOpeningFloat,
  getCashControlsConfig,
  submitRegisterSessionCloseout,
} from "./closeouts";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("cash control closeouts", () => {
  it("uses a sensible default approval threshold when store config is absent", () => {
    expect(getCashControlsConfig()).toEqual({
      requireManagerSignoffForAnyVariance: false,
      requireManagerSignoffForOvers: false,
      requireManagerSignoffForShorts: false,
      varianceApprovalThreshold: 5000,
    });
  });

  it("does not require approval for exact-match or small-variance closeouts", () => {
    expect(
      buildRegisterSessionCloseoutReview({
        config: getCashControlsConfig(),
        countedCash: 10000,
        expectedCash: 10000,
      })
    ).toMatchObject({
      hasVariance: false,
      requiresApproval: false,
      variance: 0,
    });

    expect(
      buildRegisterSessionCloseoutReview({
        config: getCashControlsConfig(),
        countedCash: 9700,
        expectedCash: 10000,
      })
    ).toMatchObject({
      hasVariance: true,
      requiresApproval: false,
      variance: -300,
    });
  });

  it("requires approval when a variance exceeds the configured threshold", () => {
    expect(
      buildRegisterSessionCloseoutReview({
        config: getCashControlsConfig(),
        countedCash: 16050,
        expectedCash: 10000,
      })
    ).toMatchObject({
      hasVariance: true,
      reason: "Variance of 6050 exceeded the closeout approval threshold.",
      requiresApproval: true,
      variance: 6050,
    });
  });

  it("normalizes variance review as an async approval requirement", () => {
    const closeoutReview = buildRegisterSessionCloseoutReview({
      config: getCashControlsConfig(),
      countedCash: 16050,
      expectedCash: 10000,
    });

    expect(
      buildRegisterSessionVarianceApprovalRequirement({
        approvalRequestId: "approval-1" as never,
        closeoutReview,
        countedCash: 16050,
        expectedCash: 10000,
        registerSession: {
          _id: "session-1",
          registerNumber: "Register 3",
        } as never,
      }),
    ).toEqual({
      action: {
        key: "cash_controls.register_session.review_variance",
        label: "Review register closeout variance",
      },
      copy: {
        message: "Variance of 6050 exceeded the closeout approval threshold.",
        primaryActionLabel: "Approve closeout",
        secondaryActionLabel: "Got it",
        title: "Manager approval required",
      },
      metadata: {
        countedCash: 16050,
        expectedCash: 10000,
        variance: 6050,
      },
      reason: "Variance of 6050 exceeded the closeout approval threshold.",
      requiredRole: "manager",
      resolutionModes: [
        { kind: "inline_manager_proof" },
        {
          approvalRequestId: "approval-1",
          kind: "async_request",
          requestType: "variance_review",
        },
      ],
      selfApproval: "allowed",
      subject: {
        id: "session-1",
        label: "Register 3",
        type: "register_session",
      },
    });
  });

  it("supports configured manager signoff for specific variance directions", () => {
    expect(
      buildRegisterSessionCloseoutReview({
        config: {
          ...getCashControlsConfig(),
          requireManagerSignoffForShorts: true,
        },
        countedCash: 9800,
        expectedCash: 10000,
      })
    ).toMatchObject({
      requiresApproval: true,
      variance: -200,
    });

    expect(
      buildRegisterSessionCloseoutReview({
        config: {
          ...getCashControlsConfig(),
          requireManagerSignoffForOvers: true,
        },
        countedCash: 10200,
        expectedCash: 10000,
      })
    ).toMatchObject({
      requiresApproval: true,
      variance: 200,
    });
  });

  it("writes through approval, register-session, and operational-event rails", () => {
    const source = getSource("./closeouts.ts");

    expect(source).toContain("buildApprovalRequest");
    expect(source).toContain("buildRegisterSessionVarianceApprovalRequirement");
    expect(source).toContain("recordOperationalEventWithCtx");
    expect(source).toContain("consumeCommandApprovalProofWithCtx");
    expect(source).toContain("requestedByStaffProfileId: args.actorStaffProfileId");
    expect(source).toContain("beginRegisterSessionCloseout");
    expect(source).toContain("closeRegisterSession");
    expect(source).toContain("decideApprovalRequest");
    expect(source).toContain("approvalProofId: v.optional(v.id(\"approvalProof\"))");
    expect(source).toContain("approvalMode: \"inline_manager_proof\"");
    expect(source).toContain("approvalRequired(approvalRequirement)");
    expect(source).toContain("REGISTER_VARIANCE_REVIEW_ACTION");
  });

  it("exposes opening float correction as a command-result mutation with audit rails", () => {
    const source = getSource("./closeouts.ts");

    expect(source).toContain("correctRegisterSessionOpeningFloat");
    expect(source).toContain("commandResultValidator");
    expect(source).toContain("internal.operations.registerSessions.correctRegisterSessionOpeningFloat");
    expect(source).toContain("register_session_opening_float_corrected");
    expect(source).toContain("opening_float_corrected");
  });

  it("returns user_error for invalid opening float corrections without mutating", async () => {
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(),
      },
      runMutation,
    };

    const result = await getHandler(correctRegisterSessionOpeningFloat)(ctx, {
      correctedOpeningFloat: -1,
      reason: "Drawer counted wrong at open.",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Corrected opening float must be a non-negative amount.",
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("returns user_error for invalid closeout counts without mutating", async () => {
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(),
      },
      runMutation,
      runQuery: vi.fn(),
    };

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      countedCash: -1,
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Counted cash cannot be negative.",
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("requires manager approval for same opening float corrections", async () => {
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "session-1",
          expectedCash: 30000,
          openingFloat: 30000,
          openedAt: 1,
          registerNumber: "A1",
          status: "open",
          storeId: "store-1",
        })),
      },
      runMutation,
    };

    const result = await getHandler(correctRegisterSessionOpeningFloat)(ctx, {
      correctedOpeningFloat: 30000,
      reason: "Drawer counted wrong at open.",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "approval_required",
      approval: {
        action: {
          key: "cash_controls.register_session.correct_opening_float",
        },
        requiredRole: "manager",
        subject: {
          id: "session-1",
          type: "register_session",
        },
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("requires manager approval before changing opening float", async () => {
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "session-1",
          expectedCash: 30000,
          openingFloat: 30000,
          openedAt: 1,
          registerNumber: "A1",
          status: "open",
          storeId: "store-1",
        })),
      },
      runMutation,
    };

    const result = await getHandler(correctRegisterSessionOpeningFloat)(ctx, {
      correctedOpeningFloat: 20000,
      reason: "Drawer counted wrong at open.",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "approval_required",
      approval: {
        action: {
          key: "cash_controls.register_session.correct_opening_float",
        },
        requiredRole: "manager",
        subject: {
          id: "session-1",
          type: "register_session",
        },
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("returns user_error for closeout sessions without mutating drawer math", async () => {
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "session-1",
          expectedCash: 30000,
          openingFloat: 30000,
          openedAt: 1,
          registerNumber: "A1",
          status: "closing",
          storeId: "store-1",
        })),
      },
      runMutation,
    };

    const result = await getHandler(correctRegisterSessionOpeningFloat)(ctx, {
      correctedOpeningFloat: 20000,
      reason: "Drawer counted wrong at open.",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Opening float can only be corrected while the register session is open.",
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });
});
