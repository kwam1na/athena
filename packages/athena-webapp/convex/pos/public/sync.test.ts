import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertConformsToExportedReturns,
  collectReturnValidatorIssues,
} from "../../lib/returnValidatorContract";
import { POS_LOCAL_SYNC_EVENT_CONTRACT } from "../../../shared/posLocalSyncContract";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  ingestLocalEventsWithCtx: vi.fn(),
  ingestRegisterSessionActivityWithCtx: vi.fn(),
  resolveLocalSyncReviewWithCtx: vi.fn(),
}));

vi.mock("../../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

vi.mock("../application/sync/ingestLocalEvents", () => ({
  ingestLocalEventsWithCtx: mocks.ingestLocalEventsWithCtx,
}));

vi.mock("../application/sync/posRegisterSessionActivity", () => ({
  ingestRegisterSessionActivityWithCtx:
    mocks.ingestRegisterSessionActivityWithCtx,
}));

vi.mock("../application/sync/resolveLocalSyncReview", () => ({
  resolveLocalSyncReviewWithCtx: mocks.resolveLocalSyncReviewWithCtx,
  MAX_LOCAL_SYNC_REVIEW_EVENTS: 100,
}));

import {
  ingestLocalEvents,
  ingestRegisterSessionActivity,
  resolveLocalSyncReview,
} from "./sync";

const SYNC_SECRET_HASH =
  "e3aaef72556405db4093f59a9aa8ee6539f8e6542e60d92f08e782faa0d246fa";
const originalStage = process.env.STAGE;

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function admittedCtx(ctx: { db: unknown; scheduler?: unknown }) {
  return expect.objectContaining({
    db: ctx.db,
    operationAdmission: expect.any(Object),
    scheduler: ctx.scheduler,
  });
}

describe("admitted POS local sync public mutation", () => {
  afterEach(() => {
    process.env.STAGE = originalStage;
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue(undefined);
    mocks.resolveLocalSyncReviewWithCtx.mockResolvedValue({
      resolvedEventIds: [],
      resolvedConflictCount: 0,
    });
    mocks.ingestLocalEventsWithCtx.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [],
        held: [],
        mappings: [],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: null,
          acceptedThroughSequence: 0,
        },
      },
    });
    mocks.ingestRegisterSessionActivityWithCtx.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [],
        skipped: [],
        checkpoint: {
          localRegisterSessionId: "local-register-1",
          reportedThroughSequence: 0,
          skippedCounts: {},
        },
      },
    });
  });

  it("returns authorization_failed when the caller cannot sync the store", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("denied"),
    );
    const ctx = buildCtx();

    const result = await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [],
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to sync this POS terminal.",
      },
    });
    expect(mocks.ingestLocalEventsWithCtx).not.toHaveBeenCalled();
  });

  it("passes authorized sync batches to ingestion with a submitted timestamp", async () => {
    const ctx = buildCtx();

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      submittedAt: 123,
      events: [buildEvent()],
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      admittedCtx(ctx),
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.ingestLocalEventsWithCtx).toHaveBeenCalledWith(
      admittedCtx(ctx),
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
        syncSecretHash: "sync-secret-1",
        submittedByUserId: "athena-user-1",
        submittedAt: 123,
      }),
    );
  });

  it("schedules an admin email for a fresh register closeout variance review in prod", async () => {
    process.env.STAGE = "prod";
    const ctx = buildCtx({
      approvalRequests: [
        {
          _id: "approval-variance-1",
          metadata: {
            localEventId: "event-closeout-1",
            variance: -4218,
          },
          registerSessionId: "register-session-1",
          requestType: "variance_review",
          status: "pending",
        },
      ],
    });
    mocks.ingestLocalEventsWithCtx.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-closeout-1",
            sequence: 2,
            status: "projected",
          },
        ],
        held: [],
        mappings: [
          {
            _id: "mapping-closeout-1",
            storeId: "store-1",
            terminalId: "terminal-1",
            localRegisterSessionId: "local-register-1",
            localEventId: "event-closeout-1",
            localIdKind: "closeout",
            localId: "event-closeout-1",
            cloudTable: "registerSession",
            cloudId: "register-session-1",
            createdAt: 124,
          },
        ],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "local-register-1",
          acceptedThroughSequence: 2,
        },
      },
    });

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [
        {
          localEventId: "event-closeout-1",
          localRegisterSessionId: "local-register-1",
          sequence: 2,
          eventType: "register_closed",
          occurredAt: 123,
          staffProfileId: "staff-1",
          payload: {
            countedCash: 120182,
            notes: "Counted twice.",
          },
        },
      ],
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "approvalRequest",
      "approval-variance-1",
      {
        metadata: expect.objectContaining({
          localEventId: "event-closeout-1",
          variance: -4218,
          varianceNotificationScheduledAt: expect.any(Number),
        }),
      },
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      {
        approvalRequestId: "approval-variance-1",
      },
    );
  });

  it("schedules an admin report for a fresh exact-match register closeout in prod", async () => {
    process.env.STAGE = "prod";
    const ctx = buildCtx({
      registerSessions: [
        {
          _id: "register-session-1",
          countedCash: 124400,
          expectedCash: 124400,
          status: "closed",
          variance: 0,
        },
      ],
    });
    mocks.ingestLocalEventsWithCtx.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [],
        held: [],
        mappings: [
          {
            cloudId: "register-session-1",
            cloudTable: "registerSession",
            localEventId: "event-closeout-1",
            localIdKind: "closeout",
          },
        ],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "local-register-1",
          acceptedThroughSequence: 2,
        },
      },
    });

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [
        {
          localEventId: "event-closeout-1",
          localRegisterSessionId: "local-register-1",
          sequence: 2,
          eventType: "register_closed",
          occurredAt: 123,
          staffProfileId: "staff-1",
          payload: { countedCash: 124400 },
        },
      ],
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "registerSession",
      "register-session-1",
      {
        closeoutNotificationLocalEventId: "event-closeout-1",
        closeoutNotificationScheduledAt: expect.any(Number),
      },
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      { registerSessionId: "register-session-1" },
    );
  });

  it("schedules an admin report for a policy-allowed variance register closeout in prod", async () => {
    process.env.STAGE = "prod";
    const ctx = buildCtx({
      registerSessions: [
        {
          _id: "register-session-1",
          countedCash: 279000,
          expectedCash: 279100,
          status: "closed",
          variance: -100,
        },
      ],
    });
    mocks.ingestLocalEventsWithCtx.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [],
        held: [],
        mappings: [
          {
            cloudId: "register-session-1",
            cloudTable: "registerSession",
            localEventId: "event-closeout-1",
            localIdKind: "closeout",
          },
        ],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "local-register-1",
          acceptedThroughSequence: 2,
        },
      },
    });

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [
        {
          localEventId: "event-closeout-1",
          localRegisterSessionId: "local-register-1",
          sequence: 2,
          eventType: "register_closed",
          occurredAt: 123,
          staffProfileId: "staff-1",
          payload: { countedCash: 279000 },
        },
      ],
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "registerSession",
      "register-session-1",
      {
        closeoutNotificationLocalEventId: "event-closeout-1",
        closeoutNotificationScheduledAt: expect.any(Number),
      },
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      { registerSessionId: "register-session-1" },
    );
  });

  it("does not reschedule an exact-match report for the same closeout event", async () => {
    process.env.STAGE = "prod";
    const ctx = buildCtx({
      registerSessions: [
        {
          _id: "register-session-1",
          closeoutNotificationLocalEventId: "event-closeout-1",
          countedCash: 124400,
          expectedCash: 124400,
          status: "closed",
          variance: 0,
        },
      ],
    });
    mocks.ingestLocalEventsWithCtx.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [],
        held: [],
        mappings: [
          {
            cloudId: "register-session-1",
            cloudTable: "registerSession",
            localEventId: "event-closeout-1",
            localIdKind: "closeout",
          },
        ],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "local-register-1",
          acceptedThroughSequence: 2,
        },
      },
    });

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [
        {
          localEventId: "event-closeout-1",
          localRegisterSessionId: "local-register-1",
          sequence: 2,
          eventType: "register_closed",
          occurredAt: 123,
          staffProfileId: "staff-1",
          payload: { countedCash: 124400 },
        },
      ],
    });

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("does not schedule a variance alert outside prod", async () => {
    process.env.STAGE = "dev";
    const ctx = buildCtx({
      approvalRequests: [
        {
          _id: "approval-variance-1",
          metadata: {
            localEventId: "event-closeout-1",
            variance: -4218,
          },
          registerSessionId: "register-session-1",
          requestType: "variance_review",
          status: "pending",
        },
      ],
    });
    mocks.ingestLocalEventsWithCtx.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-closeout-1",
            sequence: 2,
            status: "projected",
          },
        ],
        held: [],
        mappings: [
          {
            _id: "mapping-closeout-1",
            storeId: "store-1",
            terminalId: "terminal-1",
            localRegisterSessionId: "local-register-1",
            localEventId: "event-closeout-1",
            localIdKind: "closeout",
            localId: "event-closeout-1",
            cloudTable: "registerSession",
            cloudId: "register-session-1",
            createdAt: 124,
          },
        ],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "local-register-1",
          acceptedThroughSequence: 2,
        },
      },
    });

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [
        {
          localEventId: "event-closeout-1",
          localRegisterSessionId: "local-register-1",
          sequence: 2,
          eventType: "register_closed",
          occurredAt: 123,
          staffProfileId: "staff-1",
          payload: {
            countedCash: 120182,
            notes: "Counted twice.",
          },
        },
      ],
    });

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("does not reschedule a variance alert that was already marked", async () => {
    process.env.STAGE = "prod";
    const ctx = buildCtx({
      approvalRequests: [
        {
          _id: "approval-variance-1",
          metadata: {
            localEventId: "event-closeout-1",
            variance: -4218,
            varianceNotificationScheduledAt: 123,
          },
          registerSessionId: "register-session-1",
          requestType: "variance_review",
          status: "pending",
        },
      ],
    });
    mocks.ingestLocalEventsWithCtx.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-closeout-1",
            sequence: 2,
            status: "projected",
          },
        ],
        held: [],
        mappings: [
          {
            _id: "mapping-closeout-1",
            storeId: "store-1",
            terminalId: "terminal-1",
            localRegisterSessionId: "local-register-1",
            localEventId: "event-closeout-1",
            localIdKind: "closeout",
            localId: "event-closeout-1",
            cloudTable: "registerSession",
            cloudId: "register-session-1",
            createdAt: 124,
          },
        ],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "local-register-1",
          acceptedThroughSequence: 2,
        },
      },
    });

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [
        {
          localEventId: "event-closeout-1",
          localRegisterSessionId: "local-register-1",
          sequence: 2,
          eventType: "register_closed",
          occurredAt: 123,
          staffProfileId: "staff-1",
          payload: {
            countedCash: 120182,
          },
        },
      ],
    });

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("accepts actor events without staff proof at the public sync boundary", async () => {
    const ctx = buildCtx();
    const { staffProofToken: _staffProofToken, ...prooflessEvent } = buildEvent();

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [prooflessEvent],
    });

    expect(mocks.ingestLocalEventsWithCtx).toHaveBeenCalledWith(
      admittedCtx(ctx),
      expect.objectContaining({
        events: [
          expect.not.objectContaining({
            staffProofToken: expect.any(String),
          }),
        ],
      }),
    );
  });

  it("returns not_found when the store does not exist", async () => {
    const ctx = buildCtx({ missingStore: true });

    const result = await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [buildEvent()],
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Store not found.",
      },
    });
    expect(mocks.ingestLocalEventsWithCtx).not.toHaveBeenCalled();
  });

  it("returns duplicate local id reconciliation conflicts from the public boundary", async () => {
    const returnValidator = JSON.stringify(
      (ingestLocalEvents as any).exportReturns(),
    );
    for (const conflictType of [
      "duplicate_local_id",
      "inventory",
      "payment",
      "permission",
    ]) {
      expect(returnValidator).toContain(conflictType);
    }
    mocks.ingestLocalEventsWithCtx.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-1",
            sequence: 1,
            status: "conflicted",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [
          {
            _id: "conflict-1",
            storeId: "store-1",
            terminalId: "terminal-1",
            localRegisterSessionId: "local-register-1",
            localEventId: "event-1",
            sequence: 1,
            conflictType: "duplicate_local_id",
            status: "needs_review",
            summary: "Local POS sync id was reused by a different synced sale.",
            details: { localIdKind: "receipt", localId: "LR-001" },
            createdAt: 123,
          },
        ],
        syncCursor: {
          syncScope: "expense",
          localSyncCursorId: "expense-session-1",
          localRegisterSessionId: "local-register-1",
          localExpenseSessionId: "expense-session-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const ctx = buildCtx();

    const result = await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [buildEvent()],
    });

    assertConformsToExportedReturns(ingestLocalEvents, result);
    expect(result.kind).toBe("ok");
    expect(result).toMatchObject({
      kind: "ok",
      data: {
        syncCursor: {
          syncScope: "expense",
          localSyncCursorId: "expense-session-1",
          localRegisterSessionId: "local-register-1",
          localExpenseSessionId: "expense-session-1",
          acceptedThroughSequence: 1,
        },
        conflicts: [
          expect.objectContaining({
            conflictType: "duplicate_local_id",
          }),
        ],
      },
    });
  });

  it("exposes pending checkout definition and sale-line fields in the public args validator", () => {
    const argsValidator = JSON.stringify((ingestLocalEvents as any).exportArgs());

    expect(argsValidator).toContain("pending_checkout_item_defined");
    expect(argsValidator).toContain("localPendingCheckoutItemId");
    expect(argsValidator).toContain("pendingCheckoutItemId");
    expect(argsValidator).toContain("inventoryImportProvisionalSkuId");
    expect(argsValidator).toContain(
      "pos_pending_checkout_item_local_metadata_v1",
    );
    expect(argsValidator).toContain("cloudValidation");
  });

  it("rejects sync batches that exceed the event cap before ingestion", async () => {
    const ctx = buildCtx();
    const events = Array.from({ length: 251 }, (_unused, index) => ({
      ...buildEvent(),
      localEventId: `event-${index + 1}`,
      sequence: index + 1,
    }));

    const result = await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events,
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Sync uploads can include at most 250 events.",
      },
    });
    expect(mocks.ingestLocalEventsWithCtx).not.toHaveBeenCalled();
  });

  it("rejects sync batches with too many pending checkout definitions", async () => {
    const ctx = buildCtx();
    const events = Array.from({ length: 51 }, (_unused, index) => ({
      localEventId: `event-pending-${index + 1}`,
      localRegisterSessionId: "local-register-1",
      sequence: index + 1,
      eventType: "pending_checkout_item_defined",
      occurredAt: 124 + index,
      staffProfileId: "staff-1",
      staffProofToken: "proof-token-1",
      payload: {
        localPendingCheckoutItemId: `local-pending-${index + 1}`,
        name: "Unknown gel",
        lookupCode: `9999999999${String(index).padStart(2, "0")}`,
        price: 2500,
        quantitySold: 1,
      },
    }));

    const result = await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events,
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message:
          "Sync uploads can include at most 50 pending checkout items.",
      },
    });
    expect(mocks.ingestLocalEventsWithCtx).not.toHaveBeenCalled();
  });

  it("accepts sync from an authorized store member even when they did not register the terminal", async () => {
    const ctx = buildCtx({ terminalRegisteredByUserId: "athena-admin-1" });

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [buildEvent()],
    });

    expect(mocks.ingestLocalEventsWithCtx).toHaveBeenCalledWith(
      admittedCtx(ctx),
      expect.objectContaining({
        submittedByUserId: "athena-user-1",
      }),
    );
  });

  it("rejects sync without the provisioned terminal secret", async () => {
    const ctx = buildCtx();

    const result = await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "wrong-secret",
      events: [buildEvent()],
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to sync this POS terminal.",
        metadata: { terminalAuthorizationFailure: true },
      },
    });
    expect(mocks.ingestLocalEventsWithCtx).not.toHaveBeenCalled();
  });

  it("requires existing rollout terminals to re-provision a stored sync secret before syncing", async () => {
    const ctx = buildCtx({ terminalSyncSecretHash: undefined });

    const result = await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "new-rollout-secret",
      events: [buildEvent()],
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to sync this POS terminal.",
        metadata: { terminalAuthorizationFailure: true },
      },
    });
    expect(mocks.ingestLocalEventsWithCtx).not.toHaveBeenCalled();
  });

  it.each([
    ["missing terminal", { missingTerminal: true }],
    ["terminal from another store", { terminalStoreId: "store-2" }],
    ["inactive terminal", { terminalStatus: "inactive" }],
  ])("rejects sync for %s", async (_label, options) => {
    const ctx = buildCtx(options);

    const result = await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [buildEvent()],
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to sync this POS terminal.",
        metadata: { terminalAuthorizationFailure: true },
      },
    });
    expect(mocks.ingestLocalEventsWithCtx).not.toHaveBeenCalled();
  });

  it("allows a registered terminal to sync locally authenticated staff events", async () => {
    const ctx = buildCtx({ staffLinkedUserId: "athena-user-2" });

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [buildEvent()],
    });

    expect(mocks.ingestLocalEventsWithCtx).toHaveBeenCalledWith(
      admittedCtx(ctx),
      expect.objectContaining({
        events: [buildEvent()],
      }),
    );
  });

  it("passes sale completed display receipt numbers through the public sync boundary", async () => {
    const ctx = buildCtx();
    const event = buildSaleCompletedEvent();

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [event],
    });

    expect(mocks.ingestLocalEventsWithCtx).toHaveBeenCalledWith(
      admittedCtx(ctx),
      expect.objectContaining({
        events: [
          expect.objectContaining({
            eventType: "sale_completed",
            payload: expect.objectContaining({
              localReceiptNumber: "local-txn-1",
              receiptNumber: "123456",
            }),
          }),
        ],
      }),
    );
  });

  it("accepts sale completed service lines at the public sync boundary", async () => {
    const ctx = buildCtx();
    const event = buildSaleCompletedEvent({
      totals: { subtotal: 100, tax: 0, total: 100 },
      serviceLines: [
        {
          localServiceLineId: "local-service-line-1",
          localServiceCaseId: "local-service-case-1",
          serviceCatalogId: "service-catalog-1",
          serviceCatalogName: "Install",
          serviceMode: "same_day",
          pricingModel: "fixed",
          quantity: 1,
          unitPrice: 75,
          totalPrice: 75,
          catalogUpdatedAt: 1_000,
          customerProfileId: "customer-1",
        },
      ],
      payments: [
        {
          localPaymentId: "local-payment-1",
          method: "cash",
          amount: 100,
          timestamp: 124,
        },
      ],
    });

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [event],
    });

    expect(mocks.ingestLocalEventsWithCtx).toHaveBeenCalledWith(
      admittedCtx(ctx),
      expect.objectContaining({
        events: [
          expect.objectContaining({
            eventType: "sale_completed",
            payload: expect.objectContaining({
              serviceLines: [
                expect.objectContaining({
                  localServiceLineId: "local-service-line-1",
                  serviceCatalogId: "service-catalog-1",
                  totalPrice: 75,
                }),
              ],
            }),
          }),
        ],
      }),
    );
  });

  it("accepts pending checkout definitions at the public sync boundary", async () => {
    const ctx = buildCtx();
    const event = {
      localEventId: "event-pending-1",
      localRegisterSessionId: "local-register-1",
      sequence: 2,
      eventType: "pending_checkout_item_defined",
      occurredAt: 124,
      staffProfileId: "staff-1",
      staffProofToken: "proof-token-1",
      payload: {
        localPendingCheckoutItemId: "local-pending-1",
        name: "Unknown gel",
        lookupCode: "999999999999",
        searchContext: {
          query: "999999999999",
          exactLookupCode: "999999999999",
          attemptedAt: 123,
        },
        price: 2500,
        quantitySold: 2,
        localMetadata: {
          schema: "pos_pending_checkout_item_local_metadata_v1",
          createdOffline: true,
          appSessionValidation: "unverified",
          cloudValidation: "uncertain",
        },
      },
    };

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [event],
    });

    expect(mocks.ingestLocalEventsWithCtx).toHaveBeenCalledWith(
      admittedCtx(ctx),
      expect.objectContaining({
        events: [
          expect.objectContaining({
            eventType: "pending_checkout_item_defined",
            payload: expect.objectContaining({
              localPendingCheckoutItemId: "local-pending-1",
              searchContext: expect.objectContaining({
                exactLookupCode: "999999999999",
              }),
              localMetadata: expect.objectContaining({
                createdOffline: true,
                cloudValidation: "uncertain",
              }),
            }),
          }),
        ],
      }),
    );
  });

  it("accepts pending checkout sale items at the public sync boundary", async () => {
    const ctx = buildCtx();
    const event = buildSaleCompletedEvent({
      items: [
        {
          localTransactionItemId: "local-pending-sale-item-1",
          productId: "local-pending-product-1",
          productSkuId: "local-pending-sku-1",
          pendingCheckoutItemId: "local-pending-1",
          productName: "Unknown gel",
          productSku: "PENDING-1",
          barcode: "999999999999",
          quantity: 2,
          unitPrice: 2500,
        },
      ],
      totals: { subtotal: 5000, tax: 0, total: 5000 },
      payments: [
        {
          localPaymentId: "local-payment-1",
          method: "cash",
          amount: 5000,
          timestamp: 124,
        },
      ],
    });

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [event],
    });

    expect(mocks.ingestLocalEventsWithCtx).toHaveBeenCalledWith(
      admittedCtx(ctx),
      expect.objectContaining({
        events: [
          expect.objectContaining({
            eventType: "sale_completed",
            payload: expect.objectContaining({
              items: [
                expect.objectContaining({
                  productId: "local-pending-product-1",
                  productSkuId: "local-pending-sku-1",
                  pendingCheckoutItemId: "local-pending-1",
                }),
              ],
            }),
          }),
        ],
      }),
    );
  });

  it("accepts linked pending checkout alias sale items at the public sync boundary", async () => {
    const ctx = buildCtx();
    const event = buildSaleCompletedEvent({
      items: [
        {
          localTransactionItemId: "local-linked-alias-sale-item-1",
          productId: "product-1",
          productSkuId: "sku-1",
          pendingCheckoutItemId: "pending-linked-1",
          pendingCheckoutAliasState: "linked_to_catalog",
          productName: "Yeeeee",
          productSku: "6N2Y-ZJQ-AD8",
          barcode: "111222333559",
          quantity: 3,
          unitPrice: 40000,
        },
      ],
      totals: { subtotal: 120000, tax: 0, total: 120000 },
      payments: [
        {
          localPaymentId: "local-payment-1",
          method: "cash",
          amount: 120000,
          timestamp: 124,
        },
      ],
    });

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [event],
    });

    expect(mocks.ingestLocalEventsWithCtx).toHaveBeenCalledWith(
      admittedCtx(ctx),
      expect.objectContaining({
        events: [
          expect.objectContaining({
            eventType: "sale_completed",
            payload: expect.objectContaining({
              items: [
                expect.objectContaining({
                  productId: "product-1",
                  productSkuId: "sku-1",
                  pendingCheckoutItemId: "pending-linked-1",
                  pendingCheckoutAliasState: "linked_to_catalog",
                }),
              ],
            }),
          }),
        ],
      }),
    );
  });

  it("exposes drawerless expense upload fields in the public args validator", () => {
    const argsValidator = JSON.stringify((ingestLocalEvents as any).exportArgs());

    expect(argsValidator).toContain("expense_recorded");
    expect(argsValidator).toContain("syncScope");
    expect(argsValidator).toContain("localExpenseSessionId");
    expect(argsValidator).not.toContain(
      '"eventType":{"type":"literal","value":"expense_recorded"},"localRegisterSessionId"',
    );
  });

  it("derives public upload validator event names from the shared sync contract", () => {
    const argsValidator = JSON.stringify((ingestLocalEvents as any).exportArgs());

    for (const { eventType } of POS_LOCAL_SYNC_EVENT_CONTRACT) {
      expect(argsValidator).toContain(eventType);
    }
    expect(argsValidator).toContain("openingFloat");
    expect(argsValidator).toContain("localPendingCheckoutItemId");
    expect(argsValidator).toContain("localTransactionId");
    expect(argsValidator).toContain("localExpenseEventId");
    expect(argsValidator).not.toContain('"payload":{"type":"record"');
  });

  it("strictly validates public upload event discriminants and payload shapes", () => {
    const validArgs = {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [buildEvent()],
    };

    expectPublicSyncArgsToConform(validArgs);
    expectPublicSyncArgsToReject({
      ...validArgs,
      events: [
        {
          ...buildEvent(),
          eventType: "mystery_sync_event",
        },
      ],
    });
    expectPublicSyncArgsToReject({
      ...validArgs,
      events: [
        {
          ...buildEvent(),
          eventType: "sale_completed",
        },
      ],
    });
    expectPublicSyncArgsToReject({
      ...validArgs,
      events: [
        {
          ...buildEvent(),
          payload: {
            registerNumber: "1",
          },
        },
      ],
    });
  });

  it("passes drawerless expense sync batches to ingestion", async () => {
    const ctx = buildCtx();

    await getHandler(ingestLocalEvents)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      events: [buildExpenseRecordedEvent()],
    });

    expect(mocks.ingestLocalEventsWithCtx).toHaveBeenCalledWith(
      admittedCtx(ctx),
      expect.objectContaining({
        events: [
          expect.objectContaining({
            syncScope: "expense",
            eventType: "expense_recorded",
            localExpenseSessionId: "local-expense-session-1",
            payload: expect.objectContaining({
              localExpenseSessionId: "local-expense-session-1",
              localExpenseEventId: "local-expense-event-1",
              totals: {
                subtotal: 25,
                tax: 0,
                total: 25,
              },
              items: [
                expect.objectContaining({
                  localTransactionItemId: "local-expense-line-1",
                  productId: "product-1",
                  productSkuId: "sku-1",
                  quantity: 1,
                  unitPrice: 25,
                }),
              ],
            }),
          }),
        ],
      }),
    );
  });

  it("passes authorized register-session activity reports to ingestion", async () => {
    const ctx = buildCtx();

    mocks.ingestRegisterSessionActivityWithCtx.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-activity-1",
            sequence: 2,
            status: "terminal_reported",
          },
        ],
        skipped: [],
        checkpoint: {
          localRegisterSessionId: "local-register-1",
          reportedThroughSequence: 2,
          lastActivityReportedAt: 123,
          skippedCounts: {},
        },
      },
    });

    const result = await getHandler(ingestRegisterSessionActivity)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      localRegisterSessionId: "local-register-1",
      registerNumber: "R1",
      reportedThroughSequence: 2,
      submittedAt: 123,
      activities: [
        {
          localEventId: "event-activity-1",
          sequence: 2,
          occurredAt: 122,
          staffProfileId: "staff-1",
          eventType: "sale_completed",
          category: "sale",
          metadata: {
            itemCount: 2,
            receiptNumber: "R-100",
            totalAmount: 5000,
          },
        },
      ],
    });

    assertConformsToExportedReturns(ingestRegisterSessionActivity, result);
    expect(result).toMatchObject({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-activity-1",
            sequence: 2,
            status: "terminal_reported",
          },
        ],
      },
    });
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      admittedCtx(ctx),
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.ingestRegisterSessionActivityWithCtx).toHaveBeenCalledWith(
      admittedCtx(ctx),
      {
        storeId: "store-1",
        terminalId: "terminal-1",
        localRegisterSessionId: "local-register-1",
        registerNumber: "R1",
        reportedThroughSequence: 2,
        reportedThroughOccurredAt: undefined,
        submittedAt: 123,
        activities: [
          expect.objectContaining({
            localEventId: "event-activity-1",
            category: "sale",
          }),
        ],
      },
    );
  });

  it("rejects register-session activity without the provisioned terminal secret", async () => {
    const ctx = buildCtx();

    const result = await getHandler(ingestRegisterSessionActivity)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "wrong-secret",
      localRegisterSessionId: "local-register-1",
      reportedThroughSequence: 0,
      activities: [],
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to sync this POS terminal.",
        metadata: { terminalAuthorizationFailure: true },
      },
    });
    expect(mocks.ingestRegisterSessionActivityWithCtx).not.toHaveBeenCalled();
  });

  it("rejects overlarge register-session activity reports before ingestion", async () => {
    const ctx = buildCtx();
    const activities = Array.from({ length: 251 }, (_unused, index) => ({
      localEventId: `event-activity-${index + 1}`,
      sequence: index + 1,
      occurredAt: 123 + index,
      eventType: "cart_item_added",
      category: "cart",
      metadata: { itemCount: 1 },
    }));

    const result = await getHandler(ingestRegisterSessionActivity)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      localRegisterSessionId: "local-register-1",
      reportedThroughSequence: 251,
      activities,
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Activity reports can include at most 250 events.",
      },
    });
    expect(mocks.ingestRegisterSessionActivityWithCtx).not.toHaveBeenCalled();
  });
});

