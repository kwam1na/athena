import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  buildRegisterSessionCloseoutReview,
  buildRegisterSessionVarianceApprovalRequirement,
  correctRegisterSessionOpeningFloat,
  finalizeRegisterSessionCloseout,
  getCashControlsConfig,
  reopenRegisterSessionCloseout,
  reviewRegisterSessionCloseout,
  submitRegisterSessionCloseout,
} from "./closeouts";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(async () => ({
    _id: "manager-user-1",
    email: "manager@example.com",
  })),
  requireOrganizationMemberRoleWithCtx: vi.fn(async () => undefined),
}));

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function createCloseoutMappingHoldCtx() {
  const rowsByTable = new Map<string, Array<Record<string, unknown>>>(
    Object.entries({
      approvalRequest: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_missing_mapping",
          conflictType: "permission",
          createdAt: 1,
          details: {
            localTransactionId: "local-transaction-1",
          },
          localEventId: "event_sale_1",
          localRegisterSessionId: "local-register-1",
          sequence: 3,
          status: "needs_review",
          storeId: "store-1",
          summary: "Register session mapping is missing for synced POS history.",
          terminalId: "terminal-1",
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_sale_1",
          eventType: "sale_completed",
          localEventId: "event_sale_1",
          localRegisterSessionId: "local-register-1",
          occurredAt: 2,
          payload: {
            localTransactionId: "local-transaction-1",
            receiptNumber: "R-1001",
          },
          sequence: 3,
          status: "conflicted",
          storeId: "store-1",
          submittedAt: 2,
          terminalId: "terminal-1",
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "transaction_mapping_1",
          cloudId: "transaction-1",
          cloudTable: "posTransaction",
          createdAt: 2,
          localEventId: "event_sale_1",
          localId: "local-transaction-1",
          localIdKind: "transaction",
          localRegisterSessionId: "local-register-1",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      ],
      posTransaction: [
        {
          _id: "transaction-1",
          completedAt: 2,
          registerSessionId: "session-1",
          status: "completed",
          storeId: "store-1",
          terminalId: "terminal-1",
          total: 15000,
          transactionNumber: "R-1001",
        },
      ],
      registerSession: [
        {
          _id: "session-1",
          countedCash: 30000,
          expectedCash: 30000,
          openedAt: 1,
          organizationId: "org-1",
          registerNumber: "A1",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      ],
      staffProfile: [
        {
          _id: "manager-1",
          linkedUserId: "manager-user-1",
          organizationId: "org-1",
          status: "active",
          storeId: "store-1",
        },
      ],
      staffRoleAssignment: [
        {
          _id: "role-1",
          organizationId: "org-1",
          role: "manager",
          staffProfileId: "manager-1",
          status: "active",
          storeId: "store-1",
        },
      ],
      store: [
        {
          _id: "store-1",
          currency: "GHS",
          organizationId: "org-1",
        },
      ],
    }).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]),
  );
  const getRows = (tableName: string) => rowsByTable.get(tableName) ?? [];
  const matches = (
    row: Record<string, unknown>,
    filters: Array<[string, unknown]>,
  ) => filters.every(([field, value]) => row[field] === value);

  return {
    db: {
      get: vi.fn(async (tableName: string, id: string) =>
        getRows(tableName).find((row) => row._id === id) ?? null,
      ),
      insert: vi.fn(),
      patch: vi.fn(),
      query: vi.fn((tableName: string) => {
        const filters: Array<[string, unknown]> = [];
        const query = {
          withIndex: vi.fn((_indexName: string, build: (q: any) => unknown) => {
            const indexQuery = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return indexQuery;
              },
            };
            build(indexQuery);
            return query;
          }),
          collect: vi.fn(async () =>
            getRows(tableName).filter((row) => matches(row, filters)),
          ),
          take: vi.fn(async (limit: number) =>
            getRows(tableName)
              .filter((row) => matches(row, filters))
              .slice(0, limit),
          ),
          unique: vi.fn(async () =>
            getRows(tableName).find((row) => matches(row, filters)) ?? null,
          ),
        };
        return query;
      }),
    },
    runMutation: vi.fn(),
    runQuery: vi.fn(async () => ({ _id: "store-1" })),
  };
}

function createPendingItemAdjustmentApprovalCtx(options: {
  settlementMethod?: string;
  settlementDirection?: string;
} = {}) {
  const registerSession = {
    _id: "session-1",
    countedCash: 30000,
    expectedCash: 30000,
    openedAt: 1,
    organizationId: "org-1",
    registerNumber: "A1",
    status: "closing",
    storeId: "store-1",
    terminalId: "terminal-1",
  };
  const closedSession = {
    ...registerSession,
    closedAt: 100,
    closedByStaffProfileId: "manager-1",
    status: "closed",
  };
  const runMutation = vi.fn(async () => closedSession);

  return {
    db: {
      get: vi.fn(async (table: string) => {
        if (table === "registerSession") return registerSession;
        if (table === "store") {
          return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
        }
        if (table === "staffProfile") {
          return {
            _id: "manager-1",
            linkedUserId: "manager-user-1",
            organizationId: "org-1",
            status: "active",
            storeId: "store-1",
          };
        }
        return null;
      }),
      insert: vi.fn(),
      patch: vi.fn(),
      query: vi.fn((table: string) => ({
        withIndex: vi.fn(() => ({
          collect: vi.fn(async () =>
            table === "approvalRequest"
              ? [
                  {
                    _id: "item-adjustment-approval-1",
                    createdAt: 1,
                    metadata: {
                      settlementAmount: 5000,
                      settlementDirection:
                        options.settlementDirection ?? "refund",
                      settlementMethod: options.settlementMethod ?? "cash",
                    },
                    registerSessionId: "session-1",
                    requestType: "pos_item_adjustment",
                    status: "pending",
                    storeId: "store-1",
                    subjectType: "pos_transaction_item_adjustment",
                  },
                ]
              : [],
          ),
          take: vi.fn(async () =>
            table === "staffRoleAssignment"
              ? [
                  {
                    organizationId: "org-1",
                    role: "manager",
                    status: "active",
                    storeId: "store-1",
                  },
                ]
              : [],
          ),
        })),
      })),
    },
    runMutation,
    runQuery: vi.fn(async () => ({ _id: "store-1" })),
  };
}

