import { describe, expect, it } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import {
  createOrReuseRegisterSessionRepairMapping,
  projectLocalSyncEvent,
} from "./projectLocalEvents";
import type {
  LocalSyncConflictRecord,
  LocalSyncMappingRecord,
  LocalSyncRegisterReviewConflictFact,
  ParsedPosLocalSyncEventInput,
  PosLocalSalePayload,
  PosLocalSyncEventInput,
  SyncProjectionRepository,
} from "./types";

type ParsedSaleCompletedEvent = Extract<
  ParsedPosLocalSyncEventInput,
  { eventType: "sale_completed" }
>;
type ParsedPendingCheckoutItemDefinedEvent = Extract<
  ParsedPosLocalSyncEventInput,
  { eventType: "pending_checkout_item_defined" }
>;
type ParsedSaleClearedEvent = Extract<
  ParsedPosLocalSyncEventInput,
  { eventType: "sale_cleared" }
>;
type ParsedExpenseRecordedEvent = Extract<
  ParsedPosLocalSyncEventInput,
  { eventType: "expense_recorded" }
>;

describe("projectLocalSyncEvent", () => {
  it("projects pending checkout item definitions through the reviewable pending item command", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildPendingCheckoutItemDefinedEvent(),
      syncEventId: "sync-event-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });
    expect(result.status).toBe("projected");
    expect(repository.createdPendingCheckoutItems).toEqual([
      expect.objectContaining({
        storeId: "store-1",
        createdByUserId: "athena-user-1",
        createdByStaffProfileId: "staff-1",
        name: "Loose wave bundle",
        lookupCode: "999888777666",
        price: 45,
        quantitySold: 2,
        registerSessionId: "register-session-1",
        terminalId: "terminal-1",
        localEventId: "event-pending-item-1",
        source: "offline_sync",
        timestamp: 15,
      }),
    ]);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        localIdKind: "pendingCheckoutItem",
        localId: "local-pending-item-1",
        cloudTable: "posPendingCheckoutItem",
        cloudId: "pending-checkout-item-1",
      }),
    ]);
  });

  it("reuses an existing local pending checkout item mapping without adding duplicate evidence", async () => {
    const repository = createProjectionRepository();
    const event = buildPendingCheckoutItemDefinedEvent();

    await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event,
      syncEventId: "sync-event-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });
    const retry = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event,
      syncEventId: "sync-event-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });

    expect(retry.status).toBe("projected");
    expect(retry.mappings).toEqual([
      expect.objectContaining({
        localIdKind: "pendingCheckoutItem",
        localId: "local-pending-item-1",
        cloudId: "pending-checkout-item-1",
      }),
    ]);
    expect(repository.createdPendingCheckoutItems).toHaveLength(1);
  });

  it("reuses an existing register-session repair mapping for the same cloud drawer", async () => {
    const repository = createProjectionRepository();

    const mapping = await createOrReuseRegisterSessionRepairMapping(repository, {
      localEventId: "event-register-opened-1",
      localRegisterSessionId: "local-register-1",
      now: 100,
      registerSessionId: "register-session-1" as Id<"registerSession">,
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(mapping).toEqual(
      expect.objectContaining({
        _id: "mapping-register",
        cloudId: "register-session-1",
        localId: "local-register-1",
      }),
    );
    expect(repository.mappings).toHaveLength(1);
  });

  it("replays register open idempotently after a repair-created register mapping", async () => {
    const repository = createProjectionRepository();
    repository.mappings[0] = {
      ...repository.mappings[0],
      localEventId: "event-sale-repaired-1",
      sourceEventType: "repair",
    };

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-1",
        localRegisterSessionId: "local-register-1",
        sequence: 1,
        eventType: "register_opened",
        occurredAt: 10,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          openingFloat: 100,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.mappings).toEqual([
      expect.objectContaining({
        cloudId: "register-session-1",
        localId: "local-register-1",
        localEventId: "event-sale-repaired-1",
        sourceEventType: "repair",
      }),
    ]);
    expect(result.conflicts).toEqual([]);
    expect(repository.createdRegisterSessions).toEqual([]);
  });

  it("rejects register-session repair when the local drawer maps elsewhere", async () => {
    const repository = createProjectionRepository();

    await expect(
      createOrReuseRegisterSessionRepairMapping(repository, {
        localEventId: "event-sale-1",
        localRegisterSessionId: "local-register-1",
        now: 100,
        registerSessionId: "other-register-session" as Id<"registerSession">,
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
      }),
    ).rejects.toThrow(
      "POS local sync register-session mapping already belongs to another projection.",
    );
  });

  it("resolves offline pending sale lines through the pending item mapping before validating provisional anchors", async () => {
    const repository = createProjectionRepository({
      existingPosSession: {
        _id: "local-session-1",
        registerSessionId: "register-session-1",
        staffProfileId: "staff-1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });

    const definition = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildPendingCheckoutItemDefinedEvent(),
      syncEventId: "sync-event-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });
    const sale = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          items: [
            {
              localTransactionItemId: "local-pending-sale-line-1",
              pendingCheckoutItemId: "local-pending-item-1" as never,
              productId: "local-provisional-product-1" as never,
              productName: "Loose wave bundle",
              productSku: "PENDING-LOCAL",
              productSkuId: "local-provisional-sku-1" as never,
              quantity: 1,
              unitPrice: 25,
            },
          ],
        },
      }),
      syncEventId: "sync-event-2",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });

    expect(definition.status).toBe("projected");
    expect(sale.status).toBe("projected");
    expect(repository.createdTransactionItems).toEqual([
      expect.objectContaining({
        pendingCheckoutItemId: "pending-checkout-item-1",
        productId: "product-1",
        productSkuId: "sku-1",
      }),
    ]);
  });

  it("conflicts offline pending sale lines before the pending item definition has synced", async () => {
    const repository = createProjectionRepository({
      existingPosSession: {
        _id: "local-session-1",
        registerSessionId: "register-session-1",
        staffProfileId: "staff-1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          items: [
            {
              localTransactionItemId: "local-pending-sale-line-1",
              pendingCheckoutItemId: "local-pending-item-1" as never,
              productId: "local-provisional-product-1" as never,
              productName: "Loose wave bundle",
              productSku: "PENDING-LOCAL",
              productSkuId: "local-provisional-sku-1" as never,
              quantity: 1,
              unitPrice: 25,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.createdConflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        summary: "Pending checkout item reference has not synced yet.",
        details: expect.objectContaining({
          blocksProjection: true,
          pendingCheckoutItemId: "local-pending-item-1",
        }),
      }),
    ]);
    expect(repository.createdTransactions).toEqual([]);
    expect(repository.createdPaymentAllocations).toEqual([]);
    expect(repository.recordedPendingCheckoutItemSaleEvidence).toEqual([]);
  });

  it("projects offline pending sale facts when the cloud pending item is no longer saleable", async () => {
    const repository = createProjectionRepository({
      existingPosSession: {
        _id: "local-session-1",
        registerSessionId: "register-session-1",
        staffProfileId: "staff-1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      pendingCheckoutItem: {
        _id: "pending-checkout-item-1",
        storeId: "store-1",
        status: "approved",
        provisionalProductId: "product-1",
        provisionalProductSkuId: "sku-1",
      },
      validCloudIds: new Set(["pending-checkout-item-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          items: [
            {
	              localTransactionItemId: "local-pending-sale-line-1",
	              pendingCheckoutItemId: "pending-checkout-item-1" as never,
	              productId: "local-pending-product-1" as never,
	              productName: "Loose wave bundle",
	              productSku: "PENDING-LOCAL",
	              productSkuId: "local-pending-sku-1" as never,
              quantity: 1,
              unitPrice: 25,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.createdConflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        summary: "Pending checkout item reference does not match this sale line.",
        details: expect.objectContaining({
          blocksProjection: false,
          pendingCheckoutItemId: "pending-checkout-item-1",
        }),
      }),
    ]);
    expect(repository.createdTransactions).toHaveLength(1);
    expect(repository.createdTransactionItems).toEqual([
      expect.objectContaining({
        pendingCheckoutItemId: "pending-checkout-item-1",
        productId: "product-1",
        productSkuId: "sku-1",
      }),
    ]);
    expect(repository.createdPaymentAllocations).toHaveLength(1);
    expect(repository.productPatches).toEqual([]);
    expect(repository.recordedPendingCheckoutItemSaleEvidence).toEqual([
      expect.objectContaining({
        pendingCheckoutItemId: "pending-checkout-item-1",
        quantitySold: 1,
        source: "offline_sync",
      }),
    ]);
  });

  it("preserves pending checkout item sale lines without trusted stock movement", async () => {
    const repository = createProjectionRepository({
      existingPosSession: {
        _id: "local-session-1",
        registerSessionId: "register-session-1",
        staffProfileId: "staff-1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      validCloudIds: new Set(["pending-checkout-item-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          items: [
            {
              localTransactionItemId: "local-pending-sale-line-1",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              pendingCheckoutItemId: "pending-checkout-item-1" as never,
              productName: "Loose wave bundle",
              productSku: "PENDING-1",
              quantity: 1,
              unitPrice: 25,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.consumedHoldRequests).toEqual([
      {
        sessionId: "local-session-1",
        items: [],
        now: 20,
      },
    ]);
    expect(repository.productPatches).toEqual([]);
    expect(repository.createdTransactionItems).toEqual([
      expect.objectContaining({
        pendingCheckoutItemId: "pending-checkout-item-1",
        productId: "product-1",
        productSkuId: "sku-1",
        quantity: 1,
      }),
    ]);
  });

  it("preserves provisional import sale evidence without trusted stock movement", async () => {
    const repository = createProjectionRepository({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        productId: "product-1",
        sku: "IMP-CAP-1",
        price: 25,
        quantityAvailable: 0,
        inventoryCount: 0,
        images: [],
      },
      inventoryImportProvisionalSku: {
        _id: "provisional-import-sku-1",
        storeId: "store-1",
        status: "active",
        productId: "product-1",
        productSkuId: "sku-1",
        importedPrice: 25,
        importedBarcode: "999888777666",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          items: [
            {
              localTransactionItemId: "local-provisional-import-line-1",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              inventoryImportProvisionalSkuId: "provisional-import-sku-1",
              productName: "Imported Wig Cap",
              productSku: "IMP-CAP-1",
              quantity: 2,
              unitPrice: 25,
            },
          ],
          totals: {
            subtotal: 50,
            tax: 0,
            total: 50,
          },
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "cash",
              amount: 50,
              timestamp: 21,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.consumedHoldRequests).toEqual([]);
    expect(repository.productPatches).toEqual([]);
    expect(repository.recordedSaleInventoryMovements).toEqual([]);
    expect(repository.createdTransactionItems).toEqual([
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        productId: "product-1",
        productSkuId: "sku-1",
        quantity: 2,
      }),
    ]);
    expect(repository.createdPosSessionItems).toEqual([
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        productId: "product-1",
        productSkuId: "sku-1",
        quantity: 2,
      }),
    ]);
    expect(repository.recordedInventoryImportProvisionalSkuSaleEvidence).toEqual([
      {
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        posTransactionId: "transaction-1",
        quantitySold: 2,
        registerSessionId: "register-session-1",
        timestamp: 20,
      },
    ]);
  });

  it("preserves distinct provisional import sale evidence for offline same-SKU rows", async () => {
    const repository = createProjectionRepository({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        productId: "product-1",
        sku: "IMP-CAP-1",
        price: 25,
        quantityAvailable: 0,
        inventoryCount: 0,
        images: [],
      },
      inventoryImportProvisionalSkus: [
        {
          _id: "provisional-import-sku-1",
          storeId: "store-1",
          status: "active",
          productId: "product-1",
          productSkuId: "sku-1",
          importedPrice: 25,
        },
        {
          _id: "provisional-import-sku-2",
          storeId: "store-1",
          status: "active",
          productId: "product-1",
          productSkuId: "sku-1",
          importedPrice: 25,
        },
      ],
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          items: [
            {
              localTransactionItemId: "local-provisional-import-line-1",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              inventoryImportProvisionalSkuId: "provisional-import-sku-1",
              productName: "Imported Wig Cap",
              productSku: "IMP-CAP-1",
              quantity: 2,
              unitPrice: 25,
            },
            {
              localTransactionItemId: "local-provisional-import-line-2",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              inventoryImportProvisionalSkuId: "provisional-import-sku-2",
              productName: "Imported Wig Cap",
              productSku: "IMP-CAP-1",
              quantity: 3,
              unitPrice: 25,
            },
          ],
          totals: {
            subtotal: 125,
            tax: 0,
            total: 125,
          },
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "cash",
              amount: 125,
              timestamp: 21,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.productPatches).toEqual([]);
    expect(repository.recordedSaleInventoryMovements).toEqual([]);
    expect(repository.createdTransactionItems).toEqual([
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        productSkuId: "sku-1",
        quantity: 2,
      }),
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-import-sku-2",
        productSkuId: "sku-1",
        quantity: 3,
      }),
    ]);
    expect(repository.createdPosSessionItems).toEqual([
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        productSkuId: "sku-1",
        quantity: 2,
      }),
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-import-sku-2",
        productSkuId: "sku-1",
        quantity: 3,
      }),
    ]);
    expect(repository.recordedInventoryImportProvisionalSkuSaleEvidence).toEqual([
      {
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        posTransactionId: "transaction-1",
        quantitySold: 2,
        registerSessionId: "register-session-1",
        timestamp: 20,
      },
      {
        inventoryImportProvisionalSkuId: "provisional-import-sku-2",
        posTransactionId: "transaction-1",
        quantitySold: 3,
        registerSessionId: "register-session-1",
        timestamp: 20,
      },
    ]);
  });

  it("blocks offline sale lines with both pending checkout and provisional import sources", async () => {
    const repository = createProjectionRepository({
      inventoryImportProvisionalSku: {
        _id: "provisional-import-sku-1",
        storeId: "store-1",
        status: "active",
        productId: "product-1",
        productSkuId: "sku-1",
        importedPrice: 25,
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          items: [
            {
              localTransactionItemId: "local-conflicting-line-1",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              pendingCheckoutItemId: "pending-checkout-item-1" as never,
              inventoryImportProvisionalSkuId: "provisional-import-sku-1",
              productName: "Imported Wig Cap",
              productSku: "IMP-CAP-1",
              quantity: 2,
              unitPrice: 25,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        details: expect.objectContaining({
          blocksProjection: true,
          localTransactionItemId: "local-conflicting-line-1",
          pendingCheckoutItemId: "pending-checkout-item-1",
          inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        }),
      }),
    ]);
    expect(repository.createdTransactions).toEqual([]);
    expect(repository.createdTransactionItems).toEqual([]);
    expect(repository.recordedPendingCheckoutItemSaleEvidence).toEqual([]);
    expect(repository.recordedInventoryImportProvisionalSkuSaleEvidence).toEqual([]);
  });

  it("blocks offline provisional import sale lines when the row is inactive", async () => {
    const repository = createProjectionRepository({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        productId: "product-1",
        sku: "IMP-CAP-1",
        price: 25,
        quantityAvailable: 0,
        inventoryCount: 0,
        images: [],
      },
      inventoryImportProvisionalSku: {
        _id: "provisional-import-sku-1",
        storeId: "store-1",
        status: "closed",
        productId: "product-1",
        productSkuId: "sku-1",
        importedPrice: 25,
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          items: [
            {
              localTransactionItemId: "local-provisional-import-line-1",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              inventoryImportProvisionalSkuId: "provisional-import-sku-1",
              productName: "Imported Wig Cap",
              productSku: "IMP-CAP-1",
              quantity: 2,
              unitPrice: 25,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
          conflictType: "inventory",
          details: expect.objectContaining({
          blocksProjection: true,
          inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        }),
      }),
    ]);
    expect(repository.createdTransactions).toEqual([]);
    expect(repository.consumedHoldRequests).toEqual([]);
    expect(repository.productPatches).toEqual([]);
    expect(repository.recordedSaleInventoryMovements).toEqual([]);
    expect(repository.createdTransactionItems).toEqual([]);
    expect(repository.recordedInventoryImportProvisionalSkuSaleEvidence).toEqual([]);
  });

  it("blocks offline provisional import sale lines when the row is hidden from POS", async () => {
    const repository = createProjectionRepository({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        productId: "product-1",
        sku: "IMP-CAP-1",
        price: 25,
        quantityAvailable: 0,
        inventoryCount: 0,
        images: [],
      },
      inventoryImportProvisionalSku: {
        _id: "provisional-import-sku-1",
        storeId: "store-1",
        status: "active",
        posExposureStatus: "hidden",
        productId: "product-1",
        productSkuId: "sku-1",
        importedPrice: 25,
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          items: [
            {
              localTransactionItemId: "local-provisional-import-line-1",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              inventoryImportProvisionalSkuId: "provisional-import-sku-1",
              productName: "Imported Wig Cap",
              productSku: "IMP-CAP-1",
              quantity: 2,
              unitPrice: 25,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        details: expect.objectContaining({
          blocksProjection: true,
          inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        }),
      }),
    ]);
    expect(repository.createdTransactions).toEqual([]);
    expect(repository.consumedHoldRequests).toEqual([]);
    expect(repository.productPatches).toEqual([]);
    expect(repository.recordedSaleInventoryMovements).toEqual([]);
    expect(repository.createdTransactionItems).toEqual([]);
    expect(repository.recordedInventoryImportProvisionalSkuSaleEvidence).toEqual([]);
  });

  it("blocks offline sales that mix trusted and provisional lines for the same SKU", async () => {
    const repository = createProjectionRepository({
      inventoryImportProvisionalSku: {
        _id: "provisional-import-sku-1",
        storeId: "store-1",
        status: "active",
        productId: "product-1",
        productSkuId: "sku-1",
        importedPrice: 25,
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          items: [
            {
              localTransactionItemId: "local-provisional-import-line-1",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              inventoryImportProvisionalSkuId: "provisional-import-sku-1",
              productName: "Imported Wig Cap",
              productSku: "IMP-CAP-1",
              quantity: 1,
              unitPrice: 25,
            },
            {
              localTransactionItemId: "local-trusted-line-1",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              productName: "Imported Wig Cap",
              productSku: "IMP-CAP-1",
              quantity: 1,
              unitPrice: 25,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        details: expect.objectContaining({
          blocksProjection: true,
          productSkuId: "sku-1",
        }),
      }),
    ]);
    expect(repository.createdTransactions).toEqual([]);
    expect(repository.createdTransactionItems).toEqual([]);
    expect(repository.recordedInventoryImportProvisionalSkuSaleEvidence).toEqual([]);
    expect(repository.recordedSaleInventoryMovements).toEqual([]);
  });

  it("projects a completed local cash sale into transaction, payment, inventory, and trace-like records", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localIdKind: "transaction",
          localId: "local-txn-1",
          cloudTable: "posTransaction",
        }),
        expect.objectContaining({
          localIdKind: "payment",
          localId: "local-payment-1",
          cloudTable: "paymentAllocation",
        }),
      ]),
    );
    expect(repository.createdTransactions).toEqual([
      expect.objectContaining({
        transactionNumber: "LR-001",
        total: 25,
        paymentMethod: "cash",
        payments: [{ method: "cash", amount: 25, timestamp: 21 }],
      }),
    ]);
    expect(repository.posSessionPatches).toEqual([
      {
        posSessionId: "pos-session-local-session-1",
        patch: expect.objectContaining({
          total: 25,
          transactionId: "transaction-1",
        }),
      },
    ]);
    expect(repository.createdPaymentAllocations).toEqual([
      expect.objectContaining({
        targetType: "pos_transaction",
        method: "cash",
        amount: 25,
        registerSessionId: "register-session-1",
        posTransactionId: "transaction-1",
      }),
    ]);
    expect(repository.registerSessionPatches).toEqual(
      expect.arrayContaining([
        {
          registerSessionId: "register-session-1",
          patch: {
            expectedCash: 125,
          },
        },
        {
          registerSessionId: "register-session-1",
          patch: {
            workflowTraceId: "register-trace-1",
          },
        },
      ]),
    );
	    expect(repository.productPatches).toEqual([
	      {
	        productSkuId: "sku-1",
        patch: {
          inventoryCount: 9,
          quantityAvailable: 9,
        },
	      },
	    ]);
	    expect(repository.recordedSaleInventoryMovements).toEqual([
	      expect.objectContaining({
	        posTransactionId: "transaction-1",
	        productSkuId: "sku-1",
	        quantity: 1,
	        transactionNumber: "LR-001",
	      }),
	    ]);
    expect(repository.createdOperationalEvents).toEqual([
      expect.objectContaining({
        eventType: "pos_local_sync.sale_projected",
        message:
          "Sale #LR-001 synced: 1 sale line, GH₵0.25, cash.",
        metadata: expect.objectContaining({
          lineCount: 1,
          localReceiptNumber: "LR-001",
          paymentMethods: ["cash"],
          receiptNumber: "LR-001",
          total: 25,
          transactionNumber: "LR-001",
        }),
        posTransactionId: "transaction-1",
      }),
    ]);
  });

  it("conflicts sale projection when a direct cloud drawer id has an open closeout review", async () => {
    const repository = createProjectionRepository({
      registerSessionsWithCloseoutReview: new Set(["register-session-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        localRegisterSessionId: "register-session-1",
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.createdTransactions).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "Register session mapping points to a reviewed closeout.",
      }),
    ]);
  });

  it("conflicts sale projection when a mapped local drawer has an open closeout review", async () => {
    const repository = createProjectionRepository({
      registerReviewConflictFacts: [
        {
          conflict: {
            _id: "review-conflict-local-register-1",
            conflictType: "permission",
            createdAt: 1_700_000_000_000,
            details: {
              countedCash: 100,
              expectedCash: 90,
              variance: 10,
            },
            localEventId: "review-event-local-register-1",
            localRegisterSessionId: "local-register-1",
            sequence: 3,
            status: "needs_review",
            storeId: "store-1" as never,
            summary:
              "Register closeout variance requires manager review before synced closeout can be applied.",
            terminalId: "terminal-1" as never,
          },
          directRegisterSession: null,
          registerSessionMapping: {
            _id: "mapping-register",
            storeId: "store-1" as never,
            terminalId: "terminal-1" as never,
            localRegisterSessionId: "local-register-1",
            localEventId: "event-register-opened-1",
            localIdKind: "registerSession",
            localId: "local-register-1",
            cloudTable: "registerSession",
            cloudId: "register-session-1" as never,
            createdAt: 1,
          },
        },
      ],
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        localRegisterSessionId: "local-register-1",
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.createdTransactions).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "Register session mapping points to a reviewed closeout.",
      }),
    ]);
  });

  it("aggregates duplicate pending checkout lines before recording sale evidence", async () => {
    const repository = createProjectionRepository({
      existingPosSession: {
        _id: "local-session-1",
        registerSessionId: "register-session-1",
        staffProfileId: "staff-1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      validCloudIds: new Set(["pending-checkout-item-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          items: [
            {
              localTransactionItemId: "local-pending-sale-line-1",
              pendingCheckoutItemId: "pending-checkout-item-1" as never,
              productId: "product-1" as never,
              productName: "Loose wave bundle",
              productSku: "PENDING-1",
              productSkuId: "sku-1" as never,
              quantity: 1,
              unitPrice: 25,
            },
            {
              localTransactionItemId: "local-pending-sale-line-2",
              pendingCheckoutItemId: "pending-checkout-item-1" as never,
              productId: "product-1" as never,
              productName: "Loose wave bundle",
              productSku: "PENDING-1",
              productSkuId: "sku-1" as never,
              quantity: 2,
              unitPrice: 25,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.recordedPendingCheckoutItemSaleEvidence).toEqual([
      expect.objectContaining({
        pendingCheckoutItemId: "pending-checkout-item-1",
        quantitySold: 3,
      }),
    ]);
  });

  it("records offline sale evidence for flagged pending checkout items", async () => {
    const repository = createProjectionRepository({
      existingPosSession: {
        _id: "local-session-1",
        registerSessionId: "register-session-1",
        staffProfileId: "staff-1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      pendingCheckoutItem: {
        _id: "pending-checkout-item-1",
        storeId: "store-1",
        status: "flagged",
        provisionalProductId: "product-1",
        provisionalProductSkuId: "sku-1",
      },
      validCloudIds: new Set(["pending-checkout-item-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          items: [
            {
              localTransactionItemId: "local-pending-sale-line-1",
              pendingCheckoutItemId: "pending-checkout-item-1" as never,
              productId: "product-1" as never,
              productName: "Loose wave bundle",
              productSku: "PENDING-1",
              productSkuId: "sku-1" as never,
              quantity: 2,
              unitPrice: 25,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.createdTransactionItems).toEqual([
      expect.objectContaining({
        pendingCheckoutItemId: "pending-checkout-item-1",
        productId: "product-1",
        productSkuId: "sku-1",
      }),
    ]);
    expect(repository.productPatches).toEqual([]);
    expect(repository.recordedPendingCheckoutItemSaleEvidence).toEqual([
      expect.objectContaining({
        pendingCheckoutItemId: "pending-checkout-item-1",
        quantitySold: 2,
        source: "offline_sync",
      }),
    ]);
  });

  it("projects a mixed product and service sale into one receipt with split ledgers and one drawer tender effect", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          customerProfileId: "customer-1" as never,
          totals: {
            subtotal: 100,
            tax: 0,
            total: 100,
          },
          items: [
            {
              localTransactionItemId: "local-txn-item-1",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              productName: "Wig Cap",
              productSku: "CAP-1",
              quantity: 1,
              unitPrice: 25,
            },
          ],
          serviceLines: [
            buildServiceLine({
              localServiceLineId: "local-service-line-1",
              localServiceCaseId: "local-service-case-1",
              unitPrice: 75,
              totalPrice: 75,
            }),
          ],
          payments: [
            {
              localPaymentId: "local-payment-cash",
              method: "cash",
              amount: 60,
              timestamp: 21,
            },
            {
              localPaymentId: "local-payment-card",
              method: "card",
              amount: 40,
              timestamp: 22,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.createdTransactions).toEqual([
      expect.objectContaining({
        total: 100,
        payments: [
          { method: "cash", amount: 60, timestamp: 21 },
          { method: "card", amount: 40, timestamp: 22 },
        ],
      }),
    ]);
    expect(repository.createdTransactionItems).toEqual([
      expect.objectContaining({
        productSkuId: "sku-1",
        totalPrice: 25,
      }),
    ]);
    expect(repository.createdServiceCases).toEqual([
      expect.objectContaining({
        customerProfileId: "customer-1",
        serviceCatalogId: "service-catalog-1",
        quotedAmount: 75,
      }),
    ]);
    expect(repository.createdServiceCaseLineItems).toEqual([
      expect.objectContaining({
        serviceCaseId: "service-case-1",
        description: "Install",
        amount: 75,
      }),
    ]);
    expect(repository.createdTransactionServiceLines).toEqual([
      expect.objectContaining({
        transactionId: "transaction-1",
        serviceCaseId: "service-case-1",
        serviceCatalogId: "service-catalog-1",
        serviceName: "Install",
        totalPrice: 75,
      }),
    ]);
    expect(repository.createdPaymentAllocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: "pos_transaction",
          targetId: "transaction-1",
          method: "cash",
          amount: 25,
        }),
        expect.objectContaining({
          targetType: "service_case",
          targetId: "service-case-1",
          method: "cash",
          amount: 35,
          registerSessionId: "register-session-1",
          posTransactionId: "transaction-1",
        }),
        expect.objectContaining({
          targetType: "service_case",
          targetId: "service-case-1",
          method: "card",
          amount: 40,
          registerSessionId: "register-session-1",
          posTransactionId: "transaction-1",
        }),
      ]),
    );
    expect(repository.createdOperationalEvents).toEqual([
      expect.objectContaining({
        eventType: "pos_local_sync.sale_projected",
        message:
          "Sale #LR-001 synced: 2 sale lines, GH₵1, cash and card.",
        metadata: expect.objectContaining({
          lineCount: 2,
          paymentMethods: ["cash", "card"],
          total: 100,
        }),
      }),
    ]);
    expect(repository.registerSessionPatches).toEqual(
      expect.arrayContaining([
        {
          registerSessionId: "register-session-1",
          patch: {
            expectedCash: 160,
          },
        },
      ]),
    );
    expect(result.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localIdKind: "serviceCase",
          localId: "local-service-case-1",
          cloudTable: "serviceCase",
          cloudId: "service-case-1",
        }),
        expect.objectContaining({
          localIdKind: "serviceLine",
          localId: "local-service-line-1",
          cloudTable: "serviceCaseLineItem",
          cloudId: "service-line-1",
        }),
      ]),
    );
  });

  it("names every payment method on the projected sale timeline event", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          payments: [
            {
              localPaymentId: "local-payment-cash",
              method: "cash",
              amount: 10,
              timestamp: 21,
            },
            {
              localPaymentId: "local-payment-card",
              method: "card",
              amount: 5,
              timestamp: 22,
            },
            {
              localPaymentId: "local-payment-mobile-money",
              method: "mobile_money",
              amount: 10,
              timestamp: 23,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.createdOperationalEvents).toEqual([
      expect.objectContaining({
        eventType: "pos_local_sync.sale_projected",
        message:
          "Sale #LR-001 synced: 1 sale line, GH₵0.25, cash, card, and mobile money.",
        metadata: expect.objectContaining({
          paymentMethods: ["cash", "card", "mobile money"],
        }),
      }),
    ]);
  });

  it("records non-cash projected sale trace evidence without increasing expected cash", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          payments: [
            {
              localPaymentId: "local-payment-card",
              method: "card",
              amount: 25,
              timestamp: 21,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.registerSessionPatches).not.toContainEqual({
      registerSessionId: "register-session-1",
      patch: expect.objectContaining({
        expectedCash: expect.any(Number),
      }),
    });
    expect(repository.recordedRegisterSessionTraces).toEqual([
      expect.objectContaining({
        amount: 0,
        cashDelta: 0,
        paymentCount: 1,
        paymentMethodLabels: ["card"],
        saleTotal: 25,
        stage: "sale_recorded",
        syncOrigin: "local_sync",
        transactionId: "transaction-1",
        transactionNumber: "LR-001",
      }),
    ]);
  });

  it("projects service-only sales without product inventory movement or retail allocations", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          customerProfileId: "customer-1" as never,
          totals: { subtotal: 75, tax: 0, total: 75 },
          items: [],
          serviceLines: [buildServiceLine()],
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "card",
              amount: 75,
              timestamp: 21,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.createdTransactions).toHaveLength(1);
    expect(repository.createdTransactionItems).toEqual([]);
    expect(repository.productPatches).toEqual([]);
    expect(repository.createdPaymentAllocations).toEqual([
      expect.objectContaining({
        _id: "payment-allocation-1",
        targetType: "service_case",
        amount: 75,
        method: "card",
      }),
    ]);
    expect(result.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localIdKind: "payment",
          localId: "local-payment-1",
          cloudTable: "paymentAllocation",
          cloudId: "payment-allocation-1",
        }),
      ]),
    );
  });

  it("attaches service lines to an existing active service case without creating a duplicate case", async () => {
    const repository = createProjectionRepository({
      serviceCase: {
        _id: "service-case-existing",
        storeId: "store-1",
        organizationId: "org-1",
        operationalWorkItemId: "work-item-existing",
        customerProfileId: "customer-1",
        status: "in_progress",
      },
      validCloudIds: new Set(["service-case-existing"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          totals: { subtotal: 75, tax: 0, total: 75 },
          items: [],
          serviceLines: [
            buildServiceLine({
              existingServiceCaseId: "service-case-existing" as never,
              localServiceCaseId: undefined,
            }),
          ],
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "cash",
              amount: 75,
              timestamp: 21,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.createdServiceCases).toEqual([]);
    expect(repository.createdServiceCaseLineItems).toEqual([
      expect.objectContaining({
        serviceCaseId: "service-case-existing",
        amount: 75,
      }),
    ]);
    expect(repository.createdPaymentAllocations).toEqual([
      expect.objectContaining({
        targetId: "service-case-existing",
        workItemId: "work-item-existing",
      }),
    ]);
  });

  it("applies cash change once while splitting mixed service allocations", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          customerProfileId: "customer-1" as never,
          totals: { subtotal: 100, tax: 0, total: 100 },
          serviceLines: [buildServiceLine({ unitPrice: 75, totalPrice: 75 })],
          payments: [
            {
              localPaymentId: "local-payment-cash",
              method: "cash",
              amount: 120,
              timestamp: 21,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.createdTransactions).toEqual([
      expect.objectContaining({
        changeGiven: 20,
        totalPaid: 120,
      }),
    ]);
    expect(repository.createdPaymentAllocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetType: "pos_transaction", amount: 25 }),
        expect.objectContaining({ targetType: "service_case", amount: 75 }),
      ]),
    );
    expect(repository.registerSessionPatches).toEqual(
      expect.arrayContaining([
        { registerSessionId: "register-session-1", patch: { expectedCash: 200 } },
      ]),
    );
  });

  it("conflicts service sales without customer attribution before creating cases", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          totals: { subtotal: 75, tax: 0, total: 75 },
          items: [],
          serviceLines: [buildServiceLine()],
          payments: [{ method: "card", amount: 75, timestamp: 21 }],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        summary: "Service line is missing customer attribution.",
      }),
    ]);
    expect(repository.createdServiceCases).toEqual([]);
  });

  it("conflicts service catalog store or snapshot drift before projection", async () => {
    const repository = createProjectionRepository({
      serviceCatalog: {
        _id: "service-catalog-1",
        storeId: "store-1",
        organizationId: "org-1",
        name: "Install",
        serviceMode: "same_day",
        pricingModel: "fixed",
        basePrice: 90,
        status: "active",
        updatedAt: 1_100,
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          customerProfileId: "customer-1" as never,
          totals: { subtotal: 75, tax: 0, total: 75 },
          items: [],
          serviceLines: [buildServiceLine()],
          payments: [{ method: "card", amount: 75, timestamp: 21 }],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        summary: "Service catalog changed before this offline sale synced.",
      }),
    ]);
    expect(repository.createdServiceCases).toEqual([]);
  });

  it("keeps the display receipt number separate from the local sync receipt id", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          localReceiptNumber: "local-txn-1",
          receiptNumber: "123456",
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.createdTransactions).toEqual([
      expect.objectContaining({
        transactionNumber: "123456",
      }),
    ]);
    expect(result.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localIdKind: "receipt",
          localId: "local-txn-1",
        }),
      ]),
    );
  });

  it("projects cashier sales on admin-provisioned shared terminals", async () => {
    const repository = createProjectionRepository({
      terminalRegisteredByUserId: "admin-user-1",
      staffProfile: {
        _id: "staff-1",
        linkedUserId: "cashier-user-1",
        status: "active",
        storeId: "store-1",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      submittedByUserId: "cashier-user-1" as never,
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.createdTransactions).toHaveLength(1);
    expect(repository.createdConflicts).toEqual([]);
  });

  it("projects cashier sales when the signed-in uploader is not the event staff profile", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      submittedByUserId: "different-user-1" as never,
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(repository.createdTransactions).toHaveLength(1);
    expect(repository.createdPaymentAllocations).toHaveLength(1);
  });

  it("preserves the local actor through sale, cash-control, and workflow trace projection", async () => {
    const repository = createProjectionRepository({
      staffProfiles: [
        {
          _id: "staff-1",
          linkedUserId: "manager-user-1",
          status: "active",
          storeId: "store-1",
        },
        {
          _id: "staff-2",
          linkedUserId: "cashier-user-2",
          status: "active",
          storeId: "store-1",
        },
      ],
      validateLocalStaffProof: (args) =>
        args.staffProfileId === "staff-2" && args.token === "proof-token-2",
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        staffProfileId: "staff-2" as never,
        staffProofToken: "proof-token-2",
        payload: {
          ...buildSaleCompletedEvent().payload,
          localPosSessionId: "local-session-staff-2",
          localTransactionId: "local-txn-staff-2",
          localReceiptNumber: "LR-ST2",
          receiptNumber: "000222",
          payments: [
            {
              localPaymentId: "local-payment-staff-2",
              method: "cash",
              amount: 25,
              timestamp: 21,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      submittedByUserId: "hub-user-1" as never,
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.createdTransactions).toEqual([
      expect.objectContaining({
        staffProfileId: "staff-2",
        transactionNumber: "000222",
      }),
    ]);
    expect(repository.createdPaymentAllocations).toEqual([
      expect.objectContaining({
        actorStaffProfileId: "staff-2",
        externalReference: "local-payment-staff-2",
        registerSessionId: "register-session-1",
      }),
    ]);
    expect(repository.createdOperationalEvents).toEqual([
      expect.objectContaining({
        actorStaffProfileId: "staff-2",
        eventType: "pos_local_sync.sale_projected",
        metadata: expect.objectContaining({
          localReceiptNumber: "LR-ST2",
          receiptNumber: "000222",
        }),
        posTransactionId: "transaction-1",
      }),
    ]);
    expect(repository.recordedPosSessionTraces).toEqual([
      expect.objectContaining({
        stage: "completed",
        transactionId: "transaction-1",
        session: expect.objectContaining({
          staffProfileId: "staff-2",
        }),
      }),
    ]);
    expect(repository.recordedRegisterSessionTraces).toEqual([
      expect.objectContaining({
        actorStaffProfileId: "staff-2",
        amount: 25,
        cashDelta: 25,
        paymentCount: 1,
        paymentMethodLabels: ["cash"],
        saleTotal: 25,
        stage: "sale_recorded",
        syncOrigin: "local_sync",
        transactionId: "transaction-1",
        transactionNumber: "000222",
      }),
    ]);
  });

  it("projects PIN-authenticated cashier sales for active POS staff without linked user proof", async () => {
    const repository = createProjectionRepository({
      staffProfile: {
        _id: "staff-1",
        status: "active",
        storeId: "store-1",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(repository.createdTransactions).toHaveLength(1);
  });

  it("conflicts active cashier sales without a valid offline staff proof", async () => {
    const repository = createProjectionRepository({ validStaffProof: false });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        details: expect.objectContaining({
          eventType: "sale_completed",
          hasStaffProof: true,
          staffProfileId: "staff-1",
        }),
      }),
    ]);
    expect(repository.createdTransactions).toHaveLength(0);
  });

  it("does not let stored staff trust override an invalid offline staff proof", async () => {
    const repository = createProjectionRepository({ validStaffProof: false });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      now: 100,
      options: {
        trustStoredStaffProof: true,
      },
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        details: expect.objectContaining({
          eventType: "sale_completed",
          hasStaffProof: true,
          staffProfileId: "staff-1",
        }),
      }),
    ]);
    expect(repository.createdTransactions).toHaveLength(0);
  });

  it("conflicts active cashier sales without an offline staff proof token", async () => {
    const repository = createProjectionRepository();
    const event = buildSaleCompletedEvent();
    delete event.staffProofToken;

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event,
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        details: expect.objectContaining({
          eventType: "sale_completed",
          hasStaffProof: false,
          staffProfileId: "staff-1",
        }),
      }),
    ]);
    expect(repository.createdTransactions).toHaveLength(0);
  });

  it("projects cashier register opens with valid offline staff proof", async () => {
    const repository = createProjectionRepository({
      hasActivePosRole: ({ allowedRoles }) => allowedRoles.includes("cashier"),
      registerSession: null,
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-cashier",
        localRegisterSessionId: "local-register-cashier",
        sequence: 4,
        eventType: "register_opened",
        occurredAt: 20,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          openingFloat: 100,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(repository.createdRegisterSessions).toEqual([
      expect.objectContaining({
        openedByStaffProfileId: "staff-1",
        openingFloat: 100,
        registerNumber: "1",
      }),
    ]);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        localIdKind: "registerSession",
        localId: "local-register-cashier",
        cloudTable: "registerSession",
      }),
    ]);
  });

  it("conflicts register opens without valid offline staff proof", async () => {
    const repository = createProjectionRepository({ validStaffProof: false });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-proof",
        localRegisterSessionId: "local-register-proof",
        sequence: 4,
        eventType: "register_opened",
        occurredAt: 20,
        staffProfileId: "staff-1" as never,
        staffProofToken: "forged-proof-token",
        payload: {
          openingFloat: 100,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        details: expect.objectContaining({
          eventType: "register_opened",
          hasStaffProof: true,
          staffProfileId: "staff-1",
        }),
      }),
    ]);
  });

  it("maps cashier-seeded already-open cloud register sessions with cashier open permission", async () => {
    const repository = createProjectionRepository({
      hasActivePosRole: ({ allowedRoles }) => allowedRoles.includes("cashier"),
      registerSession: {
        _id: "register-session-1",
        expectedCash: 100,
        closeoutRecords: [],
        registerNumber: "1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      } as never,
      validCloudIds: new Set(["register-session-1"]),
      validStaffProof: true,
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-seed",
        localRegisterSessionId: "register-session-1",
        sequence: 2,
        eventType: "register_opened",
        occurredAt: 20,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          openingFloat: 100,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        localIdKind: "registerSession",
        localId: "register-session-1",
        cloudTable: "registerSession",
        cloudId: "register-session-1",
      }),
    ]);
  });

  it.each(["closing", "closed"])(
    "conflicts cashier-seeded cloud register sessions that are %s",
    async (status) => {
      const repository = createProjectionRepository({
        hasActivePosRole: ({ allowedRoles }) => allowedRoles.includes("cashier"),
        registerSession: {
          _id: "register-session-1",
          expectedCash: 100,
          closeoutRecords: [],
          registerNumber: "1",
          status,
          storeId: "store-1",
          terminalId: "terminal-1",
        } as never,
        validCloudIds: new Set(["register-session-1"]),
        validStaffProof: true,
      });

      const result = await projectLocalSyncEvent(repository, {
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        event: {
          localEventId: `event-register-opened-${status}`,
          localRegisterSessionId: "register-session-1",
          sequence: 1,
          eventType: "register_opened",
          occurredAt: 20,
          staffProfileId: "staff-1" as never,
          staffProofToken: "proof-token-1",
          payload: {
            openingFloat: 100,
            registerNumber: "1",
          },
        },
        syncEventId: "sync-event-1",
        now: 100,
      });

      expect(result.status).toBe("conflicted");
      expect(result.mappings).toEqual([]);
    },
  );

  it("conflicts register closeouts without valid offline staff proof", async () => {
    const repository = createProjectionRepository({ validStaffProof: false });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-unproven",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "forged-proof-token",
        payload: {
          countedCash: 100,
          notes: "Closed drawer",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.registerSessionPatches).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        details: expect.objectContaining({
          eventType: "register_closed",
          hasStaffProof: true,
          staffProfileId: "staff-1",
        }),
      }),
    ]);
  });

  it("conflicts cashier sales when the staff profile is inactive", async () => {
    const repository = createProjectionRepository({
      staffProfile: {
        _id: "staff-1",
        linkedUserId: "user-1",
        status: "inactive",
        storeId: "store-1",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "Staff access changed before this POS history synced.",
      }),
    ]);
    expect(repository.createdTransactions).toEqual([]);
  });

  it("records cash allocations net of change using the canonical POS target type", async () => {
    const repository = createProjectionRepository();

    await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          totals: {
            subtotal: 25,
            tax: 0,
            total: 25,
          },
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "cash",
              amount: 30,
              timestamp: 21,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(repository.createdPaymentAllocations).toEqual([
      expect.objectContaining({
        amount: 25,
        externalReference: "local-payment-1",
        targetType: "pos_transaction",
      }),
    ]);
    expect(repository.registerSessionPatches).toEqual(
      expect.arrayContaining([
        {
          registerSessionId: "register-session-1",
          patch: {
            expectedCash: 125,
          },
        },
        {
          registerSessionId: "register-session-1",
          patch: {
            workflowTraceId: "register-trace-1",
          },
        },
      ]),
    );
  });

  it("projects checkout for an existing cloud POS session without duplicating cart items or self-conflicting on holds", async () => {
    const repository = createProjectionRepository({
      activeHeldQuantity: 5,
      consumedHoldQuantities: new Map([["sku-1", 1]]),
      existingPosSession: {
        _id: "pos-session-1",
        registerSessionId: "register-session-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...(buildSaleCompletedEvent().payload as PosLocalSalePayload),
          localPosSessionId: "pos-session-1",
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.createdPosSessionItems).toEqual([]);
    expect(repository.consumedHoldRequests).toEqual([
      expect.objectContaining({
        sessionId: "pos-session-1",
        items: [expect.objectContaining({ productSkuId: "sku-1", quantity: 1 })],
      }),
    ]);
    expect(repository.productPatches).toEqual([
      {
        productSkuId: "sku-1",
        patch: {
          inventoryCount: 9,
          quantityAvailable: 9,
        },
      },
    ]);
    expect(repository.posSessionPatches).toEqual([
      expect.objectContaining({
        posSessionId: "pos-session-1",
        patch: expect.objectContaining({
          completedAt: 20,
          status: "completed",
          transactionId: "transaction-1",
        }),
      }),
    ]);
  });

  it("preserves an existing session sale with a reconciliation conflict when ledger holds no longer cover the sale", async () => {
    const repository = createProjectionRepository({
      consumedHoldQuantities: new Map([["sku-1", 1]]),
      existingPosSession: {
        _id: "pos-session-1",
        registerSessionId: "register-session-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });
    const baseEvent = buildSaleCompletedEvent();
    const basePayload = baseEvent.payload as PosLocalSalePayload;

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...basePayload,
          localPosSessionId: "pos-session-1",
          totals: {
            subtotal: 50,
            tax: 0,
            total: 50,
          },
          items: [
            {
              ...basePayload.items[0],
              quantity: 2,
            },
          ],
          payments: [
            {
              ...basePayload.payments[0],
              amount: 50,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        details: expect.objectContaining({
          heldForSession: 1,
          reason: "existing_pos_session_hold_expired",
          requestedQuantity: 2,
        }),
      }),
    ]);
    expect(repository.createdTransactions).toHaveLength(1);
    expect(repository.createdPosSessionItems).toEqual([]);
	    expect(repository.consumedHoldRequests).toEqual([]);
	    expect(repository.productPatches).toEqual([]);
	    expect(repository.recordedSaleInventoryMovements).toEqual([]);
  });

  it("conflicts cloud POS session ids that are not bound to the synced register session", async () => {
    const repository = createProjectionRepository({
      validCloudIds: new Set(["pos-session-other"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          localPosSessionId: "pos-session-other",
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "POS session does not belong to this synced register history.",
      }),
    ]);
    expect(repository.createdTransactions).toHaveLength(0);
  });

  it("conflicts sale completion for a session already voided by a synced clear", async () => {
    const repository = createProjectionRepository({
      existingPosSession: {
        _id: "pos-session-1",
        registerSessionId: "register-session-1",
        staffProfileId: "staff-1",
        status: "void",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      validCloudIds: new Set(["pos-session-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          localPosSessionId: "pos-session-1",
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "Cleared POS sessions cannot be completed from synced local history.",
      }),
    ]);
    expect(repository.createdTransactions).toEqual([]);
    expect(repository.posSessionPatches).toEqual([]);
  });

  it("conflicts existing cloud POS sessions owned by a different staff profile", async () => {
    const repository = createProjectionRepository({
      existingPosSession: {
        _id: "pos-session-1",
        registerSessionId: "register-session-1",
        staffProfileId: "staff-2",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...(buildSaleCompletedEvent().payload as PosLocalSalePayload),
          localPosSessionId: "pos-session-1",
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "POS session does not belong to the synced staff proof.",
      }),
    ]);
    expect(repository.createdTransactions).toEqual([]);
    expect(repository.posSessionPatches).toEqual([]);
  });

  it("preserves completed offline sales with an inventory reconciliation conflict", async () => {
    const repository = createProjectionRepository({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        productId: "product-1",
        sku: "CAP-1",
        price: 25,
        quantityAvailable: 0,
        inventoryCount: 0,
        images: [],
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      now: 100,
    });

	    expect(result.status).toBe("conflicted");
    expect(repository.createdTransactions).toHaveLength(1);
    expect(repository.productPatches).toEqual([]);
    expect(repository.recordedSaleInventoryMovements).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        status: "needs_review",
        summary: "Inventory needs manager review for a synced offline sale.",
      }),
    ]);
    const retry = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      now: 100,
    });
    expect(retry.status).toBe("conflicted");
    expect(retry.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        status: "needs_review",
      }),
    ]);
    expect(repository.createdTransactions).toHaveLength(1);
  });

  it("creates a payment reconciliation conflict for malformed payment records", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "",
              amount: 0,
              timestamp: 21,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.createdTransactions).toHaveLength(1);
    expect(repository.createdPaymentAllocations).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "payment",
        summary: "Payment needs manager review for a synced offline sale.",
      }),
    ]);
  });

  it("preserves structurally valid underpaid sales with a payment conflict", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "cash",
              amount: 20,
              timestamp: 21,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.createdTransactions).toHaveLength(1);
    expect(repository.createdPaymentAllocations).toHaveLength(1);
    expect(repository.createdTransactions[0]).toEqual(
      expect.objectContaining({
        total: 25,
        totalPaid: 20,
        payments: [{ method: "cash", amount: 20, timestamp: 21 }],
      }),
    );
    expect(repository.createdPaymentAllocations[0]).toEqual(
      expect.objectContaining({
        amount: 20,
      }),
    );
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "payment",
        summary: "Payment needs manager review for a synced offline sale.",
        details: expect.objectContaining({
          total: 25,
          totalPaid: 20,
        }),
      }),
    ]);
  });

  it("sanitizes non-finite malformed payment rows into a payment conflict", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "cash",
              amount: 25,
              timestamp: 21,
            },
            {
              localPaymentId: "local-payment-2",
              method: "cash",
              amount: Number.POSITIVE_INFINITY,
              timestamp: Number.NaN,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.createdTransactions[0]).toEqual(
      expect.objectContaining({
        payments: [{ method: "cash", amount: 25, timestamp: 21 }],
        totalPaid: 25,
      }),
    );
    expect(repository.createdPaymentAllocations).toHaveLength(1);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "payment",
      }),
    ]);
  });

  it("creates an inventory reconciliation conflict when available stock is already reserved", async () => {
    const repository = createProjectionRepository({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        productId: "product-1",
        sku: "CAP-1",
        price: 25,
        quantityAvailable: 10,
        inventoryCount: 10,
        images: [],
      },
      activeHeldQuantity: 10,
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      now: 100,
    });

	    expect(result.status).toBe("conflicted");
	    expect(repository.createdTransactions).toHaveLength(1);
	    expect(repository.productPatches).toEqual([]);
	    expect(repository.recordedSaleInventoryMovements).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        summary: "Inventory needs manager review for a synced offline sale.",
        details: expect.objectContaining({
          activeHeldQuantity: 10,
          quantityAvailable: 10,
          quantityAvailableAfterHolds: 0,
        }),
      }),
    ]);
  });

  it("creates an open inventory work item when reviewed sale replay skips stock mutation", async () => {
    const repository = createProjectionRepository({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        productId: "product-1",
        sku: "CAP-1",
        price: 25,
        quantityAvailable: 0,
        inventoryCount: 0,
        images: [],
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
      options: {
        allowReviewedInventorySaleProjection: true,
      },
    });

    expect(result.status).toBe("projected");
    expect(repository.productPatches).toEqual([]);
    expect(repository.recordedSaleInventoryMovements).toEqual([]);
    expect(repository.createdServiceWorkItems).toEqual([
      expect.objectContaining({
        approvalState: "not_required",
        createdByStaffProfileId: "staff-1",
        createdByUserId: "athena-user-1",
        metadata: expect.objectContaining({
          primaryProductSkuId: "sku-1",
          receiptNumber: "LR-001",
          skippedMutationItems: [
            expect.objectContaining({
              productSkuId: "sku-1",
              reason: "stock_shortfall",
              requestedQuantity: 1,
            }),
          ],
          sourceType: "posTransaction",
          trustedInventoryLines: [
            expect.objectContaining({
              productSkuId: "sku-1",
              quantity: 1,
            }),
          ],
        }),
        priority: "high",
        status: "open",
        title: "Review inventory for Wig Cap",
        type: "synced_sale_inventory_review",
      }),
    ]);
  });

  it("keeps existing reviewed sale mappings against closed drawers as conflict evidence", async () => {
    const repository = createProjectionRepository({
      registerSession: {
        _id: "register-session-1",
        expectedCash: 100,
        closeoutRecords: [],
        registerNumber: "1",
        status: "closed",
      },
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        productId: "product-1",
        sku: "CAP-1",
        price: 25,
        quantityAvailable: 0,
        inventoryCount: 0,
        images: [],
      },
    });
    repository.mappings.push(
      {
        _id: "mapping-existing-transaction",
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        localRegisterSessionId: "local-register-1",
        localEventId: "event-sale-completed-1",
        localIdKind: "transaction",
        localId: "local-txn-1",
        cloudTable: "posTransaction",
        cloudId: "transaction-1",
        createdAt: 1,
      },
      {
        _id: "mapping-existing-receipt",
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        localRegisterSessionId: "local-register-1",
        localEventId: "event-sale-completed-1",
        localIdKind: "receipt",
        localId: "LR-001",
        cloudTable: "posTransaction",
        cloudId: "transaction-1",
        createdAt: 1,
      },
    );
    repository.createdConflicts.push({
      _id: "conflict-reviewed-inventory",
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      localRegisterSessionId: "local-register-1",
      localEventId: "event-sale-completed-1",
      sequence: 2,
      conflictType: "inventory",
      status: "needs_review",
      summary: "Inventory needs manager review for a synced offline sale.",
      details: {
        localTransactionId: "local-txn-1",
        productSkuId: "sku-1",
        quantityAvailable: 0,
        requestedQuantity: 1,
      },
      createdAt: 1,
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
      options: {
        allowClosedRegisterSaleProjection: true,
        allowReviewedInventorySaleProjection: true,
        reviewedConflictIds: ["conflict-reviewed-inventory"],
      },
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "Register was not open before this sale synced.",
        details: expect.objectContaining({ status: "closed" }),
      }),
    ]);
    expect(repository.createdTransactions).toEqual([]);
    expect(repository.createdTransactionItems).toEqual([]);
    expect(repository.productPatches).toEqual([]);
    expect(repository.recordedSaleInventoryMovements).toEqual([]);
    expect(repository.createdServiceWorkItems).toEqual([]);
  });

  it("does not duplicate-conflict an already projected inventory review sale replay", async () => {
    const repository = createProjectionRepository({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        productId: "product-1",
        sku: "CAP-1",
        price: 25,
        quantityAvailable: 0,
        inventoryCount: 0,
        images: [],
      },
    });
    repository.createdPosSessions.push({
      _id: "pos-session-1",
      completedAt: 20,
      createdAt: 20,
      expiresAt: 20,
      inventoryHoldMode: "ledger",
      payments: [
        {
          amount: 25,
          method: "cash",
          timestamp: 21,
        },
      ],
      registerNumber: "1",
      registerSessionId: "register-session-1",
      sessionNumber: "local-session-1",
      staffProfileId: "staff-1",
      status: "completed",
      storeId: "store-1",
      subtotal: 25,
      tax: 0,
      terminalId: "terminal-1",
      total: 25,
      transactionId: "transaction-1",
      updatedAt: 20,
    });
    repository.mappings.push(
      {
        _id: "mapping-existing-pos-session",
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        localRegisterSessionId: "local-register-1",
        localEventId: "event-sale-completed-1",
        localIdKind: "posSession",
        localId: "local-session-1",
        cloudTable: "posSession",
        cloudId: "pos-session-1",
        createdAt: 1,
      },
      {
        _id: "mapping-existing-transaction",
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        localRegisterSessionId: "local-register-1",
        localEventId: "event-sale-completed-1",
        localIdKind: "transaction",
        localId: "local-txn-1",
        cloudTable: "posTransaction",
        cloudId: "transaction-1",
        createdAt: 1,
      },
      {
        _id: "mapping-existing-receipt",
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        localRegisterSessionId: "local-register-1",
        localEventId: "event-sale-completed-1",
        localIdKind: "receipt",
        localId: "LR-001",
        cloudTable: "posTransaction",
        cloudId: "transaction-1",
        createdAt: 1,
      },
    );
    repository.createdConflicts.push({
      _id: "conflict-reviewed-inventory",
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      localRegisterSessionId: "local-register-1",
      localEventId: "event-sale-completed-1",
      sequence: 2,
      conflictType: "inventory",
      status: "needs_review",
      summary: "Inventory needs manager review for a synced offline sale.",
      details: {
        localTransactionId: "local-txn-1",
        productSkuId: "sku-1",
        quantityAvailable: 0,
        requestedQuantity: 1,
      },
      createdAt: 1,
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
      options: {
        allowReviewedInventorySaleProjection: true,
        reviewedConflictIds: ["conflict-reviewed-inventory"],
      },
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(repository.createdConflicts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conflictType: "duplicate_local_id",
          summary: "Local POS session id was reused by a different synced sale.",
        }),
      ]),
    );
    expect(repository.createdTransactions).toEqual([]);
    expect(repository.createdServiceWorkItems).toHaveLength(1);
  });

  it("preserves a reviewed sale without reusing a duplicate local POS session", async () => {
    const repository = createProjectionRepository();
    repository.createdPosSessions.push({
      _id: "pos-session-original",
      completedAt: 10,
      createdAt: 9,
      expiresAt: 20,
      inventoryHoldMode: "ledger",
      payments: [
        {
          amount: 50,
          method: "cash",
          timestamp: 10,
        },
      ],
      registerNumber: "1",
      registerSessionId: "register-session-1",
      sessionNumber: "local-session-1",
      staffProfileId: "staff-1",
      status: "completed",
      storeId: "store-1",
      subtotal: 50,
      tax: 0,
      terminalId: "terminal-1",
      total: 50,
      transactionId: "transaction-original",
      updatedAt: 10,
    });
    repository.mappings.push({
      _id: "mapping-existing-pos-session",
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      localRegisterSessionId: "local-register-1",
      localEventId: "event-original-sale",
      localIdKind: "posSession",
      localId: "local-session-1",
      cloudTable: "posSession",
      cloudId: "pos-session-original",
      createdAt: 9,
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        localEventId: "event-sale-completed-review",
        payload: {
          ...buildSaleCompletedEvent().payload,
          localTransactionId: "local-txn-review",
          localReceiptNumber: "LR-REVIEW",
          receiptNumber: "LR-REVIEW",
        },
      }),
      syncEventId: "sync-event-review",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
      options: {
        allowReviewedDuplicatePosSessionSaleProjection: true,
        reviewedConflictIds: ["conflict-duplicate-pos-session"],
        reviewActorStaffProfileId: "manager-1" as never,
      },
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(repository.createdTransactions).toEqual([
      expect.objectContaining({
        _id: "transaction-1",
        registerSessionId: "register-session-1",
        transactionNumber: "LR-REVIEW",
      }),
    ]);
    expect(
      (repository.createdTransactions[0] as { sessionId?: string }).sessionId,
    ).toBeUndefined();
    expect(repository.createdTransactionItems).toHaveLength(1);
    expect(repository.createdPaymentAllocations).toHaveLength(1);
    expect(repository.recordedSaleInventoryMovements).toEqual([
      expect.objectContaining({
        posTransactionId: "transaction-1",
        productSkuId: "sku-1",
        quantity: 1,
      }),
    ]);
    expect(repository.posSessionPatches).toEqual([]);
    expect(repository.createdPosSessions).toHaveLength(1);
    expect(repository.createdPosSessionItems).toEqual([]);
    expect(repository.recordedPosSessionTraces).toEqual([]);
    expect(repository.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localIdKind: "posSession",
          localId: "local-session-1",
          cloudId: "pos-session-original",
        }),
        expect.objectContaining({
          localIdKind: "transaction",
          localId: "local-txn-review",
          cloudId: "transaction-1",
        }),
        expect.objectContaining({
          localIdKind: "receipt",
          localId: "LR-REVIEW",
          cloudId: "transaction-1",
        }),
      ]),
    );
    expect(
      repository.mappings.filter(
        (mapping) =>
          mapping.localIdKind === "posSession" &&
          mapping.localId === "local-session-1",
      ),
    ).toHaveLength(1);
  });

  it("aggregates duplicate SKU lines before validating and patching inventory", async () => {
    const repository = createProjectionRepository({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        productId: "product-1",
        sku: "CAP-1",
        price: 10,
        quantityAvailable: 3,
        inventoryCount: 3,
        images: [],
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          items: [
            {
              localTransactionItemId: "local-item-1",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              productSku: "CAP-1",
              productName: "Cap",
              quantity: 2,
              unitPrice: 10,
            },
            {
              localTransactionItemId: "local-item-2",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              productSku: "CAP-1",
              productName: "Cap",
              quantity: 2,
              unitPrice: 10,
            },
          ],
          totals: { subtotal: 40, tax: 0, total: 40 },
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "cash",
              amount: 40,
              timestamp: 21,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

	    expect(result.status).toBe("conflicted");
	    expect(repository.createdTransactions).toHaveLength(1);
	    expect(repository.productPatches).toEqual([]);
	    expect(repository.recordedSaleInventoryMovements).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        details: expect.objectContaining({
          requestedQuantity: 4,
        }),
      }),
    ]);
  });

  it("preserves completed offline sales with a catalog reconciliation conflict", async () => {
    const repository = createProjectionRepository({
      sku: {
        _id: "sku-1",
        storeId: "store-2",
        productId: "product-foreign",
        sku: "CAP-1",
        price: 25,
        quantityAvailable: 10,
        inventoryCount: 10,
        images: [],
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.createdPosSessions).toEqual([]);
    expect(repository.createdPosSessionItems).toEqual([]);
    expect(repository.createdTransactions).toEqual([]);
    expect(repository.createdTransactionItems).toEqual([]);
    expect(repository.productPatches).toEqual([]);
    expect(repository.registerSessionPatches).toEqual([]);
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conflictType: "inventory",
          summary: "Product reference is outside this store.",
        }),
      ]),
    );
  });

  it("projects completed offline sales with submitted prices when catalog prices drift", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          totals: { subtotal: 10, tax: 0, total: 10 },
          items: [
            {
              localTransactionItemId: "local-txn-item-1",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              productName: "Wig Cap",
              productSku: "CAP-1",
              quantity: 1,
              unitPrice: 10,
            },
          ],
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "cash",
              amount: 10,
              timestamp: 21,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        summary: "Product price changed before this offline sale synced.",
      }),
    ]);
    expect(repository.createdTransactions).toEqual([
      expect.objectContaining({
        total: 10,
        paymentMethod: "cash",
      }),
    ]);
    expect(repository.createdTransactionItems).toEqual([
      expect.objectContaining({
        productSkuId: "sku-1",
        quantity: 1,
        unitPrice: 10,
        totalPrice: 10,
      }),
    ]);
    expect(repository.createdPaymentAllocations).toEqual([
      expect.objectContaining({
        amount: 10,
        method: "cash",
        registerSessionId: "register-session-1",
      }),
    ]);
    expect(repository.registerSessionPatches).toEqual(
      expect.arrayContaining([
        {
          registerSessionId: "register-session-1",
          patch: {
            expectedCash: 110,
          },
        },
        {
          registerSessionId: "register-session-1",
          patch: {
            workflowTraceId: "register-trace-1",
          },
        },
      ]),
    );
  });

  it("projects provisional import offline sales using the imported provisional price", async () => {
    const repository = createProjectionRepository({
      inventoryImportProvisionalSku: {
        _id: "provisional-import-sku-1",
        storeId: "store-1",
        status: "active",
        posExposureStatus: "available",
        productId: "product-1",
        productSkuId: "sku-1",
        importedPrice: 10,
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          totals: { subtotal: 10, tax: 0, total: 10 },
          items: [
            {
              localTransactionItemId: "local-txn-item-1",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              inventoryImportProvisionalSkuId: "provisional-import-sku-1",
              productName: "Wig Cap",
              productSku: "CAP-1",
              quantity: 1,
              unitPrice: 10,
            },
          ],
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "cash",
              amount: 10,
              timestamp: 21,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(repository.createdTransactionItems).toEqual([
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        productSkuId: "sku-1",
        unitPrice: 10,
      }),
    ]);
    expect(repository.productPatches).toEqual([]);
    expect(repository.recordedSaleInventoryMovements).toEqual([]);
  });

  it("projects clear-only cloud-backed local sales into voided POS sessions", async () => {
    const repository = createProjectionRepository({
      existingPosSession: {
        _id: "session-1",
        registerSessionId: "register-session-1",
        staffProfileId: "staff-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-clear-1",
        localRegisterSessionId: "local-register-1",
        sequence: 2,
        eventType: "sale_cleared",
        occurredAt: 20,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          localPosSessionId: "session-1",
          reason: "Sale cleared",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.releasedHoldRequests).toEqual([
      {
        sessionId: "session-1",
        now: 20,
      },
    ]);
    expect(repository.posSessionPatches).toEqual([
      {
        posSessionId: "session-1",
        patch: {
          notes: "Sale cleared",
          status: "void",
          updatedAt: 20,
        },
      },
    ]);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        localIdKind: "posSession",
        localId: "session-1",
        cloudId: "session-1",
      }),
    ]);
    expect(repository.recordedPosSessionTraces).toEqual([
      expect.objectContaining({
        stage: "voided",
        occurredAt: 20,
        voidReason: "Sale cleared",
        session: expect.objectContaining({
          _id: "session-1",
          notes: "Sale cleared",
          status: "void",
          updatedAt: 20,
        }),
      }),
    ]);
  });

  it("treats repeated sale clears for an already-voided mapped POS session as idempotent", async () => {
    const repository = createProjectionRepository({
      existingPosSession: {
        _id: "session-1",
        registerSessionId: "register-session-1",
        staffProfileId: "staff-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });
    const first = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleClearedEvent({ localPosSessionId: "session-1" }),
      syncEventId: "sync-event-1",
      now: 100,
    });
    const second = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        ...buildSaleClearedEvent({ localPosSessionId: "session-1" }),
        localEventId: "event-clear-2",
        sequence: 3,
        occurredAt: 30,
      },
      syncEventId: "sync-event-2",
      now: 110,
    });

    expect(first.status).toBe("projected");
    expect(second.status).toBe("projected");
    expect(repository.posSessionPatches).toHaveLength(1);
    expect(repository.releasedHoldRequests).toHaveLength(1);
    expect(second.mappings).toEqual([
      expect.objectContaining({
        localIdKind: "posSession",
        localId: "session-1",
        cloudId: "session-1",
      }),
    ]);
  });

  it("accepts clear-only always-local sales that never reached the cloud", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleClearedEvent({ localPosSessionId: "local-session-1" }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(result.mappings).toEqual([]);
    expect(repository.posSessionPatches).toEqual([]);
  });

  it("conflicts sale clear for cloud POS session ids not bound to the synced register session", async () => {
    const repository = createProjectionRepository({
      validCloudIds: new Set(["session-other"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleClearedEvent({ localPosSessionId: "session-other" }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.posSessionPatches).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "POS session does not belong to this synced register history.",
      }),
    ]);
  });

  it("conflicts sale clear when the register mapping is missing", async () => {
    const repository = createProjectionRepository({ registerSession: null });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleClearedEvent({ localPosSessionId: "session-1" }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "Register session mapping is missing for synced POS history.",
      }),
    ]);
  });

  it("conflicts sale clear when the POS session belongs to another staff profile", async () => {
    const repository = createProjectionRepository({
      existingPosSession: {
        _id: "session-1",
        registerSessionId: "register-session-1",
        staffProfileId: "staff-2",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleClearedEvent({ localPosSessionId: "session-1" }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.posSessionPatches).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "POS session does not belong to the synced staff proof.",
      }),
    ]);
  });

  it("conflicts sale clear when the POS session is already completed", async () => {
    const repository = createProjectionRepository({
      existingPosSession: {
        _id: "session-1",
        registerSessionId: "register-session-1",
        staffProfileId: "staff-1",
        status: "completed",
        storeId: "store-1",
        terminalId: "terminal-1",
        transactionId: "transaction-1",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleClearedEvent({ localPosSessionId: "session-1" }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.posSessionPatches).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "Completed POS sessions cannot be cleared from synced local history.",
      }),
    ]);
  });

  it("conflicts foreign customer references before writing canonical sale records", async () => {
    const repository = createProjectionRepository({
      customerStoreId: "store-2",
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          customerProfileId: "customer-1" as never,
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.createdTransactions).toEqual([]);
    expect(repository.createdPaymentAllocations).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "Customer reference is outside this store.",
      }),
    ]);
  });

  it("conflicts reused local transaction ids from a different local event", async () => {
    const repository = createProjectionRepository();
    const first = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      now: 100,
    });
    const second = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        localEventId: "event-sale-completed-2",
        payload: {
          ...buildSaleCompletedEvent().payload,
          localReceiptNumber: "LR-002",
        },
      }),
      syncEventId: "sync-event-2",
      now: 200,
    });

    expect(first.status).toBe("projected");
    expect(second.status).toBe("conflicted");
    expect(repository.createdTransactions).toHaveLength(1);
    expect(second.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "duplicate_local_id",
        summary: "Local transaction id was reused by a different synced sale.",
      }),
    ]);
  });

  it("conflicts reused local child ids from a different sale in the same register session", async () => {
    const repository = createProjectionRepository();
    const baseSale = buildSaleCompletedEvent();
    const baseItem = baseSale.payload.items[0];
    const first = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: baseSale,
      syncEventId: "sync-event-1",
      now: 100,
    });
    const second = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        localEventId: "event-sale-completed-2",
        payload: {
          ...buildSaleCompletedEvent().payload,
          localPosSessionId: "local-session-2",
          localTransactionId: "local-txn-2",
          localReceiptNumber: "LR-002",
          items: [
            {
              ...baseItem,
              productSku: "CAP-1",
            },
          ],
        },
      }),
      syncEventId: "sync-event-2",
      now: 200,
    });

    expect(first.status).toBe("projected");
    expect(second.status).toBe("conflicted");
    expect(repository.createdTransactions).toHaveLength(1);
    expect(second.conflicts).toEqual([
      expect.objectContaining({
        summary: "Local POS sync id was reused by a different synced sale.",
        details: expect.objectContaining({
          localIdKind: "transactionItem",
        }),
      }),
    ]);
  });

  it("conflicts reused local payment ids from a different sale in the same terminal", async () => {
    const repository = createProjectionRepository();
    const baseSale = buildSaleCompletedEvent();
    const baseItem = baseSale.payload.items[0];
    const first = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: baseSale,
      syncEventId: "sync-event-1",
      now: 100,
    });
    const second = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        localEventId: "event-sale-completed-2",
        payload: {
          ...buildSaleCompletedEvent().payload,
          localPosSessionId: "local-session-2",
          localTransactionId: "local-txn-2",
          localReceiptNumber: "LR-002",
          items: [
            {
              ...baseItem,
              localTransactionItemId: "local-txn-item-2",
            },
          ],
        },
      }),
      syncEventId: "sync-event-2",
      now: 200,
    });

    expect(first.status).toBe("projected");
    expect(second.status).toBe("conflicted");
    expect(second.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "duplicate_local_id",
        details: expect.objectContaining({
          localIdKind: "payment",
          localId: "local-payment-1",
        }),
      }),
    ]);
  });

  it("conflicts duplicate local child ids inside one synced sale before projection", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          items: [
            {
              localTransactionItemId: "local-item-1",
              productId: "product-1" as never,
              productSkuId: "sku-1" as never,
              productName: "Wig Cap",
              productSku: "CAP-1",
              quantity: 1,
              unitPrice: 25,
            },
            {
              localTransactionItemId: "local-item-1",
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
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.createdTransactions).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "duplicate_local_id",
        summary: "Local POS sync id was reused inside one synced sale.",
        details: expect.objectContaining({
          localIdKind: "transactionItem",
          localId: "local-item-1",
        }),
      }),
    ]);
  });

  it("conflicts duplicate local payment ids inside one synced sale before projection", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "cash",
              amount: 10,
              timestamp: 21,
            },
            {
              localPaymentId: "local-payment-1",
              method: "cash",
              amount: 15,
              timestamp: 22,
            },
          ],
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.createdTransactions).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "duplicate_local_id",
        summary: "Local POS sync id was reused inside one synced sale.",
        details: expect.objectContaining({
          localIdKind: "payment",
          localId: "local-payment-1",
        }),
      }),
    ]);
  });

  it("conflicts register opens that do not match terminal assignment", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-2",
        localRegisterSessionId: "local-register-2",
        sequence: 4,
        eventType: "register_opened",
        occurredAt: 10,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          openingFloat: 100,
          registerNumber: "2",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary:
          "Terminal register assignment does not match synced POS history.",
      }),
    ]);
  });

  it("conflicts duplicate register opens that do not match the existing drawer identity", async () => {
    const repository = createProjectionRepository({
      blockingRegisterSession: {
        _id: "register-session-open",
        expectedCash: 100,
        closeoutRecords: [],
        registerNumber: "1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-2",
        localRegisterSessionId: "local-register-2",
        sequence: 1,
        eventType: "register_opened",
        occurredAt: 10,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          openingFloat: 100,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "A register session is already open for this terminal.",
        details: expect.objectContaining({
          blockingRegisterSessionId: "register-session-open",
          localRegisterSessionId: "local-register-2",
        }),
      }),
    ]);
    expect(result.mappings).toEqual([]);
    expect(repository.createdRegisterSessions).toEqual([]);
  });

  it("conflicts duplicate register opens that reuse the same local drawer id from another source event", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-reused",
        localRegisterSessionId: "local-register-1",
        sequence: 2,
        eventType: "register_opened",
        occurredAt: 20,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          openingFloat: 100,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.mappings).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "duplicate_local_id",
        summary:
          "Local register session id was reused by a different synced register open.",
        details: expect.objectContaining({
          existingLocalEventId: "event-register-opened-1",
          localRegisterSessionId: "local-register-1",
          reason: "duplicate_register_opened",
        }),
      }),
    ]);
  });

  it("conflicts a stale register open when the active drawer has a newer closeout review", async () => {
    const repository = createProjectionRepository({
      blockingRegisterSession: {
        _id: "register-session-reviewed",
        expectedCash: 100,
        closeoutRecords: [],
        registerNumber: "1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      registerReviewConflictFacts: [
        buildRegisterCloseoutReviewFact({
          closeoutOccurredAt: 50,
          registerSessionId: "register-session-reviewed",
        }),
      ],
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-2",
        localRegisterSessionId: "local-register-2",
        sequence: 2,
        eventType: "register_opened",
        occurredAt: 10,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          openingFloat: 250,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        summary: "A register session is already open for this terminal.",
      }),
    ]);
    expect(result.mappings).toEqual([]);
    expect(repository.createdRegisterSessions).toEqual([]);
  });

  it("creates a new register open when the closing drawer has a closeout review", async () => {
    const repository = createProjectionRepository({
      blockingRegisterSession: {
        _id: "register-session-closing-review",
        expectedCash: 100,
        closeoutRecords: [],
        registerNumber: "1",
        status: "closing",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      registerSessionsWithCloseoutReview: new Set([
        "register-session-closing-review",
      ]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-closing-review",
        localRegisterSessionId: "local-register-2",
        sequence: 1,
        eventType: "register_opened",
        occurredAt: 10,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          openingFloat: 250,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        localIdKind: "registerSession",
        localId: "local-register-2",
        cloudTable: "registerSession",
        cloudId: "register-session-1",
      }),
    ]);
    expect(repository.createdRegisterSessions).toEqual([
      expect.objectContaining({
        expectedCash: 250,
        openingFloat: 250,
        registerNumber: "1",
      }),
    ]);
  });

  it("conflicts a replacement register open when the closing drawer has no closeout boundary", async () => {
    const repository = createProjectionRepository({
      blockingRegisterSession: {
        _id: "register-session-closing-without-boundary",
        expectedCash: 100,
        closeoutRecords: [],
        registerNumber: "1",
        status: "closing",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-after-closing-state",
        localRegisterSessionId: "local-register-after-closing-state",
        sequence: 1,
        eventType: "register_opened",
        occurredAt: 10,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          openingFloat: 250,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "A register session is already open for this terminal.",
      }),
    ]);
    expect(result.mappings).toEqual([]);
    expect(repository.createdRegisterSessions).toEqual([]);
  });

  it("creates a new register open when the blocking drawer already submitted closeout ownership", async () => {
    const repository = createProjectionRepository({
      blockingRegisterSession: {
        _id: "register-session-closing",
        expectedCash: 100,
        closeoutOwnedAt: 5,
        closeoutOwnershipSource: "closeout_submission",
        closeoutRecords: [],
        registerNumber: "1",
        status: "closing",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-after-closeout",
        localRegisterSessionId: "local-register-after-closeout",
        sequence: 1,
        eventType: "register_opened",
        occurredAt: 10,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          openingFloat: 250,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        localIdKind: "registerSession",
        localId: "local-register-after-closeout",
        cloudTable: "registerSession",
        cloudId: "register-session-1",
      }),
    ]);
    expect(repository.createdRegisterSessions).toEqual([
      expect.objectContaining({
        expectedCash: 250,
        openingFloat: 250,
        registerNumber: "1",
      }),
    ]);
  });

  it("conflicts a stale register open before submitted closeout ownership", async () => {
    const repository = createProjectionRepository({
      blockingRegisterSession: {
        _id: "register-session-closing",
        expectedCash: 100,
        closeoutOwnedAt: 50,
        closeoutOwnershipSource: "closeout_submission",
        closeoutRecords: [],
        registerNumber: "1",
        status: "closing",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-stale-closeout",
        localRegisterSessionId: "local-register-stale-closeout",
        sequence: 1,
        eventType: "register_opened",
        occurredAt: 10,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          openingFloat: 250,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "A register session is already open for this terminal.",
      }),
    ]);
    expect(result.mappings).toEqual([]);
    expect(repository.createdRegisterSessions).toEqual([]);
  });

  it("maps a direct cloud register open after staff authorization", async () => {
    const repository = createProjectionRepository({
      registerSession: {
        _id: "register-session-1",
        expectedCash: 100,
        closeoutRecords: [],
        registerNumber: "1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      } as never,
      validCloudIds: new Set(["register-session-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-cloud",
        localRegisterSessionId: "register-session-1",
        sequence: 1,
        eventType: "register_opened",
        occurredAt: 10,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          openingFloat: 100,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        localIdKind: "registerSession",
        localId: "register-session-1",
        cloudTable: "registerSession",
        cloudId: "register-session-1",
      }),
    ]);
  });

  it("conflicts direct cloud register opens while the mapped drawer has closeout review", async () => {
    const repository = createProjectionRepository({
      registerSession: {
        _id: "register-session-1",
        expectedCash: 100,
        closeoutRecords: [],
        registerNumber: "1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      } as never,
      registerSessionsWithCloseoutReview: new Set(["register-session-1"]),
      validCloudIds: new Set(["register-session-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-cloud",
        localRegisterSessionId: "register-session-1",
        sequence: 1,
        eventType: "register_opened",
        occurredAt: 10,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          openingFloat: 100,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.mappings).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "Register session mapping is not usable for synced POS history.",
        details: expect.objectContaining({
          cloudRegisterSessionId: "register-session-1",
          localRegisterSessionId: "register-session-1",
          status: "active",
        }),
      }),
    ]);
  });

  it("projects register opens into register workflow traces", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-new",
        localRegisterSessionId: "local-register-new",
        sequence: 1,
        eventType: "register_opened",
        occurredAt: 10,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          notes: "Morning drawer",
          openingFloat: 75,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.recordedRegisterSessionTraces).toEqual([
      expect.objectContaining({
        stage: "opened",
        session: expect.objectContaining({
          _id: "register-session-1",
          expectedCash: 75,
          openedAt: 10,
          openedByStaffProfileId: "staff-1",
          openingFloat: 75,
          registerNumber: "1",
          status: "active",
        }),
      }),
    ]);
    expect(repository.registerSessionPatches).toEqual([
      {
        registerSessionId: "register-session-1",
        patch: {
          workflowTraceId: "register-trace-1",
        },
      },
    ]);
  });

  it("conflicts a direct cloud register open when staff authorization drifted", async () => {
    const repository = createProjectionRepository({
      hasActivePosRole: false,
      validCloudIds: new Set(["register-session-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-cloud",
        localRegisterSessionId: "register-session-1",
        sequence: 1,
        eventType: "register_opened",
        occurredAt: 10,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          openingFloat: 100,
          registerNumber: "1",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.mappings).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "Staff access changed before this POS history synced.",
      }),
    ]);
  });

  it("conflicts sales that reuse a local transaction id across local register sessions", async () => {
    const repository = createProjectionRepository();
    const first = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      now: 100,
    });
    const second = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        localEventId: "event-sale-completed-2",
        localRegisterSessionId: "local-register-2",
        payload: {
          ...buildSaleCompletedEvent().payload,
          localPosSessionId: "local-session-2",
          localReceiptNumber: "LR-002",
        },
      }),
      syncEventId: "sync-event-2",
      now: 200,
    });

    expect(first.status).toBe("projected");
    expect(second.status).toBe("conflicted");
    expect(repository.createdTransactions).toHaveLength(1);
    expect(second.conflicts).toEqual([
      expect.objectContaining({
        summary: "Local transaction id was reused by a different synced sale.",
      }),
    ]);
  });

  it("conflicts sale register numbers that do not match the mapped register session", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...buildSaleCompletedEvent().payload,
          registerNumber: "2",
        },
      }),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.createdTransactions).toHaveLength(0);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        summary: "Sale register assignment does not match synced POS history.",
      }),
    ]);
  });

  it("projects zero-variance register closeout and holds offline reopen for manager review", async () => {
    const repository = createProjectionRepository();

    const closeout = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          countedCash: 100,
          notes: "Closed drawer",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });
    const reopen = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-reopened-1",
        localRegisterSessionId: "local-register-1",
        sequence: 4,
        eventType: "register_reopened",
        occurredAt: 40,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          reason: "Corrected count",
        },
      },
      syncEventId: "sync-event-2",
      now: 110,
    });

    expect(closeout.status).toBe("projected");
    expect(closeout.mappings).toEqual([
      expect.objectContaining({
        localIdKind: "closeout",
        localId: "event-register-closed-1",
      }),
    ]);
    expect(reopen.status).toBe("conflicted");
    expect(repository.registerSessionPatches).toEqual(
      expect.arrayContaining([
        {
          registerSessionId: "register-session-1",
          patch: expect.objectContaining({
            status: "closed",
            countedCash: 100,
            variance: 0,
            closedByStaffProfileId: "staff-1",
            closedAt: 30,
            closeoutRecords: [
              expect.objectContaining({
                countedCash: 100,
                expectedCash: 100,
                type: "closed",
                variance: 0,
              }),
            ],
            notes: "Closed drawer",
          }),
        },
        {
          registerSessionId: "register-session-1",
          patch: {
            workflowTraceId: "register-trace-1",
          },
        },
      ]),
    );
    expect(repository.recordedRegisterSessionTraces).toEqual([
      expect.objectContaining({
        actorStaffProfileId: "staff-1",
        countedCash: 100,
        occurredAt: 30,
        stage: "closed",
        variance: 0,
        session: expect.objectContaining({
          closedAt: 30,
          closedByStaffProfileId: "staff-1",
          countedCash: 100,
          notes: "Closed drawer",
          status: "closed",
          variance: 0,
        }),
      }),
    ]);
    expect(repository.createdOperationalEvents).toEqual([
      expect.objectContaining({
        actorStaffProfileId: "staff-1",
        createdAt: 30,
        eventType: "register_session_closed",
        message:
          "Front counter / Register 1 closeout recorded with an exact cash match.",
        metadata: expect.objectContaining({
          countedCash: 100,
          expectedCash: 100,
          localEventId: "event-register-closed-1",
          registerNumber: "1",
          syncOrigin: "local_sync",
          variance: 0,
        }),
        organizationId: "org-1",
        registerSessionId: "register-session-1",
        storeId: "store-1",
        subjectId: "register-session-1",
        subjectType: "register_session",
      }),
    ]);
    expect(reopen.conflicts).toEqual([
      expect.objectContaining({
        summary: "Staff access changed before this POS history synced.",
      }),
    ]);
  });

  it("keeps synced register closeout unresolved when pending void approvals exist", async () => {
    const repository = createProjectionRepository({
      pendingVoidApprovalCount: 1,
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          countedCash: 90,
          notes: "Closed drawer with pending void review",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.mappings).toEqual([
      expect.objectContaining({
        localIdKind: "closeout",
        localId: "event-register-closed-1",
      }),
    ]);
    expect(repository.registerSessionPatches).toEqual([
      {
        registerSessionId: "register-session-1",
        patch: expect.objectContaining({
          closeoutOwnedAt: 30,
          closeoutOwnershipSource: "closeout_submission",
          status: "closing",
          countedCash: 90,
          notes: "Closed drawer with pending void review",
          variance: -10,
        }),
      },
    ]);
    const registerSessionPatch = repository.registerSessionPatches[0] as
      | { patch: Record<string, unknown> }
      | undefined;
    expect(registerSessionPatch?.patch).not.toHaveProperty(
      "closeoutRecords",
    );
    expect(repository.recordedRegisterSessionTraces).toEqual([]);
    expect(repository.createdOperationalEvents).toEqual([
      expect.objectContaining({
        createdAt: 30,
        eventType: "register_session_closeout_submitted",
        localEventId: "event-register-closed-1",
        message: expect.stringContaining(
          "closeout submitted with a cash variance",
        ),
        metadata: expect.objectContaining({
          countedCash: 90,
          expectedCash: 100,
          holdKinds: ["pending_completed_sale_void_approvals"],
          localEventId: "event-register-closed-1",
          notes: "Closed drawer with pending void review",
          syncOrigin: "local_sync",
          variance: -10,
        }),
        registerSessionId: "register-session-1",
        subjectId: "register-session-1",
        subjectType: "register_session",
      }),
    ]);
    expect(repository.createdOperationalEvents[0]).toEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          "Finalize after pending register corrections are resolved.",
        ),
      }),
    );
  });

  it("keeps synced register closeout unresolved when repairable mapping holds exist", async () => {
    const repository = createProjectionRepository({
      closeoutHolds: [
        {
          kind: "repairable_missing_register_session_mapping_sales",
          cashAffecting: true,
          count: 1,
        },
      ],
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          countedCash: 90,
          notes: "Closed drawer with pending sale mapping repair",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.registerSessionPatches).toEqual([
      {
        registerSessionId: "register-session-1",
        patch: expect.objectContaining({
          status: "closing",
          countedCash: 90,
          notes: "Closed drawer with pending sale mapping repair",
          variance: -10,
        }),
      },
    ]);
    expect(repository.createdOperationalEvents).toEqual([
      expect.objectContaining({
        createdAt: 30,
        eventType: "register_session_closeout_submitted",
        localEventId: "event-register-closed-1",
        metadata: expect.objectContaining({
          holdKinds: ["repairable_missing_register_session_mapping_sales"],
          syncOrigin: "local_sync",
        }),
        registerSessionId: "register-session-1",
        subjectId: "register-session-1",
        subjectType: "register_session",
      }),
    ]);
  });

  it("projects under-threshold offline closeout variance without manager review", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          countedCash: 90,
          notes: "Short drawer",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        cloudId: "register-session-1",
        cloudTable: "registerSession",
        localId: "event-register-closed-1",
        localIdKind: "closeout",
      }),
    ]);
    expect(repository.registerSessionPatches).toEqual(
      expect.arrayContaining([
        {
          registerSessionId: "register-session-1",
          patch: expect.objectContaining({
            closedAt: 30,
            closedByStaffProfileId: "staff-1",
            countedCash: 90,
            notes: "Short drawer",
            status: "closed",
            variance: -10,
          }),
        },
      ]),
    );
    expect(repository.createdConflicts).toEqual([]);
    expect(repository.createdOperationalEvents).toEqual([
      expect.objectContaining({
        actorStaffProfileId: "staff-1",
        createdAt: 30,
        eventType: "register_session_closed",
        localEventId: "event-register-closed-1",
        message:
          "Front counter / Register 1 closeout recorded with a cash variance of GH₵-0.1.",
        metadata: expect.objectContaining({
          countedCash: 90,
          expectedCash: 100,
          localEventId: "event-register-closed-1",
          syncOrigin: "local_sync",
          variance: -10,
        }),
        registerSessionId: "register-session-1",
        terminalId: "terminal-1",
      }),
    ]);
  });

  it("projects approval-required offline closeout variance with Cash Controls approval ownership", async () => {
    const repository = createProjectionRepository({
      storeConfig: {
        operations: {
          cashControls: {
            varianceApprovalThreshold: 5,
          },
        },
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          countedCash: 90,
          notes: "Short drawer",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(repository.createdConflicts).toEqual([]);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        cloudId: "register-session-1",
        cloudTable: "registerSession",
        localId: "event-register-closed-1",
        localIdKind: "closeout",
      }),
    ]);
    expect(repository.approvalRequests).toEqual([
      expect.objectContaining({
        _id: "approval-request-1",
        metadata: expect.objectContaining({
          countedCash: 90,
          expectedCash: 100,
          gateDecision: "approval_required",
          localEventId: "event-register-closed-1",
          localRegisterSessionId: "local-register-1",
          notes: "Short drawer",
          syncOrigin: "local_sync",
          terminalId: "terminal-1",
          variance: -10,
        }),
        registerSessionId: "register-session-1",
        requestType: "variance_review",
        status: "pending",
      }),
    ]);
    expect(repository.registerSessionPatches).toEqual([
      {
        registerSessionId: "register-session-1",
        patch: expect.objectContaining({
          closeoutOwnedAt: 30,
          closeoutOwnershipSource: "approval_request",
          countedCash: 90,
          managerApprovalRequestId: "approval-request-1",
          notes: "Short drawer",
          status: "closing",
          variance: -10,
        }),
      },
    ]);
    expect(repository.createdOperationalEvents).toEqual([
      expect.objectContaining({
        actorStaffProfileId: "staff-1",
        approvalRequestId: "approval-request-1",
        createdAt: 30,
        eventType: "register_session_variance_review_requested",
        localEventId: "event-register-closed-1",
        metadata: expect.objectContaining({
          approvalRequestId: "approval-request-1",
          countedCash: 90,
          expectedCash: 100,
          gateDecision: "approval_required",
          localEventId: "event-register-closed-1",
          syncOrigin: "local_sync",
          variance: -10,
        }),
        registerSessionId: "register-session-1",
        terminalId: "terminal-1",
      }),
    ]);
  });

  it("honors store manager-signoff variance policy during offline closeout projection", async () => {
    const repository = createProjectionRepository({
      storeConfig: {
        operations: {
          cashControls: {
            requireManagerSignoffForAnyVariance: true,
            varianceApprovalThreshold: 5000,
          },
        },
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          countedCash: 90,
          notes: "Short drawer",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(repository.approvalRequests).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          gateDecisionReason:
            "Manager signoff is required for any register variance (-10).",
          variance: -10,
        }),
        requestType: "variance_review",
        status: "pending",
      }),
    ]);
    expect(repository.createdConflicts).toEqual([]);
  });

  it("conflicts approval-required closeout sync when a pending review has different facts", async () => {
    const repository = createProjectionRepository({
      approvalRequests: [
        ...Array.from({ length: 25 }, (_, index) => ({
          _id: `approval-request-unrelated-${index}`,
          createdAt: index,
          registerSessionId: "register-session-1",
          requestType: index % 2 === 0 ? "void_review" : "variance_review",
          status: index % 2 === 0 ? ("pending" as const) : ("approved" as const),
        })),
        {
          _id: "approval-request-existing",
          createdAt: 25,
          metadata: {
            countedCash: 80,
            expectedCash: 100,
            localEventId: "event-register-closed-previous",
            localRegisterSessionId: "local-register-1",
            notes: "Earlier count",
            terminalId: "terminal-1",
            variance: -20,
          },
          notes: "Earlier count",
          reason: "Variance of -20 exceeded the closeout approval threshold.",
          registerSessionId: "register-session-1",
          requestType: "variance_review",
          status: "pending",
        },
      ],
      storeConfig: {
        operations: {
          cashControls: {
            varianceApprovalThreshold: 5,
          },
        },
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          countedCash: 90,
          notes: "Short drawer",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.mappings).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        details: expect.objectContaining({
          existingApprovalRequestId: "approval-request-existing",
          localEventId: "event-register-closed-1",
          registerSessionId: "register-session-1",
        }),
        summary:
          "Register closeout already has a pending variance review with different closeout facts.",
      }),
    ]);
    expect(repository.approvalRequests).toHaveLength(26);
    expect(
      repository.approvalRequests.filter(
        (approvalRequest) =>
          approvalRequest.status === "pending" &&
          approvalRequest.requestType === "variance_review",
      ),
    ).toHaveLength(1);
    expect(repository.approvalRequests).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: "approval-request-27" }),
      ]),
    );
    expect(repository.registerSessionPatches).toEqual([]);
    expect(repository.createdOperationalEvents).toEqual([]);
  });

  it("conflicts approval-required closeout sync when multiple pending variance reviews exist", async () => {
    const repository = createProjectionRepository({
      approvalRequests: [
        {
          _id: "approval-request-one",
          createdAt: 25,
          metadata: {
            countedCash: 90,
            expectedCash: 100,
            localEventId: "event-register-closed-1",
            localRegisterSessionId: "local-register-1",
            notes: "Short drawer",
            terminalId: "terminal-1",
            variance: -10,
          },
          notes: "Short drawer",
          reason: "Variance of -10 exceeded the closeout approval threshold.",
          registerSessionId: "register-session-1",
          requestType: "variance_review",
          status: "pending",
        },
        {
          _id: "approval-request-two",
          createdAt: 26,
          metadata: {
            countedCash: 80,
            expectedCash: 100,
            localEventId: "event-register-closed-previous",
            localRegisterSessionId: "local-register-1",
            notes: "Earlier count",
            terminalId: "terminal-1",
            variance: -20,
          },
          notes: "Earlier count",
          reason: "Variance of -20 exceeded the closeout approval threshold.",
          registerSessionId: "register-session-1",
          requestType: "variance_review",
          status: "pending",
        },
      ],
      storeConfig: {
        operations: {
          cashControls: {
            varianceApprovalThreshold: 5,
          },
        },
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          countedCash: 90,
          notes: "Short drawer",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.mappings).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        details: expect.objectContaining({
          existingApprovalRequestIds: [
            "approval-request-one",
            "approval-request-two",
          ],
          localEventId: "event-register-closed-1",
          registerSessionId: "register-session-1",
        }),
        summary:
          "Register closeout already has multiple pending variance reviews.",
      }),
    ]);
    expect(repository.approvalRequests).toHaveLength(2);
    expect(repository.registerSessionPatches).toEqual([]);
    expect(repository.createdOperationalEvents).toEqual([]);
  });

  it("reuses approval ownership when approval-required closeout sync retries", async () => {
    const repository = createProjectionRepository({
      approvalRequests: [
        ...Array.from({ length: 25 }, (_, index) => ({
          _id: `approval-request-unrelated-${index}`,
          createdAt: index,
          registerSessionId: "register-session-1",
          requestType: index % 2 === 0 ? "void_review" : "variance_review",
          status: index % 2 === 0 ? ("pending" as const) : ("approved" as const),
        })),
        {
          _id: "approval-request-existing",
          createdAt: 30,
          metadata: {
            countedCash: 90,
            expectedCash: 100,
            localEventId: "event-register-closed-1",
            localRegisterSessionId: "local-register-1",
            notes: "Short drawer",
            terminalId: "terminal-1",
            variance: -10,
          },
          notes: "Short drawer",
          reason: "Variance of -10 exceeded the closeout approval threshold.",
          registerSessionId: "register-session-1",
          requestType: "variance_review",
          status: "pending",
        },
      ],
      registerSession: {
        _id: "register-session-1",
        closeoutRecords: [],
        countedCash: 90,
        expectedCash: 100,
        managerApprovalRequestId: "approval-request-existing" as never,
        registerNumber: "1",
        status: "closing",
        variance: -10,
      },
      storeConfig: {
        operations: {
          cashControls: {
            varianceApprovalThreshold: 5,
          },
        },
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          countedCash: 90,
          notes: "Short drawer",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(repository.approvalRequests).toHaveLength(26);
    expect(
      repository.approvalRequests.filter(
        (approvalRequest) =>
          approvalRequest.status === "pending" &&
          approvalRequest.requestType === "variance_review",
      ),
    ).toHaveLength(1);
    expect(repository.approvalRequests).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: "approval-request-27" }),
      ]),
    );
    expect(repository.createdOperationalEvents).toEqual([]);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        cloudId: "register-session-1",
        cloudTable: "registerSession",
        localId: "event-register-closed-1",
        localIdKind: "closeout",
      }),
    ]);
  });

  it("conflicts approval-owned closeout retry when the submitted notes changed", async () => {
    const repository = createProjectionRepository({
      approvalRequests: [
        {
          _id: "approval-request-existing",
          createdAt: 30,
          metadata: {
            countedCash: 90,
            expectedCash: 100,
            localEventId: "event-register-closed-1",
            localRegisterSessionId: "local-register-1",
            notes: "Short drawer",
            terminalId: "terminal-1",
            variance: -10,
          },
          notes: "Short drawer",
          reason: "Variance of -10 exceeded the closeout approval threshold.",
          registerSessionId: "register-session-1",
          requestType: "variance_review",
          status: "pending",
        },
      ],
      registerSession: {
        _id: "register-session-1",
        closeoutRecords: [],
        countedCash: 90,
        expectedCash: 100,
        managerApprovalRequestId: "approval-request-existing" as never,
        registerNumber: "1",
        status: "closing",
        variance: -10,
      },
      storeConfig: {
        operations: {
          cashControls: {
            varianceApprovalThreshold: 5,
          },
        },
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          countedCash: 90,
          notes: "Adjusted drawer note",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.mappings).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        details: expect.objectContaining({
          approvalRequestId: "approval-request-existing",
          localEventId: "event-register-closed-1",
          registerSessionId: "register-session-1",
        }),
        summary:
          "Register closeout approval ownership no longer matches the synced closeout facts.",
      }),
    ]);
    expect(repository.approvalRequests).toHaveLength(1);
    expect(repository.createdOperationalEvents).toEqual([]);
  });

  it("replays an approved approval-owned closeout without creating a second review", async () => {
    const repository = createProjectionRepository({
      approvalRequests: [
        {
          _id: "approval-request-approved",
          createdAt: 30,
          decidedAt: 40,
          metadata: {
            countedCash: 90,
            expectedCash: 100,
            localEventId: "event-register-closed-1",
            localRegisterSessionId: "local-register-1",
            notes: "Short drawer",
            terminalId: "terminal-1",
            variance: -10,
          },
          notes: "Short drawer",
          reason: "Variance of -10 exceeded the closeout approval threshold.",
          registerSessionId: "register-session-1",
          requestType: "variance_review",
          status: "approved",
        },
      ],
      registerSession: {
        _id: "register-session-1",
        closeoutRecords: [],
        countedCash: 90,
        expectedCash: 100,
        managerApprovalRequestId: "approval-request-approved" as never,
        registerNumber: "1",
        status: "closing",
        variance: -10,
      },
      storeConfig: {
        operations: {
          cashControls: {
            varianceApprovalThreshold: 5,
          },
        },
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          countedCash: 90,
          notes: "Short drawer",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(repository.approvalRequests).toHaveLength(1);
    expect(repository.registerSessionPatches).toEqual([]);
    expect(repository.createdOperationalEvents).toEqual([]);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        cloudId: "register-session-1",
        cloudTable: "registerSession",
        localId: "event-register-closed-1",
        localIdKind: "closeout",
      }),
    ]);
  });

  it("formats manager-reviewed closeout variance in projected operational evidence", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: {
          countedCash: 90,
          notes: "Short drawer",
        },
      },
      syncEventId: "sync-event-1",
      now: 100,
      options: {
        allowRegisterCloseoutVarianceProjection: true,
      },
    });

    expect(result.status).toBe("projected");
    expect(repository.createdOperationalEvents).toEqual([
      expect.objectContaining({
        eventType: "register_session_closed",
        message:
          "Front counter / Register 1 closeout recorded with a cash variance of GH₵-0.1.",
        metadata: expect.objectContaining({
          countedCash: 90,
          expectedCash: 100,
          registerNumber: "1",
          variance: -10,
        }),
      }),
    ]);
  });

  it("conflicts a sale projected after local closeout when no reopen was synced", async () => {
    const repository = createProjectionRepository({
      registerSession: {
        _id: "register-session-1",
        expectedCash: 100,
        closeoutRecords: [],
        status: "closed",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.createdTransactions).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary: "Register was not open before this sale synced.",
      }),
    ]);
  });

  it("applies the expected total for manager-reviewed non-cash overpayment against an active drawer", async () => {
    const repository = createProjectionRepository({
      registerSession: {
        _id: "register-session-1",
        closeoutRecords: [],
        expectedCash: 100,
        registerNumber: "1",
        status: "active",
      },
    });
    const baseSale = buildSaleCompletedEvent();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        payload: {
          ...baseSale.payload,
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "mobile_money",
              amount: 50,
              timestamp: 21,
            },
          ],
        },
        staffProofToken: undefined,
      }),
      syncEventId: "sync-event-1",
      now: 100,
      options: {
        applyExpectedTotalForReviewedNonCashOverpayment: true,
        trustStoredStaffProof: true,
      },
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(repository.createdTransactions).toEqual([
      expect.objectContaining({
        payments: [
          expect.objectContaining({
            amount: 25,
            method: "mobile_money",
          }),
        ],
        total: 25,
        totalPaid: 25,
      }),
    ]);
    expect(repository.createdPaymentAllocations).toEqual([
      expect.objectContaining({
        amount: 25,
        externalReference: "local-payment-1",
        method: "mobile_money",
        targetType: "pos_transaction",
      }),
    ]);
    expect(repository.registerSessionPatches).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patch: expect.objectContaining({
            expectedCash: expect.any(Number),
          }),
        }),
      ]),
    );
  });

  it.each(["closed", "closeout_rejected"] as const)(
    "keeps reviewed sale replay against a %s register session as review evidence only",
    async (status) => {
      const repository = createProjectionRepository({
        registerSession: {
          _id: "register-session-1",
          expectedCash: 100,
          closeoutRecords: [],
          countedCash: 100,
          registerNumber: "1",
          status,
          variance: 0,
        },
      });

      const result = await projectLocalSyncEvent(repository, {
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        event: {
          ...buildSaleCompletedEvent(),
          staffProofToken: undefined,
        },
        syncEventId: "sync-event-1",
        now: 100,
        options: {
          allowClosedRegisterSaleProjection: true,
          trustStoredStaffProof: true,
        },
      });

      expect(result.status).toBe("conflicted");
      expect(result.mappings).toEqual([]);
      expect(repository.createdPosSessions).toEqual([]);
      expect(repository.createdTransactions).toEqual([]);
      expect(repository.createdTransactionItems).toEqual([]);
      expect(repository.createdPaymentAllocations).toEqual([]);
      expect(repository.posSessionPatches).toEqual([]);
      expect(repository.registerSessionPatches).toEqual([]);
      expect(result.conflicts).toEqual([
        expect.objectContaining({
          conflictType: "permission",
          summary: "Register was not open before this sale synced.",
          details: expect.objectContaining({ status }),
        }),
      ]);
    },
  );

  it("projects a synced closeout as idempotent when the register was already closed with the same count", async () => {
    const repository = createProjectionRepository({
      registerSession: {
        _id: "register-session-1",
        expectedCash: 350,
        closeoutRecords: [
          {
            countedCash: 350,
            expectedCash: 350,
            type: "closed",
            variance: 0,
          },
        ],
        countedCash: 350,
        registerNumber: "1",
        status: "closed",
        variance: 0,
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: { countedCash: 350 },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.registerSessionPatches).toEqual([]);
    expect(repository.recordedRegisterSessionTraces).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        cloudId: "register-session-1",
        cloudTable: "registerSession",
        localId: "event-register-closed-1",
        localIdKind: "closeout",
      }),
    ]);
  });

  it("conflicts duplicate closeout attempts against an already closed register session", async () => {
    const repository = createProjectionRepository({
      registerSession: {
        _id: "register-session-1",
        expectedCash: 100,
        closeoutRecords: [],
        countedCash: 90,
        registerNumber: "1",
        status: "closed",
        variance: -10,
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: { countedCash: 100 },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.registerSessionPatches).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        summary: "Register session is not open for synced POS closeout.",
      }),
    ]);
  });

  it("projects an approved variance closeout when the register is already waiting in closing", async () => {
    const repository = createProjectionRepository({
      registerSession: {
        _id: "register-session-1",
        expectedCash: 100,
        closeoutRecords: [],
        countedCash: 90,
        registerNumber: "1",
        status: "closing",
        variance: -10,
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: { countedCash: 90 },
      },
      syncEventId: "sync-event-1",
      now: 100,
      options: {
        allowRegisterCloseoutVarianceProjection: true,
      },
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(repository.registerSessionPatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          registerSessionId: "register-session-1",
          patch: expect.objectContaining({
            countedCash: 90,
            status: "closed",
            variance: -10,
          }),
        }),
      ]),
    );
    expect(result.mappings).toEqual([
      expect.objectContaining({
        cloudId: "register-session-1",
        cloudTable: "registerSession",
        localId: "event-register-closed-1",
        localIdKind: "closeout",
      }),
    ]);
  });

  it("keeps a pending variance closeout review from turning into a duplicate closeout review", async () => {
    const repository = createProjectionRepository({
      registerSession: {
        _id: "register-session-1",
        expectedCash: 100,
        closeoutRecords: [],
        countedCash: 90,
        registerNumber: "1",
        status: "closing",
        variance: -10,
      },
    });
    repository.createdConflicts.push({
      _id: "conflict-existing-variance",
      conflictType: "permission",
      createdAt: 10,
      details: {
        countedCash: 90,
        expectedCash: 100,
        variance: -10,
      },
      localEventId: "event-register-closed-1",
      localRegisterSessionId: "local-register-1",
      sequence: 3,
      status: "needs_review",
      storeId: "store-1" as never,
      summary:
        "Register closeout variance requires manager review before synced closeout can be applied.",
      terminalId: "terminal-1" as never,
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_closed",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: { countedCash: 90 },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        _id: "conflict-existing-variance",
      }),
    ]);
    expect(repository.createdConflicts).toHaveLength(1);
    expect(repository.createdConflicts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "Register session is not open for synced POS closeout.",
        }),
      ]),
    );
  });

  it("conflicts reopen attempts against a register session that is not closed", async () => {
    const repository = createProjectionRepository();

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-reopened-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_reopened",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: { reason: "Corrected count" },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.registerSessionPatches).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        summary: "Staff access changed before this POS history synced.",
      }),
    ]);
  });

  it("conflicts reopen attempts when another drawer is already open", async () => {
    const repository = createProjectionRepository({
      registerSession: {
        _id: "register-session-1",
        expectedCash: 100,
        closeoutRecords: [],
        closedAt: 30,
        countedCash: 90,
        registerNumber: "1",
        status: "closed",
        variance: -10,
      },
      blockingRegisterSession: {
        _id: "register-session-2",
        expectedCash: 100,
        closeoutRecords: [],
        registerNumber: "1",
        status: "active",
      },
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-reopened-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        eventType: "register_reopened",
        occurredAt: 30,
        staffProfileId: "staff-1" as never,
        staffProofToken: "proof-token-1",
        payload: { reason: "Corrected count" },
      },
      syncEventId: "sync-event-1",
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(repository.registerSessionPatches).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        summary: "Staff access changed before this POS history synced.",
      }),
    ]);
  });

  it("conflicts reused receipt mappings across local register sessions for the terminal", async () => {
    const repository = createProjectionRepository();
    const first = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      now: 100,
    });
    const second = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        localEventId: "event-sale-completed-2",
        localRegisterSessionId: "local-register-2",
        payload: {
          ...buildSaleCompletedEvent().payload,
          localPosSessionId: "local-session-2",
          localTransactionId: "local-txn-2",
          localReceiptNumber: "LR-001",
        },
      }),
      syncEventId: "sync-event-2",
      now: 200,
    });

    expect(first.status).toBe("projected");
    expect(second.status).toBe("conflicted");
    expect(second.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "duplicate_local_id",
        details: expect.objectContaining({
          localIdKind: "receipt",
          localId: "LR-001",
        }),
      }),
    ]);
  });

  it("conflicts reused local POS session ids across different synced sales", async () => {
    const repository = createProjectionRepository();
    const basePayload = buildSaleCompletedEvent().payload as PosLocalSalePayload;

    const first = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent(),
      syncEventId: "sync-event-1",
      now: 100,
    });
    const second = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildSaleCompletedEvent({
        localEventId: "event-sale-completed-2",
        payload: {
          ...basePayload,
          localTransactionId: "local-txn-2",
          localReceiptNumber: "LR-002",
          items: [
            {
              ...basePayload.items[0],
              localTransactionItemId: "local-txn-item-2",
            },
          ],
          payments: [
            {
              ...basePayload.payments[0],
              localPaymentId: "local-payment-2",
            },
          ],
        },
      }),
      syncEventId: "sync-event-2",
      now: 200,
    });

    expect(first.status).toBe("projected");
    expect(second.status).toBe("conflicted");
    expect(second.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "duplicate_local_id",
        details: expect.objectContaining({
          localIdKind: "posSession",
          localId: "local-session-1",
        }),
      }),
    ]);
    expect(repository.posSessionPatches).toHaveLength(1);
  });

  it("projects trusted expense records and decrements trusted inventory once", async () => {
    const repository = createProjectionRepository({
      validCloudIds: new Set(["product-1", "sku-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildExpenseRecordedEvent(),
      syncEventId: "sync-event-expense-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.mappings).toEqual([
      expect.objectContaining({
        localIdKind: "expenseSession",
        localId: "local-expense-session-1",
        cloudTable: "expenseSession",
      }),
      expect.objectContaining({
        localIdKind: "expenseTransaction",
        localId: "local-expense-event-1",
        cloudTable: "expenseTransaction",
      }),
    ]);
    expect(repository.createdExpenseTransactions).toEqual([
      expect.objectContaining({
        sessionId: "expense-session-1",
        transactionNumber: expect.stringMatching(/^\d{6}$/),
        totalValue: 25,
      }),
    ]);
    expect(repository.createdExpenseTransactions).not.toEqual([
      expect.objectContaining({
        transactionNumber: "local-expense-event-1",
      }),
    ]);
    expect(repository.createdExpenseTransactionItems).toEqual([
      expect.objectContaining({
        inventoryHoldApplied: true,
        productSkuId: "sku-1",
      }),
    ]);
    expect(repository.productPatches).toEqual([
      {
        productSkuId: "sku-1",
        patch: {
          inventoryCount: 9,
          quantityAvailable: 9,
        },
      },
    ]);
  });

  it("projects repeated expense records even when older clients reused cart line ids", async () => {
    const repository = createProjectionRepository({
      validCloudIds: new Set(["product-1", "sku-1"]),
    });
    const reusedLineId = "optimistic:sku-1:trusted_inventory";
    const baseEvent = buildExpenseRecordedEvent({
      payload: {
        ...buildExpenseRecordedEvent().payload,
        items: [
          {
            ...buildExpenseRecordedEvent().payload.items[0],
            localTransactionItemId: reusedLineId,
          },
        ],
      },
    });

    const first = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: baseEvent,
      syncEventId: "sync-event-expense-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });
    const second = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildExpenseRecordedEvent({
        localEventId: "event-expense-recorded-2",
        localExpenseSessionId: "local-expense-session-2",
        sequence: 2,
        payload: {
          ...baseEvent.payload,
          localExpenseSessionId: "local-expense-session-2",
          localExpenseEventId: "local-expense-event-2",
        },
      }),
      syncEventId: "sync-event-expense-2",
      submittedByUserId: "athena-user-1" as never,
      now: 200,
    });

    expect(first.status).toBe("projected");
    expect(second.status).toBe("projected");
    expect(repository.createdExpenseTransactions).toHaveLength(2);
    expect(repository.mappings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localIdKind: "transactionItem",
          localId: reusedLineId,
          cloudTable: "expenseSessionItem",
        }),
      ]),
    );
  });

  it("projects trusted zero-stock expense records with review evidence and no stock decrement", async () => {
    const repository = createProjectionRepository({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        productId: "product-1",
        sku: "CAP-1",
        price: 25,
        quantityAvailable: 0,
        inventoryCount: 0,
        images: [],
      },
      validCloudIds: new Set(["product-1", "sku-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildExpenseRecordedEvent(),
      syncEventId: "sync-event-expense-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        summary: "Inventory needs manager review for a synced expense.",
        details: expect.objectContaining({
          blocksProjection: false,
          inventoryCount: 0,
          requestedQuantity: 1,
        }),
      }),
    ]);
    expect(repository.createdExpenseTransactionItems).toEqual([
      expect.objectContaining({
        inventoryHoldApplied: false,
      }),
    ]);
    expect(repository.productPatches).toEqual([]);
  });

  it("projects duplicate trusted expense SKU lines with one aggregate stock decrement", async () => {
    const repository = createProjectionRepository({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        productId: "product-1",
        sku: "CAP-1",
        price: 25,
        quantityAvailable: 10,
        inventoryCount: 10,
        images: [],
      },
      validCloudIds: new Set(["product-1", "sku-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildExpenseRecordedEvent({
        payload: {
          ...buildExpenseRecordedEvent().payload,
          totals: {
            subtotal: 175,
            tax: 0,
            total: 175,
          },
          items: [
            {
              ...buildExpenseRecordedEvent().payload.items[0],
              localTransactionItemId: "local-expense-line-1",
              quantity: 3,
            },
            {
              ...buildExpenseRecordedEvent().payload.items[0],
              localTransactionItemId: "local-expense-line-2",
              quantity: 4,
            },
          ],
        },
      }),
      syncEventId: "sync-event-expense-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([]);
    expect(repository.createdExpenseTransactionItems).toEqual([
      expect.objectContaining({
        inventoryHoldApplied: true,
        productSkuId: "sku-1",
        quantity: 3,
      }),
      expect.objectContaining({
        inventoryHoldApplied: true,
        productSkuId: "sku-1",
        quantity: 4,
      }),
    ]);
    expect(repository.productPatches).toEqual([
      {
        productSkuId: "sku-1",
        patch: {
          inventoryCount: 3,
          quantityAvailable: 3,
        },
      },
    ]);
  });

  it("projects duplicate trusted expense SKU lines with aggregate review evidence when total exceeds stock", async () => {
    const repository = createProjectionRepository({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        productId: "product-1",
        sku: "CAP-1",
        price: 25,
        quantityAvailable: 5,
        inventoryCount: 5,
        images: [],
      },
      validCloudIds: new Set(["product-1", "sku-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildExpenseRecordedEvent({
        payload: {
          ...buildExpenseRecordedEvent().payload,
          totals: {
            subtotal: 175,
            tax: 0,
            total: 175,
          },
          items: [
            {
              ...buildExpenseRecordedEvent().payload.items[0],
              localTransactionItemId: "local-expense-line-1",
              quantity: 3,
            },
            {
              ...buildExpenseRecordedEvent().payload.items[0],
              localTransactionItemId: "local-expense-line-2",
              quantity: 4,
            },
          ],
        },
      }),
      syncEventId: "sync-event-expense-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        summary: "Inventory needs manager review for a synced expense.",
        details: expect.objectContaining({
          blocksProjection: false,
          inventoryCount: 5,
          requestedQuantity: 7,
        }),
      }),
    ]);
    expect(repository.createdExpenseTransactionItems).toEqual([
      expect.objectContaining({
        inventoryHoldApplied: false,
        quantity: 3,
      }),
      expect.objectContaining({
        inventoryHoldApplied: false,
        quantity: 4,
      }),
    ]);
    expect(repository.productPatches).toEqual([]);
  });

  it("projects trusted expense records with review evidence when available stock is already held", async () => {
    const repository = createProjectionRepository({
      sku: {
        _id: "sku-1",
        storeId: "store-1",
        productId: "product-1",
        sku: "CAP-1",
        price: 25,
        quantityAvailable: 2,
        inventoryCount: 10,
        images: [],
      },
      validCloudIds: new Set(["product-1", "sku-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildExpenseRecordedEvent({
        payload: {
          ...buildExpenseRecordedEvent().payload,
          totals: {
            subtotal: 100,
            tax: 0,
            total: 100,
          },
          items: [
            {
              ...buildExpenseRecordedEvent().payload.items[0],
              quantity: 4,
            },
          ],
        },
      }),
      syncEventId: "sync-event-expense-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        summary: "Inventory needs manager review for a synced expense.",
        details: expect.objectContaining({
          blocksProjection: false,
          inventoryCount: 10,
          quantityAvailable: 2,
          requestedQuantity: 4,
        }),
      }),
    ]);
    expect(repository.createdExpenseTransactionItems).toEqual([
      expect.objectContaining({
        inventoryHoldApplied: false,
        quantity: 4,
      }),
    ]);
    expect(repository.productPatches).toEqual([]);
  });

  it("projects pending checkout expense records without trusted stock movement", async () => {
    const repository = createProjectionRepository({
      validCloudIds: new Set(["product-1", "sku-1", "pending-checkout-item-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildExpenseRecordedEvent({
        payload: {
          ...buildExpenseRecordedEvent().payload,
          items: [
            {
              ...buildExpenseRecordedEvent().payload.items[0],
              localTransactionItemId: "local-expense-pending-line-1",
              pendingCheckoutItemId: "pending-checkout-item-1" as never,
            },
          ],
        },
      }),
      syncEventId: "sync-event-expense-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.createdExpenseSessionItems).toEqual([
      expect.objectContaining({
        pendingCheckoutItemId: "pending-checkout-item-1",
        inventoryHoldApplied: false,
      }),
    ]);
    expect(repository.createdExpenseTransactionItems).toEqual([
      expect.objectContaining({
        pendingCheckoutItemId: "pending-checkout-item-1",
        inventoryHoldApplied: false,
      }),
    ]);
    expect(repository.productPatches).toEqual([]);
    expect(repository.mappings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cloudTable: "expenseSessionItem" }),
      ]),
    );
  });

  it("projects provisional import expense records without trusted stock movement", async () => {
    const repository = createProjectionRepository({
      inventoryImportProvisionalSkus: [
        {
          _id: "provisional-import-sku-1",
          storeId: "store-1",
          productId: "product-1",
          productSkuId: "sku-1",
          status: "active",
          posExposureStatus: "available",
          importedPrice: 25,
        },
      ],
      validCloudIds: new Set(["product-1", "sku-1", "provisional-import-sku-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildExpenseRecordedEvent({
        payload: {
          ...buildExpenseRecordedEvent().payload,
          items: [
            {
              ...buildExpenseRecordedEvent().payload.items[0],
              localTransactionItemId: "local-expense-provisional-line-1",
              inventoryImportProvisionalSkuId:
                "provisional-import-sku-1" as never,
            },
          ],
        },
      }),
      syncEventId: "sync-event-expense-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });

    expect(result.status).toBe("projected");
    expect(repository.createdExpenseSessionItems).toEqual([
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        inventoryHoldApplied: false,
      }),
    ]);
    expect(repository.createdExpenseTransactionItems).toEqual([
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        inventoryHoldApplied: false,
      }),
    ]);
    expect(repository.productPatches).toEqual([]);
  });

  it("blocks expense records with both pending checkout and provisional import sources", async () => {
    const repository = createProjectionRepository({
      inventoryImportProvisionalSkus: [
        {
          _id: "provisional-import-sku-1",
          storeId: "store-1",
          productId: "product-1",
          productSkuId: "sku-1",
          status: "active",
          posExposureStatus: "available",
          importedPrice: 25,
        },
      ],
      validCloudIds: new Set([
        "product-1",
        "sku-1",
        "pending-checkout-item-1",
        "provisional-import-sku-1",
      ]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildExpenseRecordedEvent({
        payload: {
          ...buildExpenseRecordedEvent().payload,
          items: [
            {
              ...buildExpenseRecordedEvent().payload.items[0],
              localTransactionItemId: "local-expense-conflicting-line-1",
              pendingCheckoutItemId: "pending-checkout-item-1" as never,
              inventoryImportProvisionalSkuId:
                "provisional-import-sku-1" as never,
            },
          ],
        },
      }),
      syncEventId: "sync-event-expense-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        summary:
          "Synced expense line has conflicting pending checkout and provisional import sources.",
        details: expect.objectContaining({
          blocksProjection: true,
          localExpenseEventId: "local-expense-event-1",
          localTransactionItemId: "local-expense-conflicting-line-1",
          pendingCheckoutItemId: "pending-checkout-item-1",
          inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        }),
      }),
    ]);
    expect(repository.createdExpenseSessions).toEqual([]);
    expect(repository.createdExpenseTransactions).toEqual([]);
    expect(repository.productPatches).toEqual([]);
  });

  it("blocks hidden provisional import expense records before side effects", async () => {
    const repository = createProjectionRepository({
      inventoryImportProvisionalSkus: [
        {
          _id: "provisional-import-sku-1",
          storeId: "store-1",
          productId: "product-1",
          productSkuId: "sku-1",
          status: "active",
          posExposureStatus: "hidden",
          importedPrice: 25,
        },
      ],
      validCloudIds: new Set(["product-1", "sku-1", "provisional-import-sku-1"]),
    });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: buildExpenseRecordedEvent({
        payload: {
          ...buildExpenseRecordedEvent().payload,
          items: [
            {
              ...buildExpenseRecordedEvent().payload.items[0],
              inventoryImportProvisionalSkuId:
                "provisional-import-sku-1" as never,
            },
          ],
        },
      }),
      syncEventId: "sync-event-expense-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({
          blocksProjection: true,
          inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        }),
      }),
    ]);
    expect(repository.createdExpenseSessions).toEqual([]);
    expect(repository.createdExpenseTransactions).toEqual([]);
    expect(repository.productPatches).toEqual([]);
  });

  it("retries expense projections without duplicating sessions or transactions", async () => {
    const repository = createProjectionRepository({
      validCloudIds: new Set(["product-1", "sku-1"]),
    });
    const event = buildExpenseRecordedEvent();

    const first = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event,
      syncEventId: "sync-event-expense-1",
      submittedByUserId: "athena-user-1" as never,
      now: 100,
    });
    const retry = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event,
      syncEventId: "sync-event-expense-1",
      submittedByUserId: "athena-user-1" as never,
      now: 200,
    });

    expect(first.status).toBe("projected");
    expect(retry.status).toBe("projected");
    expect(repository.createdExpenseSessions).toHaveLength(1);
    expect(repository.createdExpenseTransactions).toHaveLength(1);
    expect(retry.mappings).toEqual([
      expect.objectContaining({ localIdKind: "expenseSession" }),
      expect.objectContaining({ localIdKind: "expenseTransaction" }),
    ]);
  });
});

