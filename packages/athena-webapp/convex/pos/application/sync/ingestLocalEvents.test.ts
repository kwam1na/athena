import { beforeEach, describe, expect, it, vi } from "vitest";

const activityPatchMocks = vi.hoisted(() => ({
  patchRegisterSessionActivityFromLocalSyncWithCtx: vi.fn(),
}));

vi.mock("./posRegisterSessionActivity", () => activityPatchMocks);

import {
  createLocalSyncIngestionService,
  ingestLocalEventsWithCtx,
  type PosLocalSyncBatchInput,
} from "./ingestLocalEvents";
import { createConvexLocalSyncRepository } from "../../infrastructure/repositories/localSyncRepository";
import type { Id } from "../../../_generated/dataModel";
import { hashPosLocalStaffProofToken } from "./staffProof";
import type {
  LocalSyncConflictRecord,
  LocalSyncEventRecord,
  LocalSyncMappingRecord,
  LocalSyncRepository,
  PosLocalSalePayload,
  PosLocalSyncEventInput,
  SyncProjectionRepository,
} from "./types";

beforeEach(() => {
  activityPatchMocks.patchRegisterSessionActivityFromLocalSyncWithCtx.mockReset();
  activityPatchMocks.patchRegisterSessionActivityFromLocalSyncWithCtx.mockResolvedValue(
    undefined,
  );
});

