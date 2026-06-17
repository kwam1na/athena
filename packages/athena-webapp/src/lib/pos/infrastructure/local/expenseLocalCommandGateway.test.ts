import { describe, expect, it, vi } from "vitest";

import { createExpenseLocalCommandGateway } from "./expenseLocalCommandGateway";
import {
  createMemoryPosLocalStorageAdapter,
  createPosLocalStore,
} from "./posLocalStore";

describe("createExpenseLocalCommandGateway", () => {
  it("starts a drawerless local expense session and appends cart mutations", async () => {
    let nextId = 1;
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: () => `local-event-${nextId++}`,
    });
    const gateway = createExpenseLocalCommandGateway({
      store,
      clock: () => 2_000,
      createLocalId: (kind) => `${kind}-${nextId++}`,
    });

    await expect(
      gateway.startSession({
        terminalId: "terminal-1",
        storeId: "store-1",
        staffProfileId: "staff-1",
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      data: {
        localExpenseSessionId: "local-expense-session-1",
        status: "active",
      },
    });
    await expect(
      gateway.addItem({
        terminalId: "terminal-1",
        storeId: "store-1",
        staffProfileId: "staff-1",
        localExpenseSessionId: "local-expense-session-1",
        localItemId: "item-1",
        productSkuId: "sku-1",
        price: 10,
        quantity: 1,
      }),
    ).resolves.toBe(true);
    await expect(
      gateway.updateItem({
        terminalId: "terminal-1",
        storeId: "store-1",
        staffProfileId: "staff-1",
        localExpenseSessionId: "local-expense-session-1",
        localItemId: "item-1",
        productSkuId: "sku-1",
        price: 10,
        quantity: 2,
      }),
    ).resolves.toBe(true);

    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({
          type: "expense.session_started",
          localExpenseSessionId: "local-expense-session-1",
        }),
        expect.objectContaining({
          type: "expense.item_added",
          localExpenseSessionId: "local-expense-session-1",
        }),
        expect.objectContaining({
          type: "expense.item_updated",
          localExpenseSessionId: "local-expense-session-1",
        }),
      ],
    });
  });

  it("preserves source metadata and staff proof on completed expense events", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const gateway = createExpenseLocalCommandGateway({
      store,
      createLocalId: (kind) => `${kind}-1`,
      staffProofToken: "proof-token-1",
    });

    await gateway.startSession(scope());
    await expect(
      gateway.completeExpense({
        ...scope(),
        localExpenseSessionId: "local-expense-session-1",
        localExpenseEventId: "local-expense-event-1",
        subtotal: 50,
        tax: 0,
        total: 50,
        items: [
          {
            localExpenseSessionId: "local-expense-session-1",
            localItemId: "pending-item",
            productSkuId: "sku-1",
            pendingCheckoutItemId: "pending-1",
            price: 50,
            quantity: 1,
          },
          {
            localExpenseSessionId: "local-expense-session-1",
            localItemId: "provisional-item",
            productSkuId: "sku-1",
            inventoryImportProvisionalSkuId: "provisional-1",
            price: 50,
            quantity: 1,
          },
        ],
      }),
    ).resolves.toBe(true);

    await expect(store.listEventsForUpload()).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({
          type: "expense.completed",
          localExpenseSessionId: "local-expense-session-1",
          staffProofToken: "proof-token-1",
          uploadSequence: 1,
          payload: expect.objectContaining({
            localExpenseEventId: "local-expense-event-1",
            items: [
              expect.objectContaining({
                pendingCheckoutItemId: "pending-1",
              }),
              expect.objectContaining({
                inventoryImportProvisionalSkuId: "provisional-1",
              }),
            ],
          }),
        }),
      ]),
    });
  });

  it("notifies after each durable expense event append", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const onEventAppended = vi.fn();
    const gateway = createExpenseLocalCommandGateway({
      store,
      createLocalId: (kind) => `${kind}-1`,
      onEventAppended,
    });

    await gateway.startSession(scope());
    await gateway.holdSession({
      ...scope(),
      localExpenseSessionId: "local-expense-session-1",
      reason: "waiting_on_receipt",
    });
    await gateway.resumeSession({
      ...scope(),
      localExpenseSessionId: "local-expense-session-1",
    });

    expect(onEventAppended).toHaveBeenCalledTimes(3);
  });

  it("does not append mutations after a pre-completion cancel", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const gateway = createExpenseLocalCommandGateway({
      store,
      createLocalId: (kind) => `${kind}-1`,
    });

    await gateway.startSession(scope());
    await gateway.cancelSession({
      ...scope(),
      localExpenseSessionId: "local-expense-session-1",
      reason: "cashier_cancel",
    });

    await expect(
      gateway.addItem({
        ...scope(),
        localExpenseSessionId: "local-expense-session-1",
        productSkuId: "sku-1",
        price: 10,
        quantity: 1,
      }),
    ).resolves.toBe(false);
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({ type: "expense.session_started" }),
        expect.objectContaining({ type: "expense.canceled" }),
      ],
    });
  });

  it("reopens a stale voided local expense session before adding an item", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const gateway = createExpenseLocalCommandGateway({
      store,
      createLocalId: (kind) => `${kind}-1`,
    });

    await gateway.startSession(scope());
    await gateway.voidSession({
      ...scope(),
      localExpenseSessionId: "local-expense-session-1",
      reason: "stale_navigation",
    });

    await expect(
      gateway.addItem({
        ...scope(),
        localExpenseSessionId: "local-expense-session-1",
        localItemId: "item-1",
        productSkuId: "sku-1",
        price: 10,
        quantity: 1,
      }),
    ).resolves.toBe(true);
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({ type: "expense.session_started" }),
        expect.objectContaining({ type: "expense.voided" }),
        expect.objectContaining({
          type: "expense.session_started",
          payload: expect.objectContaining({
            recoveredFromStatus: "voided",
          }),
        }),
        expect.objectContaining({ type: "expense.item_added" }),
      ],
    });
  });
});

function scope() {
  return {
    terminalId: "terminal-1",
    storeId: "store-1",
    staffProfileId: "staff-1",
  };
}
