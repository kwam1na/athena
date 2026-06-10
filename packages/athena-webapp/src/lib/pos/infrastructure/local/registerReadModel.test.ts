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
          uploadSequence: 1,
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
          uploadSequence: 2,
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
      pendingCount: 2,
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

  it("does not replace a same-SKU cart line with a different inventory source", () => {
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
            localItemId: "local-item-trusted",
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
            localItemId: "local-item-provisional",
            productId: "product-1",
            productSkuId: "sku-1",
            inventoryImportProvisionalSkuId: "provisional-sku-1",
            productSku: "SKU-1",
            productName: "Body Wave",
            price: 75,
            quantity: 2,
          },
        }),
      ],
    });

    expect(model.activeSale?.items).toEqual([
      expect.objectContaining({
        localItemId: "local-item-trusted",
        productSkuId: "sku-1",
        quantity: 1,
      }),
    ]);
    expect(model.activeSale?.items[0]?.inventoryImportProvisionalSkuId).toBe(
      undefined,
    );
  });

  it("keeps same-SKU cart lines separate by provisional import row", () => {
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
            localItemId: "local-item-provisional-1",
            productId: "product-1",
            productSkuId: "sku-1",
            inventoryImportProvisionalSkuId: "provisional-sku-1",
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
            localItemId: "local-item-provisional-2",
            productId: "product-1",
            productSkuId: "sku-1",
            inventoryImportProvisionalSkuId: "provisional-sku-2",
            productSku: "SKU-1",
            productName: "Body Wave",
            price: 75,
            quantity: 2,
          },
        }),
      ],
    });

    expect(model.activeSale?.items).toEqual([
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-sku-1",
        localItemId: "local-item-provisional-1",
        productSkuId: "sku-1",
        quantity: 1,
      }),
      expect.objectContaining({
        inventoryImportProvisionalSkuId: "provisional-sku-2",
        localItemId: "local-item-provisional-2",
        productSkuId: "sku-1",
        quantity: 2,
      }),
    ]);
  });

  it("replays local service draft adds and updates into active sale totals", () => {
    const model = projectLocalRegisterReadModel({
      events: [
        ...serviceDraftPrelude(),
        serviceDraftEvent({
          sequence: 3,
          localServiceLineId: "service-line-1",
          unitPrice: 75,
          totalPrice: 75,
        }),
        serviceDraftEvent({
          sequence: 4,
          localServiceLineId: "service-line-1",
          unitPrice: 125,
          totalPrice: 125,
        }),
      ],
    });

    expect(model.activeSale?.serviceLines).toEqual([
      expect.objectContaining({
        localServiceLineId: "service-line-1",
        totalPrice: 125,
        unitPrice: 125,
      }),
    ]);
    expect(model.activeSale).toEqual(
      expect.objectContaining({
        subtotal: 125,
        tax: 0,
        total: 125,
      }),
    );
    expect(model.errors).toEqual([]);
  });

  it("replays local service draft removals into active sale totals", () => {
    const model = projectLocalRegisterReadModel({
      events: [
        ...serviceDraftPrelude(),
        serviceDraftEvent({
          sequence: 3,
          localServiceLineId: "service-line-1",
          unitPrice: 125,
          totalPrice: 125,
        }),
        serviceDraftEvent({
          sequence: 4,
          localServiceLineId: "service-line-2",
          serviceCatalogId: "service-catalog-2",
          serviceCatalogName: "Consultation",
          unitPrice: 40,
          totalPrice: 40,
        }),
        serviceDraftEvent({
          sequence: 5,
          localServiceLineId: "service-line-1",
          quantity: 0,
          unitPrice: 0,
          totalPrice: 0,
        }),
      ],
    });

    expect(model.activeSale?.serviceLines).toEqual([
      expect.objectContaining({
        localServiceLineId: "service-line-2",
        serviceCatalogId: "service-catalog-2",
        serviceCatalogName: "Consultation",
        totalPrice: 40,
      }),
    ]);
    expect(model.activeSale).toEqual(
      expect.objectContaining({
        subtotal: 40,
        tax: 0,
        total: 40,
      }),
    );
    expect(model.errors).toEqual([]);
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

  it("preserves completed service lines from the local sale payload", () => {
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
            customerProfileId: "customer-profile-1",
            subtotal: 100,
            tax: 0,
            total: 100,
            items: [
              {
                localItemId: "payload-item-1",
                productId: "product-1",
                productSkuId: "sku-1",
                productSku: "SKU-1",
                productName: "Payload Item",
                price: 25,
                quantity: 1,
              },
            ],
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
              },
            ],
            payments: [{ method: "card", amount: 100, timestamp: 1_004 }],
          },
        }),
      ],
    });

    expect(model.completedSales).toEqual([
      expect.objectContaining({
        serviceLines: [
          expect.objectContaining({
            localServiceLineId: "local-service-line-1",
            localServiceCaseId: "local-service-case-1",
            serviceCatalogId: "service-catalog-1",
            serviceCatalogName: "Install",
            totalPrice: 75,
          }),
        ],
        total: 100,
      }),
    ]);
    expect(model.errors).toEqual([]);
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

  it("applies closeout events recorded with the mapped cloud drawer id", () => {
    const closed = projectLocalRegisterReadModel({
      mappings: [
        {
          entity: "registerSession",
          localId: "local-register-1",
          cloudId: "cloud-register-1",
          mappedAt: 1_001,
        },
      ],
      events: [
        event({
          sequence: 1,
          type: "register.opened",
          localRegisterSessionId: "local-register-1",
          payload: { openingFloat: 100 },
        }),
        event({
          sequence: 2,
          type: "register.closeout_started",
          localRegisterSessionId: "cloud-register-1",
          payload: { countedCash: 100 },
        }),
      ],
    });

    expect(closed.canSell).toBe(false);
    expect(closed.activeRegisterSession).toMatchObject({
      localRegisterSessionId: "local-register-1",
      cloudRegisterSessionId: "cloud-register-1",
      status: "closing",
    });
    expect(closed.closeoutState).toMatchObject({
      localRegisterSessionId: "local-register-1",
      status: "closed_locally",
    });
  });

  it("blocks selling when terminal integrity requires repair", () => {
    const model = projectLocalRegisterReadModel({
      terminalIntegrity: {
        observedAt: 1_010,
        reason: "authorization_failed",
        status: "requires_reprovision",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
      events: [
        event({
          sequence: 1,
          type: "register.opened",
          payload: { openingFloat: 100 },
        }),
      ],
      isOnline: false,
    });

    expect(model.canSell).toBe(false);
    expect(model.saleBlockReason).toBe("terminal_integrity");
    expect(model.syncStatus.state).toBe("synced");
  });

  it("keeps normal pending offline sync sellable", () => {
    const model = projectLocalRegisterReadModel({
      events: [
        event({
          sequence: 1,
          uploadSequence: 1,
          type: "register.opened",
          payload: { openingFloat: 100 },
          sync: { status: "pending" },
        }),
      ],
      isOnline: false,
    });

    expect(model.canSell).toBe(true);
    expect(model.saleBlockReason).toBeUndefined();
    expect(model.syncStatus.state).toBe("offline");
  });

  it("blocks selling when drawer authority is blocked for the active session", () => {
    const model = projectLocalRegisterReadModel({
      drawerAuthority: {
        cloudRegisterSessionId: "cloud-register-1",
        localRegisterSessionId: "local-register-1",
        observedAt: 1_050,
        reason: "cloud_closed",
        status: "blocked",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
      mappings: [
        {
          entity: "registerSession",
          localId: "local-register-1",
          cloudId: "cloud-register-1",
          mappedAt: 1_001,
        },
      ],
      events: [
        event({
          sequence: 1,
          type: "register.opened",
          payload: { openingFloat: 100 },
        }),
      ],
    });

    expect(model.canSell).toBe(false);
    expect(model.saleBlockReason).toBe("drawer_authority");
    expect(model.drawerAuthorityReason).toBe("cloud_closed");
  });

  it("keeps selling available when uploaded lifecycle review does not invalidate local authority", () => {
    const model = projectLocalRegisterReadModel({
      events: [
        event({
          sequence: 1,
          uploadSequence: 1,
          type: "register.opened",
          payload: { openingFloat: 100 },
          sync: { status: "needs_review", uploaded: true },
        }),
      ],
      isOnline: true,
    });

    expect(model.canSell).toBe(true);
    expect(model.saleBlockReason).toBeUndefined();
    expect(model.syncStatus.state).toBe("needs_review");
  });

  it("keeps the current drawer active when a later duplicate drawer open needs review", () => {
    const model = projectLocalRegisterReadModel({
      mappings: [
        {
          entity: "registerSession",
          localId: "local-register-1",
          cloudId: "cloud-register-1",
          mappedAt: 1_001,
        },
      ],
      events: [
        event({
          sequence: 1,
          type: "register.opened",
          payload: { openingFloat: 100 },
          sync: { status: "synced", uploaded: true },
        }),
        event({
          sequence: 2,
          uploadSequence: 2,
          type: "register.opened",
          localEventId: "duplicate-open",
          localRegisterSessionId: "local-register-2",
          payload: { localRegisterSessionId: "local-register-2", openingFloat: 500 },
          sync: { status: "needs_review", uploaded: true },
        }),
      ],
      isOnline: true,
    });

    expect(model.activeRegisterSession).toMatchObject({
      localRegisterSessionId: "local-register-1",
      cloudRegisterSessionId: "cloud-register-1",
      openingFloat: 100,
    });
    expect(model.canSell).toBe(true);
    expect(model.saleBlockReason).toBeUndefined();
    expect(model.syncStatus.state).toBe("needs_review");
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

function serviceDraftPrelude() {
  return [
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
  ];
}

function serviceDraftEvent(input: {
  sequence: number;
  localServiceLineId: string;
  serviceCatalogId?: string;
  serviceCatalogName?: string;
  quantity?: number;
  unitPrice: number;
  totalPrice: number;
}) {
  return event({
    sequence: input.sequence,
    type: "cart.service_added",
    localRegisterSessionId: "local-register-1",
    localPosSessionId: "local-sale-1",
    payload: {
      localServiceLineId: input.localServiceLineId,
      serviceCatalogId: input.serviceCatalogId ?? "service-catalog-1",
      serviceCatalogName: input.serviceCatalogName ?? "Install",
      serviceMode: "same_day",
      pricingModel: "fixed",
      quantity: input.quantity ?? 1,
      unitPrice: input.unitPrice,
      totalPrice: input.totalPrice,
    },
  });
}
