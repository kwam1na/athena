import { describe, expect, it } from "vitest";

import type { PosLocalEventRecord } from "./posLocalStore";
import { projectExpenseLocalReadModel } from "./expenseReadModel";

describe("projectExpenseLocalReadModel", () => {
  it("replays active expense events into a cart read model", () => {
    const model = projectExpenseLocalReadModel({
      events: [
        event({
          sequence: 1,
          type: "expense.session_started",
          localExpenseSessionId: "expense-1",
          payload: { localExpenseSessionId: "expense-1" },
        }),
        event({
          sequence: 2,
          type: "expense.item_added",
          localExpenseSessionId: "expense-1",
          payload: item({ quantity: 1 }),
        }),
        event({
          sequence: 3,
          type: "expense.item_updated",
          localExpenseSessionId: "expense-1",
          payload: item({ quantity: 3 }),
        }),
      ],
    });

    expect(model.activeSession).toMatchObject({
      localExpenseSessionId: "expense-1",
      status: "active",
      subtotal: 75,
      total: 75,
      items: [
        expect.objectContaining({
          localItemId: "item-1",
          productSkuId: "sku-1",
          quantity: 3,
        }),
      ],
    });
    expect(model.errors).toEqual([]);
  });

  it("removes a replayed item when the remove event used an optimistic item id", () => {
    const model = projectExpenseLocalReadModel({
      events: [
        event({
          sequence: 1,
          type: "expense.session_started",
          localExpenseSessionId: "expense-1",
          payload: { localExpenseSessionId: "expense-1" },
        }),
        event({
          sequence: 2,
          type: "expense.item_added",
          localExpenseSessionId: "expense-1",
          payload: item({
            localItemId: "expense-item-1",
            productSkuId: "sku-1",
          }),
        }),
        event({
          sequence: 3,
          type: "expense.item_added",
          localExpenseSessionId: "expense-1",
          payload: item({
            localItemId: "pending-item-1",
            pendingCheckoutItemId: "pending-1",
            productSkuId: "sku-1",
          }),
        }),
        event({
          sequence: 4,
          type: "expense.item_removed",
          localExpenseSessionId: "expense-1",
          payload: {
            localExpenseSessionId: "expense-1",
            localItemId: "optimistic:sku-1:trusted_inventory",
            productSkuId: "sku-1",
          },
        }),
      ],
    });

    expect(model.activeSession?.items).toEqual([
      expect.objectContaining({
        localItemId: "pending-item-1",
        sourceKey: "pending_checkout:pending-1",
      }),
    ]);
    expect(model.errors).toEqual([]);
  });

  it("preserves trusted, pending checkout, and provisional import source metadata", () => {
    const model = projectExpenseLocalReadModel({
      events: [
        event({
          sequence: 1,
          type: "expense.session_started",
          localExpenseSessionId: "expense-1",
          payload: { localExpenseSessionId: "expense-1" },
        }),
        event({
          sequence: 2,
          type: "expense.item_added",
          localExpenseSessionId: "expense-1",
          payload: item({
            localItemId: "trusted-item",
            productSkuId: "sku-trusted",
          }),
        }),
        event({
          sequence: 3,
          type: "expense.item_added",
          localExpenseSessionId: "expense-1",
          payload: item({
            localItemId: "pending-item",
            productSkuId: "sku-pending",
            pendingCheckoutItemId: "pending-1",
          }),
        }),
        event({
          sequence: 4,
          type: "expense.item_added",
          localExpenseSessionId: "expense-1",
          payload: item({
            localItemId: "provisional-item",
            productSkuId: "sku-provisional",
            inventoryImportProvisionalSkuId: "provisional-1",
          }),
        }),
      ],
    });

    expect(
      model.activeSession?.items.map((cartItem) => ({
        localItemId: cartItem.localItemId,
        source: cartItem.source,
        sourceKey: cartItem.sourceKey,
        pendingCheckoutItemId: cartItem.pendingCheckoutItemId,
        inventoryImportProvisionalSkuId:
          cartItem.inventoryImportProvisionalSkuId,
      })),
    ).toEqual([
      {
        localItemId: "trusted-item",
        source: "trusted_inventory",
        sourceKey: "trusted_inventory",
        pendingCheckoutItemId: undefined,
        inventoryImportProvisionalSkuId: undefined,
      },
      {
        localItemId: "pending-item",
        source: "pending_checkout",
        sourceKey: "pending_checkout:pending-1",
        pendingCheckoutItemId: "pending-1",
        inventoryImportProvisionalSkuId: undefined,
      },
      {
        localItemId: "provisional-item",
        source: "provisional_import",
        sourceKey: "provisional_import:provisional-1",
        pendingCheckoutItemId: undefined,
        inventoryImportProvisionalSkuId: "provisional-1",
      },
    ]);
  });

  it("keeps same-SKU lines distinct when their source keys differ", () => {
    const model = projectExpenseLocalReadModel({
      events: [
        event({
          sequence: 1,
          type: "expense.session_started",
          localExpenseSessionId: "expense-1",
          payload: { localExpenseSessionId: "expense-1" },
        }),
        event({
          sequence: 2,
          type: "expense.item_added",
          localExpenseSessionId: "expense-1",
          payload: item({ localItemId: "trusted", productSkuId: "sku-1" }),
        }),
        event({
          sequence: 3,
          type: "expense.item_added",
          localExpenseSessionId: "expense-1",
          payload: item({
            localItemId: "pending",
            productSkuId: "sku-1",
            pendingCheckoutItemId: "pending-1",
          }),
        }),
        event({
          sequence: 4,
          type: "expense.item_added",
          localExpenseSessionId: "expense-1",
          payload: item({
            localItemId: "provisional",
            productSkuId: "sku-1",
            inventoryImportProvisionalSkuId: "provisional-1",
          }),
        }),
      ],
    });

    expect(model.activeSession?.items).toHaveLength(3);
    expect(model.activeSession?.items.map((cartItem) => cartItem.sourceKey)).toEqual([
      "trusted_inventory",
      "pending_checkout:pending-1",
      "provisional_import:provisional-1",
    ]);
  });

  it("is deterministic for rapid add, update, remove, clear, and re-add events", () => {
    const model = projectExpenseLocalReadModel({
      events: [
        event({
          sequence: 5,
          type: "expense.cart_cleared",
          localExpenseSessionId: "expense-1",
          payload: { localExpenseSessionId: "expense-1" },
        }),
        event({
          sequence: 1,
          type: "expense.session_started",
          localExpenseSessionId: "expense-1",
          payload: { localExpenseSessionId: "expense-1" },
        }),
        event({
          sequence: 4,
          type: "expense.item_removed",
          localExpenseSessionId: "expense-1",
          payload: item({ quantity: 2 }),
        }),
        event({
          sequence: 2,
          type: "expense.item_added",
          localExpenseSessionId: "expense-1",
          payload: item({ quantity: 1 }),
        }),
        event({
          sequence: 6,
          type: "expense.item_added",
          localExpenseSessionId: "expense-1",
          payload: item({ localItemId: "item-2", productSkuId: "sku-2" }),
        }),
        event({
          sequence: 3,
          type: "expense.item_updated",
          localExpenseSessionId: "expense-1",
          payload: item({ quantity: 2 }),
        }),
      ],
    });

    expect(model.activeSession?.items).toEqual([
      expect.objectContaining({
        localItemId: "item-2",
        productSkuId: "sku-2",
        quantity: 1,
      }),
    ]);
  });

  it("keeps pre-completion voided sessions out of active expense state", () => {
    const model = projectExpenseLocalReadModel({
      events: [
        event({
          sequence: 1,
          type: "expense.session_started",
          localExpenseSessionId: "expense-1",
          payload: { localExpenseSessionId: "expense-1" },
        }),
        event({
          sequence: 2,
          type: "expense.item_added",
          localExpenseSessionId: "expense-1",
          payload: item({ quantity: 1 }),
        }),
        event({
          sequence: 3,
          type: "expense.voided",
          localExpenseSessionId: "expense-1",
          payload: {
            localExpenseSessionId: "expense-1",
            reason: "cashier_void",
          },
        }),
      ],
    });

    expect(model.activeSession).toBeNull();
    expect(model.preCompletionVoidedSessions).toEqual([
      expect.objectContaining({
        localExpenseSessionId: "expense-1",
        status: "voided",
        reason: "cashier_void",
      }),
    ]);
  });

  it("does not expire old held sessions during replay", () => {
    const model = projectExpenseLocalReadModel({
      events: [
        event({
          sequence: 1,
          createdAt: 1,
          type: "expense.session_started",
          localExpenseSessionId: "expense-old",
          payload: { localExpenseSessionId: "expense-old" },
        }),
        event({
          sequence: 2,
          createdAt: 2,
          type: "expense.held",
          localExpenseSessionId: "expense-old",
          payload: {
            localExpenseSessionId: "expense-old",
            reason: "waiting_on_receipt",
          },
        }),
      ],
    });

    expect(model.heldSessions).toEqual([
      expect.objectContaining({
        localExpenseSessionId: "expense-old",
        status: "held",
        reason: "waiting_on_receipt",
      }),
    ]);
  });

  it("derives completed pending-sync, synced, and needs-review states from completion event sync", () => {
    const model = projectExpenseLocalReadModel({
      events: [
        completedEvent("expense-pending", 1, { status: "pending" }),
        completedEvent("expense-synced", 2, { status: "synced" }),
        completedEvent("expense-review", 3, {
          status: "needs_review",
          uploaded: true,
        }),
      ],
      isOnline: true,
    });

    expect(
      model.completedSessions.map((session) => ({
        localExpenseSessionId: session.localExpenseSessionId,
        status: session.status,
        sync: session.sync?.status,
      })),
    ).toEqual([
      {
        localExpenseSessionId: "expense-pending",
        status: "completed_pending_sync",
        sync: "pending",
      },
      {
        localExpenseSessionId: "expense-synced",
        status: "synced",
        sync: "synced",
      },
      {
        localExpenseSessionId: "expense-review",
        status: "needs_review",
        sync: "needs_review",
      },
    ]);
  });
});