function expectPublicSyncArgsToConform(value: unknown) {
  expect(collectPublicSyncArgsIssues(value)).toEqual([]);
}

function expectPublicSyncArgsToReject(value: unknown) {
  expect(collectPublicSyncArgsIssues(value).length).toBeGreaterThan(0);
}

function collectPublicSyncArgsIssues(value: unknown) {
  return collectReturnValidatorIssues(
    JSON.parse((ingestLocalEvents as any).exportArgs()),
    value,
  );
}

describe("resolveLocalSyncReview public mutation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue(undefined);
    mocks.resolveLocalSyncReviewWithCtx.mockResolvedValue({
      resolvedEventIds: ["event-review-1"],
      resolvedConflictCount: 1,
    });
  });

  it("denies a caller without the POS review role", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("denied"),
    );
    const ctx = buildCtx();

    const result = await getHandler(resolveLocalSyncReview)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      localEventIds: ["event-review-1"],
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to resolve POS sync reviews.",
      },
    });
    expect(mocks.resolveLocalSyncReviewWithCtx).not.toHaveBeenCalled();
  });

  it("returns not_found for an unknown store without resolving", async () => {
    const ctx = buildCtx({ missingStore: true });

    const result = await getHandler(resolveLocalSyncReview)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      localEventIds: ["event-review-1"],
    });

    expect(result).toEqual({
      kind: "user_error",
      error: { code: "not_found", message: "Store not found." },
    });
    expect(mocks.resolveLocalSyncReviewWithCtx).not.toHaveBeenCalled();
  });

  it("round-trips an authorized resolution with the caller as the resolver", async () => {
    const ctx = buildCtx();

    const result = await getHandler(resolveLocalSyncReview)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      localEventIds: ["event-review-1"],
      submittedAt: 4_242,
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.resolveLocalSyncReviewWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
        localEventIds: ["event-review-1"],
        resolvedByUserId: "athena-user-1",
        now: 4_242,
      }),
    );
    assertConformsToExportedReturns(resolveLocalSyncReview, result);
    expect(result).toEqual({
      kind: "ok",
      data: { resolvedEventIds: ["event-review-1"], resolvedConflictCount: 1 },
    });
  });
});