function buildExpenseRecordedEvent(
  overrides: Partial<ParsedExpenseRecordedEvent> = {},
): ParsedExpenseRecordedEvent {
  return {
    syncScope: "expense",
    localEventId: "event-expense-recorded-1",
    localExpenseSessionId: "local-expense-session-1",
    sequence: 1,
    eventType: "expense_recorded",
    occurredAt: 20,
    staffProfileId: "staff-1" as never,
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
          productSku: "CAP-1",
          quantity: 1,
          unitPrice: 25,
        },
      ],
    },
    ...overrides,
  };
}

function buildSaleCompletedEvent(
  overrides: Partial<ParsedSaleCompletedEvent> = {},
): ParsedSaleCompletedEvent {
  return {
    localEventId: "event-sale-completed-1",
    localRegisterSessionId: "local-register-1",
    sequence: 2,
    eventType: "sale_completed",
    occurredAt: 20,
    staffProfileId: "staff-1" as never,
    staffProofToken: "proof-token-1",
    payload: {
      localPosSessionId: "local-session-1",
      localTransactionId: "local-txn-1",
      localReceiptNumber: "LR-001",
      receiptNumber: "LR-001",
      registerNumber: "1",
      totals: {
        subtotal: 25,
        tax: 0,
        total: 25,
      },
      items: [
        {
          localTransactionItemId: "local-txn-item-1",
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
          localPaymentId: "local-payment-1",
          method: "cash",
          amount: 25,
          timestamp: 21,
        },
      ],
    },
    ...overrides,
  };
}