function event(
  overrides: Partial<PosLocalEventRecord> & Pick<PosLocalEventRecord, "type">,
): PosLocalEventRecord {
  const { type, ...rest } = overrides;
  return {
    localEventId: `event-${overrides.sequence ?? 1}`,
    schemaVersion: 8,
    sequence: overrides.sequence ?? 1,
    type,
    terminalId: "terminal-1",
    storeId: "store-1",
    staffProfileId: "staff-1",
    payload: {},
    createdAt: overrides.createdAt ?? 1_000 + (overrides.sequence ?? 1),
    sync: { status: "synced" },
    ...rest,
  };
}

function completedEvent(
  localExpenseSessionId: string,
  sequence: number,
  sync: PosLocalEventRecord["sync"],
) {
  return event({
    sequence,
    type: "expense.completed",
    localExpenseSessionId,
    uploadSequence: 1,
    payload: {
      localExpenseSessionId,
      localExpenseEventId: `${localExpenseSessionId}-event`,
      items: [item({ localExpenseSessionId })],
      subtotal: 25,
      tax: 0,
      total: 25,
    },
    sync,
  });
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    localExpenseSessionId: "expense-1",
    localItemId: "item-1",
    productId: "product-1",
    productSkuId: "sku-1",
    productSku: "SKU-1",
    productName: "Body Wave",
    price: 25,
    quantity: 1,
    ...overrides,
  };
}