describe("createLocalSyncIngestionService", () => {
  it("accepts an ordered local register batch and returns durable mappings", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({ sequence: 1 }),
          buildSaleCompletedEvent({ sequence: 2 }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");

    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-1",
        sequence: 1,
        status: "projected",
      }),
      expect.objectContaining({
        localEventId: "event-sale-completed-2",
        sequence: 2,
        status: "projected",
      }),
    ]);
    expect(result.data.syncCursor).toEqual({
      syncScope: "pos",
      localSyncCursorId: "local-register-1",
      localRegisterSessionId: "local-register-1",
      acceptedThroughSequence: 2,
    });
    expect(result.data.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localEventId: "event-sale-completed-1",
          localIdKind: "transaction",
        }),
        expect.objectContaining({
          localEventId: "event-sale-completed-2",
          localIdKind: "transaction",
        }),
      ]),
    );
    expect(repository.createdTransactions).toHaveLength(2);
    expect(repository.createdPaymentAllocations).toHaveLength(2);
  });

  it("accepts sale clear events", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [buildSaleClearedEvent({ sequence: 1 })],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-cleared-1",
        sequence: 1,
        status: "projected",
      }),
    ]);
    expect(result.data.syncCursor).toEqual({
      syncScope: "pos",
      localSyncCursorId: "local-register-1",
      localRegisterSessionId: "local-register-1",
      acceptedThroughSequence: 1,
    });
  });

  it("accepts pending checkout item definition events and returns the local mapping", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        submittedByUserId: "athena-user-1" as never,
        events: [buildPendingCheckoutItemDefinedEvent({ sequence: 1 })],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-pending-item-1",
        sequence: 1,
        status: "projected",
      }),
    ]);
    expect(result.data.mappings).toEqual([
      expect.objectContaining({
        localIdKind: "pendingCheckoutItem",
        localId: "local-pending-item-1",
        cloudTable: "posPendingCheckoutItem",
        cloudId: "pending-checkout-item-1",
      }),
    ]);
    expect(repository.createdPendingCheckoutItems).toEqual([
      expect.objectContaining({
        name: "Loose wave bundle",
        lookupCode: "999888777666",
        quantitySold: 2,
        source: "offline_sync",
      }),
    ]);
  });

  it("rejects malformed pending checkout item definitions before projection", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildPendingCheckoutItemDefinedEvent({
            sequence: 1,
            payload: {
              localPendingCheckoutItemId: "local-pending-item-1",
              name: "",
              price: 45,
              quantitySold: 2,
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-pending-item-1",
        status: "rejected",
      }),
    ]);
    expect(repository.createdPendingCheckoutItems).toEqual([]);
  });

  it("rejects malformed sale clear payloads", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const missingSession = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleClearedEvent({
            sequence: 1,
            payload: { localPosSessionId: "", reason: "Sale cleared" },
          }),
        ],
      }),
    );
    const badReasonRepository = createFakeSyncRepository();
    const badReasonService = createLocalSyncIngestionService({
      repository: badReasonRepository,
      projectionRepository: badReasonRepository,
      now: () => 100,
    });
    const badReason = await badReasonService.ingestBatch(
      buildBatch({
        events: [
          buildSaleClearedEvent({
            sequence: 1,
            payload: { localPosSessionId: "local-session-1", reason: "" },
          }),
        ],
      }),
    );

    expect(missingSession.kind).toBe("ok");
    expect(badReason.kind).toBe("ok");
    if (missingSession.kind !== "ok" || badReason.kind !== "ok") {
      throw new Error("Expected ok result");
    }
    expect(missingSession.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-cleared-1",
        status: "rejected",
      }),
    ]);
    expect(badReason.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-cleared-1",
        status: "rejected",
      }),
    ]);
  });

  it("returns stable outcomes and mappings when a projected batch is retried", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    const batch = buildBatch({
      events: [
        buildSaleCompletedEvent({ sequence: 1 }),
        buildSaleCompletedEvent({ sequence: 2 }),
      ],
    });

    const first = await service.ingestBatch(batch);
    const second = await service.ingestBatch(batch);

    expect(second).toEqual(first);
    expect(repository.createdRegisterSessions).toHaveLength(0);
    expect(repository.createdTransactions).toHaveLength(2);
    expect(repository.createdPaymentAllocations).toHaveLength(2);
  });

  it("returns inventory review work item mappings when a reviewed sale is retried", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    const sale = buildSaleCompletedEvent({
      sequence: 1,
      payload: {
        ...buildSaleCompletedEvent({ sequence: 1 }).payload,
        totals: {
          subtotal: 275,
          tax: 0,
          total: 275,
        },
        items: [
          {
            localTransactionItemId: "local-txn-item-1",
            productId: "product-1" as never,
            productSkuId: "sku-1" as never,
            productName: "Wig Cap",
            productSku: "CAP-1",
            quantity: 11,
            unitPrice: 25,
          },
        ],
        payments: [
          {
            localPaymentId: "local-payment-1",
            method: "cash",
            amount: 275,
            timestamp: 21,
          },
        ],
      },
    });
    const batch = buildBatch({ events: [sale] });

    const first = await service.ingestBatch(batch);
    const second = await service.ingestBatch(batch);

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") {
      throw new Error("Expected ok result");
    }
    for (const result of [first, second]) {
      expect(result.data.accepted).toEqual([
        expect.objectContaining({
          localEventId: "event-sale-completed-1",
          status: "projected",
        }),
      ]);
      expect(result.data.mappings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            localId: "local-txn-1",
            localIdKind: "transaction",
          }),
          expect.objectContaining({
            cloudTable: "operationalWorkItem",
            localId: "local-txn-1:inventory-review",
            localIdKind: "inventoryReviewWorkItem",
          }),
        ]),
      );
      expect(result.data.conflicts).toEqual([]);
    }
    expect(repository.createdTransactions).toHaveLength(1);
  });

  it("projects eligible SKU inventory movement when another SKU needs review", async () => {
    const repository = createFakeSyncRepository({
      skus: [
        {
          _id: "sku-1",
          storeId: "store-1",
          productId: "product-1",
          sku: "CAP-1",
          price: 25,
          quantityAvailable: 0,
          inventoryCount: 0,
          images: [],
        },
        {
          _id: "sku-2",
          storeId: "store-1",
          productId: "product-2",
          sku: "BRUSH-1",
          price: 15,
          quantityAvailable: 4,
          inventoryCount: 4,
          images: [],
        },
      ],
    });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    const sale = buildSaleCompletedEvent({
      sequence: 1,
      payload: {
        ...buildSaleCompletedEvent({ sequence: 1 }).payload,
        totals: {
          subtotal: 55,
          tax: 0,
          total: 55,
        },
        items: [
          {
            localTransactionItemId: "local-blocked-line-1",
            productId: "product-1" as never,
            productSkuId: "sku-1" as never,
            productName: "Wig Cap",
            productSku: "CAP-1",
            quantity: 1,
            unitPrice: 25,
          },
          {
            localTransactionItemId: "local-eligible-line-1",
            productId: "product-2" as never,
            productSkuId: "sku-2" as never,
            productName: "Edge Brush",
            productSku: "BRUSH-1",
            quantity: 2,
            unitPrice: 15,
          },
        ],
        payments: [
          {
            localPaymentId: "local-payment-1",
            method: "cash",
            amount: 55,
            timestamp: 21,
          },
        ],
      },
    });

    const result = await service.ingestBatch(buildBatch({ events: [sale] }));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected ok result");
    }
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-1",
        status: "projected",
      }),
    ]);
    expect(result.data.conflicts).toEqual([]);
    expect(repository.createdServiceWorkItems).toEqual([
      expect.objectContaining({
        type: "synced_sale_inventory_review",
        metadata: expect.objectContaining({
          primaryProductSkuId: "sku-1",
          skippedMutationItems: [
            expect.objectContaining({
              productSkuId: "sku-1",
              reason: "stock_shortfall",
              requestedQuantity: 1,
            }),
          ],
        }),
      }),
    ]);
    expect(repository.recordedSaleInventoryMovements).toEqual([
      expect.objectContaining({
        productSkuId: "sku-2",
        quantity: 2,
        transactionNumber: "LR-001",
      }),
    ]);
    expect(repository.productPatches).toEqual([
      {
        productSkuId: "sku-2",
        patch: {
          inventoryCount: 2,
          quantityAvailable: 2,
        },
      },
    ]);
  });

  it("backfills eligible SKU movement when an already-projected reviewed sale retries", async () => {
    const repository = createFakeSyncRepository({
      skus: [
        {
          _id: "sku-1",
          storeId: "store-1",
          productId: "product-1",
          sku: "CAP-1",
          price: 25,
          quantityAvailable: 0,
          inventoryCount: 0,
          images: [],
        },
        {
          _id: "sku-2",
          storeId: "store-1",
          productId: "product-2",
          sku: "BRUSH-1",
          price: 15,
          quantityAvailable: 4,
          inventoryCount: 4,
          images: [],
        },
      ],
    });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 200,
    });
    const sale = buildSaleCompletedEvent({
      sequence: 1,
      payload: {
        ...buildSaleCompletedEvent({ sequence: 1 }).payload,
        totals: {
          subtotal: 55,
          tax: 0,
          total: 55,
        },
        items: [
          {
            localTransactionItemId: "local-blocked-line-1",
            productId: "product-1" as never,
            productSkuId: "sku-1" as never,
            productName: "Wig Cap",
            productSku: "CAP-1",
            quantity: 1,
            unitPrice: 25,
          },
          {
            localTransactionItemId: "local-eligible-line-1",
            productId: "product-2" as never,
            productSkuId: "sku-2" as never,
            productName: "Edge Brush",
            productSku: "BRUSH-1",
            quantity: 2,
            unitPrice: 15,
          },
        ],
        payments: [
          {
            localPaymentId: "local-payment-1",
            method: "cash",
            amount: 55,
            timestamp: 21,
          },
        ],
      },
    });
    const salePayload = sale.payload as PosLocalSalePayload;
    repository.events.push({
      _id: "sync-event-existing",
      acceptedAt: 100,
      eventType: "sale_completed",
      localEventId: sale.localEventId,
      localRegisterSessionId: sale.localRegisterSessionId ?? "",
      occurredAt: sale.occurredAt,
      payload: {
        ...salePayload,
        receiptNumber: salePayload.localReceiptNumber,
      },
      projectedAt: 100,
      sequence: sale.sequence,
      staffProfileId: sale.staffProfileId as never,
      status: "projected",
      storeId: "store-1" as never,
      submittedAt: 100,
      syncScope: "pos",
      terminalId: "terminal-1" as never,
    });
    repository.mappings.push({
      _id: "mapping-transaction-existing",
      cloudId: "transaction-existing" as never,
      cloudTable: "posTransaction",
      createdAt: 100,
      localEventId: sale.localEventId,
      localId: salePayload.localTransactionId,
      localIdKind: "transaction",
      localRegisterSessionId: sale.localRegisterSessionId ?? "",
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
    });
    repository.conflicts.push({
      _id: "conflict-reviewed-inventory",
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      localRegisterSessionId: sale.localRegisterSessionId ?? "",
      localEventId: sale.localEventId,
      sequence: sale.sequence,
      conflictType: "inventory",
      status: "resolved",
      summary: "Inventory needs manager review for a synced offline sale.",
      details: {
        localTransactionId: salePayload.localTransactionId,
        productSkuId: "sku-1",
        quantityAvailable: 0,
        requestedQuantity: 1,
      },
      createdAt: 100,
      resolvedAt: 150,
    });

    const retry = await service.ingestBatch(buildBatch({ events: [sale] }));

    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") {
      throw new Error("Expected ok result");
    }
    expect(retry.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-1",
        status: "projected",
      }),
    ]);
    expect(repository.recordedSaleInventoryMovements).toEqual([
      expect.objectContaining({
        posTransactionId: "transaction-existing",
        productSkuId: "sku-2",
        quantity: 2,
      }),
    ]);
    expect(repository.productPatches).toEqual([
      {
        productSkuId: "sku-2",
        patch: {
          inventoryCount: 2,
          quantityAvailable: 2,
        },
      },
    ]);

    const secondRetry = await service.ingestBatch(buildBatch({ events: [sale] }));

    expect(secondRetry.kind).toBe("ok");
    if (secondRetry.kind !== "ok") {
      throw new Error("Expected ok result");
    }
    expect(secondRetry.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-1",
        status: "projected",
      }),
    ]);
    expect(repository.recordedSaleInventoryMovements).toEqual([
      expect.objectContaining({
        posTransactionId: "transaction-existing",
        productSkuId: "sku-2",
        quantity: 2,
      }),
    ]);
    expect(repository.productPatches).toEqual([
      {
        productSkuId: "sku-2",
        patch: {
          inventoryCount: 2,
          quantityAvailable: 2,
        },
      },
    ]);
  });

  it("rejects and preserves a projected event when a duplicate local event id has changed data", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    const batch = buildBatch({
      events: [buildSaleCompletedEvent({ sequence: 1 })],
    });

    await service.ingestBatch(batch);
    const duplicate = await service.ingestBatch(
      buildBatch({
        events: [
          {
            ...buildSaleCompletedEvent({ sequence: 0 }),
            localEventId: "event-sale-completed-1",
          },
        ],
      }),
    );

    expect(duplicate.kind).toBe("user_error");
    if (duplicate.kind !== "user_error")
      throw new Error("Expected user error result");
    expect(duplicate.error.message).toBe(
      "POS sync event retry does not match the original local event.",
    );
    expect(repository.events[0]).toEqual(
      expect.objectContaining({
        localEventId: "event-sale-completed-1",
        sequence: 1,
        status: "projected",
      }),
    );
  });

  it("scopes retry mappings and conflicts to the submitting store and terminal", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    const batch = buildBatch({
      events: [buildRegisterOpenedEvent({ sequence: 1 })],
    });

    await service.ingestBatch(batch);
    repository.mappings.push({
      _id: "foreign-mapping",
      storeId: "store-2" as never,
      terminalId: "terminal-2" as never,
      localRegisterSessionId: "local-register-foreign",
      localEventId: "event-register-opened-1",
      localIdKind: "registerSession",
      localId: "local-register-foreign",
      cloudTable: "registerSession",
      cloudId: "register-session-foreign" as never,
      createdAt: 1,
    });
    repository.conflicts.push({
      _id: "foreign-conflict",
      storeId: "store-2" as never,
      terminalId: "terminal-2" as never,
      localRegisterSessionId: "local-register-foreign",
      localEventId: "event-register-opened-1",
      sequence: 1,
      conflictType: "permission",
      status: "needs_review",
      summary: "Foreign conflict",
      details: {},
      createdAt: 1,
    });

    const retry = await service.ingestBatch(batch);

    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") throw new Error("Expected ok result");
    expect(retry.data.mappings).not.toContainEqual(
      expect.objectContaining({ _id: "foreign-mapping" }),
    );
    expect(retry.data.conflicts).not.toContainEqual(
      expect.objectContaining({ _id: "foreign-conflict" }),
    );
  });

  it("reprojects existing conflicted register opens on retry and resolves stale conflicts", async () => {
    const repository = createFakeSyncRepository({
      hasActivePosRole: true,
      existingRegisterSession: null,
    });
    repository.events.push({
      _id: "sync-event-existing",
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      localEventId: "event-register-opened-1",
      localRegisterSessionId: "local-register-1",
      sequence: 1,
      eventType: "register_opened",
      occurredAt: 10,
      staffProfileId: "staff-1" as never,
      payload: {
        openingFloat: 100,
        registerNumber: "1",
      },
      submittedAt: 50,
      acceptedAt: 50,
      status: "conflicted",
      projectedAt: 50,
    });
    repository.conflicts.push({
      _id: "sync-conflict-existing",
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      localRegisterSessionId: "local-register-1",
      localEventId: "event-register-opened-1",
      sequence: 1,
      conflictType: "permission",
      status: "needs_review",
      summary: "Staff access changed before this POS history synced.",
      details: {
        eventType: "register_opened",
      },
      createdAt: 50,
    });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const retry = await service.ingestBatch(
      buildBatch({
        events: [buildRegisterOpenedEvent({ sequence: 1 })],
      }),
    );

    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") throw new Error("Expected ok result");
    expect(retry.data.accepted).toEqual([
      {
        localEventId: "event-register-opened-1",
        sequence: 1,
        status: "projected",
      },
    ]);
    expect(retry.data.conflicts).toEqual([]);
    expect(repository.events[0]).toEqual(
      expect.objectContaining({
        status: "projected",
        submittedAt: 90,
      }),
    );
    expect(repository.conflicts[0]).toEqual(
      expect.objectContaining({
        status: "resolved",
        resolvedAt: 100,
      }),
    );
    expect(repository.createdRegisterSessions).toEqual([
      expect.objectContaining({
        openedByStaffProfileId: "staff-1",
        openingFloat: 100,
        registerNumber: "1",
      }),
    ]);
  });

  it("reuses an active review conflict when a conflicted register open retry still conflicts", async () => {
    const repository = createFakeSyncRepository({ hasActivePosRole: false });
    let now = 100;
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => now,
    });
    const batch = buildBatch({
      events: [buildRegisterOpenedEvent({ sequence: 1 })],
    });

    const first = await service.ingestBatch(batch);
    now = 200;
    const retry = await service.ingestBatch(batch);

    expect(first.kind).toBe("ok");
    expect(retry.kind).toBe("ok");
    if (first.kind !== "ok" || retry.kind !== "ok") {
      throw new Error("Expected ok results");
    }
    expect(first.data.conflicts).toEqual([
      expect.objectContaining({
        _id: "sync-conflict-2",
        conflictType: "permission",
        status: "needs_review",
      }),
    ]);
    expect(retry.data.accepted).toEqual([
      {
        localEventId: "event-register-opened-1",
        sequence: 1,
        status: "conflicted",
      },
    ]);
    expect(retry.data.conflicts).toEqual([
      expect.objectContaining({
        _id: "sync-conflict-2",
        createdAt: 100,
      }),
    ]);
    expect(repository.conflicts).toHaveLength(1);

    const changedDetailsConflict = await repository.createConflict({
      storeId: repository.conflicts[0].storeId,
      terminalId: repository.conflicts[0].terminalId,
      localRegisterSessionId: repository.conflicts[0].localRegisterSessionId,
      localEventId: repository.conflicts[0].localEventId,
      sequence: repository.conflicts[0].sequence,
      conflictType: repository.conflicts[0].conflictType,
      status: "needs_review",
      summary: repository.conflicts[0].summary,
      details: {
        ...repository.conflicts[0].details,
        hasStaffProof: false,
      },
      createdAt: 300,
    });
    expect(changedDetailsConflict._id).not.toBe("sync-conflict-2");
    expect(repository.conflicts).toHaveLength(2);
  });

  it("projects proofless offline register opens and completed sales for active terminal staff", async () => {
    const repository = createFakeSyncRepository({
      existingRegisterSession: null,
    });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    const registerOpened = buildRegisterOpenedEvent({ sequence: 1 });
    const saleCompleted = buildSaleCompletedEvent({ sequence: 2 });
    delete registerOpened.staffProofToken;
    delete saleCompleted.staffProofToken;

    const result = await service.ingestBatch(
      buildBatch({
        events: [registerOpened, saleCompleted],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      {
        localEventId: "event-register-opened-1",
        sequence: 1,
        status: "projected",
      },
      {
        localEventId: "event-sale-completed-2",
        sequence: 2,
        status: "projected",
      },
    ]);
    expect(result.data.conflicts).toEqual([]);
    expect(repository.events).toEqual([
      expect.not.objectContaining({ staffProofTokenHash: expect.any(String) }),
      expect.not.objectContaining({ staffProofTokenHash: expect.any(String) }),
    ]);
    expect(repository.createdRegisterSessions).toEqual([
      expect.objectContaining({
        openedByStaffProfileId: "staff-1",
        openingFloat: 100,
      }),
    ]);
    expect(repository.createdTransactions).toEqual([
      expect.objectContaining({
        registerSessionId: "register-session-1",
        staffProfileId: "staff-1",
        total: 25,
      }),
    ]);
    expect(repository.createdPaymentAllocations).toHaveLength(1);
  });

  it("holds an out-of-order event without projection side effects", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [buildSaleCompletedEvent({ sequence: 25 })],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");

    expect(result.data.held).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-25",
        sequence: 25,
        code: "out_of_order",
      }),
    ]);
    expect(result.data.syncCursor).toMatchObject({
      localRegisterSessionId: "local-register-1",
      acceptedThroughSequence: 0,
    });
    expect(repository.createdTransactions).toHaveLength(0);
  });

  it("rejects mixed-register sync batches before recording events", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildRegisterOpenedEvent({ sequence: 1 }),
          {
            ...buildSaleCompletedEvent({ sequence: 2 }),
            localRegisterSessionId: "local-register-2",
          },
        ],
      }),
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "POS sync batches must contain one local sync cursor.",
      },
    });
    expect(repository.events).toEqual([]);
  });

  it("accepts and projects drawerless expense sync batches on local expense session scope", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [buildExpenseRecordedEvent({ sequence: 1 })],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      {
        localEventId: "event-expense-recorded-1",
        sequence: 1,
        status: "projected",
      },
    ]);
    expect(result.data.syncCursor).toEqual({
      syncScope: "expense",
      localSyncCursorId: "local-expense-session-1",
      localRegisterSessionId: "local-expense-session-1",
      localExpenseSessionId: "local-expense-session-1",
      acceptedThroughSequence: 1,
    });
    expect(repository.events).toEqual([
      expect.objectContaining({
        syncScope: "expense",
        localRegisterSessionId: "local-expense-session-1",
        localExpenseSessionId: "local-expense-session-1",
        eventType: "expense_recorded",
        status: "projected",
      }),
    ]);
    expect(repository.createdExpenseTransactions).toEqual([
      expect.objectContaining({
        transactionNumber: expect.stringMatching(/^\d{6}$/),
        totalValue: 25,
      }),
    ]);
    expect(repository.createdExpenseTransactions).not.toEqual([
      expect.objectContaining({
        transactionNumber: "local-expense-event-1",
      }),
    ]);
  });

  it("projects held expense retries that move from global to scoped sequence", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    const globallySequencedExpense = buildExpenseRecordedEvent({
      sequence: 42,
    });

    await service.ingestBatch(
      buildBatch({
        events: [globallySequencedExpense],
      }),
    );

    const retry = await service.ingestBatch(
      buildBatch({
        events: [
          {
            ...globallySequencedExpense,
            sequence: 1,
          },
        ],
      }),
    );

    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") throw new Error("Expected ok result");
    expect(retry.data.held).toEqual([]);
    expect(retry.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-expense-recorded-42",
        sequence: 1,
        status: "projected",
      }),
    ]);
    expect(retry.data.syncCursor).toEqual({
      syncScope: "expense",
      localSyncCursorId: "local-expense-session-1",
      localRegisterSessionId: "local-expense-session-1",
      localExpenseSessionId: "local-expense-session-1",
      acceptedThroughSequence: 1,
    });
    expect(repository.events).toEqual([
      expect.objectContaining({
        localEventId: "event-expense-recorded-42",
        sequence: 1,
        status: "projected",
      }),
    ]);
    expect(repository.createdExpenseTransactions).toHaveLength(1);
  });

  it("keeps POS register and expense cursors separate when their local ids match", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    const sharedLocalId = "shared-local-session";

    const posResult = await service.ingestBatch(
      buildBatch({
        events: [
          buildRegisterOpenedEvent({
            localRegisterSessionId: sharedLocalId,
            sequence: 1,
          }),
        ],
      }),
    );
    const expenseResult = await service.ingestBatch(
      buildBatch({
        events: [
          buildExpenseRecordedEvent({
            localExpenseSessionId: sharedLocalId,
            sequence: 1,
          }),
        ],
      }),
    );

    expect(posResult.kind).toBe("ok");
    expect(expenseResult.kind).toBe("ok");
    if (posResult.kind !== "ok" || expenseResult.kind !== "ok") {
      throw new Error("Expected ok results");
    }
    expect(posResult.data.syncCursor).toEqual({
      syncScope: "pos",
      localSyncCursorId: sharedLocalId,
      localRegisterSessionId: sharedLocalId,
      acceptedThroughSequence: 1,
    });
    expect(expenseResult.data.syncCursor).toEqual({
      syncScope: "expense",
      localSyncCursorId: sharedLocalId,
      localRegisterSessionId: sharedLocalId,
      localExpenseSessionId: sharedLocalId,
      acceptedThroughSequence: 1,
    });
  });

  it("rejects mixed POS and expense sync batches before recording events", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildRegisterOpenedEvent({ sequence: 1 }),
          buildExpenseRecordedEvent({ sequence: 2 }),
        ],
      }),
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "POS sync batches cannot mix POS and expense events.",
      },
    });
    expect(repository.events).toEqual([]);
  });

  it("rejects expense events missing local expense identity before projection", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildExpenseRecordedEvent({
            sequence: 1,
            localExpenseSessionId: "",
            payload: {
              localExpenseSessionId: "",
              localExpenseEventId: "",
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-expense-recorded-1",
        status: "rejected",
      }),
    ]);
    expect(repository.events).toEqual([
      expect.objectContaining({
        eventType: "expense_recorded",
        status: "rejected",
        rejectionCode: "validation_failed",
        rejectionMessage:
          "Expense sync event is missing required local identifiers.",
      }),
    ]);
    expect(repository.createdTransactions).toHaveLength(0);
  });

  it("rejects expense events with invalid line quantities before projection", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildExpenseRecordedEvent({
            sequence: 1,
            payload: {
              localExpenseSessionId: "local-expense-session-1",
              localExpenseEventId: "local-expense-event-1",
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
                  quantity: -1,
                  unitPrice: 25,
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-expense-recorded-1",
        status: "rejected",
      }),
    ]);
    expect(repository.events).toEqual([
      expect.objectContaining({
        eventType: "expense_recorded",
        status: "rejected",
        rejectionCode: "validation_failed",
        rejectionMessage: "Expense sync line items are invalid.",
      }),
    ]);
    expect(repository.createdExpenseTransactions).toHaveLength(0);
  });

  it("rejects expense events with both pending checkout and provisional import sources before projection", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildExpenseRecordedEvent({
            sequence: 1,
            payload: {
              localExpenseSessionId: "local-expense-session-1",
              localExpenseEventId: "local-expense-event-1",
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
                  pendingCheckoutItemId: "pending-checkout-item-1",
                  inventoryImportProvisionalSkuId: "provisional-import-sku-1",
                  quantity: 1,
                  unitPrice: 25,
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-expense-recorded-1",
        status: "rejected",
      }),
    ]);
    expect(repository.events).toEqual([
      expect.objectContaining({
        eventType: "expense_recorded",
        status: "rejected",
        rejectionCode: "validation_failed",
        rejectionMessage: "Expense sync line items are invalid.",
      }),
    ]);
    expect(repository.createdExpenseTransactions).toHaveLength(0);
  });

  it("projects a previously held event after earlier history syncs", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    await service.ingestBatch(
      buildBatch({
        events: [buildSaleCompletedEvent({ sequence: 2 })],
      }),
    );
    await service.ingestBatch(
      buildBatch({
        events: [buildSaleCompletedEvent({ sequence: 1 })],
      }),
    );

    const retry = await service.ingestBatch(
      buildBatch({
        events: [buildSaleCompletedEvent({ sequence: 2 })],
      }),
    );

    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") throw new Error("Expected ok result");

    expect(retry.data.held).toEqual([]);
    expect(retry.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-2",
        sequence: 2,
        status: "projected",
      }),
    ]);
    expect(retry.data.syncCursor).toMatchObject({
      localRegisterSessionId: "local-register-1",
      acceptedThroughSequence: 2,
    });
    expect(repository.createdTransactions).toHaveLength(2);
    expect(
      repository.events.find((event) => event.sequence === 2)?.status,
    ).toBe("projected");
  });

  it("rejects a terminal/store mismatch before recording events", async () => {
    const repository = createFakeSyncRepository({
      terminal: {
        _id: "terminal-1",
        storeId: "store-2",
        status: "active",
      },
    });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildRegisterOpenedEvent({
            sequence: 1,
            payload: {
              openingFloat: 100,
              registerNumber: "1",
              localRegisterSessionId: "local-register-1",
            },
          }),
        ],
      }),
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "This terminal is not provisioned for POS sync.",
      },
    });
    expect(repository.events).toHaveLength(0);
    expect(repository.createdRegisterSessions).toHaveLength(0);
  });

  it("records permission drift as a reconciliation conflict without projecting the event", async () => {
    const repository = createFakeSyncRepository({
      staff: {
        _id: "staff-1",
        storeId: "store-1",
        status: "inactive",
      },
    });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildRegisterOpenedEvent({
            sequence: 1,
            payload: {
              openingFloat: 100,
              registerNumber: "1",
              localRegisterSessionId: "local-register-1",
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");

    expect(result.data.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "Staff access changed before this POS history synced.",
      }),
    ]);
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-register-opened-1",
        status: "conflicted",
      }),
    ]);
    expect(repository.createdRegisterSessions).toHaveLength(0);
  });

  it("records permission drift when active staff no longer has a POS role", async () => {
    const repository = createFakeSyncRepository({ hasActivePosRole: false });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [buildSaleCompletedEvent({ sequence: 1 })],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");

    expect(result.data.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        details: expect.objectContaining({
          eventType: "sale_completed",
          staffProfileId: "staff-1",
        }),
      }),
    ]);
    expect(repository.createdRegisterSessions).toHaveLength(0);
    expect(repository.roleChecks[0]).toEqual(
      expect.objectContaining({
        allowedRoles: ["cashier", "manager"],
      }),
    );
  });

  it("does not project completed sales when staff permission drift needs review", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    await service.ingestBatch(
      buildBatch({
        events: [buildSaleCompletedEvent({ sequence: 1 })],
      }),
    );
    repository.hasActivePosRole = async () => false;

    const result = await service.ingestBatch(
      buildBatch({
        events: [buildSaleCompletedEvent({ sequence: 2 })],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted[0]).toEqual(
      expect.objectContaining({
        localEventId: "event-sale-completed-2",
        status: "conflicted",
      }),
    );
    expect(repository.createdTransactions).toHaveLength(1);
    expect(result.data.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conflictType: "permission",
          localEventId: "event-sale-completed-2",
        }),
      ]),
    );
    expect(result.data.syncCursor).toMatchObject({
      localRegisterSessionId: "local-register-1",
      acceptedThroughSequence: 2,
    });
  });

  it("projects sales for active terminal staff even when linked to another user", async () => {
    const repository = createFakeSyncRepository({
      staff: {
        _id: "staff-1",
        storeId: "store-1",
        status: "active",
        linkedUserId: "athena-user-2",
      },
    });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({ events: [buildSaleCompletedEvent({ sequence: 1 })] }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-1",
        status: "projected",
      }),
    ]);
    expect(result.data.conflicts).toEqual([]);
    expect(repository.createdPaymentAllocations).toHaveLength(1);
    expect(repository.createdTransactions).toHaveLength(1);
  });

  it("accepts a stable contiguous local sequence with different actor staff profiles", async () => {
    const repository = createFakeSyncRepository({
      staffProfiles: [
        {
          _id: "staff-1",
          storeId: "store-1",
          status: "active",
          linkedUserId: "manager-user-1",
        },
        {
          _id: "staff-2",
          storeId: "store-1",
          status: "active",
          linkedUserId: "cashier-user-2",
        },
      ],
      validateLocalStaffProof: async (args) =>
        args.storeId === "store-1" &&
        args.terminalId === "terminal-1" &&
        ((args.staffProfileId === "staff-1" &&
          args.token === "proof-token-1") ||
          (args.staffProfileId === "staff-2" &&
            args.token === "proof-token-2")),
    });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildRegisterOpenedEvent({ sequence: 1 }),
          buildSaleCompletedEvent({
            sequence: 2,
            staffProfileId: "staff-2" as never,
            staffProofToken: "proof-token-2",
          }),
          {
            localEventId: "event-register-closed-3",
            localRegisterSessionId: "local-register-1",
            sequence: 3,
            eventType: "register_closed",
            occurredAt: 30,
            staffProfileId: "staff-1" as never,
            staffProofToken: "proof-token-1",
            payload: { countedCash: 125 },
          },
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.held).toEqual([]);
    expect(result.data.accepted).toEqual([
      expect.objectContaining({ sequence: 1, status: "projected" }),
      expect.objectContaining({ sequence: 2, status: "projected" }),
      expect.objectContaining({ sequence: 3, status: "projected" }),
    ]);
    expect(result.data.syncCursor).toMatchObject({
      localRegisterSessionId: "local-register-1",
      acceptedThroughSequence: 3,
    });
    expect(repository.events).toEqual([
      expect.objectContaining({ sequence: 1, staffProfileId: "staff-1" }),
      expect.objectContaining({ sequence: 2, staffProfileId: "staff-2" }),
      expect.objectContaining({ sequence: 3, staffProfileId: "staff-1" }),
    ]);
    expect(repository.createdTransactions).toEqual([
      expect.objectContaining({ staffProfileId: "staff-2" }),
    ]);
    expect(repository.createdPaymentAllocations).toEqual([
      expect.objectContaining({ actorStaffProfileId: "staff-2" }),
    ]);
    expect(repository.registerSessionPatches.at(-1)).toEqual(
      expect.objectContaining({
        patch: expect.objectContaining({
          closedByStaffProfileId: "staff-1",
          closeoutRecords: [
            expect.objectContaining({
              actorStaffProfileId: "staff-1",
            }),
          ],
        }),
      }),
    );
  });

  it("projects valid local sale items when the submitted display SKU is blank", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({
            sequence: 1,
            payload: {
              ...buildSaleCompletedEvent({ sequence: 1 }).payload,
              items: [
                {
                  localTransactionItemId: "local-txn-item-1",
                  productId: "product-1",
                  productSkuId: "sku-1",
                  productName: "Wig Cap",
                  productSku: "",
                  quantity: 1,
                  unitPrice: 25,
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-1",
        status: "projected",
      }),
    ]);
    expect(result.data.conflicts).toEqual([]);
    expect(repository.createdTransactions).toHaveLength(1);
  });

  it("projects a pending offline sale after the register and POS session were opened online", async () => {
    const repository = createFakeSyncRepository({
      validCloudIds: new Set(["pos-session-1"]),
      existingPosSession: {
        _id: "pos-session-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      existingRegisterSession: {
        _id: "register-session-1",
        closeoutRecords: [],
        expectedCash: 100,
        registerNumber: "1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    repository.mappings.push({
      _id: "sync-mapping-online-pos-session",
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      localRegisterSessionId: "local-register-1",
      localEventId: "event-session-started-online",
      localIdKind: "posSession",
      localId: "pos-session-1",
      cloudTable: "posSession",
      cloudId: "pos-session-1" as never,
      createdAt: 1,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({
            localRegisterSessionId: "local-register-1",
            sequence: 1,
            payload: {
              ...buildSaleCompletedEvent({ sequence: 1 }).payload,
              localPosSessionId: "pos-session-1",
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.held).toEqual([]);
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        sequence: 1,
        status: "projected",
      }),
    ]);
    expect(repository.createdRegisterSessions).toHaveLength(0);
    expect(repository.createdTransactions).toHaveLength(1);
    expect(result.data.syncCursor).toMatchObject({
      localRegisterSessionId: "local-register-1",
      acceptedThroughSequence: 1,
    });
  });

  it("conflicts sales when an unmapped local register id is a cloud register session id", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({
            sequence: 1,
            localRegisterSessionId: "register-session-1",
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-1",
        status: "conflicted",
      }),
    ]);
    expect(result.data.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "Register session mapping is missing for synced POS history.",
      }),
    ]);
    expect(repository.createdTransactions).toEqual([]);
  });

  it("conflicts register closeouts when an unmapped local register id is a cloud register session id", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          {
            localEventId: "event-register-closed-1",
            localRegisterSessionId: "register-session-1",
            sequence: 1,
            eventType: "register_closed",
            occurredAt: 20,
            staffProfileId: "staff-1" as never,
            staffProofToken: "proof-token-1",
            payload: { countedCash: 100 },
          },
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-register-closed-1",
        status: "conflicted",
      }),
    ]);
    expect(result.data.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "Register session mapping is missing for synced POS history.",
      }),
    ]);
  });

  it("conflicts register reopens when an unmapped local register id is a cloud register session id", async () => {
    const repository = createFakeSyncRepository({
      staff: {
        _id: "staff-1",
        storeId: "store-1",
        status: "active",
        linkedUserId: "athena-user-2",
      },
    });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          {
            localEventId: "event-register-reopened-1",
            localRegisterSessionId: "register-session-1",
            sequence: 1,
            eventType: "register_reopened",
            occurredAt: 30,
            staffProfileId: "staff-1" as never,
            staffProofToken: "proof-token-1",
            payload: { reason: "Corrected count" },
          },
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-register-reopened-1",
        status: "conflicted",
      }),
    ]);
    expect(result.data.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
      }),
    ]);
    expect(repository.createdRegisterSessions).toEqual([]);
  });

  it("projects register opens for active terminal staff linked to another user", async () => {
    const repository = createFakeSyncRepository({
      staff: {
        _id: "staff-1",
        storeId: "store-1",
        status: "active",
        linkedUserId: "athena-user-2",
      },
    });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildRegisterOpenedEvent({
            sequence: 1,
            payload: {
              openingFloat: 100,
              registerNumber: "1",
              localRegisterSessionId: "local-register-1",
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-register-opened-1",
        status: "projected",
      }),
    ]);
    expect(result.data.conflicts).toEqual([]);
    expect(repository.createdRegisterSessions).toHaveLength(1);
  });

  it("rejects malformed sale payloads before projection side effects", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({ sequence: 1 }),
          buildSaleCompletedEvent({
            sequence: 2,
            payload: {
              ...buildSaleCompletedEvent({ sequence: 2 }).payload,
              items: [
                {
                  localTransactionItemId: "local-txn-item-1",
                  productId: "product-1",
                  productSkuId: "sku-1",
                  productName: "Wig Cap",
                  productSku: "CAP-1",
                  quantity: -1,
                  unitPrice: 25,
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");

    expect(result.data.accepted.at(-1)).toEqual(
      expect.objectContaining({
        localEventId: "event-sale-completed-2",
        status: "rejected",
      }),
    );
    expect(repository.createdTransactions).toHaveLength(1);
  });

  it("rejects malformed pending checkout alias state before projection side effects", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({ sequence: 1 }),
          buildSaleCompletedEvent({
            sequence: 2,
            payload: {
              ...buildSaleCompletedEvent({ sequence: 2 }).payload,
              items: [
                {
                  localTransactionItemId: "local-txn-item-1",
                  productId: "product-1",
                  productSkuId: "sku-1",
                  pendingCheckoutItemId: "pending-checkout-item-1",
                  pendingCheckoutAliasState: "linked" as never,
                  productName: "Wig Cap",
                  productSku: "CAP-1",
                  quantity: 1,
                  unitPrice: 25,
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");

    expect(result.data.accepted.at(-1)).toEqual(
      expect.objectContaining({
        localEventId: "event-sale-completed-2",
        status: "rejected",
      }),
    );
    expect(repository.createdTransactions).toHaveLength(1);
  });

  it("rejects non-cash overpayments before projection side effects", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({ sequence: 1 }),
          buildSaleCompletedEvent({
            sequence: 2,
            payload: {
              ...buildSaleCompletedEvent({ sequence: 2 }).payload,
              payments: [
                {
                  localPaymentId: "local-payment-1",
                  method: "card",
                  amount: 30,
                  timestamp: 21,
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted.at(-1)).toEqual(
      expect.objectContaining({
        localEventId: "event-sale-completed-2",
        status: "rejected",
      }),
    );
    expect(repository.createdTransactions).toHaveLength(1);
    expect(repository.events.at(-1)).toEqual(
      expect.objectContaining({
        rejectionMessage:
          "POS sale non-cash payments cannot exceed the sale total.",
      }),
    );
  });

  it("rejects malformed cash payment rows instead of crashing ingestion", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({ sequence: 1 }),
          buildSaleCompletedEvent({
            sequence: 2,
            payload: {
              ...buildSaleCompletedEvent({ sequence: 2 }).payload,
              payments: [
                {
                  localPaymentId: "local-payment-1",
                  method: "cash",
                  amount: "25",
                  timestamp: 21,
                },
                {
                  localPaymentId: "local-payment-2",
                  method: "card",
                  amount: 30,
                  timestamp: 22,
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted.at(-1)).toEqual(
      expect.objectContaining({
        localEventId: "event-sale-completed-2",
        status: "rejected",
      }),
    );
    expect(repository.events.at(-1)).toEqual(
      expect.objectContaining({
        rejectionMessage: "POS sale payment records are invalid.",
      }),
    );
    expect(repository.createdTransactions).toHaveLength(1);
  });

  it("rejects malformed optional local payment ids before projection side effects", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({ sequence: 1 }),
          buildSaleCompletedEvent({
            sequence: 2,
            payload: {
              ...buildSaleCompletedEvent({ sequence: 2 }).payload,
              payments: [
                {
                  localPaymentId: { nested: "bad" },
                  method: "cash",
                  amount: 25,
                  timestamp: 21,
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted.at(-1)).toEqual(
      expect.objectContaining({
        localEventId: "event-sale-completed-2",
        status: "rejected",
      }),
    );
    expect(repository.createdTransactions).toHaveLength(1);
  });

  it("rejects malformed optional local item ids before projection side effects", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({ sequence: 1 }),
          buildSaleCompletedEvent({
            sequence: 2,
            payload: {
              ...buildSaleCompletedEvent({ sequence: 2 }).payload,
              items: [
                {
                  localTransactionItemId: ["bad"],
                  productId: "product-1" as never,
                  productSkuId: "sku-1" as never,
                  productName: "Wig Cap",
                  productSku: "CAP-1",
                  quantity: 1,
                  unitPrice: 25,
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted.at(-1)).toEqual(
      expect.objectContaining({
        localEventId: "event-sale-completed-2",
        status: "rejected",
      }),
    );
    expect(repository.createdTransactions).toHaveLength(1);
  });

  it("rejects malformed provisional import row ids before projection side effects", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({ sequence: 1 }),
          buildSaleCompletedEvent({
            sequence: 2,
            payload: {
              ...buildSaleCompletedEvent({ sequence: 2 }).payload,
              items: [
                {
                  localTransactionItemId: "local-txn-item-1",
                  productId: "product-1" as never,
                  productSkuId: "sku-1" as never,
                  inventoryImportProvisionalSkuId: "",
                  productName: "Wig Cap",
                  productSku: "CAP-1",
                  quantity: 1,
                  unitPrice: 25,
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted.at(-1)).toEqual(
      expect.objectContaining({
        localEventId: "event-sale-completed-2",
        status: "rejected",
      }),
    );
    expect(repository.createdTransactions).toHaveLength(1);
  });

  it("consumes a rejected expected sequence so later history can sync", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({ sequence: 1 }),
          buildSaleCompletedEvent({
            sequence: 2,
            payload: {
              ...buildSaleCompletedEvent({ sequence: 2 }).payload,
              items: [],
            },
          }),
          buildSaleCompletedEvent({ sequence: 3 }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");

    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-1",
        status: "projected",
      }),
      expect.objectContaining({
        localEventId: "event-sale-completed-2",
        status: "rejected",
      }),
      expect.objectContaining({
        localEventId: "event-sale-completed-3",
        status: "projected",
      }),
    ]);
    expect(result.data.held).toEqual([]);
    expect(result.data.syncCursor.acceptedThroughSequence).toBe(3);
    expect(repository.createdTransactions).toHaveLength(2);
  });

  it("returns stable rejected outcomes when malformed accepted-history events retry", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    const malformedSale = buildSaleCompletedEvent({
      sequence: 2,
      payload: {
        ...buildSaleCompletedEvent({ sequence: 2 }).payload,
        items: [],
      },
    });

    await service.ingestBatch(
      buildBatch({
        events: [buildSaleCompletedEvent({ sequence: 1 }), malformedSale],
      }),
    );
    const retry = await service.ingestBatch(
      buildBatch({
        events: [malformedSale, buildSaleCompletedEvent({ sequence: 3 })],
      }),
    );

    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") throw new Error("Expected ok result");

    expect(retry.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-2",
        status: "rejected",
      }),
      expect.objectContaining({
        localEventId: "event-sale-completed-3",
        status: "projected",
      }),
    ]);
    expect(retry.data.held).toEqual([]);
    expect(retry.data.syncCursor.acceptedThroughSequence).toBe(3);
    expect(repository.createdTransactions).toHaveLength(2);
  });

  it("consumes a rejected held-event retry so later history can sync", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    const malformedSale = buildSaleCompletedEvent({
      sequence: 2,
      payload: {
        ...buildSaleCompletedEvent({ sequence: 2 }).payload,
        items: [],
      },
    });

    await service.ingestBatch(buildBatch({ events: [malformedSale] }));
    await service.ingestBatch(
      buildBatch({ events: [buildRegisterOpenedEvent({ sequence: 1 })] }),
    );
    const retry = await service.ingestBatch(
      buildBatch({
        events: [malformedSale, buildSaleCompletedEvent({ sequence: 3 })],
      }),
    );

    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") throw new Error("Expected ok result");

    expect(retry.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-2",
        status: "rejected",
      }),
      expect.objectContaining({
        localEventId: "event-sale-completed-3",
        status: "projected",
      }),
    ]);
    expect(retry.data.held).toEqual([]);
    expect(retry.data.syncCursor.acceptedThroughSequence).toBe(3);
    expect(repository.createdTransactions).toHaveLength(1);
  });

  it("rejects invalid sequence values before holding events out of order", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [buildRegisterOpenedEvent({ sequence: 0 })],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");

    expect(result.data.held).toEqual([]);
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-register-opened-0",
        sequence: 0,
        status: "rejected",
      }),
    ]);
    expect(result.data.syncCursor.acceptedThroughSequence).toBe(0);
    expect(repository.events[0]).toEqual(
      expect.objectContaining({
        status: "rejected",
        rejectionMessage: "POS sync event sequence is invalid.",
      }),
    );
  });

  it("does not let invalid future-envelope rejects advance the contiguous cursor", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    const malformedFutureEvent = {
      ...buildSaleCompletedEvent({ sequence: 25 }),
      occurredAt: 0,
    };

    await service.ingestBatch(
      buildBatch({
        events: [malformedFutureEvent],
      }),
    );
    const duplicateReject = await service.ingestBatch(
      buildBatch({
        events: [malformedFutureEvent],
      }),
    );

    expect(duplicateReject.kind).toBe("ok");
    if (duplicateReject.kind !== "ok") throw new Error("Expected ok result");
    expect(duplicateReject.data.syncCursor.acceptedThroughSequence).toBe(0);

    const retry = await service.ingestBatch(
      buildBatch({ events: [buildSaleCompletedEvent({ sequence: 1 })] }),
    );

    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") throw new Error("Expected ok result");
    expect(retry.data.held).toEqual([]);
    expect(retry.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-1",
        sequence: 1,
        status: "projected",
      }),
    ]);
    expect(retry.data.syncCursor.acceptedThroughSequence).toBe(1);
  });

  it("advances past an expected envelope reject before processing the next event", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          {
            ...buildRegisterOpenedEvent({ sequence: 1 }),
            occurredAt: 0,
          },
          buildSaleCompletedEvent({ sequence: 2 }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.held).toEqual([]);
    expect(result.data.accepted).toEqual([
      expect.objectContaining({ sequence: 1, status: "rejected" }),
      expect.objectContaining({ sequence: 2, status: "projected" }),
    ]);
    expect(result.data.syncCursor.acceptedThroughSequence).toBe(2);
  });

  it("advances past rejected held envelope retries before processing later events", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    const malformedSale = {
      ...buildSaleCompletedEvent({ sequence: 2 }),
      occurredAt: 0,
    };

    await service.ingestBatch(buildBatch({ events: [malformedSale] }));
    await service.ingestBatch(
      buildBatch({ events: [buildRegisterOpenedEvent({ sequence: 1 })] }),
    );
    const retry = await service.ingestBatch(
      buildBatch({
        events: [malformedSale, buildSaleCompletedEvent({ sequence: 3 })],
      }),
    );

    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") throw new Error("Expected ok result");
    expect(retry.data.held).toEqual([]);
    expect(retry.data.accepted).toEqual([
      expect.objectContaining({ sequence: 2, status: "rejected" }),
      expect.objectContaining({ sequence: 3, status: "projected" }),
    ]);
    expect(retry.data.syncCursor.acceptedThroughSequence).toBe(3);
  });

  it("rejects held event retries when immutable event contents changed", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    await service.ingestBatch(
      buildBatch({ events: [buildSaleCompletedEvent({ sequence: 2 })] }),
    );
    const retry = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({
            sequence: 2,
            staffProfileId: "staff-2" as never,
          }),
        ],
      }),
    );

    expect(retry).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message:
          "POS sync event retry does not match the original local event.",
      },
    });
    expect(repository.events[0]).toEqual(
      expect.objectContaining({
        staffProfileId: "staff-1",
        status: "held",
      }),
    );
  });

  it("allows held event retries when only the staff proof token changed", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    await service.ingestBatch(
      buildBatch({ events: [buildSaleCompletedEvent({ sequence: 2 })] }),
    );
    const retry = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({
            sequence: 2,
            staffProofToken: "proof-token-2",
          }),
        ],
      }),
    );

    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") throw new Error("Expected ok result");
    expect(retry.data.held).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-2",
        sequence: 2,
      }),
    ]);
    expect(repository.events[0]).toEqual(
      expect.objectContaining({
        staffProofTokenHash: await hashPosLocalStaffProofToken("proof-token-1"),
        status: "held",
      }),
    );
    expect(repository.events[0]).not.toHaveProperty("staffProofToken");
  });

  it("validates held event retries against the original server acceptance time", async () => {
    const proofValidationTimes: number[] = [];
    const repository = createFakeSyncRepository({
      validateLocalStaffProof: async (args) => {
        proofValidationTimes.push(args.now);
        return args.token === "proof-token-1" && args.now === 100;
      },
    });
    let now = 100;
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => now,
    });

    await service.ingestBatch(
      buildBatch({ events: [buildSaleCompletedEvent({ sequence: 2 })] }),
    );

    now = 200;
    const retry = await service.ingestBatch(
      buildBatch({
        events: [
          buildRegisterOpenedEvent({ sequence: 1 }),
          buildSaleCompletedEvent({ sequence: 2 }),
        ],
      }),
    );

    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") throw new Error("Expected ok result");
    expect(retry.data.accepted).toEqual([
      expect.objectContaining({ sequence: 1, status: "conflicted" }),
      expect.objectContaining({ sequence: 2, status: "projected" }),
    ]);
    expect(repository.events.find((event) => event.sequence === 2)).toEqual(
      expect.objectContaining({
        acceptedAt: 100,
        status: "projected",
      }),
    );
    expect(proofValidationTimes).toContain(100);
  });

  it("accepts held event retries with equivalent payload content in a different key order", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    const originalSale = buildSaleCompletedEvent({
      sequence: 2,
      payload: {
        localPosSessionId: "local-session-1",
        localTransactionId: "local-txn-2",
        localReceiptNumber: "LR-002",
        registerNumber: "1",
        totals: { subtotal: 25, tax: 0, total: 25 },
        items: [
          {
            localTransactionItemId: "local-txn-item-2",
            productId: "product-1" as never,
            productSkuId: "sku-1" as never,
            productName: "Wig Cap",
            productSku: "CAP-1",
            quantity: 1,
            unitPrice: 25,
          },
        ],
        payments: [
          {
            localPaymentId: "local-payment-2",
            method: "cash",
            amount: 25,
            timestamp: 21,
          },
        ],
      },
    });
    const reorderedSale = buildSaleCompletedEvent({
      sequence: 2,
      payload: {
        payments: [
          {
            timestamp: 21,
            amount: 25,
            method: "cash",
            localPaymentId: "local-payment-2",
          },
        ],
        items: [
          {
            unitPrice: 25,
            quantity: 1,
            productSku: "CAP-1",
            productName: "Wig Cap",
            productSkuId: "sku-1" as never,
            productId: "product-1" as never,
            localTransactionItemId: "local-txn-item-2",
          },
        ],
        totals: { total: 25, tax: 0, subtotal: 25 },
        registerNumber: "1",
        localReceiptNumber: "LR-002",
        localTransactionId: "local-txn-2",
        localPosSessionId: "local-session-1",
      },
    });

    await service.ingestBatch(buildBatch({ events: [originalSale] }));
    const retry = await service.ingestBatch(
      buildBatch({
        events: [buildRegisterOpenedEvent({ sequence: 1 }), reorderedSale],
      }),
    );

    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") throw new Error("Expected ok result");
    expect(retry.data.accepted).toEqual([
      expect.objectContaining({ sequence: 1 }),
      expect.objectContaining({ sequence: 2, status: "projected" }),
    ]);
  });

  it("rejects malformed held retries without mutating the original held event", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    await service.ingestBatch(
      buildBatch({ events: [buildSaleCompletedEvent({ sequence: 2 })] }),
    );
    const retry = await service.ingestBatch(
      buildBatch({
        events: [
          {
            ...buildSaleCompletedEvent({ sequence: 0 }),
            localEventId: "event-sale-completed-2",
          },
        ],
      }),
    );

    expect(retry).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message:
          "POS sync event retry does not match the original local event.",
      },
    });
    expect(repository.events[0]).toEqual(
      expect.objectContaining({
        sequence: 2,
        status: "held",
      }),
    );
  });

  it("rejects malformed optional register lifecycle fields before projection", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          {
            ...buildRegisterOpenedEvent({ sequence: 1 }),
            payload: {
              openingFloat: 100,
              registerNumber: 123,
            },
          },
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-register-opened-1",
        status: "rejected",
      }),
    ]);
    expect(repository.createdRegisterSessions).toEqual([]);
  });

  it("accepts projected retries with canonicalized optional lifecycle strings", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });
    const event = {
      ...buildRegisterOpenedEvent({ sequence: 1 }),
      payload: {
        openingFloat: 100,
        registerNumber: " 1 ",
        notes: " Morning drawer ",
      },
    };

    const first = await service.ingestBatch(buildBatch({ events: [event] }));
    const retry = await service.ingestBatch(buildBatch({ events: [event] }));

    expect(first.kind).toBe("ok");
    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") throw new Error("Expected ok result");
    expect(retry.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-register-opened-1",
        status: "projected",
      }),
    ]);
    expect(repository.createdRegisterSessions).toHaveLength(1);
  });

  it("rejects malformed optional closeout notes before register patching", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildRegisterOpenedEvent({ sequence: 1 }),
          {
            localEventId: "event-register-closed-2",
            localRegisterSessionId: "local-register-1",
            sequence: 2,
            eventType: "register_closed",
            occurredAt: 20,
            staffProfileId: "staff-1" as never,
            staffProofToken: "proof-token-1",
            payload: { countedCash: 100, notes: 123 },
          },
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({ status: "projected" }),
      expect.objectContaining({
        localEventId: "event-register-closed-2",
        status: "rejected",
      }),
    ]);
    expect(repository.registerSessionPatches).toEqual([]);
  });

  it("rejects malformed optional reopen reasons before projection", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          {
            localEventId: "event-register-reopened-1",
            localRegisterSessionId: "local-register-1",
            sequence: 1,
            eventType: "register_reopened",
            occurredAt: 30,
            staffProfileId: "staff-1" as never,
            staffProofToken: "proof-token-1",
            payload: { reason: 123 },
          },
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-register-reopened-1",
        status: "rejected",
      }),
    ]);
    expect(repository.registerSessionPatches).toEqual([]);
  });

  it("accepts closeout uploads without counted cash and defaults projection to expected cash", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildRegisterOpenedEvent({ sequence: 1 }),
          {
            localEventId: "event-register-closed-2",
            localRegisterSessionId: "local-register-1",
            sequence: 2,
            eventType: "register_closed",
            occurredAt: 20,
            staffProfileId: "staff-1" as never,
            staffProofToken: "proof-token-1",
            payload: { notes: "Closed drawer" },
          },
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-register-opened-1",
        status: "projected",
      }),
      expect.objectContaining({
        localEventId: "event-register-closed-2",
        status: "projected",
      }),
    ]);
    expect(repository.registerSessionPatches).toEqual([
      expect.objectContaining({
        patch: expect.objectContaining({
          countedCash: 100,
          variance: 0,
        }),
      }),
    ]);
  });

  it("rejects duplicate projected event ids when retry contents changed", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    await service.ingestBatch(
      buildBatch({ events: [buildSaleCompletedEvent({ sequence: 1 })] }),
    );
    const retry = await service.ingestBatch(
      buildBatch({
        events: [
          {
            ...buildSaleCompletedEvent({
              sequence: 1,
              staffProfileId: "staff-2" as never,
            }),
            localEventId: "event-sale-completed-1",
          },
        ],
      }),
    );

    expect(retry).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message:
          "POS sync event retry does not match the original local event.",
      },
    });
  });

  it("accepts duplicate projected event retries when only the staff proof token changed", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    await service.ingestBatch(
      buildBatch({ events: [buildSaleCompletedEvent({ sequence: 1 })] }),
    );
    const retry = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({
            sequence: 1,
            staffProofToken: "proof-token-2",
          }),
        ],
      }),
    );

    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") throw new Error("Expected ok result");
    expect(retry.data.accepted).toEqual([
      expect.objectContaining({
        localEventId: "event-sale-completed-1",
        sequence: 1,
        status: "projected",
      }),
    ]);
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]).toEqual(
      expect.objectContaining({
        staffProofTokenHash: await hashPosLocalStaffProofToken("proof-token-1"),
        status: "projected",
      }),
    );
  });

  it("rejects malformed nested Convex ids before projection side effects", async () => {
    const repository = createFakeSyncRepository({
      invalidCloudIds: new Set(["not-a-product-id"]),
    });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildSaleCompletedEvent({ sequence: 1 }),
          buildSaleCompletedEvent({
            sequence: 2,
            payload: {
              ...buildSaleCompletedEvent({ sequence: 2 }).payload,
              items: [
                {
                  localTransactionItemId: "local-txn-item-1",
                  productId: "not-a-product-id" as never,
                  productSkuId: "sku-1" as never,
                  productName: "Wig Cap",
                  productSku: "CAP-1",
                  quantity: 1,
                  unitPrice: 25,
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      expect.objectContaining({ sequence: 1, status: "projected" }),
      expect.objectContaining({ sequence: 2, status: "rejected" }),
    ]);
    expect(repository.createdTransactions).toHaveLength(1);
    expect(repository.events[1]).toEqual(
      expect.objectContaining({
        rejectionMessage: "POS sale product reference is invalid.",
        status: "rejected",
      }),
    );
  });

  it.each([
    {
      invalidId: "not-a-customer-id",
      payload: {
        ...buildSaleCompletedEvent({ sequence: 2 }).payload,
        customerProfileId: "not-a-customer-id",
      },
      rejectionMessage: "POS sale customer reference is invalid.",
    },
    {
      invalidId: "not-a-sku-id",
      payload: {
        ...buildSaleCompletedEvent({ sequence: 2 }).payload,
        items: [
          {
            localTransactionItemId: "local-txn-item-1",
            productId: "product-1" as never,
            productSkuId: "not-a-sku-id" as never,
            productName: "Wig Cap",
            productSku: "CAP-1",
            quantity: 1,
            unitPrice: 25,
          },
        ],
      },
      rejectionMessage: "POS sale product SKU reference is invalid.",
    },
    {
      invalidId: "not-a-product-id",
      payload: {
        ...buildSaleCompletedEvent({ sequence: 2 }).payload,
        items: [
          {
            localTransactionItemId: "local-txn-item-1",
            productId: "not-a-product-id" as never,
            productSkuId: "sku-1" as never,
            pendingCheckoutItemId: "pending-checkout-item-1" as never,
            pendingCheckoutAliasState: "linked_to_catalog" as const,
            productName: "Wig Cap",
            productSku: "CAP-1",
            quantity: 1,
            unitPrice: 25,
          },
        ],
      },
      rejectionMessage: "POS sale product reference is invalid.",
    },
    {
      invalidId: "not-a-sku-id",
      payload: {
        ...buildSaleCompletedEvent({ sequence: 2 }).payload,
        items: [
          {
            localTransactionItemId: "local-txn-item-1",
            productId: "product-1" as never,
            productSkuId: "not-a-sku-id" as never,
            pendingCheckoutItemId: "pending-checkout-item-1" as never,
            pendingCheckoutAliasState: "linked_to_catalog" as const,
            productName: "Wig Cap",
            productSku: "CAP-1",
            quantity: 1,
            unitPrice: 25,
          },
        ],
      },
      rejectionMessage: "POS sale product SKU reference is invalid.",
    },
    {
      invalidId: "not-a-service-catalog-id",
      payload: {
        ...buildSaleCompletedEvent({ sequence: 2 }).payload,
        customerProfileId: "customer-1" as never,
        totals: { subtotal: 75, tax: 0, total: 75 },
        items: [],
        serviceLines: [
          buildServiceLine({
            serviceCatalogId: "not-a-service-catalog-id" as never,
          }),
        ],
        payments: [
          {
            localPaymentId: "local-payment-2",
            method: "cash",
            amount: 75,
            timestamp: 21,
          },
        ],
      },
      rejectionMessage: "POS sale service catalog reference is invalid.",
    },
  ])(
    "rejects malformed nested $invalidId before projection",
    async ({ invalidId, payload, rejectionMessage }) => {
      const repository = createFakeSyncRepository({
        invalidCloudIds: new Set([invalidId]),
      });
      const service = createLocalSyncIngestionService({
        repository,
        projectionRepository: repository,
        now: () => 100,
      });

      const result = await service.ingestBatch(
        buildBatch({
          events: [
            buildRegisterOpenedEvent({ sequence: 1 }),
            buildSaleCompletedEvent({ sequence: 2, payload }),
          ],
        }),
      );

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error("Expected ok result");
      expect(result.data.accepted[1]).toEqual(
        expect.objectContaining({ sequence: 2, status: "rejected" }),
      );
      expect(repository.createdTransactions).toEqual([]);
      expect(repository.events[1]).toEqual(
        expect.objectContaining({
          rejectionMessage,
          status: "rejected",
        }),
      );
    },
  );

  it("accepts service-only sales at the ingestion boundary", async () => {
    const repository = createFakeSyncRepository();
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildRegisterOpenedEvent({ sequence: 1 }),
          buildSaleCompletedEvent({
            sequence: 2,
            payload: {
              ...buildSaleCompletedEvent({ sequence: 2 }).payload,
              customerProfileId: "customer-1" as never,
              totals: { subtotal: 75, tax: 0, total: 75 },
              items: [],
              serviceLines: [buildServiceLine()],
              payments: [
                {
                  localPaymentId: "local-payment-service",
                  method: "cash",
                  amount: 75,
                  timestamp: 21,
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted[1]).toEqual(
      expect.objectContaining({ sequence: 2, status: "projected" }),
    );
    expect(repository.createdTransactions).toHaveLength(1);
    expect(repository.createdPaymentAllocations).toEqual([
      expect.objectContaining({
        targetType: "service_case",
        amount: 75,
        registerSessionId: "register-session-1",
      }),
    ]);
  });

  it("conflicts cashier-only attempts to sync manager-only register reopen events", async () => {
    const repository = createFakeSyncRepository({
      hasActivePosRole: false,
    });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildRegisterOpenedEvent({ sequence: 1 }),
          {
            localEventId: "event-register-reopened-2",
            localRegisterSessionId: "local-register-1",
            sequence: 2,
            eventType: "register_reopened",
            occurredAt: 30,
            staffProfileId: "staff-1" as never,
            staffProofToken: "proof-token-1",
            payload: { reason: "Corrected count" },
          },
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted[1]).toEqual(
      expect.objectContaining({ sequence: 2, status: "conflicted" }),
    );
    expect(result.data.conflicts[0]).toEqual(
      expect.objectContaining({
        conflictType: "permission",
        summary: "Staff access changed before this POS history synced.",
      }),
    );
    expect(repository.roleChecks.at(-1)).toEqual(
      expect.objectContaining({
        allowedRoles: ["manager"],
      }),
    );
  });

  it("conflicts manager-only register reopen events even with forged client proof", async () => {
    const repository = createFakeSyncRepository({
      staff: {
        _id: "staff-1",
        storeId: "store-1",
        status: "active",
        linkedUserId: "athena-user-2",
      },
    });
    const service = createLocalSyncIngestionService({
      repository,
      projectionRepository: repository,
      now: () => 100,
    });

    const result = await service.ingestBatch(
      buildBatch({
        events: [
          buildRegisterOpenedEvent({ sequence: 1 }),
          {
            localEventId: "event-register-closed-2",
            localRegisterSessionId: "local-register-1",
            sequence: 2,
            eventType: "register_closed",
            occurredAt: 20,
            staffProfileId: "staff-1" as never,
            staffProofToken: "proof-token-1",
            payload: { countedCash: 100 },
          },
          {
            localEventId: "event-register-reopened-3",
            localRegisterSessionId: "local-register-1",
            sequence: 3,
            eventType: "register_reopened",
            occurredAt: 30,
            staffProfileId: "staff-1" as never,
            staffProofToken: "proof-token-1",
            payload: {
              managerProof: buildManagerProof({
                eventType: "register_reopened",
                localRegisterSessionId: "local-register-1",
                occurredAt: 30,
                staffProfileId: "staff-1",
              }),
              reason: "Corrected count",
            },
          },
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted[2]).toEqual(
      expect.objectContaining({ sequence: 3, status: "conflicted" }),
    );
    expect(result.data.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conflictType: "permission",
          localEventId: "event-register-reopened-3",
        }),
      ]),
    );
    expect(repository.roleChecks[2]).toEqual(
      expect.objectContaining({
        allowedRoles: ["manager"],
      }),
    );
  });

  it("uses the Convex cursor table and scoped mapping index in the production repository", async () => {
    const ctx = createFakeConvexCtx({
      posLocalSyncMapping: [
        {
          _id: "mapping-local-register-1",
          storeId: "store-1",
          terminalId: "terminal-1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event-1",
          localIdKind: "registerSession",
          localId: "local-register",
          cloudTable: "registerSession",
          cloudId: "register-session-1",
          createdAt: 1,
        },
        {
          _id: "mapping-local-register-2",
          storeId: "store-1",
          terminalId: "terminal-1",
          localRegisterSessionId: "local-register-2",
          localEventId: "event-2",
          localIdKind: "registerSession",
          localId: "local-register",
          cloudTable: "registerSession",
          cloudId: "register-session-2",
          createdAt: 1,
        },
      ],
      posLocalSyncEvent: Array.from({ length: 250 }, (_, index) => ({
        _id: `event-${index + 1}`,
        storeId: "store-1",
        terminalId: "terminal-1",
        localEventId: `event-${index + 1}`,
        localRegisterSessionId: "local-register-1",
        sequence: index + 1,
        eventType: "sale_completed",
        occurredAt: index + 1,
        staffProfileId: "staff-1",
        payload: {},
        status: "projected",
        submittedAt: index + 1,
      })),
    });
    const repository = createConvexLocalSyncRepository(ctx as never);

    await repository.updateAcceptedThroughSequence({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      cursor: {
        syncScope: "pos",
        localSyncCursorId: "local-register-1",
        localRegisterSessionId: "local-register-1",
      },
      acceptedThroughSequence: 42,
      updatedAt: 100,
    });
    await repository.updateAcceptedThroughSequence({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      cursor: {
        syncScope: "pos",
        localSyncCursorId: "local-register-1",
        localRegisterSessionId: "local-register-1",
      },
      acceptedThroughSequence: 64,
      updatedAt: 200,
    });
    await repository.updateAcceptedThroughSequence({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      cursor: {
        syncScope: "expense",
        localSyncCursorId: "local-register-1",
        localExpenseSessionId: "local-register-1",
      },
      acceptedThroughSequence: 7,
      updatedAt: 250,
    });

    await expect(
      repository.getAcceptedThroughSequence({
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        cursor: {
          syncScope: "pos",
          localSyncCursorId: "local-register-1",
          localRegisterSessionId: "local-register-1",
        },
      }),
    ).resolves.toBe(64);
    await expect(
      repository.getAcceptedThroughSequence({
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        cursor: {
          syncScope: "expense",
          localSyncCursorId: "local-register-1",
          localExpenseSessionId: "local-register-1",
        },
      }),
    ).resolves.toBe(7);

    const crowdedCursorCtx = createFakeConvexCtx({
      posLocalSyncCursor: [
        ...Array.from({ length: 101 }, (_, index) => ({
          _id: `cursor-old-${index}`,
          storeId: "store-1",
          terminalId: "terminal-1",
          syncScope: "pos",
          localSyncCursorId: `old-local-register-${index}`,
          localRegisterSessionId: `old-local-register-${index}`,
          acceptedThroughSequence: index,
          updatedAt: index,
        })),
        {
          _id: "cursor-target",
          storeId: "store-1",
          terminalId: "terminal-1",
          syncScope: "pos",
          localSyncCursorId: "target-local-register",
          localRegisterSessionId: "target-local-register",
          acceptedThroughSequence: 91,
          updatedAt: 200,
        },
        {
          _id: "cursor-legacy-pos",
          storeId: "store-1",
          terminalId: "terminal-1",
          localRegisterSessionId: "shared-local-id",
          acceptedThroughSequence: 33,
          updatedAt: 100,
        },
      ],
    });
    const crowdedRepository = createConvexLocalSyncRepository(
      crowdedCursorCtx as never,
    );

    await expect(
      crowdedRepository.getAcceptedThroughSequence({
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        cursor: {
          syncScope: "pos",
          localSyncCursorId: "target-local-register",
          localRegisterSessionId: "target-local-register",
        },
      }),
    ).resolves.toBe(91);
    await expect(
      crowdedRepository.getAcceptedThroughSequence({
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        cursor: {
          syncScope: "pos",
          localSyncCursorId: "shared-local-id",
          localRegisterSessionId: "shared-local-id",
        },
      }),
    ).resolves.toBe(33);
    await expect(
      crowdedRepository.getAcceptedThroughSequence({
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        cursor: {
          syncScope: "expense",
          localSyncCursorId: "shared-local-id",
          localExpenseSessionId: "shared-local-id",
        },
      }),
    ).resolves.toBe(0);
    await expect(
      repository.findMapping({
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        localRegisterSessionId: "local-register-2",
        localIdKind: "registerSession",
        localId: "local-register",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        cloudId: "register-session-2",
        localRegisterSessionId: "local-register-2",
      }),
    );
    expect(ctx.queriedTables).not.toContain("posLocalSyncEvent");
  });

  it("normalizes direct cloud register and POS session ids in the production repository", async () => {
    const ctx = createFakeConvexCtx({
      posLocalSyncMapping: [],
      posSession: [
        {
          _id: "pos-session-1",
          storeId: "store-1",
          terminalId: "terminal-1",
          registerSessionId: "register-session-1",
        },
      ],
      registerSession: [
        {
          _id: "register-session-1",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      ],
    });
    const repository = createConvexLocalSyncRepository(ctx as never);

    await expect(
      repository.getRegisterSessionByLocalId({
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        localRegisterSessionId: "register-session-1",
      }),
    ).resolves.toEqual(expect.objectContaining({ _id: "register-session-1" }));
    await expect(
      repository.getPosSessionByLocalId({
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        localRegisterSessionId: "local-register-1",
        localPosSessionId: "pos-session-1",
        registerSessionId: "register-session-1" as never,
      }),
    ).resolves.toEqual(expect.objectContaining({ _id: "pos-session-1" }));
    await expect(
      repository.getRegisterSessionByLocalId({
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        localRegisterSessionId: "pos-session-1",
      }),
    ).resolves.toBeNull();
    expect(ctx.normalizedIds).toEqual(
      expect.arrayContaining([
        { tableName: "registerSession", value: "register-session-1" },
        { tableName: "posSession", value: "pos-session-1" },
        { tableName: "registerSession", value: "pos-session-1" },
      ]),
    );
    expect(ctx.getCalls).not.toContainEqual({
      tableName: "registerSession",
      id: "pos-session-1",
    });
  });

  it("flushes local-sync SKU patches into catalog summary invalidation", async () => {
    const ctx = createFakeConvexCtx({
      catalogSummary: [
        {
          _id: "catalog-summary-1",
          categoryCount: 1,
          missingInfoProductCount: 0,
          needsRefresh: false,
          outOfStockProductCount: 0,
          productCount: 1,
          storeId: "store-1",
          updatedAt: 10,
        },
      ],
      productSku: [
        {
          _id: "sku-1",
          inventoryCount: 8,
          productId: "product-1",
          quantityAvailable: 8,
          storeId: "store-1",
        },
      ],
    });
    const repository = createConvexLocalSyncRepository(ctx as never);

    await repository.patchProductSku("sku-1" as never, {
      inventoryCount: 7,
      quantityAvailable: 7,
    });
    await repository.flushCatalogSummaryRefreshes?.();

    await expect(
      ctx.db.get("catalogSummary", "catalog-summary-1"),
    ).resolves.toEqual(
      expect.objectContaining({
        needsRefresh: true,
        storeId: "store-1",
      }),
    );
  });

  it("returns direct and mapped register-session facts for open review conflicts in the production repository", async () => {
    const ctx = createFakeConvexCtx({
      registerSession: [
        {
          _id: "register-session-1",
          storeId: "store-1",
          terminalId: "terminal-1",
          status: "active",
        },
        {
          _id: "register-session-2",
          storeId: "store-2",
          terminalId: "terminal-1",
          status: "active",
        },
        {
          _id: "register-session-3",
          storeId: "store-1",
          terminalId: "terminal-2",
          status: "active",
        },
      ],
      posLocalSyncConflict: [
        {
          _id: "conflict-1",
          storeId: "store-1",
          terminalId: "terminal-1",
          localRegisterSessionId: "register-session-1",
          localEventId: "event-closeout-1",
          sequence: 2,
          conflictType: "permission",
          status: "needs_review",
          summary:
            "Register closeout variance requires manager review before synced closeout can be applied.",
          details: { countedCash: 100, expectedCash: 90, variance: 10 },
          createdAt: 100,
        },
        {
          _id: "conflict-mapped",
          storeId: "store-1",
          terminalId: "terminal-1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event-closeout-mapped",
          sequence: 5,
          conflictType: "permission",
          status: "needs_review",
          summary:
            "Register closeout variance requires manager review before synced closeout can be applied.",
          details: { countedCash: 100, expectedCash: 90, variance: 10 },
          createdAt: 103,
        },
        {
          _id: "conflict-2",
          storeId: "store-1",
          terminalId: "terminal-1",
          localRegisterSessionId: "register-session-2",
          localEventId: "event-closeout-2",
          sequence: 3,
          conflictType: "permission",
          status: "needs_review",
          summary:
            "Register closeout variance requires manager review before synced closeout can be applied.",
          details: { countedCash: 100, expectedCash: 90, variance: 10 },
          createdAt: 101,
        },
        {
          _id: "conflict-3",
          storeId: "store-1",
          terminalId: "terminal-1",
          localRegisterSessionId: "register-session-3",
          localEventId: "event-closeout-3",
          sequence: 4,
          conflictType: "permission",
          status: "needs_review",
          summary:
            "Register closeout variance requires manager review before synced closeout can be applied.",
          details: { countedCash: 100, expectedCash: 90, variance: 10 },
          createdAt: 102,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "mapping-register",
          storeId: "store-1",
          terminalId: "terminal-1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event-register-opened-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "register-session-1",
          createdAt: 1,
        },
      ],
    });
    const repository = createConvexLocalSyncRepository(ctx as never);

    const facts = await repository.listOpenRegisterReviewConflictFacts({
      registerSessionId: "register-session-1" as never,
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
    });

    expect(facts).toHaveLength(2);
    expect(facts[0]).toEqual(
      expect.objectContaining({
        directRegisterSession: {
          _id: "register-session-1",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        registerSessionMapping: null,
      }),
    );
    expect(facts[1]).toEqual(
      expect.objectContaining({
        conflict: expect.objectContaining({ _id: "conflict-mapped" }),
        directRegisterSession: null,
        registerSessionMapping: expect.objectContaining({
          cloudId: "register-session-1",
          localRegisterSessionId: "local-register-1",
        }),
      }),
    );
  });

  it("creates POS sync conflicts idempotently in the production repository", async () => {
    const conflictInput = {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      localRegisterSessionId: "local-register-1",
      localEventId: "event-register-opened-1",
      sequence: 1,
      conflictType: "permission" as const,
      status: "needs_review" as const,
      summary: "Staff access changed before this POS history synced.",
      details: {
        staffProfileId: "staff-1",
        eventType: "register_opened",
        nested: { left: 1, right: 2 },
      },
      createdAt: 200,
    };
    const ctx = createFakeConvexCtx({
      posLocalSyncConflict: [
        {
          _id: "resolved-conflict",
          ...conflictInput,
          status: "resolved",
          createdAt: 100,
          resolvedAt: 150,
        },
      ],
    });
    const repository = createConvexLocalSyncRepository(ctx as never);

    const first = await repository.createConflict(conflictInput);
    const retry = await repository.createConflict({
      ...conflictInput,
      details: {
        nested: { right: 2, left: 1 },
        eventType: "register_opened",
        staffProfileId: "staff-1",
      },
      createdAt: 300,
    });
    const changedDetails = await repository.createConflict({
      ...conflictInput,
      details: {
        ...conflictInput.details,
        hasStaffProof: false,
      },
      createdAt: 400,
    });

    expect(first._id).not.toBe("resolved-conflict");
    expect(retry).toEqual(first);
    expect(retry.createdAt).toBe(200);
    expect(changedDetails._id).not.toBe(first._id);
    await expect(
      repository.listConflictsForEvent({
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        localEventId: "event-register-opened-1",
      }),
    ).resolves.toHaveLength(3);
  });

  it("sums only active unexpired inventory holds in the production repository", async () => {
    const ctx = createFakeConvexCtx({
      inventoryHold: [
        {
          _id: "hold-1",
          storeId: "store-1",
          productSkuId: "sku-1",
          status: "active",
          expiresAt: 200,
          quantity: 2,
        },
        {
          _id: "hold-2",
          storeId: "store-1",
          productSkuId: "sku-1",
          status: "active",
          expiresAt: 300,
          quantity: 3,
        },
        {
          _id: "hold-expired",
          storeId: "store-1",
          productSkuId: "sku-1",
          status: "active",
          expiresAt: 50,
          quantity: 5,
        },
        {
          _id: "hold-released",
          storeId: "store-1",
          productSkuId: "sku-1",
          status: "released",
          expiresAt: 300,
          quantity: 7,
        },
        {
          _id: "hold-other-store",
          storeId: "store-2",
          productSkuId: "sku-1",
          status: "active",
          expiresAt: 300,
          quantity: 11,
        },
        {
          _id: "hold-other-sku",
          storeId: "store-1",
          productSkuId: "sku-2",
          status: "active",
          expiresAt: 300,
          quantity: 13,
        },
      ],
    });
    const repository = createConvexLocalSyncRepository(ctx as never);

    await expect(
      repository.getActiveHeldQuantity({
        storeId: "store-1" as never,
        productSkuId: "sku-1" as never,
        now: 100,
      }),
    ).resolves.toBe(5);
  });

  it("validates production local staff proofs through hashed scoped active credentials", async () => {
    const tokenHash = await hashPosLocalStaffProofToken("proof-token-1");
    const ctx = createFakeConvexCtx({
      posLocalStaffProof: [
        {
          _id: "proof-1",
          credentialId: "credential-1",
          credentialVersion: 2,
          expiresAt: 200,
          staffProfileId: "staff-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-1",
          tokenHash,
        },
      ],
      staffCredential: [
        {
          _id: "credential-1",
          localVerifierVersion: 2,
          staffProfileId: "staff-1",
          status: "active",
          storeId: "store-1",
        },
      ],
    });
    const repository = createConvexLocalSyncRepository(ctx as never);

    await expect(
      repository.validateLocalStaffProof({
        staffProfileId: "staff-1" as never,
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        token: "proof-token-1",
        now: 100,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.validateLocalStaffProof({
        staffProfileId: "staff-2" as never,
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        token: "proof-token-1",
        now: 100,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.validateLocalStaffProof({
        staffProfileId: "staff-1" as never,
        storeId: "store-2" as never,
        terminalId: "terminal-1" as never,
        token: "proof-token-1",
        now: 100,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.validateLocalStaffProof({
        staffProfileId: "staff-1" as never,
        storeId: "store-1" as never,
        terminalId: "terminal-2" as never,
        token: "proof-token-1",
        now: 100,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.validateLocalStaffProof({
        staffProfileId: "staff-1" as never,
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        token: "wrong-token",
        now: 100,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.validateLocalStaffProof({
        staffProfileId: "staff-1" as never,
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        token: "proof-token-1",
        now: 201,
      }),
    ).resolves.toBe(false);

    await ctx.db.patch("staffCredential", "credential-1", {
      localVerifierVersion: 3,
    });
    await expect(
      repository.validateLocalStaffProof({
        staffProfileId: "staff-1" as never,
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        token: "proof-token-1",
        now: 100,
      }),
    ).resolves.toBe(false);

    const proof = ctx.db
      .query("posLocalStaffProof")
      .withIndex("by_tokenHash", (q: any) => q.eq("tokenHash", tokenHash));
    await expect(proof.unique()).resolves.toEqual(
      expect.objectContaining({ lastUsedAt: 100 }),
    );
  });

  it("rejects unversioned local staff proofs once a credential has a verifier version", async () => {
    const tokenHash = await hashPosLocalStaffProofToken("proof-token-1");
    const ctx = createFakeConvexCtx({
      posLocalStaffProof: [
        {
          _id: "proof-1",
          credentialId: "credential-1",
          expiresAt: 200,
          staffProfileId: "staff-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-1",
          tokenHash,
        },
      ],
      staffCredential: [
        {
          _id: "credential-1",
          localVerifierVersion: 1,
          staffProfileId: "staff-1",
          status: "active",
          storeId: "store-1",
        },
      ],
    });
    const repository = createConvexLocalSyncRepository(ctx as never);

    await expect(
      repository.validateLocalStaffProof({
        staffProfileId: "staff-1" as never,
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        token: "proof-token-1",
        now: 100,
      }),
    ).resolves.toBe(false);
  });

  it("rejects production local staff proofs when the bound credential is suspended or revoked", async () => {
    const tokenHash = await hashPosLocalStaffProofToken("proof-token-1");
    const buildCtx = (status: "suspended" | "revoked") =>
      createFakeConvexCtx({
        posLocalStaffProof: [
          {
            _id: "proof-1",
            credentialId: "credential-1",
            expiresAt: 200,
            staffProfileId: "staff-1",
            status: "active",
            storeId: "store-1",
            terminalId: "terminal-1",
            tokenHash,
          },
        ],
        staffCredential: [
          {
            _id: "credential-1",
            staffProfileId: "staff-1",
            status,
            storeId: "store-1",
          },
        ],
      });

    for (const status of ["suspended", "revoked"] as const) {
      const ctx = buildCtx(status);
      const repository = createConvexLocalSyncRepository(ctx as never);

      await expect(
        repository.validateLocalStaffProof({
          staffProfileId: "staff-1" as never,
          storeId: "store-1" as never,
          terminalId: "terminal-1" as never,
          token: "proof-token-1",
          now: 100,
        }),
      ).resolves.toBe(false);
      expect(ctx.getCalls).toContainEqual({
        tableName: "staffCredential",
        id: "credential-1",
      });
    }
  });
});

describe("ingestLocalEventsWithCtx", () => {
  it("returns the core sync result when activity patching fails", async () => {
    activityPatchMocks.patchRegisterSessionActivityFromLocalSyncWithCtx.mockRejectedValueOnce(
      new Error("activity patch failed"),
    );
    const ctx = createFakeConvexCtx({
      posTerminal: [
        {
          _id: "terminal-1",
          status: "active",
          storeId: "store-1",
        },
      ],
    });

    const result = await ingestLocalEventsWithCtx(ctx as never, {
      events: [],
      storeId: "store-1" as Id<"store">,
      submittedAt: 100,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        accepted: [],
        conflicts: [],
        held: [],
        mappings: [],
        syncCursor: {
          localRegisterSessionId: null,
          acceptedThroughSequence: 0,
        },
      },
    });
    expect(
      activityPatchMocks.patchRegisterSessionActivityFromLocalSyncWithCtx,
    ).toHaveBeenCalled();
  });
});

function buildBatch(
  overrides: Partial<PosLocalSyncBatchInput> & {
    events: PosLocalSyncEventInput[];
  },
): PosLocalSyncBatchInput {
  return {
    storeId: "store-1" as never,
    terminalId: "terminal-1" as never,
    submittedAt: 90,
    ...overrides,
  };
}

function createFakeConvexCtx(
  seed: Record<string, Array<Record<string, unknown>>>,
) {
  let nextId = 1;
  const tables = new Map(
    Object.entries(seed).map(([tableName, rows]) => [
      tableName,
      rows.map((row) => ({ ...row })),
    ]),
  );
  const queriedTables: string[] = [];
  const getCalls: Array<{ id: string; tableName: string }> = [];
  const normalizedIds: Array<{ tableName: string; value: string }> = [];

  const getRows = (tableName: string) => {
    const rows = tables.get(tableName);
    if (rows) return rows;
    const nextRows: Array<Record<string, unknown>> = [];
    tables.set(tableName, nextRows);
    return nextRows;
  };

  return {
    queriedTables,
    getCalls,
    normalizedIds,
    db: {
      get: async (tableName: string, id: string) => {
        getCalls.push({ tableName, id });
        return getRows(tableName).find((row) => row._id === id) ?? null;
      },
      normalizeId: (tableName: string, id: string) => {
        normalizedIds.push({ tableName, value: id });
        return getRows(tableName).some((row) => row._id === id) ? id : null;
      },
      insert: async (tableName: string, row: Record<string, unknown>) => {
        const id = `${tableName}-${nextId++}`;
        getRows(tableName).push({ _id: id, ...row });
        return id;
      },
      patch: async (
        tableName: string,
        id: string,
        patch: Record<string, unknown>,
      ) => {
        const row = getRows(tableName).find(
          (candidate) => candidate._id === id,
        );
        if (row) Object.assign(row, patch);
      },
      query: (tableName: string) => {
        queriedTables.push(tableName);
        const filters: Array<[string, unknown]> = [];
        const gtFilters: Array<[string, number]> = [];
        const query = {
          withIndex: (_indexName: string, build: (q: any) => unknown) => {
            const indexQuery = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return indexQuery;
              },
              gt(field: string, value: number) {
                gtFilters.push([field, value]);
                return indexQuery;
              },
            };
            build(indexQuery);
            return query;
          },
          async take(limit: number) {
            return getRows(tableName)
              .filter(
                (row) =>
                  filters.every(([field, value]) => row[field] === value) &&
                  gtFilters.every(
                    ([field, value]) =>
                      typeof row[field] === "number" && row[field] > value,
                  ),
              )
              .slice(0, limit);
          },
          async unique() {
            return (
              getRows(tableName).find(
                (row) =>
                  filters.every(([field, value]) => row[field] === value) &&
                  gtFilters.every(
                    ([field, value]) =>
                      typeof row[field] === "number" && row[field] > value,
                  ),
              ) ?? null
            );
          },
          async first() {
            return this.unique();
          },
          async collect() {
            return getRows(tableName).filter(
              (row) =>
                filters.every(([field, value]) => row[field] === value) &&
                gtFilters.every(
                  ([field, value]) =>
                    typeof row[field] === "number" && row[field] > value,
                ),
            );
          },
        };
        return query;
      },
    },
  };
}

function haveEquivalentConflictDetails(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return left === right;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) =>
      haveEquivalentConflictDetails(item, right[index]),
    );
  }

  if (typeof left !== "object" || typeof right !== "object") {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] &&
      haveEquivalentConflictDetails(leftRecord[key], rightRecord[key]),
  );
}

function buildRegisterOpenedEvent(
  overrides: Partial<PosLocalSyncEventInput> & { sequence: number },
): PosLocalSyncEventInput {
  const { sequence, ...rest } = overrides;
  return {
    localEventId: `event-register-opened-${sequence}`,
    localRegisterSessionId: "local-register-1",
    sequence,
    eventType: "register_opened",
    occurredAt: 10,
    staffProfileId: "staff-1" as never,
    staffProofToken: "proof-token-1",
    payload: {
      openingFloat: 100,
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      managerProof: buildManagerProof({
        eventType: "register_opened",
        localRegisterSessionId: "local-register-1",
        occurredAt: 10,
        staffProfileId: "staff-1",
      }),
    },
    ...rest,
  };
}

function buildManagerProof(input: {
  eventType: "register_opened" | "register_closed" | "register_reopened";
  localRegisterSessionId: string;
  occurredAt: number;
  staffProfileId: string;
}) {
  return {
    authenticatedAt: input.occurredAt,
    eventType: input.eventType,
    localRegisterSessionId: input.localRegisterSessionId,
    staffProfileId: input.staffProfileId,
  };
}

function buildSaleCompletedEvent(
  overrides: Partial<PosLocalSyncEventInput> & { sequence: number },
): PosLocalSyncEventInput {
  const { sequence, ...rest } = overrides;
  return {
    localEventId: `event-sale-completed-${sequence}`,
    localRegisterSessionId: "local-register-1",
    sequence,
    eventType: "sale_completed",
    occurredAt: 20,
    staffProfileId: "staff-1" as never,
    staffProofToken: "proof-token-1",
    payload: {
      localPosSessionId: `local-session-${sequence}`,
      localTransactionId: `local-txn-${sequence}`,
      localReceiptNumber: `LR-${String(sequence).padStart(3, "0")}`,
      registerNumber: "1",
      totals: {
        subtotal: 25,
        tax: 0,
        total: 25,
      },
      items: [
        {
          localTransactionItemId: `local-txn-item-${sequence}`,
          productId: "product-1" as never,
          productSkuId: "sku-1" as never,
          productName: "Wig Cap",
          productSku: "CAP-1",
          quantity: 1,
          unitPrice: 25,
        },
      ],
      payments: [
        {
          localPaymentId: `local-payment-${sequence}`,
          method: "cash",
          amount: 25,
          timestamp: 21,
        },
      ],
    },
    ...rest,
  };
}

function buildPendingCheckoutItemDefinedEvent(
  overrides: Partial<PosLocalSyncEventInput> & { sequence: number },
): PosLocalSyncEventInput {
  const { sequence, ...rest } = overrides;
  return {
    localEventId: `event-pending-item-${sequence}`,
    localRegisterSessionId: "local-register-1",
    sequence,
    eventType: "pending_checkout_item_defined",
    occurredAt: 15,
    staffProfileId: "staff-1" as never,
    staffProofToken: "proof-token-1",
    payload: {
      localPendingCheckoutItemId: "local-pending-item-1",
      name: "Loose wave bundle",
      lookupCode: "999888777666",
      searchContext: {
        query: "loose wave",
        source: "barcode",
        matched: "none",
      },
      price: 45,
      quantitySold: 2,
      localMetadata: {
        schema: "pos_pending_checkout_item_local_metadata_v1",
        source: "offline_search",
        createdOffline: true,
        appSessionValidation: "unverified",
      },
    },
    ...rest,
  };
}

function buildServiceLine(
  overrides: Partial<
    NonNullable<PosLocalSalePayload["serviceLines"]>[number]
  > = {},
): NonNullable<PosLocalSalePayload["serviceLines"]>[number] {
  return {
    localServiceLineId: "local-service-line-1",
    localServiceCaseId: "local-service-case-1",
    serviceCatalogId: "service-catalog-1" as never,
    serviceCatalogName: "Install",
    serviceMode: "same_day",
    pricingModel: "fixed",
    quantity: 1,
    unitPrice: 75,
    totalPrice: 75,
    catalogUpdatedAt: 1_000,
    ...overrides,
  };
}

function buildSaleClearedEvent(
  overrides: Partial<PosLocalSyncEventInput> & { sequence: number },
): PosLocalSyncEventInput {
  const { sequence, ...rest } = overrides;
  return {
    localEventId: `event-sale-cleared-${sequence}`,
    localRegisterSessionId: "local-register-1",
    sequence,
    eventType: "sale_cleared",
    occurredAt: 20,
    staffProfileId: "staff-1" as never,
    staffProofToken: "proof-token-1",
    payload: {
      localPosSessionId: `local-session-${sequence}`,
      reason: "Sale cleared",
    },
    ...rest,
  };
}

function buildExpenseRecordedEvent(
  overrides: Partial<PosLocalSyncEventInput> & {
    localExpenseSessionId?: string;
    sequence: number;
  },
): PosLocalSyncEventInput {
  const { sequence, localExpenseSessionId, ...rest } = overrides;
  const resolvedLocalExpenseSessionId =
    localExpenseSessionId ?? "local-expense-session-1";
  return {
    syncScope: "expense",
    localEventId: `event-expense-recorded-${sequence}`,
    localExpenseSessionId: resolvedLocalExpenseSessionId,
    sequence,
    eventType: "expense_recorded",
    occurredAt: 20,
    staffProfileId: "staff-1" as never,
    staffProofToken: "proof-token-1",
    payload: {
      localExpenseSessionId: resolvedLocalExpenseSessionId,
      localExpenseEventId: `local-expense-event-${sequence}`,
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
    ...rest,
  } as PosLocalSyncEventInput;
}

function createFakeSyncRepository(
  overrides: Partial<{
    terminal: {
      _id: string;
      storeId: string;
      registerNumber?: string;
      registeredByUserId?: string;
      status: string;
    } | null;
    staff: {
      _id: string;
      storeId: string;
      status: string;
      linkedUserId?: string;
    } | null;
    staffProfiles: Array<{
      _id: string;
      storeId: string;
      status: string;
      linkedUserId?: string;
    }>;
    hasActivePosRole: boolean;
    existingPosSession: {
      _id: string;
      storeId: string;
      terminalId: string;
    };
    skus: Array<{
      _id: string;
      storeId: string;
      productId: string;
      sku: string;
      price: number;
      quantityAvailable: number;
      inventoryCount: number;
      images: string[];
    }>;
    consumedHoldQuantities: Map<string, number>;
    existingRegisterSession: {
      _id: string;
      expectedCash: number;
      closeoutRecords: unknown[];
      registerNumber?: string;
      status: string;
      storeId: string;
      terminalId: string;
    } | null;
    invalidCloudIds: Set<string>;
    registerSessionsWithCloseoutReview: Set<string>;
    validCloudIds: Set<string>;
    validateLocalStaffProof: SyncProjectionRepository["validateLocalStaffProof"];
  }> = {},
): LocalSyncRepository & {
  conflicts: LocalSyncConflictRecord[];
  createdPendingCheckoutItems: unknown[];
  createdPaymentAllocations: unknown[];
  createdExpenseSessions: unknown[];
  createdExpenseSessionItems: unknown[];
  createdExpenseTransactions: unknown[];
  createdExpenseTransactionItems: unknown[];
  createdServiceWorkItems: unknown[];
  createdRegisterSessions: unknown[];
  createdTransactions: unknown[];
  events: LocalSyncEventRecord[];
  mappings: LocalSyncMappingRecord[];
  productPatches: unknown[];
  registerSessionPatches: Array<{ registerSessionId: string; patch: unknown }>;
  recordedSaleInventoryMovements: unknown[];
  roleChecks: Array<{
    allowedRoles: string[];
    staffProfileId: string;
    storeId: string;
  }>;
} {
  let nextId = 1;
  const events: LocalSyncEventRecord[] = [];
  const mappings: LocalSyncMappingRecord[] = [];
  const conflicts: LocalSyncConflictRecord[] = [];
  const createdPendingCheckoutItems: unknown[] = [];
  const roleChecks: Array<{
    allowedRoles: string[];
    staffProfileId: string;
    storeId: string;
  }> = [];
  const createdRegisterSessions: unknown[] = [];
  const createdTransactions: unknown[] = [];
  const createdPaymentAllocations: unknown[] = [];
  const createdExpenseSessions: unknown[] = [];
  const createdExpenseSessionItems: unknown[] = [];
  const createdExpenseTransactions: unknown[] = [];
  const createdExpenseTransactionItems: unknown[] = [];
  const createdServiceWorkItems: unknown[] = [];
  const productPatches: unknown[] = [];
  const recordedSaleInventoryMovements: unknown[] = [];
  const registerSessionPatches: Array<{
    registerSessionId: string;
    patch: unknown;
  }> = [];
  const acceptedThroughSequenceByCursor = new Map<string, number>();
  const terminal = overrides.terminal ?? {
    _id: "terminal-1",
    storeId: "store-1",
    registerNumber: "1",
    registeredByUserId: "athena-user-1",
    status: "active",
  };
  const staff = overrides.staff ?? {
    _id: "staff-1",
    storeId: "store-1",
    status: "active",
    linkedUserId: "athena-user-1",
  };
  const defaultExistingRegisterSession = {
    _id: "register-session-1",
    closeoutRecords: [],
    expectedCash: 100,
    registerNumber: "1",
    status: "active",
    storeId: "store-1",
    terminalId: "terminal-1",
  };
  const skus = overrides.skus ?? [
    {
      _id: "sku-1",
      storeId: "store-1",
      productId: "product-1",
      sku: "CAP-1",
      price: 25,
      quantityAvailable: 10,
      inventoryCount: 10,
      images: [],
    },
  ];

  return {
    conflicts,
    createdPendingCheckoutItems,
    createdPaymentAllocations,
    createdExpenseSessions,
    createdExpenseSessionItems,
    createdExpenseTransactions,
    createdExpenseTransactionItems,
    createdServiceWorkItems,
    createdRegisterSessions,
    createdTransactions,
    events,
    mappings,
    productPatches,
    registerSessionPatches,
    recordedSaleInventoryMovements,
    roleChecks,
    async getTerminal(terminalId) {
      return terminal && terminal._id === terminalId
        ? (terminal as never)
        : null;
    },
    async getStaffProfile(staffProfileId) {
      if (overrides.staffProfiles) {
        return (
          (overrides.staffProfiles.find(
            (staffProfile) => staffProfile._id === staffProfileId,
          ) as never) ?? null
        );
      }
      return staff && staff._id === staffProfileId ? (staff as never) : null;
    },
    async hasActivePosRole(args) {
      roleChecks.push({
        allowedRoles: args.allowedRoles,
        staffProfileId: args.staffProfileId,
        storeId: args.storeId,
      });
      return overrides.hasActivePosRole ?? true;
    },
    async validateLocalStaffProof(args) {
      if (overrides.validateLocalStaffProof) {
        return overrides.validateLocalStaffProof(args);
      }
      return (
        args.staffProfileId === "staff-1" &&
        args.storeId === "store-1" &&
        args.terminalId === "terminal-1" &&
        args.token === "proof-token-1"
      );
    },
    normalizeCloudId(tableName, value) {
      if (overrides.invalidCloudIds?.has(value)) return null;
      if (tableName === "posSession" || tableName === "registerSession") {
        return overrides.validCloudIds?.has(value) ? (value as never) : null;
      }
      return value as never;
    },
    async getStore(storeId) {
      return storeId === "store-1"
        ? ({
            _id: "store-1",
            organizationId: "org-1",
          } as never)
        : null;
    },
    async getCustomerProfile() {
      return {
        _id: "customer-1",
        storeId: "store-1",
      } as never;
    },
    async getProduct(productId) {
      const sku = skus.find((candidate) => candidate.productId === productId);
      return sku
        ? ({
            _id: productId,
            storeId: sku.storeId,
          } as never)
        : null;
    },
    async getProductSku(productSkuId) {
      return (skus.find((candidate) => candidate._id === productSkuId) as never) ?? null;
    },
    async getPendingCheckoutItem(pendingCheckoutItemId) {
      const created = createdPendingCheckoutItems.find(
        (item): item is { _id: string } & Record<string, unknown> =>
          typeof item === "object" &&
          item !== null &&
          "_id" in item &&
          item._id === pendingCheckoutItemId,
      );
      if (created) {
        return {
          ...created,
          storeId: "store-1",
          status: "pending_review",
          provisionalProductId: "product-1",
          provisionalProductSkuId: "sku-1",
        } as never;
      }
      return pendingCheckoutItemId === "pending-checkout-item-1"
        ? ({
            _id: "pending-checkout-item-1",
            storeId: "store-1",
            status: "pending_review",
            provisionalProductId: "product-1",
            provisionalProductSkuId: "sku-1",
          } as never)
        : null;
    },
    async getInventoryImportProvisionalSku() {
      return null;
    },
    async recordInventoryImportProvisionalSkuSaleEvidence() {
      // No-op for ingestion tests that do not seed provisional import rows.
    },
    async getServiceCatalog(serviceCatalogId) {
      return serviceCatalogId === "service-catalog-1"
        ? ({
            _id: "service-catalog-1",
            storeId: "store-1",
            organizationId: "org-1",
            name: "Install",
            serviceMode: "same_day",
            pricingModel: "fixed",
            basePrice: 75,
            status: "active",
            updatedAt: 1_000,
          } as never)
        : null;
    },
    async getServiceCase() {
      return null;
    },
    async getRegisterSession(registerSessionId) {
      const existing =
        overrides.existingRegisterSession === undefined
          ? defaultExistingRegisterSession
          : overrides.existingRegisterSession;
      return existing && existing._id === registerSessionId
        ? (existing as never)
        : null;
    },
    async getApprovalRequest() {
      return null;
    },
    async createOrReuseRegisterSessionVarianceReview(input) {
      return {
        status: "ready",
        approvalRequest: {
          _id: "approval-request-1",
          _creationTime: input.closeoutOccurredAt,
          actionKey: "cash_controls.register_session.variance_review",
          createdAt: input.closeoutOccurredAt,
          createdByStaffProfileId: input.requestedByStaffProfileId,
          metadata: {
            countedCash: input.countedCash,
            expectedCash: input.expectedCash,
            variance: input.variance,
          },
          reason: input.gateDecisionReason,
          registerSessionId: input.registerSessionId,
          requestType: "variance_review",
          status: "pending",
          storeId: input.storeId,
        } as never,
        created: true,
      };
    },
    async getActiveHeldQuantity() {
      return 0;
    },
    async readActiveInventoryHoldQuantitiesForSession() {
      return (overrides.consumedHoldQuantities ??
        new Map([["sku-1", 1]])) as never;
    },
    async consumeInventoryHoldsForSession() {
      return (overrides.consumedHoldQuantities ??
        new Map([["sku-1", 1]])) as never;
    },
    async releaseActiveInventoryHoldsForSession() {
      return {
        releasedHoldCount: 0,
        releasedHolds: [],
      } as never;
    },
    async findEvent(args) {
      return (
        events.find(
          (event) =>
            event.storeId === args.storeId &&
            event.terminalId === args.terminalId &&
            event.localEventId === args.localEventId,
        ) ?? null
      );
    },
    async getAcceptedThroughSequence(args) {
      return (
        acceptedThroughSequenceByCursor.get(
          `${args.cursor.syncScope}:${args.cursor.localSyncCursorId}`,
        ) ?? 0
      );
    },
    async updateAcceptedThroughSequence(args) {
      acceptedThroughSequenceByCursor.set(
        `${args.cursor.syncScope}:${args.cursor.localSyncCursorId}`,
        args.acceptedThroughSequence,
      );
    },
    async createEvent(input) {
      const event = {
        _id: `sync-event-${nextId++}`,
        ...input,
      } satisfies LocalSyncEventRecord;
      events.push(event);
      return event;
    },
    async patchEvent(eventId, patch) {
      const event = events.find((candidate) => candidate._id === eventId);
      if (event) Object.assign(event, patch);
    },
    async findMapping(args) {
      return (
        mappings.find(
          (mapping) =>
            mapping.storeId === args.storeId &&
            mapping.terminalId === args.terminalId &&
            mapping.localRegisterSessionId === args.localRegisterSessionId &&
            mapping.localIdKind === args.localIdKind &&
            mapping.localId === args.localId,
        ) ?? null
      );
    },
    async findMappingForTerminal(args) {
      return (
        mappings.find(
          (mapping) =>
            mapping.storeId === args.storeId &&
            mapping.terminalId === args.terminalId &&
            mapping.localIdKind === args.localIdKind &&
            mapping.localId === args.localId,
        ) ?? null
      );
    },
    async createMapping(input) {
      const mapping = {
        _creationTime: 100,
        _id: `sync-mapping-${nextId++}`,
        ...input,
      } as LocalSyncMappingRecord & { _creationTime: number };
      mappings.push(mapping);
      return mapping;
    },
    async listMappingsForEvent(args) {
      return mappings.filter(
        (mapping) =>
          mapping.storeId === args.storeId &&
          mapping.terminalId === args.terminalId &&
          mapping.localEventId === args.localEventId,
      );
    },
    async createConflict(input) {
      const existing = conflicts.find(
        (conflict) =>
          conflict.storeId === input.storeId &&
          conflict.terminalId === input.terminalId &&
          conflict.localRegisterSessionId === input.localRegisterSessionId &&
          conflict.localEventId === input.localEventId &&
          conflict.sequence === input.sequence &&
          conflict.conflictType === input.conflictType &&
          conflict.status === "needs_review" &&
          conflict.summary === input.summary &&
          haveEquivalentConflictDetails(conflict.details, input.details),
      );
      if (existing) return existing;

      const conflict = {
        _id: `sync-conflict-${nextId++}`,
        ...input,
      } satisfies LocalSyncConflictRecord;
      conflicts.push(conflict);
      return conflict;
    },
    async resolveConflictsForEvent(args) {
      for (const conflict of conflicts) {
        if (
          conflict.storeId === args.storeId &&
          conflict.terminalId === args.terminalId &&
          conflict.localEventId === args.localEventId &&
          conflict.status === "needs_review"
        ) {
          conflict.status = "resolved";
          conflict.resolvedAt = args.resolvedAt;
        }
      }
    },
    async listConflictsForEvent(args) {
      return conflicts.filter(
        (conflict) =>
          conflict.storeId === args.storeId &&
          conflict.terminalId === args.terminalId &&
          conflict.localEventId === args.localEventId,
      );
    },
    async createRegisterSession(input) {
      const id = `register-session-${createdRegisterSessions.length + 1}`;
      createdRegisterSessions.push({
        _id: id,
        closeoutRecords: [],
        status: "active",
        ...input,
      });
      return id as never;
    },
    async findBlockingRegisterSession() {
      return null;
    },
    async listOpenRegisterReviewConflictFacts(args) {
      return [
        ...(overrides.registerSessionsWithCloseoutReview ?? new Set()),
      ].map((registerSessionId, index) => ({
        conflict: {
          _id: `review-conflict-${registerSessionId}`,
          conflictType: "permission" as const,
          createdAt: 1_700_000_000_000 + index,
          details: {
            countedCash: 100,
            expectedCash: 90,
            variance: 10,
          },
          localEventId: `review-event-${registerSessionId}`,
          localRegisterSessionId: registerSessionId,
          sequence: 0,
          status: "needs_review" as const,
          storeId: args.storeId,
          summary:
            "Register closeout variance requires manager review before synced closeout can be applied.",
          terminalId: args.terminalId,
        },
        directRegisterSession: {
          _id: registerSessionId as Id<"registerSession">,
          storeId: args.storeId,
          terminalId: args.terminalId,
        },
        registerSessionMapping: null,
      }));
    },
    async getRegisterSessionByLocalId(args) {
      const mapping = mappings.find(
        (candidate) =>
          candidate.storeId === args.storeId &&
          candidate.terminalId === args.terminalId &&
          candidate.localRegisterSessionId === args.localRegisterSessionId &&
          candidate.localIdKind === "registerSession" &&
          candidate.localId === args.localRegisterSessionId,
      );
      if (!mapping) {
        const existing =
          overrides.existingRegisterSession === undefined
            ? defaultExistingRegisterSession
            : overrides.existingRegisterSession;
        return existing &&
          args.localRegisterSessionId === "local-register-1" &&
          existing.storeId === args.storeId &&
          existing.terminalId === args.terminalId
          ? (existing as never)
          : null;
      }
      return createdRegisterSessions.find(
        (session) =>
          typeof session === "object" &&
          session !== null &&
          "_id" in session &&
          session._id === mapping.cloudId,
      ) as never;
    },
    async getPosSessionByLocalId(args) {
      const mapping = mappings.find(
        (candidate) =>
          candidate.storeId === args.storeId &&
          candidate.terminalId === args.terminalId &&
          candidate.localRegisterSessionId === args.localRegisterSessionId &&
          candidate.localIdKind === "posSession" &&
          candidate.localId === args.localPosSessionId,
      );
      if (mapping) {
        return {
          _id: mapping.cloudId,
          registerSessionId: args.registerSessionId,
          staffProfileId: "staff-1",
          storeId: args.storeId,
          terminalId: args.terminalId,
        } as never;
      }

      const existing = overrides.existingPosSession;
      return existing &&
        existing._id === args.localPosSessionId &&
        existing.storeId === args.storeId &&
        existing.terminalId === args.terminalId &&
        args.registerSessionId === args.localRegisterSessionId
        ? (existing as never)
        : null;
    },
    async patchRegisterSession(registerSessionId, patch) {
      registerSessionPatches.push({ registerSessionId, patch });
      const session = createdRegisterSessions.find(
        (candidate) =>
          typeof candidate === "object" &&
          candidate !== null &&
          "_id" in candidate &&
          candidate._id === registerSessionId,
      );
      if (session && typeof session === "object") {
        Object.assign(session, patch);
      }
    },
    async createPosSession(input) {
      return `pos-session-${input.localPosSessionId ?? createdTransactions.length + 1}` as never;
    },
    async patchPosSession() {},
    async createPosSessionItem() {
      return `pos-session-item-${nextId++}` as never;
    },
    async createOrReusePendingCheckoutItem(input) {
      const id = `pending-checkout-item-${createdPendingCheckoutItems.length + 1}`;
      createdPendingCheckoutItems.push({
        _id: id,
        ...input,
        provisionalProductId: "product-1",
        provisionalProductSkuId: "sku-1",
        status: "pending_review",
        storeId: "store-1",
      });
      return {
        pendingCheckoutItemId: id,
        productId: "product-1",
        productSkuId: "sku-1",
      } as never;
    },
    async recordPendingCheckoutItemSaleEvidence(input) {
      return this.getPendingCheckoutItem(input.pendingCheckoutItemId);
    },
    async createServiceWorkItem(input) {
      const id = `service-work-item-${nextId++}`;
      createdServiceWorkItems.push({ _id: id, ...input });
      return id as never;
    },
    async createServiceCase() {
      return `service-case-${nextId++}` as never;
    },
    async createServiceCaseLineItem() {
      return `service-line-${nextId++}` as never;
    },
    async syncServiceCaseFinancials() {},
    async createTransaction(input) {
      const id = `transaction-${createdTransactions.length + 1}`;
      createdTransactions.push({ _id: id, ...input });
      return id as never;
    },
    async createTransactionItem() {
      return `transaction-item-${nextId++}` as never;
    },
    async getExpenseSessionByLocalId(args) {
      const mapping = mappings.find(
        (candidate) =>
          candidate.storeId === args.storeId &&
          candidate.terminalId === args.terminalId &&
          candidate.localIdKind === "expenseSession" &&
          candidate.localId === args.localExpenseSessionId,
      );
      if (!mapping) return null;
      return (
        (createdExpenseSessions.find(
          (candidate) =>
            typeof candidate === "object" &&
            candidate !== null &&
            "_id" in candidate &&
            candidate._id === mapping.cloudId,
        ) as never) ?? null
      );
    },
    async createExpenseSession(input) {
      const id = `expense-session-${createdExpenseSessions.length + 1}`;
      createdExpenseSessions.push({ _id: id, ...input });
      return id as never;
    },
    async createExpenseSessionItem(input) {
      const id = `expense-session-item-${createdExpenseSessionItems.length + 1}`;
      createdExpenseSessionItems.push({ _id: id, ...input });
      return id as never;
    },
    async createExpenseTransaction(input) {
      const id = `expense-transaction-${createdExpenseTransactions.length + 1}`;
      createdExpenseTransactions.push({ _id: id, ...input });
      return id as never;
    },
    async createExpenseTransactionItem(input) {
      const id = `expense-transaction-item-${createdExpenseTransactionItems.length + 1}`;
      createdExpenseTransactionItems.push({ _id: id, ...input });
      return id as never;
    },
    async createTransactionServiceLine() {
      return `transaction-service-line-${nextId++}` as never;
    },
    async patchProductSku(productSkuId, patch) {
      productPatches.push({ productSkuId, patch });
    },
    async recordSaleInventoryMovement(input) {
      if (
        recordedSaleInventoryMovements.some(
          (movement) => {
            const recordedMovement = movement as {
              posTransactionId?: unknown;
              productSkuId?: unknown;
            };
            return (
              recordedMovement.posTransactionId === input.posTransactionId &&
              recordedMovement.productSkuId === input.productSkuId
            );
          },
        )
      ) {
        return "existing";
      }
      recordedSaleInventoryMovements.push(input);
      return "inserted";
    },
    async createPaymentAllocation(input) {
      const id = `payment-allocation-${createdPaymentAllocations.length + 1}`;
      createdPaymentAllocations.push({ _id: id, ...input });
      return id as never;
    },
    async createOperationalEvent() {
      return `operational-event-${nextId++}` as never;
    },
  };
}