describe("cash control closeouts", () => {
  it("proves changed public closeout exports conform to their return validators", () => {
    const validationError = {
      kind: "user_error" as const,
      error: {
        code: "validation_failed" as const,
        message: "Counted cash cannot be negative.",
      },
    };
    const rejectedCloseoutResult = {
      kind: "ok" as const,
      data: {
        action: "rejected" as const,
        approvalRequest: null,
        registerSession: {
          _id: "session-1",
          status: "closeout_rejected",
        },
      },
    };
    const submittedCloseoutResult = {
      kind: "ok" as const,
      data: {
        action: "submitted" as const,
        closeoutReview: {
          hasVariance: true,
          requiresApproval: false,
          variance: -100,
        },
        pendingVoidApprovalCount: 1,
        registerSession: {
          _id: "session-1",
          status: "closing",
        },
      },
    };
    const submittedApprovalOwnedCloseoutResult = {
      kind: "ok" as const,
      data: {
        action: "submitted" as const,
        closeoutReview: {
          hasVariance: true,
          reason: "Manager signoff is required for any register variance (-100).",
          requiresApproval: true,
          variance: -100,
        },
        pendingVoidApprovalCount: 1,
        registerSession: {
          _id: "session-1",
          managerApprovalRequestId: "approval-request-1",
          status: "closing",
        },
      },
    };
    const finalizedCloseoutResult = {
      kind: "ok" as const,
      data: {
        action: "closed" as const,
        closeoutReview: {
          hasVariance: false,
          requiresApproval: false,
          variance: 0,
        },
        registerSession: {
          _id: "session-1",
          closeoutOperatingDate: "2026-06-08",
          closeoutOperatingDateDerivationStatus: "resolved",
          closeoutOperatingDateEndAt: Date.UTC(2026, 5, 9, 2),
          closeoutOperatingDateStartAt: Date.UTC(2026, 5, 8, 10),
          closeoutOwnedAt: Date.UTC(2026, 5, 8, 21),
          closeoutOwnershipSource: "closed_record",
          status: "closed",
        },
      },
    };

    assertConformsToExportedReturns(
      submitRegisterSessionCloseout,
      validationError,
    );
    assertConformsToExportedReturns(
      submitRegisterSessionCloseout,
      submittedCloseoutResult,
    );
    assertConformsToExportedReturns(
      submitRegisterSessionCloseout,
      submittedApprovalOwnedCloseoutResult,
    );
    assertConformsToExportedReturns(
      finalizeRegisterSessionCloseout,
      finalizedCloseoutResult,
    );
    assertConformsToExportedReturns(
      reopenRegisterSessionCloseout,
      validationError,
    );
    assertConformsToExportedReturns(
      correctRegisterSessionOpeningFloat,
      validationError,
    );
    assertConformsToExportedReturns(
      reviewRegisterSessionCloseout,
      validationError,
    );
    assertConformsToExportedReturns(
      reviewRegisterSessionCloseout,
      rejectedCloseoutResult,
    );
  });

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
    expect(source).toContain("resolveCloseoutActorStaffProfileId");
    expect(source).toContain("beginRegisterSessionCloseout");
    expect(source).toContain("closeRegisterSession");
    expect(source).toContain("decideApprovalRequest");
    expect(source).toContain("approvalProofId: v.optional(v.id(\"approvalProof\"))");
    expect(source).toContain("approvalMode: \"inline_manager_proof\"");
    expect(source).toContain("approvalRequired(approvalRequirement)");
    expect(source).toContain("REGISTER_VARIANCE_REVIEW_ACTION");
    expect(source).toContain("buildRegisterCloseoutVarianceTimelineMessage");
    expect(source).toContain("currency: store?.currency");
  });

  it("exposes opening float correction as a command-result mutation with audit rails", () => {
    const source = getSource("./closeouts.ts");

    expect(source).toContain("correctRegisterSessionOpeningFloat");
    expect(source).toContain("commandResultValidator");
    expect(source).toContain("internal.operations.registerSessions.correctRegisterSessionOpeningFloat");
    expect(source).toContain("register_session_opening_float_corrected");
    expect(source).toContain("opening_float_corrected");
    expect(source).toContain("requestedByStaffProfileId: actorStaffProfileId");
  });

  it("exposes closed-closeout reopening as an append-only correction path", () => {
    const source = getSource("./closeouts.ts");

    expect(source).toContain("reopenClosedRegisterSessionCloseout");
    expect(source).toContain("register_session_closeout_reopened");
    expect(source).toContain("stage: \"closeout_reopened\"");
    expect(source).toContain("metadata: previousCloseout");
    expect(source).toContain("requestedByStaffProfileId: actorStaffProfileId");
    expect(source).toContain("REGISTER_CLOSEOUT_MODIFICATION_SUBMIT_ACTION");
    expect(source).toContain("closeoutModificationApprovalProofId");
    expect(source).toContain(
      "proof.data.approvedByStaffProfileId !==\n        latestReopenedCloseout.actorStaffProfileId",
    );
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
    const usedGenericCancellation = runMutation.mock.calls.some(
      ([, mutationArgs]) => mutationArgs?.decision === "cancelled",
    );
    expect(usedGenericCancellation).toBe(false);
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

  it("returns user_error when submitting an already closed closeout", async () => {
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "session-1",
          expectedCash: 10000,
          status: "closed",
          storeId: "store-1",
        })),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      countedCash: 9000,
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Register session is already closed.",
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("returns user_error when reopening a non-closeout register session", async () => {
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "session-1",
          status: "active",
          storeId: "store-1",
        })),
      },
      runMutation,
    };

    const result = await getHandler(reopenRegisterSessionCloseout)(ctx, {
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Register session is not in closeout.",
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("requires a manager approval proof to reopen a closed register closeout", async () => {
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") {
            return {
              _id: "session-1",
              expectedCash: 10000,
              organizationId: "org-1",
              registerNumber: "A1",
              status: "closed",
              storeId: "store-1",
            };
          }

          if (table === "store") {
            return { _id: "store-1", organizationId: "org-1" };
          }

          if (table === "staffProfile") {
            return {
              _id: "staff-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }

          return null;
        }),
        query: vi.fn(() => ({
          withIndex: () => ({
            take: async () => [],
          }),
        })),
      },
      runMutation,
    };

    const result = await getHandler(reopenRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "staff-1",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authentication_failed",
        message: "Only managers can reopen a closed register closeout.",
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("reopens a closed closeout when the manager approval proof belongs to a different signed-in user", async () => {
    const registerSession = {
      _id: "session-1",
      closedAt: 100,
      closedByStaffProfileId: "staff-1",
      countedCash: 10000,
      expectedCash: 10000,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "closed",
      storeId: "store-1",
    };
    const reopenedSession = {
      ...registerSession,
      status: "closing",
    };
    const insert = vi.fn(async () => "inserted");
    const patch = vi.fn();
    const runMutation = vi.fn(async () => reopenedSession);
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id?: string) => {
          if (table === "registerSession") return registerSession;
          if (table === "store") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (table === "approvalProof") {
            return {
              _id: "proof-1",
              actionKey: "cash_controls.register_session.reopen_closeout",
              approvedByStaffProfileId: "manager-1",
              expiresAt: Date.now() + 60_000,
              requestedByStaffProfileId: "staff-1",
              requiredRole: "manager",
              storeId: "store-1",
              subjectId: "session-1",
              subjectLabel: "A1",
              subjectType: "register_session",
            };
          }
          if (table === "staffProfile" && id === "manager-1") {
            return {
              _id: "manager-1",
              linkedUserId: "other-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        insert,
        patch,
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
            order: vi.fn(() => ({
              first: vi.fn(async () => null),
            })),
            take: vi.fn(async () => [
              {
                organizationId: "org-1",
                role: "manager",
                staffProfileId: "manager-1",
                status: "active",
                storeId: "store-1",
              },
            ]),
            unique: vi.fn(async () => null),
          })),
        })),
      },
      runMutation,
    };

    const result = await getHandler(reopenRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "manager-1",
      approvalProofId: "proof-1",
      registerSessionId: "session-1",
      requestedByStaffProfileId: "staff-1",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "reopened",
        approvalRequest: null,
        registerSession: reopenedSession,
      },
    });
    expect(patch).toHaveBeenCalledWith("approvalProof", "proof-1", {
      consumedAt: expect.any(Number),
    });
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      actorStaffProfileId: "manager-1",
      actorUserId: "manager-user-1",
      reason: "Closed register closeout reopened for correction.",
      registerSessionId: "session-1",
    });
  });

  it("reopens rejected closeouts for correction without making them sale-usable", async () => {
    let registerSession = {
      _id: "session-1",
      closeoutRecords: [],
      countedCash: 9000,
      expectedCash: 10000,
      notes: "Variance counted at lane 1.",
      openedAt: 1,
      openingFloat: 5000,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "closeout_rejected",
      storeId: "store-1",
      terminalId: "terminal-1",
      variance: -1000,
    };
    const patch = vi.fn(async (table: string, id: string, updates: object) => {
      if (table === "registerSession" && id === "session-1") {
        registerSession = { ...registerSession, ...updates };
      }
    });
    const insert = vi.fn(async () => "inserted");
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") return registerSession;
          if (table === "approvalProof") {
            return {
              _id: "proof-1",
              actionKey: "cash_controls.register_session.reopen_closeout",
              approvedByStaffProfileId: "manager-1",
              expiresAt: Date.now() + 60_000,
              requestedByStaffProfileId: "staff-1",
              requiredRole: "manager",
              storeId: "store-1",
              subjectId: "session-1",
              subjectLabel: "A1",
              subjectType: "register_session",
            };
          }
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "staffProfile") {
            return {
              _id: "staff-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        insert,
        patch,
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
            order: vi.fn(() => ({
              first: vi.fn(async () => null),
            })),
            take: vi.fn(async () => [
              {
                organizationId: "org-1",
                role: "manager",
                staffProfileId: "manager-1",
                status: "active",
                storeId: "store-1",
              },
            ]),
            unique: vi.fn(async () => null),
          })),
        })),
      },
      runMutation: vi.fn(),
    };

    const result = await getHandler(reopenRegisterSessionCloseout)(ctx, {
      actorUserId: "manager-user-1",
      approvalProofId: "proof-1",
      registerSessionId: "session-1",
      requestedByStaffProfileId: "staff-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        action: "reopened",
        approvalRequest: null,
        registerSession: expect.objectContaining({
          _id: "session-1",
          status: "closing",
          countedCash: 9000,
          closeoutRecords: [
            expect.objectContaining({
              actorStaffProfileId: "manager-1",
              actorUserId: "manager-user-1",
              countedCash: 9000,
              expectedCash: 10000,
              notes: "Variance counted at lane 1.",
              occurredAt: expect.any(Number),
              reason: "Correction needed after manager rejection.",
              type: "reopened",
              variance: -1000,
            }),
          ],
          variance: -1000,
        }),
      },
    });
    expect(patch).toHaveBeenCalledWith(
      "registerSession",
      "session-1",
      expect.objectContaining({
        closeoutRecords: [
          expect.objectContaining({
            actorStaffProfileId: "manager-1",
            actorUserId: "manager-user-1",
            countedCash: 9000,
            expectedCash: 10000,
            notes: "Variance counted at lane 1.",
            occurredAt: expect.any(Number),
            reason: "Correction needed after manager rejection.",
            type: "reopened",
            variance: -1000,
          }),
        ],
        managerApprovalRequestId: undefined,
        status: "closing",
      }),
    );
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("requires manager approval before reopening a rejected closeout", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "session-1",
          expectedCash: 10000,
          organizationId: "org-1",
          status: "closeout_rejected",
          storeId: "store-1",
        })),
        patch,
      },
    };

    const result = await getHandler(reopenRegisterSessionCloseout)(ctx, {
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authentication_failed",
        message: "Only managers can reopen a rejected register closeout.",
      },
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it("rejects rejected-closeout reopen approvals from staff without review permission", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") {
            return {
              _id: "session-1",
              expectedCash: 10000,
              organizationId: "org-1",
              registerNumber: "A1",
              status: "closeout_rejected",
              storeId: "store-1",
            };
          }
          if (table === "store") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (table === "approvalProof") {
            return {
              _id: "proof-1",
              actionKey: "cash_controls.register_session.reopen_closeout",
              approvedByStaffProfileId: "staff-1",
              expiresAt: Date.now() + 60_000,
              requestedByStaffProfileId: "staff-1",
              requiredRole: "manager",
              storeId: "store-1",
              subjectId: "session-1",
              subjectLabel: "A1",
              subjectType: "register_session",
            };
          }
          if (table === "staffProfile") {
            return {
              _id: "staff-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        patch,
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            take: vi.fn(async () => []),
          })),
        })),
      },
    };

    const result = await getHandler(reopenRegisterSessionCloseout)(ctx, {
      approvalProofId: "proof-1",
      registerSessionId: "session-1",
      requestedByStaffProfileId: "staff-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Only managers can reopen a rejected register closeout.",
      },
    });
    expect(patch).not.toHaveBeenCalledWith(
      "registerSession",
      "session-1",
      expect.anything(),
    );
  });

  it("requires the same manager to submit a reopened closeout correction", async () => {
    const runMutation = vi.fn();
    const patch = vi.fn();
    const insert = vi.fn(async (table: string) =>
      table === "approvalRequesterChallenge" ? "requester-challenge-1" : "event-1",
    );
    const registerSession = {
      _id: "session-1",
      closeoutRecords: [
        {
          actorStaffProfileId: "manager-1",
          expectedCash: 10000,
          occurredAt: 1,
          type: "reopened",
        },
      ],
      expectedCash: 10000,
      openedAt: 1,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "closing",
      storeId: "store-1",
      terminalId: "terminal-1",
    };
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") {
            return registerSession;
          }
          if (table === "approvalProof") {
            return {
              _id: "proof-1",
              actionKey: "cash_controls.register_session.submit_reopened_closeout",
              approvedByStaffProfileId: "manager-2",
              expiresAt: Date.now() + 60_000,
              requiredRole: "manager",
              storeId: "store-1",
              subjectId: "session-1",
              subjectLabel: "A1",
              subjectType: "register_session",
            };
          }
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "staffProfile") {
            return {
              _id: "staff-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        insert,
        patch,
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "staff-1",
      closeoutModificationApprovalProofId: "proof-1",
      countedCash: 10000,
      registerSessionId: "session-1",
      requestedByStaffProfileId: "staff-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message:
          "The manager who reopened this closeout must submit the correction.",
      },
    });
    expect(patch).toHaveBeenCalledWith("approvalProof", "proof-1", {
      consumedAt: expect.any(Number),
    });
    expect(runMutation).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalledWith(
      "approvalRequest",
      expect.anything(),
    );
  });

  it("returns an inline-only approval requirement for manager closeout variance submissions", async () => {
    const registerSession = {
      _id: "session-1",
      expectedCash: 30000,
      openedAt: 1,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "open",
      storeId: "store-1",
      terminalId: "terminal-1",
    };
    const runMutation = vi.fn(async () => ({
      ...registerSession,
      countedCash: 20000,
      status: "closing",
    }));
    const insert = vi.fn(async (table: string) =>
      table === "approvalRequesterChallenge" ? "requester-challenge-1" : "event-1",
    );
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") {
            return registerSession;
          }
          if (table === "staffProfile") {
            return {
              _id: "staff-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          if (table === "store") {
            return { _id: "store-1", currency: "GHS" };
          }
          return null;
        }),
        insert,
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            take: vi.fn(async () => [
              {
                organizationId: "org-1",
                role: "manager",
                status: "active",
                storeId: "store-1",
              },
            ]),
          })),
        })),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "staff-1",
      actorUserId: "user-1",
      countedCash: 20000,
      notes: "Manager counted the shortage.",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "approval_required",
      approval: {
        action: {
          key: "cash_controls.register_session.review_variance",
        },
        requiredRole: "manager",
        requesterBinding: {
          challengeId: "requester-challenge-1",
          kind: "operational_staff_challenge",
          requestedByStaffProfileId: "staff-1",
        },
        resolutionModes: [{ kind: "inline_manager_proof" }],
        subject: {
          id: "session-1",
          type: "register_session",
        },
      },
    });
    expect(result.approval.resolutionModes).not.toContainEqual(
      expect.objectContaining({ kind: "async_request" }),
    );
    expect(insert).toHaveBeenCalledWith(
      "approvalRequesterChallenge",
      expect.objectContaining({
        actionKey: "cash_controls.register_session.review_variance",
        requestedByStaffProfileId: "staff-1",
        requiredRole: "manager",
        storeId: "store-1",
        subjectId: "session-1",
        subjectType: "register_session",
      }),
    );
    expect(insert).not.toHaveBeenCalledWith(
      "approvalRequest",
      expect.anything(),
    );
  });

  it("submits closeout without final closure when pending void approvals exist", async () => {
    const registerSession = {
      _id: "session-1",
      expectedCash: 30000,
      openedAt: 1,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "open",
      storeId: "store-1",
      terminalId: "terminal-1",
    };
    const closingSession = {
      ...registerSession,
      countedCash: 20000,
      status: "closing",
      variance: -10000,
    };
    const runMutation = vi.fn(async (_name: unknown, args: unknown) => {
      expect(args).toMatchObject({
        countedCash: 20000,
        registerSessionId: "session-1",
      });
      return closingSession;
    });
    const insert = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") return registerSession;
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "staffProfile") {
            return {
              _id: "manager-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        insert,
        patch: vi.fn(),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () =>
              table === "approvalRequest"
                ? [
                    {
                      _id: "void-approval-1",
                      registerSessionId: "session-1",
                      requestType: "pos_transaction_void",
                      status: "pending",
                      storeId: "store-1",
                      subjectType: "pos_transaction",
                    },
                  ]
                : [],
            ),
          })),
        })),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "manager-1",
      actorUserId: "user-1",
      countedCash: 20000,
      notes: "Count recorded before void review.",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "submitted",
        pendingVoidApprovalCount: 1,
        registerSession: closingSession,
      },
    });
    expect(insert).not.toHaveBeenCalledWith(
      "approvalRequest",
      expect.anything(),
    );
    expect(insert).toHaveBeenCalledWith(
      "operationalEvent",
      expect.objectContaining({
        eventType: "register_session_closeout_submitted",
        message: expect.stringContaining(
          "Register A1 closeout submitted with a cash variance",
        ),
        metadata: expect.objectContaining({
          countedCash: 20000,
          expectedCash: 30000,
          holdKinds: ["pending_completed_sale_void_approvals"],
          pendingVoidApprovalCount: 1,
          variance: -10000,
        }),
        registerSessionId: "session-1",
        subjectId: "session-1",
        subjectType: "register_session",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "operationalEvent",
      expect.objectContaining({
        message: expect.stringContaining(
          "Finalize after pending register corrections are resolved.",
        ),
      }),
    );
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("rejects closeout submit when the staff actor belongs to another user", async () => {
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "staffProfile") {
            return {
              _id: "manager-1",
              linkedUserId: "other-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
      },
      runMutation,
    };

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "manager-1",
      countedCash: 20000,
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Closeout staff actor does not match the signed-in user.",
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("accepts closeout submit for an unlinked staff actor with matching staff credentials", async () => {
    const closingSession = {
      _id: "session-1",
      countedCash: 70000,
      expectedCash: 70000,
      openedAt: 1,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "closing",
      storeId: "store-1",
      terminalId: "terminal-1",
    };
    const closedSession = {
      ...closingSession,
      closedAt: Date.now(),
      status: "closed",
    };
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(closingSession)
      .mockResolvedValueOnce(closedSession);
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "registerSession") {
            return {
              _id: "session-1",
              expectedCash: 70000,
              openedAt: 1,
              organizationId: "org-1",
              registerNumber: "A1",
              status: "active",
              storeId: "store-1",
              terminalId: "terminal-1",
            };
          }
          if (table === "staffProfile") {
            return {
              _id: "cashier-1",
              linkedUserId: "other-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        insert,
        patch,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
            order: vi.fn(() => ({
              first: vi.fn(async () => null),
              take: vi.fn(async () => []),
            })),
            take: vi.fn(async () => {
              if (table === "staffCredential") {
                return [
                  {
                    _id: "credential-1",
                    organizationId: "org-1",
                    pinHash: "hashed-pin",
                    staffProfileId: "cashier-1",
                    status: "active",
                    storeId: "store-1",
                    username: "cashier",
                  },
                ];
              }
              if (table === "staffRoleAssignment") {
                return [
                  {
                    organizationId: "org-1",
                    role: "cashier",
                    status: "active",
                    storeId: "store-1",
                  },
                ];
              }
              return [];
            }),
            unique: vi.fn(async () => null),
          })),
        })),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "cashier-1",
      countedCash: 70000,
      registerSessionId: "session-1",
      staffPinHash: "hashed-pin",
      staffUsername: "cashier",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "closed",
        registerSession: closedSession,
      },
    });
    expect(patch).toHaveBeenCalledWith("staffCredential", "credential-1", {
      authenticationLockedUntil: undefined,
      failedAuthenticationAttempts: 0,
      lastAuthenticatedAt: expect.any(Number),
    });
    expect(runMutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        countedCash: 70000,
        registerSessionId: "session-1",
      }),
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        closedByStaffProfileId: "cashier-1",
        countedCash: 70000,
        registerSessionId: "session-1",
      }),
    );
    expect(insert).not.toHaveBeenCalledWith(
      "approvalRequest",
      expect.anything(),
    );
  });

  it("returns an operational requester binding for unlinked staff variance closeout submissions", async () => {
    const registerSession = {
      _id: "session-1",
      expectedCash: 70000,
      openedAt: 1,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "active",
      storeId: "store-1",
      terminalId: "terminal-1",
    };
    const runMutation = vi.fn(async () => ({
      ...registerSession,
      countedCash: 60000,
      status: "closing",
    }));
    const patch = vi.fn();
    const insert = vi.fn(async (table: string) => {
      if (table === "approvalRequest") return "approval-1";
      if (table === "approvalRequesterChallenge") return "requester-challenge-1";
      return "event-1";
    });
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id?: string) => {
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "registerSession") {
            return registerSession;
          }
          if (table === "approvalRequest" && id === "approval-1") {
            return {
              _id: "approval-1",
              createdAt: 1234,
              requestedByStaffProfileId: "cashier-1",
            };
          }
          if (table === "staffProfile") {
            return {
              _id: "cashier-1",
              linkedUserId: "other-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        insert,
        patch,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
            order: vi.fn(() => ({
              first: vi.fn(async () => null),
              take: vi.fn(async () => []),
            })),
            take: vi.fn(async () => {
              if (table === "staffCredential") {
                return [
                  {
                    _id: "credential-1",
                    organizationId: "org-1",
                    pinHash: "hashed-pin",
                    staffProfileId: "cashier-1",
                    status: "active",
                    storeId: "store-1",
                    username: "cashier",
                  },
                ];
              }
              if (table === "staffRoleAssignment") {
                return [
                  {
                    organizationId: "org-1",
                    role: "cashier",
                    status: "active",
                    storeId: "store-1",
                  },
                ];
              }
              return [];
            }),
            unique: vi.fn(async () => null),
          })),
        })),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "cashier-1",
      countedCash: 60000,
      registerSessionId: "session-1",
      staffPinHash: "hashed-pin",
      staffUsername: "cashier",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "approval_required",
      approval: {
        requesterBinding: {
          challengeId: "requester-challenge-1",
          kind: "operational_staff_challenge",
          requestedByStaffProfileId: "cashier-1",
        },
      },
    });
    expect(insert).toHaveBeenCalledWith(
      "approvalRequesterChallenge",
      expect.objectContaining({
        actionKey: "cash_controls.register_session.review_variance",
        requestedByStaffProfileId: "cashier-1",
        requiredRole: "manager",
        storeId: "store-1",
        subjectId: "session-1",
      }),
    );
    expect(patch).toHaveBeenCalledWith("staffCredential", "credential-1", {
      authenticationLockedUntil: undefined,
      failedAuthenticationAttempts: 0,
      lastAuthenticatedAt: expect.any(Number),
    });
  });

  it("rejects closeout submit when staff credentials authenticate a different actor", async () => {
    const runMutation = vi.fn();
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "staffProfile") {
            return {
              _id: "cashier-1",
              linkedUserId: "other-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        patch,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(() => ({
            take: vi.fn(async () => {
              if (table === "staffCredential") {
                return [
                  {
                    _id: "credential-2",
                    organizationId: "org-1",
                    pinHash: "hashed-pin",
                    staffProfileId: "cashier-2",
                    status: "active",
                    storeId: "store-1",
                    username: "cashier-2",
                  },
                ];
              }
              if (table === "staffRoleAssignment") {
                return [
                  {
                    organizationId: "org-1",
                    role: "cashier",
                    status: "active",
                    storeId: "store-1",
                  },
                ];
              }
              return [];
            }),
          })),
        })),
      },
      runMutation,
    };

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "cashier-1",
      countedCash: 70000,
      registerSessionId: "session-1",
      staffPinHash: "hashed-pin",
      staffUsername: "cashier-2",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Closeout staff actor does not match the signed-in user.",
      },
    });
    expect(patch).toHaveBeenCalledWith("staffCredential", "credential-2", {
      authenticationLockedUntil: undefined,
      failedAuthenticationAttempts: 0,
      lastAuthenticatedAt: expect.any(Number),
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("rejects direct corrected-count submission while closeout is rejected", async () => {
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "registerSession") {
            return {
              _id: "session-1",
              expectedCash: 70000,
              openedAt: 1,
              organizationId: "org-1",
              registerNumber: "A1",
              status: "closeout_rejected",
              storeId: "store-1",
              terminalId: "terminal-1",
            };
          }
          if (table === "staffProfile") {
            return {
              _id: "cashier-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "cashier-1",
      countedCash: 70000,
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "Register closeout must be reopened before submitting a corrected count.",
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("returns the existing pending approval for duplicate variance closeout submissions", async () => {
    const insert = vi.fn(async (table: string) =>
      table === "approvalRequesterChallenge" ? "requester-challenge-1" : "event-1",
    );
    const patch = vi.fn();
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id?: string) => {
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "registerSession") {
            return {
              _id: "session-1",
              expectedCash: 70000,
              managerApprovalRequestId: "approval-1",
              openedAt: 1,
              organizationId: "org-1",
              registerNumber: "A1",
              status: "closing",
              storeId: "store-1",
              terminalId: "terminal-1",
            };
          }
          if (table === "approvalRequest" && id === "approval-1") {
            return {
              _id: "approval-1",
              createdAt: 1,
              metadata: {
                countedCash: 0,
                expectedCash: 70000,
                variance: -70000,
              },
              notes: "Recounted drawer.",
              registerSessionId: "session-1",
              requestType: "variance_review",
              requestedByStaffProfileId: "cashier-1",
              status: "pending",
              storeId: "store-1",
            };
          }
          if (table === "staffProfile") {
            return {
              _id: "cashier-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        insert,
        patch,
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
            order: vi.fn(() => ({
              take: vi.fn(async () => []),
            })),
            take: vi.fn(async () => []),
          })),
        })),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "cashier-1",
      countedCash: 0,
      notes: "Recounted drawer.",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "approval_required",
      approval: {
        action: {
          key: "cash_controls.register_session.review_variance",
        },
        metadata: {
          countedCash: 0,
          expectedCash: 70000,
          variance: -70000,
        },
        requesterBinding: {
          challengeId: "requester-challenge-1",
          kind: "operational_staff_challenge",
          requestedByStaffProfileId: "cashier-1",
        },
      },
    });
    expect(result.kind === "approval_required" && result.approval.resolutionModes).toContainEqual({
      approvalRequestId: "approval-1",
      kind: "async_request",
      requestType: "variance_review",
    });
    expect(runMutation).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(
      "approvalRequesterChallenge",
      expect.objectContaining({
        actionKey: "cash_controls.register_session.review_variance",
        requestedByStaffProfileId: "cashier-1",
        storeId: "store-1",
        subjectId: "session-1",
      }),
    );
    expect(insert).not.toHaveBeenCalledWith(
      "approvalRequest",
      expect.anything(),
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it("marks matched pending variance approvals approved on inline proof retry", async () => {
    const closedSession = {
      _id: "session-1",
      closedAt: 2,
      countedCash: 0,
      expectedCash: 70000,
      status: "closed",
      storeId: "store-1",
    };
    const patch = vi.fn();
    const runMutation = vi.fn(async (_mutation, args) =>
      "closedByStaffProfileId" in args
        ? closedSession
        : {
            _id: "session-1",
            countedCash: 0,
            expectedCash: 70000,
            status: "closing",
            storeId: "store-1",
          },
    );
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id?: string) => {
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "registerSession") {
            return {
              _id: "session-1",
              expectedCash: 70000,
              managerApprovalRequestId: "approval-1",
              openedAt: 1,
              organizationId: "org-1",
              registerNumber: "A1",
              status: "closing",
              storeId: "store-1",
              terminalId: "terminal-1",
            };
          }
          if (table === "approvalRequest" && id === "approval-1") {
            return {
              _id: "approval-1",
              createdAt: 1,
              metadata: {
                countedCash: 0,
                expectedCash: 70000,
                variance: -70000,
              },
              notes: "Recounted drawer.",
              registerSessionId: "session-1",
              requestType: "variance_review",
              requestedByStaffProfileId: "cashier-1",
              status: "pending",
              storeId: "store-1",
            };
          }
          if (table === "approvalProof") {
            return {
              _id: "proof-1",
              actionKey: "cash_controls.register_session.review_variance",
              approvedByStaffProfileId: "manager-1",
              expiresAt: Date.now() + 60_000,
              requestedByStaffProfileId: "cashier-1",
              requiredRole: "manager",
              storeId: "store-1",
              subjectId: "session-1",
              subjectLabel: "A1",
              subjectType: "register_session",
            };
          }
          if (table === "staffProfile" && id === "cashier-1") {
            return {
              _id: "cashier-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          if (table === "staffProfile" && id === "manager-1") {
            return {
              _id: "manager-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        insert: vi.fn(async () => "event-1"),
        patch,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
            order: vi.fn(() => ({
              first: vi.fn(async () => null),
              take: vi.fn(async () => []),
            })),
            take: vi.fn(async () =>
              table === "staffRoleAssignment"
                ? [
                    {
                      organizationId: "org-1",
                      role: "manager",
                      status: "active",
                      storeId: "store-1",
                    },
                  ]
                : [],
            ),
          })),
        })),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "cashier-1",
      approvalProofId: "proof-1",
      countedCash: 0,
      notes: "Recounted drawer.",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "closed",
        registerSession: closedSession,
      },
    });
    expect(patch).toHaveBeenCalledWith("approvalRequest", "approval-1", {
      status: "approved",
      decisionApprovedByStaffProfileId: "manager-1",
      decisionApprovalProofId: "proof-1",
      reviewedByStaffProfileId: "manager-1",
      reviewedByUserId: "manager-user-1",
      decidedAt: expect.any(Number),
    });
    expect(patch).not.toHaveBeenCalledWith(
      "approvalRequest",
      "approval-1",
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  it("replaces pending variance approval when a corrected closeout count changes before review", async () => {
    const insert = vi.fn(async (table: string, _value?: unknown) =>
      table === "approvalRequest" ? "approval-2" : "event-1",
    );
    const patch = vi.fn();
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id?: string) => {
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "registerSession") {
            return {
              _id: "session-1",
              expectedCash: 70000,
              managerApprovalRequestId: "approval-1",
              openedAt: 1,
              organizationId: "org-1",
              registerNumber: "A1",
              status: "closing",
              storeId: "store-1",
              terminalId: "terminal-1",
            };
          }
          if (table === "approvalRequest" && id === "approval-1") {
            return {
              _id: "approval-1",
              createdAt: 1,
              metadata: {
                countedCash: 0,
                expectedCash: 70000,
                variance: -70000,
              },
              notes: "First count.",
              registerSessionId: "session-1",
              requestType: "variance_review",
              requestedByStaffProfileId: "cashier-1",
              status: "pending",
              storeId: "store-1",
            };
          }
          if (table === "approvalRequest" && id === "approval-2") {
            return {
              _id: "approval-2",
              createdAt: 2,
              metadata: {
                countedCash: 10000,
                expectedCash: 70000,
                variance: -60000,
              },
              notes: "Corrected count.",
              registerSessionId: "session-1",
              requestType: "variance_review",
              requestedByStaffProfileId: "cashier-1",
              status: "pending",
              storeId: "store-1",
            };
          }
          if (table === "staffProfile") {
            return {
              _id: "cashier-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        insert,
        patch,
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
            order: vi.fn(() => ({
              take: vi.fn(async () => []),
            })),
            take: vi.fn(async () => []),
          })),
        })),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "cashier-1",
      countedCash: 10000,
      notes: "Corrected count.",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    assert.equal(result.kind, "approval_required");
    assert.equal(result.approval.metadata.countedCash, 10000);
    assert.equal(result.approval.metadata.expectedCash, 70000);
    assert.equal(result.approval.metadata.variance, -60000);
    const usedGenericCancellation = runMutation.mock.calls.some(
      ([, mutationArgs]) => mutationArgs?.decision === "cancelled",
    );
    assert.equal(usedGenericCancellation, false);
    const approvalCancelPatch = patch.mock.calls.find(
      ([table, id]) => table === "approvalRequest" && id === "approval-1",
    )?.[2];
    assert.equal(
      approvalCancelPatch?.decisionNotes,
      "Superseded by a new register closeout submission.",
    );
    assert.equal(approvalCancelPatch?.reviewedByStaffProfileId, "cashier-1");
    assert.equal(approvalCancelPatch?.status, "cancelled");
    const replacementApproval = insert.mock.calls.find(
      ([table]) => table === "approvalRequest",
    )?.[1] as
      | {
          metadata?: { countedCash?: number; variance?: number };
          notes?: string;
        }
      | undefined;
    assert.equal(replacementApproval?.metadata?.countedCash, 10000);
    assert.equal(replacementApproval?.metadata?.variance, -60000);
    assert.equal(replacementApproval?.notes, "Corrected count.");
    const patchedReplacementApprovalId = patch.mock.calls.some(
      ([table, id, patchValue]) =>
        table === "registerSession" &&
        id === "session-1" &&
        patchValue?.managerApprovalRequestId === "approval-2",
    );
    assert.equal(patchedReplacementApprovalId, true);
  });

  it("rejects closeout approval proof payloads while pending void approvals exist", async () => {
    const registerSession = {
      _id: "session-1",
      expectedCash: 30000,
      openedAt: 1,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "open",
      storeId: "store-1",
      terminalId: "terminal-1",
    };
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") return registerSession;
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "staffProfile") {
            return {
              _id: "manager-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () =>
              table === "approvalRequest"
                ? [
                    {
                      _id: "void-approval-1",
                      registerSessionId: "session-1",
                      requestType: "pos_transaction_void",
                      status: "pending",
                      storeId: "store-1",
                      subjectType: "pos_transaction",
                    },
                  ]
                : [],
            ),
          })),
        })),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "manager-1",
      actorUserId: "user-1",
      approvalProofId: "proof-1",
      countedCash: 20000,
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "Resolve pending void approvals before approving final closeout.",
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("rejects closeout approval proof payloads while cash item adjustments are pending", async () => {
    const ctx = createPendingItemAdjustmentApprovalCtx();

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "manager-1",
      actorUserId: "user-1",
      approvalProofId: "proof-1",
      countedCash: 30000,
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "Resolve pending register corrections before approving final closeout.",
      },
    });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("rejects closeout approval proof payloads while mapping repair holds exist", async () => {
    const ctx = createCloseoutMappingHoldCtx();

    const result = await getHandler(submitRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "manager-1",
      approvalProofId: "proof-1",
      countedCash: 30000,
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "Resolve pending register corrections before approving final closeout.",
      },
    });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("blocks final closeout while pending void approvals remain", async () => {
    const registerSession = {
      _id: "session-1",
      countedCash: 30000,
      expectedCash: 30000,
      openedAt: 1,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "closing",
      storeId: "store-1",
      terminalId: "terminal-1",
    };
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") return registerSession;
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "staffProfile") {
            return {
              _id: "manager-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () =>
              table === "approvalRequest"
                ? [
                    {
                      _id: "void-approval-1",
                      registerSessionId: "session-1",
                      requestType: "pos_transaction_void",
                      status: "pending",
                      storeId: "store-1",
                      subjectType: "pos_transaction",
                    },
                  ]
                : [],
            ),
          })),
        })),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(finalizeRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "manager-1",
      actorUserId: "user-1",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Resolve pending void approvals before finalizing closeout.",
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("blocks final closeout while cash item adjustments remain", async () => {
    const ctx = createPendingItemAdjustmentApprovalCtx();

    const result = await getHandler(finalizeRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "manager-1",
      actorUserId: "user-1",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "Resolve pending register corrections before finalizing closeout.",
      },
    });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("does not block final closeout for non-cash item adjustments", async () => {
    const ctx = createPendingItemAdjustmentApprovalCtx({
      settlementMethod: "mobile_money",
    });

    const result = await getHandler(finalizeRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "manager-1",
      actorUserId: "user-1",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "closed",
        registerSession: expect.objectContaining({ status: "closed" }),
      },
    });
    expect(ctx.runMutation).toHaveBeenCalled();
  });

  it("blocks final closeout while mapping repair holds remain", async () => {
    const ctx = createCloseoutMappingHoldCtx();

    const result = await getHandler(finalizeRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "manager-1",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "Resolve pending register corrections before finalizing closeout.",
      },
    });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("finalizes exact-match submitted closeouts without a variance approval proof", async () => {
    const registerSession = {
      _id: "session-1",
      countedCash: 30000,
      expectedCash: 30000,
      openedAt: 1,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "closing",
      storeId: "store-1",
      terminalId: "terminal-1",
    };
    const closedSession = {
      ...registerSession,
      closedAt: 100,
      closedByStaffProfileId: "staff-1",
      closedByUserId: "manager-user-1",
      status: "closed",
    };
    const runMutation = vi.fn(async () => closedSession);
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") return registerSession;
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "staffProfile") {
            return {
              _id: "staff-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        insert: vi.fn(),
        patch: vi.fn(),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
            take: vi.fn(async () =>
              table === "staffRoleAssignment"
                ? [
                    {
                      organizationId: "org-1",
                      role: "manager",
                      status: "active",
                      storeId: "store-1",
                    },
                  ]
                : [],
            ),
          })),
        })),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(finalizeRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "staff-1",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "closed",
        registerSession: closedSession,
      },
    });
    expect(ctx.db.get).not.toHaveBeenCalledWith("approvalProof", expect.anything());
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        closedByStaffProfileId: "staff-1",
        closedByUserId: "manager-user-1",
        countedCash: 30000,
        registerSessionId: "session-1",
      }),
    );
  });

  it("finalizes exact-match submitted closeouts for an unlinked manager with matching staff credentials", async () => {
    const registerSession = {
      _id: "session-1",
      countedCash: 30000,
      expectedCash: 30000,
      openedAt: 1,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "closing",
      storeId: "store-1",
      terminalId: "terminal-1",
    };
    const closedSession = {
      ...registerSession,
      closedAt: 100,
      closedByStaffProfileId: "manager-1",
      closedByUserId: "manager-user-1",
      status: "closed",
    };
    const runMutation = vi.fn(async () => closedSession);
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") return registerSession;
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "staffProfile") {
            return {
              _id: "manager-1",
              linkedUserId: "other-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        insert: vi.fn(),
        patch,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
            take: vi.fn(async () => {
              if (table === "staffCredential") {
                return [
                  {
                    _id: "credential-1",
                    organizationId: "org-1",
                    pinHash: "hashed-pin",
                    staffProfileId: "manager-1",
                    status: "active",
                    storeId: "store-1",
                    username: "manager",
                  },
                ];
              }
              if (table === "staffRoleAssignment") {
                return [
                  {
                    organizationId: "org-1",
                    role: "manager",
                    status: "active",
                    storeId: "store-1",
                  },
                ];
              }
              return [];
            }),
          })),
        })),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(finalizeRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "manager-1",
      registerSessionId: "session-1",
      staffPinHash: "hashed-pin",
      staffUsername: "manager",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "closed",
        registerSession: closedSession,
      },
    });
    expect(patch).toHaveBeenCalledWith("staffCredential", "credential-1", {
      authenticationLockedUntil: undefined,
      failedAuthenticationAttempts: 0,
      lastAuthenticatedAt: expect.any(Number),
    });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        closedByStaffProfileId: "manager-1",
        closedByUserId: "manager-user-1",
        countedCash: 30000,
        registerSessionId: "session-1",
      }),
    );
  });

  it("rejects exact-match finalization when the staff actor belongs to another user", async () => {
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "staffProfile") {
            return {
              _id: "manager-1",
              linkedUserId: "other-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
      },
      runMutation,
    };

    const result = await getHandler(finalizeRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "manager-1",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Closeout staff actor does not match the signed-in user.",
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("rejects exact-match finalization when the signed-in staff actor is not a manager", async () => {
    const registerSession = {
      _id: "session-1",
      countedCash: 30000,
      expectedCash: 30000,
      openedAt: 1,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "closing",
      storeId: "store-1",
      terminalId: "terminal-1",
    };
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") return registerSession;
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "staffProfile") {
            return {
              _id: "staff-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
            take: vi.fn(async () => []),
          })),
        })),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(finalizeRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "staff-1",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Only managers can finalize register closeouts.",
      },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("requires manager proof when finalizing a submitted variance closeout", async () => {
    const registerSession = {
      _id: "session-1",
      countedCash: 20000,
      expectedCash: 30000,
      openedAt: 1,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "closing",
      storeId: "store-1",
      terminalId: "terminal-1",
    };
    const insert = vi.fn(async (table: string) =>
      table === "approvalRequesterChallenge" ? "requester-challenge-1" : "event-1",
    );
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") return registerSession;
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "staffProfile") {
            return {
              _id: "manager-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
          })),
        })),
        insert,
      },
      runMutation: vi.fn(),
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(finalizeRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "manager-1",
      actorUserId: "user-1",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "approval_required",
      approval: {
        action: {
          key: "cash_controls.register_session.review_variance",
        },
        requiredRole: "manager",
        requesterBinding: {
          challengeId: "requester-challenge-1",
          kind: "operational_staff_challenge",
          requestedByStaffProfileId: "manager-1",
        },
      },
    });
    expect(insert).toHaveBeenCalledWith(
      "approvalRequesterChallenge",
      expect.objectContaining({
        actionKey: "cash_controls.register_session.review_variance",
        requestedByStaffProfileId: "manager-1",
        subjectId: "session-1",
      }),
    );
  });

  it("allows managers to finalize variance closeout after pending void approvals clear", async () => {
    const registerSession = {
      _id: "session-1",
      countedCash: 20000,
      expectedCash: 30000,
      openedAt: 1,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "closing",
      storeId: "store-1",
      terminalId: "terminal-1",
    };
    const closedSession = {
      ...registerSession,
      closedAt: 100,
      closedByStaffProfileId: "manager-1",
      status: "closed",
    };
    const runMutation = vi.fn(async () => closedSession);
    const insert = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") return registerSession;
          if (table === "approvalProof") {
            return {
              _id: "proof-1",
              actionKey: "cash_controls.register_session.review_variance",
              approvedByStaffProfileId: "manager-1",
              expiresAt: Date.now() + 60_000,
              requestedByStaffProfileId: "manager-1",
              requiredRole: "manager",
              storeId: "store-1",
              subjectId: "session-1",
              subjectLabel: "A1",
              subjectType: "register_session",
            };
          }
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "staffProfile") {
            return {
              _id: "manager-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        insert,
        patch: vi.fn(),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
            take: vi.fn(async () =>
              table === "staffRoleAssignment"
                ? [
                    {
                      organizationId: "org-1",
                      role: "manager",
                      status: "active",
                      storeId: "store-1",
                    },
                  ]
                : [],
            ),
          })),
        })),
      },
      runMutation,
      runQuery: vi.fn(async () => ({ _id: "store-1" })),
    };

    const result = await getHandler(finalizeRegisterSessionCloseout)(ctx, {
      actorStaffProfileId: "manager-1",
      actorUserId: "user-1",
      approvalProofId: "proof-1",
      registerSessionId: "session-1",
      requestedByStaffProfileId: "manager-1",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "closed",
        registerSession: closedSession,
      },
    });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        closedByStaffProfileId: "manager-1",
        countedCash: 20000,
        registerSessionId: "session-1",
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith("approvalProof", "proof-1", {
      consumedAt: expect.any(Number),
    });
  });

  it("keeps variance approval approved but unclosed while void approvals are pending", async () => {
    const registerSession = {
      _id: "session-1",
      countedCash: 20000,
      expectedCash: 30000,
      managerApprovalRequestId: "approval-1",
      openedAt: 1,
      organizationId: "org-1",
      registerNumber: "A1",
      status: "closing",
      storeId: "store-1",
      terminalId: "terminal-1",
      variance: -10000,
    };
    const approvalRequest = {
      _id: "approval-1",
      registerSessionId: "session-1",
      requestType: "variance_review",
      status: "pending",
      storeId: "store-1",
      subjectId: "session-1",
      subjectType: "register_session",
    };
    const reviewedApprovalRequest = {
      ...approvalRequest,
      status: "approved",
    };
    const runMutation = vi.fn(async () => reviewedApprovalRequest);
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") return registerSession;
          if (table === "approvalRequest") return approvalRequest;
          if (table === "approvalProof") {
            return {
              _id: "proof-1",
              actionKey: "cash_controls.register_session.review_variance",
              approvedByStaffProfileId: "manager-1",
              expiresAt: Date.now() + 60_000,
              requiredRole: "manager",
              storeId: "store-1",
              subjectId: "session-1",
              subjectLabel: "A1",
              subjectType: "register_session",
            };
          }
          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }
          if (table === "staffProfile") {
            return {
              _id: "manager-1",
              linkedUserId: "manager-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }
          return null;
        }),
        insert: vi.fn(),
        patch: vi.fn(),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () =>
              table === "approvalRequest"
                ? [
                    {
                      _id: "void-approval-1",
                      registerSessionId: "session-1",
                      requestType: "pos_transaction_void",
                      status: "pending",
                      storeId: "store-1",
                      subjectType: "pos_transaction",
                    },
                  ]
                : [],
            ),
            take: vi.fn(async () =>
              table === "staffRoleAssignment"
                ? [
                    {
                      organizationId: "org-1",
                      role: "manager",
                      status: "active",
                      storeId: "store-1",
                    },
                  ]
                : [],
            ),
          })),
        })),
      },
      runMutation,
    };

    const result = await getHandler(reviewRegisterSessionCloseout)(ctx, {
      approvalProofId: "proof-1",
      decision: "approved",
      registerSessionId: "session-1",
      reviewedByUserId: "manager-user-1",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        action: "approved",
        approvalRequest: reviewedApprovalRequest,
        registerSession,
      },
    });
    assertConformsToExportedReturns(reviewRegisterSessionCloseout, result);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        approvalRequestId: "approval-1",
        decision: "approved",
      }),
    );
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

  it("binds opening float approval to the active staff requester", async () => {
    const insert = vi.fn(async (table: string) =>
      table === "approvalRequesterChallenge" ? "requester-challenge-1" : "event-1",
    );
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "registerSession") {
            return {
              _id: "session-1",
              expectedCash: 30000,
              openingFloat: 30000,
              openedAt: 1,
              organizationId: "org-1",
              registerNumber: "A1",
              status: "open",
              storeId: "store-1",
            };
          }

          if (table === "store") {
            return { _id: "store-1", currency: "GHS", organizationId: "org-1" };
          }

          if (table === "staffProfile") {
            return {
              _id: "staff-1",
              linkedUserId: "other-user-1",
              organizationId: "org-1",
              status: "active",
              storeId: "store-1",
            };
          }

          if (table === "staffCredential") {
            return {
              _id: "credential-1",
              localVerifierVersion: 2,
              staffProfileId: "staff-1",
              status: "active",
              storeId: "store-1",
            };
          }

          return null;
        }),
        insert,
        patch: vi.fn(),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            unique: vi.fn(async () => ({
              _id: "staff-proof-1",
              credentialId: "credential-1",
              credentialVersion: 2,
              expiresAt: Date.now() + 60_000,
              staffProfileId: "staff-1",
              status: "active",
              storeId: "store-1",
              terminalId: "terminal-1",
            })),
          })),
        })),
      },
      runMutation,
    };

    const result = await getHandler(correctRegisterSessionOpeningFloat)(ctx, {
      actorStaffProfileId: "staff-1",
      correctedOpeningFloat: 20000,
      reason: "Drawer counted wrong at open.",
      registerSessionId: "session-1",
      staffProofToken: "staff-proof-token",
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    expect(result).toMatchObject({
      kind: "approval_required",
      approval: {
        requesterBinding: {
          kind: "operational_staff_challenge",
          challengeId: "requester-challenge-1",
          requestedByStaffProfileId: "staff-1",
        },
      },
    });
    expect(insert).toHaveBeenCalledWith(
      "approvalRequesterChallenge",
      expect.objectContaining({
        actionKey: "cash_controls.register_session.correct_opening_float",
        organizationId: "org-1",
        requestedByStaffProfileId: "staff-1",
        requiredRole: "manager",
        storeId: "store-1",
        subjectId: "session-1",
        subjectLabel: "A1",
        subjectType: "register_session",
      }),
    );
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
