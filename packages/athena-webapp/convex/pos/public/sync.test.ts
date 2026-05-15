import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  ingestLocalEventsWithCtx: vi.fn(),
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

import { ingestLocalEvents } from "./sync";

const SYNC_SECRET_HASH =
  "e3aaef72556405db4093f59a9aa8ee6539f8e6542e60d92f08e782faa0d246fa";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("POS local sync public mutation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue(undefined);
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
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.ingestLocalEventsWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
        syncSecretHash: "sync-secret-1",
        submittedByUserId: "athena-user-1",
        submittedAt: 123,
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
          localRegisterSessionId: "local-register-1",
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

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        conflicts: [
          expect.objectContaining({
            conflictType: "duplicate_local_id",
          }),
        ],
      },
    });
  });

  it("rejects sync when the signed-in user does not own the terminal seed", async () => {
    const ctx = buildCtx({ terminalRegisteredByUserId: "athena-admin-1" });

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
      },
    });
    expect(mocks.ingestLocalEventsWithCtx).not.toHaveBeenCalled();
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
      ctx,
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
      ctx,
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
});

function buildCtx(
  options: {
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

function buildSaleCompletedEvent() {
  return {
    localEventId: "event-sale-1",
    localRegisterSessionId: "local-register-1",
    sequence: 2,
    eventType: "sale_completed",
    occurredAt: 124,
    staffProfileId: "staff-1",
    staffProofToken: "proof-token-1",
    payload: {
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
    },
  };
}