function buildCtx(
  options: {
    approvalRequests?: Array<{
      _id: string;
      metadata?: Record<string, unknown>;
      registerSessionId?: string;
      requestType: string;
      status: string;
    }>;
    registerSessions?: Array<Record<string, unknown> & { _id: string }>;
    missingTerminal?: boolean;
    staffLinkedUserId?: string;
    terminalRegisteredByUserId?: string;
    terminalSyncSecretHash?: string;
    terminalStatus?: string;
    terminalStoreId?: string;
    missingStore?: boolean;
  } = {},
) {
  return {
    db: {
      get: vi.fn(async (tableName: string, id: string) => {
        if (tableName === "registerSession") {
          return (
            options.registerSessions?.find((session) => session._id === id) ??
            null
          );
        }
        if (tableName === "store" && id === "store-1" && !options.missingStore) {
          return {
            _id: "store-1",
            organizationId: "org-1",
          };
        }

        if (
          tableName === "posTerminal" &&
          id === "terminal-1" &&
          !options.missingTerminal
        ) {
          return {
            _id: "terminal-1",
            storeId: options.terminalStoreId ?? "store-1",
            status: options.terminalStatus ?? "active",
            registeredByUserId:
              options.terminalRegisteredByUserId ?? "athena-user-1",
            ...(options.terminalSyncSecretHash !== undefined
              ? { syncSecretHash: options.terminalSyncSecretHash }
              : "terminalSyncSecretHash" in options
                ? {}
                : { syncSecretHash: SYNC_SECRET_HASH }),
          };
        }

        if (tableName === "staffProfile" && id === "staff-1") {
          return {
            _id: "staff-1",
            storeId: "store-1",
            status: "active",
            linkedUserId: options.staffLinkedUserId ?? "athena-user-1",
          };
        }

        return null;
      }),
      patch: vi.fn(),
      query: vi.fn((tableName: string) => {
        if (tableName !== "approvalRequest") {
          return {
            withIndex: vi.fn(() => ({
              take: vi.fn(async () => []),
            })),
          };
        }

        return {
          withIndex: vi.fn(
            (
              _indexName: string,
              indexBuilder: (q: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown,
            ) => {
              const filters: Record<string, unknown> = {};
              const q = {
                eq(field: string, value: unknown) {
                  filters[field] = value;
                  return q;
                },
              };
              indexBuilder(q);

              return {
                take: vi.fn(async () =>
                  (options.approvalRequests ?? []).filter(
                    (request) =>
                      request.registerSessionId === filters.registerSessionId &&
                      request.status === filters.status &&
                      request.requestType === filters.requestType,
                  ),
                ),
              };
            },
          ),
        };
      }),
    },
    scheduler: {
      runAfter: vi.fn(),
    },
  };
}

function buildEvent() {
  return {
    localEventId: "event-1",
    localRegisterSessionId: "local-register-1",
    sequence: 1,
    eventType: "register_opened",
    occurredAt: 123,
    staffProfileId: "staff-1",
    staffProofToken: "proof-token-1",
    payload: {
      openingFloat: 100,
      registerNumber: "1",
    },
  };
}

function buildSaleCompletedEvent(
  payloadOverrides: Record<string, unknown> = {},
) {
  return {
    localEventId: "event-sale-1",
    localRegisterSessionId: "local-register-1",
    sequence: 2,
    eventType: "sale_completed",
    occurredAt: 124,
    staffProfileId: "staff-1",
    staffProofToken: "proof-token-1",
    payload: {
      ...baseSaleCompletedPayload(),
      ...payloadOverrides,
    },
  };
}

function buildExpenseRecordedEvent() {
  return {
    syncScope: "expense",
    localEventId: "event-expense-1",
    localExpenseSessionId: "local-expense-session-1",
    sequence: 1,
    eventType: "expense_recorded",
    occurredAt: 124,
    staffProfileId: "staff-1",
    staffProofToken: "proof-token-1",
    payload: {
      localExpenseSessionId: "local-expense-session-1",
      localExpenseEventId: "local-expense-event-1",
      notes: "Damaged stock",
      totals: {
        subtotal: 25,
        tax: 0,
        total: 25,
      },
      items: [
        {
          localTransactionItemId: "local-expense-line-1",
          productId: "product-1",
          productSkuId: "sku-1",
          productName: "Repair kit",
          productSku: "KIT-1",
          quantity: 1,
          unitPrice: 25,
        },
      ],
    },
  };
}

function baseSaleCompletedPayload() {
  return {
    localPosSessionId: "local-session-1",
    localTransactionId: "local-txn-1",
    localReceiptNumber: "local-txn-1",
    receiptNumber: "123456",
    registerNumber: "1",
    totals: {
      subtotal: 25,
      tax: 0,
      total: 25,
    },
    items: [
      {
        localTransactionItemId: "local-item-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productName: "Wig Cap",
        productSku: "CAP-1",
        quantity: 1,
        unitPrice: 25,
      },
    ],
    payments: [
      {
        localPaymentId: "local-payment-1",
        method: "cash",
        amount: 25,
        timestamp: 124,
      },
    ],
  };
}