function buildPendingCheckoutItemDefinedEvent(
  overrides: Partial<ParsedPendingCheckoutItemDefinedEvent> = {},
): ParsedPendingCheckoutItemDefinedEvent {
  return {
    localEventId: "event-pending-item-1",
    localRegisterSessionId: "local-register-1",
    sequence: 2,
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
    ...overrides,
  };
}

function buildServiceLine(
  overrides: Partial<NonNullable<PosLocalSalePayload["serviceLines"]>[number]> = {},
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
  payloadOverrides: Partial<ParsedSaleClearedEvent["payload"]> = {},
): ParsedSaleClearedEvent {
  return {
    localEventId: "event-clear-1",
    localRegisterSessionId: "local-register-1",
    sequence: 2,
    eventType: "sale_cleared",
    occurredAt: 20,
    staffProfileId: "staff-1" as never,
    staffProofToken: "proof-token-1",
    payload: {
      localPosSessionId: "session-1",
      reason: "Sale cleared",
      ...payloadOverrides,
    },
  };
}

function createProjectionRepository(
  overrides: Partial<{
    registerSession: {
      _id: string;
      expectedCash: number;
      closeoutOwnedAt?: number;
      closeoutOwnershipSource?: string;
      closeoutRecords: unknown[];
      closedAt?: number;
      closedByStaffProfileId?: string;
      countedCash?: number;
      managerApprovalRequestId?: string;
      notes?: string;
      registerNumber?: string;
      status: string;
      variance?: number;
    } | null;
    blockingRegisterSession: {
      _id: string;
      expectedCash: number;
      closeoutOwnedAt?: number;
      closeoutOwnershipSource?: string;
      closeoutRecords: unknown[];
      registerNumber?: string;
      status: string;
      storeId?: string;
      terminalId?: string;
    };
    registerReviewConflictFacts: LocalSyncRegisterReviewConflictFact[];
    registerSessionsWithCloseoutReview: Set<string>;
    sku: {
      _id: string;
      storeId: string;
      productId: string;
      sku: string;
      price: number;
      netPrice?: number;
      quantityAvailable: number;
      inventoryCount: number;
      images: string[];
    };
    productStoreId: string;
    customerStoreId: string;
    serviceCatalog: {
      _id: string;
      storeId: string;
      organizationId?: string;
      name: string;
      serviceMode: "same_day" | "consultation" | "repair" | "revamp";
      pricingModel: "fixed" | "starting_at" | "quote_after_consultation";
      basePrice?: number;
      status: "active" | "archived";
      updatedAt: number;
    } | null;
    serviceCase: {
      _id: string;
      storeId: string;
      organizationId?: string;
      operationalWorkItemId: string;
      customerProfileId: string;
      status: string;
    } | null;
    pendingCheckoutItem: {
      _id: string;
      storeId: string;
      status:
        | "pending_review"
        | "flagged"
        | "approved"
        | "rejected"
        | "linked_to_catalog";
      provisionalProductId?: string;
      provisionalProductSkuId?: string;
    } | null;
    inventoryImportProvisionalSku: {
      _id: string;
      storeId: string;
      status: "active" | "finalized" | "rejected" | "closed";
      posExposureStatus?: "available" | "hidden";
      productId: string;
      productSkuId: string;
      importedBarcode?: string;
      importedPrice: number;
    } | null;
    inventoryImportProvisionalSkus: Array<{
      _id: string;
      storeId: string;
      status: "active" | "finalized" | "rejected" | "closed";
      posExposureStatus?: "available" | "hidden";
      productId: string;
      productSkuId: string;
      importedBarcode?: string;
      importedPrice: number;
    }>;
    activeHeldQuantity: number;
    consumedHoldQuantities: Map<string, number>;
    existingPosSession: {
      _id: string;
      registerSessionId: string;
      staffProfileId?: string;
      status?: string;
      storeId: string;
      terminalId: string;
      transactionId?: string;
    };
    staffProfile: {
      _id: string;
      linkedUserId?: string;
      status: string;
      storeId: string;
    };
    staffProfiles: Array<{
      _id: string;
      linkedUserId?: string;
      status: string;
      storeId: string;
    }>;
    terminalRegisteredByUserId: string;
    validCloudIds: Set<string>;
    validateLocalStaffProof:
      | boolean
      | ((
          args: Parameters<SyncProjectionRepository["validateLocalStaffProof"]>[0],
        ) => boolean);
    hasActivePosRole:
      | boolean
      | ((args: Parameters<SyncProjectionRepository["hasActivePosRole"]>[0]) => boolean);
    pendingVoidApprovalCount: number;
    closeoutHolds: Array<{
      cashAffecting: boolean;
      count: number;
      kind:
        | "pending_completed_sale_void_approvals"
        | "repairable_missing_register_session_mapping_sales";
    }>;
    validStaffProof: boolean;
    storeConfig: unknown;
    approvalRequests: Array<{
      _id: string;
      createdAt: number;
      decidedAt?: number;
      metadata?: Record<string, unknown>;
      notes?: string;
      reason?: string;
      registerSessionId?: string;
      requestType: string;
      status: "pending" | "approved" | "rejected" | "cancelled";
    }>;
  }> = {},
): SyncProjectionRepository & {
  approvalRequests: Array<{
    _id: string;
    createdAt: number;
    decidedAt?: number;
    metadata?: Record<string, unknown>;
    notes?: string;
    reason?: string;
    registerSessionId?: string;
    requestType: string;
    status: "pending" | "approved" | "rejected" | "cancelled";
  }>;
  createdConflicts: LocalSyncConflictRecord[];
  consumedHoldRequests: unknown[];
  releasedHoldRequests: unknown[];
  createdOperationalEvents: unknown[];
  createdPendingCheckoutItems: unknown[];
  createdPaymentAllocations: unknown[];
  createdExpenseSessions: unknown[];
  createdExpenseSessionItems: unknown[];
  createdExpenseTransactions: unknown[];
  createdExpenseTransactionItems: unknown[];
  createdPosSessions: unknown[];
  createdPosSessionItems: unknown[];
  createdRegisterSessions: unknown[];
  createdServiceCaseLineItems: unknown[];
  createdServiceCases: unknown[];
  createdServiceWorkItems: unknown[];
  createdTransactionItems: unknown[];
  createdTransactionServiceLines: unknown[];
  createdTransactions: unknown[];
  posSessionPatches: unknown[];
  mappings: LocalSyncMappingRecord[];
	  productPatches: unknown[];
	  recordedPendingCheckoutItemSaleEvidence: unknown[];
	  recordedInventoryImportProvisionalSkuSaleEvidence: unknown[];
	  recordedSaleInventoryMovements: unknown[];
	  recordedPosSessionTraces: unknown[];
  recordedRegisterSessionTraces: unknown[];
  registerSessionPatches: unknown[];
} {
  let nextId = 1;
  const mappings: LocalSyncMappingRecord[] = [
    {
      _id: "mapping-register",
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      localRegisterSessionId: "local-register-1",
      localEventId: "event-register-opened-1",
      sourceEventType: "register_opened",
      localIdKind: "registerSession",
      localId: "local-register-1",
      cloudTable: "registerSession",
      cloudId: "register-session-1" as never,
      createdAt: 1,
    },
  ];
  const createdConflicts: LocalSyncConflictRecord[] = [];
  const createdOperationalEvents: unknown[] = [];
  const createdPendingCheckoutItems: unknown[] = [];
  const createdPaymentAllocations: unknown[] = [];
  const createdExpenseSessions: unknown[] = [];
  const createdExpenseSessionItems: unknown[] = [];
  const createdExpenseTransactions: unknown[] = [];
  const createdExpenseTransactionItems: unknown[] = [];
  const createdPosSessions: unknown[] = [];
  const createdPosSessionItems: unknown[] = [];
  const createdRegisterSessions: unknown[] = [];
  const createdServiceCaseLineItems: unknown[] = [];
  const createdServiceCases: unknown[] = [];
  const createdServiceWorkItems: unknown[] = [];
  const createdTransactionItems: unknown[] = [];
  const createdTransactionServiceLines: unknown[] = [];
  const createdTransactions: unknown[] = [];
	  const posSessionPatches: unknown[] = [];
	  const productPatches: unknown[] = [];
	  const recordedPendingCheckoutItemSaleEvidence: unknown[] = [];
	  const recordedInventoryImportProvisionalSkuSaleEvidence: unknown[] = [];
	  const recordedSaleInventoryMovements: unknown[] = [];
	  const recordedPosSessionTraces: unknown[] = [];
  const recordedRegisterSessionTraces: unknown[] = [];
  const registerSessionPatches: unknown[] = [];
  const consumedHoldRequests: unknown[] = [];
  const releasedHoldRequests: unknown[] = [];
  const approvalRequests = [...(overrides.approvalRequests ?? [])];
  const sku = overrides.sku ?? {
    _id: "sku-1",
    storeId: "store-1",
    productId: "product-1",
    sku: "CAP-1",
    price: 25,
    quantityAvailable: 10,
    inventoryCount: 10,
    images: [],
  };
  const registerSession =
    overrides.registerSession === null
      ? null
      : (overrides.registerSession ?? {
          _id: "register-session-1",
          expectedCash: 100,
          closeoutRecords: [],
          registerNumber: "1",
          status: "active",
        });
  const terminal = {
    _id: "terminal-1",
    storeId: "store-1",
    displayName: "Front counter",
    registerNumber: "1",
    registeredByUserId: overrides.terminalRegisteredByUserId ?? "user-1",
    status: "active",
  };
  const serviceCatalog =
    overrides.serviceCatalog === null
      ? null
      : (overrides.serviceCatalog ?? {
          _id: "service-catalog-1",
          storeId: "store-1",
          organizationId: "org-1",
          name: "Install",
          serviceMode: "same_day",
          pricingModel: "fixed",
          basePrice: 75,
          status: "active",
          updatedAt: 1_000,
        });
  const serviceCase =
    overrides.serviceCase === null
      ? null
      : (overrides.serviceCase ?? null);

  return {
    createdConflicts,
    createdOperationalEvents,
    createdPendingCheckoutItems,
    createdPaymentAllocations,
    createdExpenseSessions,
    createdExpenseSessionItems,
    createdExpenseTransactions,
    createdExpenseTransactionItems,
    createdPosSessions,
    createdPosSessionItems,
    createdRegisterSessions,
    createdServiceCaseLineItems,
    createdServiceCases,
    createdServiceWorkItems,
    createdTransactionItems,
    createdTransactionServiceLines,
    createdTransactions,
    posSessionPatches,
	    productPatches,
	    recordedPendingCheckoutItemSaleEvidence,
	    recordedInventoryImportProvisionalSkuSaleEvidence,
	    recordedSaleInventoryMovements,
	    recordedPosSessionTraces,
    recordedRegisterSessionTraces,
    registerSessionPatches,
    consumedHoldRequests,
    releasedHoldRequests,
    approvalRequests,
    mappings,
    async getTerminal(terminalId) {
      return terminalId === "terminal-1" ? (terminal as never) : null;
    },
    async getStaffProfile(staffProfileId) {
      if (overrides.staffProfiles) {
        return (
          (overrides.staffProfiles.find(
            (staffProfile) => staffProfile._id === staffProfileId,
          ) as never) ?? null
        );
      }
      if (overrides.staffProfile) {
        return staffProfileId === overrides.staffProfile._id
          ? (overrides.staffProfile as never)
          : null;
      }
      return staffProfileId === "staff-1"
        ? ({
            _id: "staff-1",
            linkedUserId: "user-1",
            status: "active",
            storeId: "store-1",
          } as never)
        : null;
    },
    async hasActivePosRole(args) {
      if (typeof overrides.hasActivePosRole === "function") {
        return overrides.hasActivePosRole(args);
      }
      return overrides.hasActivePosRole ?? true;
    },
    async validateLocalStaffProof(args) {
      if (typeof overrides.validateLocalStaffProof === "function") {
        return overrides.validateLocalStaffProof(args);
      }
      if (typeof overrides.validateLocalStaffProof === "boolean") {
        return overrides.validateLocalStaffProof;
      }
      if (overrides.validStaffProof !== undefined) {
        return overrides.validStaffProof;
      }
      return (
        args.staffProfileId === "staff-1" &&
        args.storeId === "store-1" &&
        args.terminalId === "terminal-1" &&
        args.token === "proof-token-1"
      );
    },
    async getStore() {
      return {
        _id: "store-1",
        config: overrides.storeConfig,
        organizationId: "org-1",
      } as never;
    },
    async getCustomerProfile() {
      return {
        _id: "customer-1",
        storeId: overrides.customerStoreId ?? "store-1",
      } as never;
    },
    async getProduct(productId) {
      return productId === "product-1"
        ? ({
            _id: "product-1",
            storeId: overrides.productStoreId ?? "store-1",
          } as never)
        : null;
    },
    async getProductSku(productSkuId) {
      return productSkuId === "sku-1" ? (sku as never) : null;
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
      if (overrides.pendingCheckoutItem !== undefined) {
        return overrides.pendingCheckoutItem &&
          pendingCheckoutItemId === overrides.pendingCheckoutItem._id
          ? (overrides.pendingCheckoutItem as never)
          : null;
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
    async getInventoryImportProvisionalSku(inventoryImportProvisionalSkuId) {
      if (overrides.inventoryImportProvisionalSkus) {
        const provisionalSku = overrides.inventoryImportProvisionalSkus.find(
          (row) => row._id === inventoryImportProvisionalSkuId,
        );
        return provisionalSku
          ? ({
              posExposureStatus: "available",
              ...provisionalSku,
            } as never)
          : null;
      }
      if (overrides.inventoryImportProvisionalSku !== undefined) {
        return overrides.inventoryImportProvisionalSku &&
          inventoryImportProvisionalSkuId ===
            overrides.inventoryImportProvisionalSku._id
          ? ({
              posExposureStatus: "available",
              ...overrides.inventoryImportProvisionalSku,
            } as never)
          : null;
      }
      return null;
    },
    async getServiceCatalog(serviceCatalogId) {
      return serviceCatalog && serviceCatalogId === serviceCatalog._id
        ? (serviceCatalog as never)
        : null;
    },
    async getServiceCase(serviceCaseId) {
      return serviceCase && serviceCaseId === serviceCase._id
        ? (serviceCase as never)
        : null;
    },
    async getRegisterSession(registerSessionId) {
      return registerSession && registerSessionId === registerSession._id
        ? (registerSession as never)
        : null;
    },
    async listCloseoutHoldsForRegisterSession() {
      if (overrides.closeoutHolds) {
        return overrides.closeoutHolds;
      }
      const count = overrides.pendingVoidApprovalCount ?? 0;
      return count > 0
        ? [
            {
              kind: "pending_completed_sale_void_approvals" as const,
              cashAffecting: true,
              count,
            },
          ]
        : [];
    },
    async getActiveHeldQuantity(args) {
      if (args.excludeSessionId && overrides.existingPosSession?._id === args.excludeSessionId) {
        return 0;
      }
      return overrides.activeHeldQuantity ?? 0;
    },
    async readActiveInventoryHoldQuantitiesForSession(args) {
      return args.sessionId === overrides.existingPosSession?._id
        ? ((overrides.consumedHoldQuantities ?? new Map()) as never)
        : new Map();
    },
    async consumeInventoryHoldsForSession(args) {
      consumedHoldRequests.push(args);
      return (overrides.consumedHoldQuantities ?? new Map()) as never;
    },
    async releaseActiveInventoryHoldsForSession(args) {
      releasedHoldRequests.push(args);
      return {
        releasedHoldCount: 1,
        releasedHolds: [
          {
            holdId: "hold-1",
            productSkuId: "sku-1",
            quantity: 1,
          },
        ],
      } as never;
    },
    normalizeCloudId(_tableName, value) {
      return overrides.validCloudIds?.has(value) ? (value as never) : null;
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
      const existing = mappings.find(
        (mapping) =>
          mapping.storeId === input.storeId &&
          mapping.terminalId === input.terminalId &&
          mapping.localRegisterSessionId === input.localRegisterSessionId &&
          mapping.localIdKind === input.localIdKind &&
          mapping.localId === input.localId,
      );
      if (existing) {
        if (
          existing.localEventId === input.localEventId &&
          existing.cloudTable === input.cloudTable &&
          existing.cloudId === input.cloudId
        ) {
          return existing;
        }

        throw new Error(
          "POS local sync mapping already belongs to another projection.",
        );
      }
      const mapping = {
        _id: `mapping-${nextId++}`,
        ...input,
      } as LocalSyncMappingRecord;
      mappings.push(mapping);
      return mapping;
    },
	    async createConflict(input) {
	      const conflict = {
	        _id: `conflict-${nextId++}`,
	        ...input,
	      } satisfies LocalSyncConflictRecord;
	      createdConflicts.push(conflict);
	      return conflict;
	    },
	    async listConflictsForEvent(args) {
	      return createdConflicts.filter(
	        (conflict) =>
	          conflict.storeId === args.storeId &&
	          conflict.terminalId === args.terminalId &&
	          conflict.localEventId === args.localEventId,
	      );
	    },
    async createRegisterSession(input) {
      createdRegisterSessions.push(input);
      return "register-session-1" as never;
    },
    async findBlockingRegisterSession() {
      return (overrides.blockingRegisterSession as never) ?? null;
    },
    async listOpenRegisterReviewConflictFacts(args) {
      if (overrides.registerReviewConflictFacts) {
        return overrides.registerReviewConflictFacts;
      }

      return [...(overrides.registerSessionsWithCloseoutReview ?? new Set())]
        .map((registerSessionId, index) => ({
          conflict: {
            _id: `review-conflict-${registerSessionId}`,
            conflictType: "permission" as const,
            createdAt: 1_700_000_000_000 + index,
            details: {
              closeoutOccurredAt: 5,
              countedCash: 100,
              expectedCash: 90,
              variance: 10,
            },
            localEventId: `review-event-${registerSessionId}`,
            localRegisterSessionId: registerSessionId,
            sequence: 3,
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
    async getRegisterSessionByLocalId() {
      return registerSession as never;
    },
    async getPosSessionByLocalId(args) {
	      if (
	        overrides.existingPosSession &&
	        args.localPosSessionId === overrides.existingPosSession._id &&
	        args.registerSessionId === overrides.existingPosSession.registerSessionId
	      ) {
	        return {
	          staffProfileId: "staff-1",
	          ...overrides.existingPosSession,
	        } as never;
	      }
      const mapping = mappings.find(
        (candidate) =>
          candidate.storeId === args.storeId &&
          candidate.terminalId === args.terminalId &&
          candidate.localRegisterSessionId === args.localRegisterSessionId &&
          candidate.localIdKind === "posSession" &&
          candidate.localId === args.localPosSessionId,
      );
      if (!mapping) return null;
      const session = createdPosSessions.find(
        (candidate) =>
          typeof candidate === "object" &&
          candidate !== null &&
          "_id" in candidate &&
          candidate._id === mapping.cloudId,
      );
      const patch = posSessionPatches.find(
        (candidate) =>
          typeof candidate === "object" &&
          candidate !== null &&
          "posSessionId" in candidate &&
          candidate.posSessionId === mapping.cloudId,
      );
      return session
        ? ({ ...session, ...((patch as { patch?: object })?.patch ?? {}) } as never)
        : null;
    },
    async patchRegisterSession(registerSessionId, patch) {
      registerSessionPatches.push({ registerSessionId, patch });
      if (registerSession) Object.assign(registerSession, patch);
    },
    async getApprovalRequest(approvalRequestId) {
      return (
        (approvalRequests.find(
          (approvalRequest) => approvalRequest._id === approvalRequestId,
        ) as never) ?? null
      );
    },
    async createOrReuseRegisterSessionVarianceReview(input) {
      const notes = input.notes?.trim() || undefined;
      const pendingVarianceReviews = approvalRequests.filter(
        (approvalRequest) =>
          approvalRequest.status === "pending" &&
          approvalRequest.requestType === "variance_review" &&
          approvalRequest.registerSessionId === input.registerSessionId,
      );
      if (pendingVarianceReviews.length > 1) {
        return {
          details: {
            existingApprovalRequestIds: pendingVarianceReviews.map(
              (approvalRequest) => approvalRequest._id,
            ),
            localEventId: input.localEventId,
            registerSessionId: input.registerSessionId,
          },
          status: "conflict",
          summary:
            "Register closeout already has multiple pending variance reviews.",
        };
      }
      const matchingApprovalRequest = pendingVarianceReviews.find(
        (approvalRequest) =>
          approvalRequest.metadata?.countedCash === input.countedCash &&
          approvalRequest.metadata?.expectedCash === input.expectedCash &&
          approvalRequest.metadata?.variance === input.variance &&
          approvalRequest.metadata?.notes === notes &&
          approvalRequest.metadata?.localEventId === input.localEventId &&
          approvalRequest.metadata?.localRegisterSessionId ===
            input.localRegisterSessionId &&
          approvalRequest.metadata?.terminalId === input.terminalId,
      );

      if (matchingApprovalRequest) {
        return {
          approvalRequest: matchingApprovalRequest as never,
          created: false,
          status: "ready",
        };
      }

      if (pendingVarianceReviews[0]) {
        return {
          details: {
            existingApprovalRequestId: pendingVarianceReviews[0]._id,
            localEventId: input.localEventId,
            registerSessionId: input.registerSessionId,
          },
          status: "conflict",
          summary:
            "Register closeout already has a pending variance review with different closeout facts.",
        };
      }

      const approvalRequest = {
        _id: `approval-request-${approvalRequests.length + 1}`,
        createdAt: input.closeoutOccurredAt,
        metadata: {
          countedCash: input.countedCash,
          expectedCash: input.expectedCash,
          gateDecision: "approval_required",
          gateDecisionReason: input.gateDecisionReason,
          localEventId: input.localEventId,
          localRegisterSessionId: input.localRegisterSessionId,
          notes,
          closeoutOccurredAt: input.closeoutOccurredAt,
          syncOrigin: "local_sync",
          terminalId: input.terminalId,
          variance: input.variance,
        },
        notes,
        reason: input.gateDecisionReason,
        registerSessionId: input.registerSessionId,
        requestType: "variance_review",
        status: "pending" as const,
      };
      approvalRequests.push(approvalRequest);
      await this.patchRegisterSession(input.registerSessionId, {
        countedCash: input.countedCash,
        variance: input.variance,
        notes,
        status: "closing",
        managerApprovalRequestId: approvalRequest._id as never,
        closeoutOwnedAt: approvalRequest.createdAt,
        closeoutOwnershipSource: "approval_request",
      });
      return {
        approvalRequest: approvalRequest as never,
        created: true,
        status: "ready",
      };
    },
    async createPosSession(input) {
      const id = `pos-session-${input.localPosSessionId ?? nextId++}`;
      createdPosSessions.push({ _id: id, ...input });
      return id as never;
    },
    async patchPosSession(posSessionId, patch) {
      posSessionPatches.push({ posSessionId, patch });
    },
    async createPosSessionItem(input) {
      createdPosSessionItems.push(input);
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
      recordedPendingCheckoutItemSaleEvidence.push(input);
      const item = await this.getPendingCheckoutItem(input.pendingCheckoutItemId);
      return item
        ? ({
            ...item,
            evidence: {
              ...(item.evidence as Record<string, unknown>),
              lastPosTransactionId: input.posTransactionId,
              totalQuantitySold: input.quantitySold,
              transactionCount: 1,
            },
          } as never)
        : null;
    },
    async recordInventoryImportProvisionalSkuSaleEvidence(input) {
      recordedInventoryImportProvisionalSkuSaleEvidence.push(input);
    },
    async createServiceWorkItem(input) {
      const id = `service-work-item-${createdServiceWorkItems.length + 1}`;
      createdServiceWorkItems.push({ _id: id, ...input });
      return id as never;
    },
    async createServiceCase(input) {
      const id = `service-case-${createdServiceCases.length + 1}`;
      createdServiceCases.push({ _id: id, ...input });
      return id as never;
    },
    async createServiceCaseLineItem(input) {
      const id = `service-line-${createdServiceCaseLineItems.length + 1}`;
      createdServiceCaseLineItems.push({ _id: id, ...input });
      return id as never;
    },
    async syncServiceCaseFinancials() {},
    async createTransaction(input) {
      const id = `transaction-${createdTransactions.length + 1}`;
      createdTransactions.push({ _id: id, ...input });
      return id as never;
    },
    async createTransactionItem(input) {
      createdTransactionItems.push(input);
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
    async createTransactionServiceLine(input) {
      const id = `transaction-service-line-${createdTransactionServiceLines.length + 1}`;
      createdTransactionServiceLines.push({ _id: id, ...input });
      return id as never;
    },
	    async patchProductSku(productSkuId, patch) {
	      productPatches.push({ productSkuId, patch });
	    },
	    async recordSaleInventoryMovement(input) {
	      recordedSaleInventoryMovements.push(input);
	      return "inserted";
	    },
	    async createPaymentAllocation(input) {
      const id = `payment-allocation-${createdPaymentAllocations.length + 1}`;
      createdPaymentAllocations.push({ _id: id, ...input });
      return id as never;
    },
    async createOperationalEvent(input) {
      const id = `operational-event-${createdOperationalEvents.length + 1}`;
      createdOperationalEvents.push({ _id: id, ...input });
      return id as never;
    },
    async recordPosSessionWorkflowTrace(input) {
      recordedPosSessionTraces.push(input);
      return {
        traceCreated: true,
        traceId: `pos-trace-${recordedPosSessionTraces.length}`,
      };
    },
    async recordRegisterSessionWorkflowTrace(input) {
      recordedRegisterSessionTraces.push(input);
      return {
        traceCreated: true,
        traceId: `register-trace-${recordedRegisterSessionTraces.length}`,
      };
    },
  };
}

function buildRegisterCloseoutReviewFact(args: {
  closeoutOccurredAt?: number;
  registerSessionId: string;
  sequence?: number;
}): LocalSyncRegisterReviewConflictFact {
  return {
    conflict: {
      _id: `review-conflict-${args.registerSessionId}`,
      conflictType: "permission",
      createdAt: 1_700_000_000_000,
      details: {
        ...(args.closeoutOccurredAt === undefined
          ? {}
          : { closeoutOccurredAt: args.closeoutOccurredAt }),
        countedCash: 100,
        expectedCash: 90,
        variance: 10,
      },
      localEventId: `review-event-${args.registerSessionId}`,
      localRegisterSessionId: args.registerSessionId,
      sequence: args.sequence ?? 3,
      status: "needs_review",
      storeId: "store-1" as never,
      summary:
        "Register closeout variance requires manager review before synced closeout can be applied.",
      terminalId: "terminal-1" as never,
    },
    directRegisterSession: {
      _id: args.registerSessionId as Id<"registerSession">,
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
    },
    registerSessionMapping: null,
  };
}
