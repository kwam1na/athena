import { describe, expect, it } from "vitest";

import type { PosLocalEventRecord } from "./posLocalStore";
import {
  projectLocalRegisterReadModel,
  type PosLocalRegisterReadModelError,
} from "./registerReadModel";

describe("projectLocalRegisterReadModel", () => {
  it("replays a local drawer, sale, cart, payment, and receipt history", () => {
    const model = projectLocalRegisterReadModel({
      events: [
        event({
          sequence: 1,
          type: "register.opened",
          localRegisterSessionId: "local-register-1",
          payload: {
            localRegisterSessionId: "local-register-1",
            openingFloat: 100,
            expectedCash: 100,
            status: "open",
          },
        }),
        event({
          sequence: 2,
          type: "session.started",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: { localPosSessionId: "local-sale-1", status: "active" },
        }),
        event({
          sequence: 3,
          type: "cart.item_added",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productSku: "SKU-1",
            productName: "Lace Front",
            price: 75,
            quantity: 2,
          },
        }),
        event({
          sequence: 4,
          type: "transaction.completed",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          localTransactionId: "local-txn-1",
          payload: {
            localPosSessionId: "local-sale-1",
            localTransactionId: "local-txn-1",
            receiptNumber: "R-1",
            subtotal: 150,
            tax: 0,
            total: 150,
            payments: [{ method: "cash", amount: 150, timestamp: 1_004 }],
          },
        }),
      ],
      isOnline: true,
    });

    expect(model.registerState.activeRegisterSession).toMatchObject({
      _id: "local-register-1",
      openingFloat: 100,
      expectedCash: 250,
      status: "active",
    });
    expect(model.activeSale).toBeNull();
    expect(model.completedSales).toEqual([
      expect.objectContaining({
        localPosSessionId: "local-sale-1",
        localTransactionId: "local-txn-1",
        receiptNumber: "R-1",
        total: 150,
        items: [
          expect.objectContaining({
            localItemId: "local-item-1",
            productSkuId: "sku-1",
            quantity: 2,
          }),
        ],
        payments: [{ method: "cash", amount: 150, timestamp: 1_004 }],
      }),
    ]);
    expect(model.syncStatus).toMatchObject({
      state: "pending",
      pendingCount: 4,
      lastLocalSequence: 4,
    });
    expect(model.errors).toEqual([]);
  });

  it("uses synced mappings without replacing local identities", () => {
    const model = projectLocalRegisterReadModel({
      terminalSeed: {
        terminalId: "local-terminal-1",
        cloudTerminalId: "terminal-cloud-1",
        syncSecretHash: "secret",
        storeId: "store-1",
        registerNumber: "1",
        displayName: "Front register",
        provisionedAt: 900,
        schemaVersion: 1,
      },
      mappings: [
        {
          entity: "registerSession",
          localId: "local-register-1",
          cloudId: "register-cloud-1",
          mappedAt: 1_100,
        },
        {
          entity: "posSession",
          localId: "local-sale-1",
          cloudId: "sale-cloud-1",
          mappedAt: 1_101,
        },
      ],
      events: [
        event({
          sequence: 1,
          type: "register.opened",
          localRegisterSessionId: "local-register-1",
          payload: { openingFloat: 50 },
          sync: { status: "synced", cloudEventId: "event-cloud-1" },
        }),
        event({
          sequence: 2,
          type: "session.started",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: { status: "active" },
          sync: { status: "synced", cloudEventId: "event-cloud-2" },
        }),
      ],
      isOnline: true,
    });

    expect(model.registerState.terminal).toMatchObject({
      _id: "terminal-cloud-1",
      cloudTerminalId: "terminal-cloud-1",
      displayName: "Front register",
      localTerminalId: "local-terminal-1",
      registerNumber: "1",
      status: "local",
    });
    expect(model.activeRegisterSession).toMatchObject({
      localRegisterSessionId: "local-register-1",
      cloudRegisterSessionId: "register-cloud-1",
    });
    expect(model.activeSale).toMatchObject({
      localPosSessionId: "local-sale-1",
      cloudPosSessionId: "sale-cloud-1",
    });
    expect(model.syncStatus.state).toBe("synced");
  });

  it("isolates malformed and unsupported payload errors without corrupting good state", () => {
    const model = projectLocalRegisterReadModel({
      events: [
        event({
          sequence: 1,
          type: "register.opened",
          localRegisterSessionId: "local-register-1",
          payload: { openingFloat: 25 },
        }),
        event({
          sequence: 2,
          type: "cart.item_added",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: { productSkuId: "sku-bad", quantity: "two" },
        }),
        event({
          sequence: 3,
          type: "cash.movement_recorded",
          localRegisterSessionId: "local-register-1",
          payload: { amount: 10 },
        }),
        event({
          sequence: 4,
          type: "session.started",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: { status: "active" },
        }),
        event({
          sequence: 5,
          type: "cart.item_added",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: {
            localItemId: "local-item-good",
            productId: "product-good",
            productSkuId: "sku-good",
            productSku: "SKU-GOOD",
            productName: "Good item",
            price: 30,
            quantity: 1,
          },
        }),
      ],
    });

    expect(model.activeRegisterSession?.localRegisterSessionId).toBe(
      "local-register-1",
    );
    expect(model.activeSale?.items).toEqual([
      expect.objectContaining({ productSkuId: "sku-good", quantity: 1 }),
    ]);
    expect(errorCodes(model.errors)).toEqual([
      "malformed_payload",
      "unsupported_event_type",
    ]);
  });

  it("replaces cart quantity updates and removes zero-quantity items", () => {
    const model = projectLocalRegisterReadModel({
      events: [
        event({
          sequence: 1,
          type: "register.opened",
          localRegisterSessionId: "local-register-1",
          payload: { openingFloat: 100 },
        }),
        event({
          sequence: 2,
          type: "session.started",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: { localPosSessionId: "local-sale-1", status: "active" },
        }),
        event({
          sequence: 3,
          type: "cart.item_added",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productSku: "SKU-1",
            productName: "Body Wave",
            price: 75,
            quantity: 1,
          },
        }),
        event({
          sequence: 4,
          type: "cart.item_added",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productSku: "SKU-1",
            productName: "Body Wave",
            price: 75,
            quantity: 3,
          },
        }),
        event({
          sequence: 5,
          type: "cart.item_added",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productSku: "SKU-1",
            productName: "Body Wave",
            price: 75,
            quantity: 0,
          },
        }),
      ],
    });

    expect(model.activeSale?.items).toEqual([]);
    expect(model.activeSale?.total).toBe(0);
  });

  it("clears local cart and payment state with one durable clear event", () => {
    const model = projectLocalRegisterReadModel({
      events: [
        event({
          sequence: 1,
          type: "register.opened",
          localRegisterSessionId: "local-register-1",
          payload: { openingFloat: 100 },
        }),
        event({
          sequence: 2,
          type: "session.started",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: { localPosSessionId: "local-sale-1", status: "active" },
        }),
        event({
          sequence: 3,
          type: "cart.item_added",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: {
            localItemId: "local-item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productSku: "SKU-1",
            productName: "Body Wave",
            price: 75,
            quantity: 2,
          },
        }),
        event({
          sequence: 4,
          type: "session.payments_updated",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: {
            localPosSessionId: "local-sale-1",
            payments: [{ method: "cash", amount: 150, timestamp: 1_004 }],
            stage: "paymentAdded",
          },
        }),
        event({
          sequence: 5,
          type: "cart.cleared",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: { localPosSessionId: "local-sale-1" },
        }),
      ],
    });

    expect(model.activeSale).toBeNull();
    expect(model.clearedSaleIds).toEqual(["local-sale-1"]);
  });

  it("uses completed sale payload items and customer attribution", () => {
    const model = projectLocalRegisterReadModel({
      events: [
        event({
          sequence: 1,
          type: "register.opened",
          localRegisterSessionId: "local-register-1",
          payload: { openingFloat: 100 },
        }),
        event({
          sequence: 2,
          type: "session.started",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          payload: { localPosSessionId: "local-sale-1", status: "active" },
        }),
        event({
          sequence: 3,
          type: "transaction.completed",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          localTransactionId: "local-txn-1",
          payload: {
            localPosSessionId: "local-sale-1",
            localTransactionId: "local-txn-1",
            receiptNumber: "R-1",
            customerProfileId: "customer-profile-1",
            subtotal: 80,
            tax: 0,
            total: 80,
            items: [
              {
                localItemId: "payload-item-1",
                productId: "product-1",
                productSkuId: "sku-1",
                productSku: "SKU-1",
                productName: "Payload Item",
                price: 40,
                quantity: 2,
              },
            ],
            payments: [{ method: "card", amount: 80, timestamp: 1_004 }],
          },
        }),
      ],
    });

    expect(model.completedSales).toEqual([
      expect.objectContaining({
        customerProfileId: "customer-profile-1",
        items: [
          expect.objectContaining({
            localItemId: "payload-item-1",
            productSkuId: "sku-1",
            quantity: 2,
          }),
        ],
        total: 80,
      }),
    ]);
  });

  it("adds only cash retained after change to local expected cash", () => {
    const model = projectLocalRegisterReadModel({
      events: [
        event({
          sequence: 1,
          type: "register.opened",
          localRegisterSessionId: "local-register-1",
          payload: { openingFloat: 100 },
        }),
        event({
          sequence: 2,
          type: "transaction.completed",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-1",
          localTransactionId: "local-txn-1",
          payload: {
            localPosSessionId: "local-sale-1",
            localTransactionId: "local-txn-1",
            receiptNumber: "R-1",
            subtotal: 90,
            tax: 0,
            total: 90,
            items: [
              {
                localItemId: "payload-item-1",
                productId: "product-1",
                productSkuId: "sku-1",
                productSku: "SKU-1",
                productName: "Payload Item",
                price: 90,
                quantity: 1,
              },
            ],
            payments: [
              {
                localPaymentId: "payment-1",
                method: "cash",
                amount: 100,
                timestamp: 1_004,
              },
            ],
          },
        }),
      ],
    });

    expect(model.activeRegisterSession?.expectedCash).toBe(190);
    expect(model.completedSales[0]?.payments).toEqual([
      {
        id: "payment-1",
        method: "cash",
        amount: 100,
        timestamp: 1_004,
      },
    ]);
  });

  it("replays local payment drafts into the active sale", () => {
    const events = [
      event({
        sequence: 1,
        type: "register.opened",
        localRegisterSessionId: "local-register-1",
        payload: { openingFloat: 100 },
      }),
      event({
        sequence: 2,
        type: "session.started",
        localRegisterSessionId: "local-register-1",
        localPosSessionId: "local-sale-1",
        payload: { localPosSessionId: "local-sale-1", status: "active" },
      }),
      event({
        sequence: 3,
        type: "session.payments_updated",
        localRegisterSessionId: "local-register-1",
        localPosSessionId: "local-sale-1",
        payload: {
          localPosSessionId: "local-sale-1",
          payments: [{ method: "cash", amount: 100, timestamp: 1_003 }],
          stage: "paymentAdded",
        },
      }),
    ];

    const paid = projectLocalRegisterReadModel({ events });

    expect(paid.activeSale?.payments).toEqual([
      { method: "cash", amount: 100, timestamp: 1_003 },
    ]);
  });

  it("blocks selling after local closeout until the register is reopened", () => {
    const closedEvents = [
      event({
        sequence: 1,
        type: "register.opened",
        localRegisterSessionId: "local-register-1",
        payload: { openingFloat: 100 },
      }),
      event({
        sequence: 2,
        type: "register.closeout_started",
        localRegisterSessionId: "local-register-1",
        payload: { countedCash: 100 },
      }),
      event({
        sequence: 3,
        type: "session.started",
        localRegisterSessionId: "local-register-1",
        localPosSessionId: "local-sale-blocked",
        payload: { status: "active" },
      }),
    ];
    const closed = projectLocalRegisterReadModel({ events: closedEvents });

    expect(closed.canSell).toBe(false);
    expect(closed.closeoutState).toMatchObject({
      status: "closed_locally",
      localRegisterSessionId: "local-register-1",
    });
    expect(closed.registerState.activeRegisterSession).toMatchObject({
      _id: "local-register-1",
      status: "closing",
    });
    expect(closed.activeSale).toBeNull();
    expect(errorCodes(closed.errors)).toContain("register_closed");

    const reopened = projectLocalRegisterReadModel({
      events: [
        ...closedEvents,
        event({
          sequence: 4,
          type: "register.reopened",
          localRegisterSessionId: "local-register-1",
          payload: { reason: "Correction" },
        }),
        event({
          sequence: 5,
          type: "session.started",
          localRegisterSessionId: "local-register-1",
          localPosSessionId: "local-sale-open",
          payload: { status: "active" },
        }),
      ],
    });

    expect(reopened.canSell).toBe(true);
    expect(reopened.closeoutState).toMatchObject({ status: "reopened" });
    expect(reopened.activeSale).toMatchObject({
      localPosSessionId: "local-sale-open",
    });
  });
});

function errorCodes(errors: PosLocalRegisterReadModelError[]) {
  return errors.map((error) => error.code);
}

function event(
  overrides: Partial<PosLocalEventRecord> & {
    sequence: number;
    type: PosLocalEventRecord["type"];
  },
): PosLocalEventRecord {
  const { sequence, type, ...rest } = overrides;
  return {
    localEventId: `event-${sequence}`,
    schemaVersion: 1,
    sequence,
    type,
    terminalId: "local-terminal-1",
    storeId: "store-1",
    registerNumber: "1",
    localRegisterSessionId: "local-register-1",
    staffProfileId: "staff-1",
    payload: {},
    createdAt: 1_000 + sequence,
    sync: { status: "pending" },
    ...rest,
  };
}
