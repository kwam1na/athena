import { describe, expect, it } from "vitest";

import type { PosLocalEventRecord } from "./posLocalStore";
import {
  buildPosLocalSyncUploadEvents,
  isSyncablePosLocalEvent,
} from "./syncContract";

describe("syncContract", () => {
  it("keeps scheduler selection and upload conversion on the same syncable event set", () => {
    const syncableEvents = [
      buildLocalEvent({ type: "register.opened" }),
      buildLocalEvent({ type: "transaction.completed" }),
      buildLocalEvent({ type: "register.closeout_started" }),
      buildLocalEvent({ type: "register.reopened" }),
    ];
    const localOnlyEvents = [
      buildLocalEvent({ type: "session.started" }),
      buildLocalEvent({ type: "cart.item_added" }),
      buildLocalEvent({ localRegisterSessionId: undefined }),
      buildLocalEvent({ staffProfileId: undefined }),
      buildLocalEvent({ staffProofToken: undefined }),
    ];

    expect(syncableEvents.map(isSyncablePosLocalEvent)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(localOnlyEvents.map(isSyncablePosLocalEvent)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(
      buildPosLocalSyncUploadEvents([localOnlyEvents[4]], localOnlyEvents),
    ).toEqual([]);
  });

  it("maps register lifecycle events to server upload events with syncable sequence numbers", () => {
    const events: PosLocalEventRecord[] = [
      buildLocalEvent({
        localEventId: "event-open",
        sequence: 1,
        type: "register.opened",
        payload: { openingFloat: 100, notes: "Morning" },
      }),
      buildLocalEvent({
        localEventId: "event-session",
        sequence: 2,
        type: "session.started",
      }),
      buildLocalEvent({
        localEventId: "event-closeout",
        sequence: 3,
        type: "register.closeout_started",
        payload: { countedCash: 125, notes: "Closed" },
      }),
      buildLocalEvent({
        localEventId: "event-reopen",
        sequence: 4,
        type: "register.reopened",
        payload: { reason: "Corrected count" },
      }),
    ];

    expect(buildPosLocalSyncUploadEvents(events, events)).toEqual([
      expect.objectContaining({
        localEventId: "event-open",
        sequence: 1,
        eventType: "register_opened",
        payload: expect.objectContaining({
          openingFloat: 100,
          registerNumber: "1",
          notes: "Morning",
        }),
      }),
      expect.objectContaining({
        localEventId: "event-closeout",
        sequence: 2,
        eventType: "register_closed",
        payload: expect.objectContaining({
          countedCash: 125,
          notes: "Closed",
        }),
      }),
      expect.objectContaining({
        localEventId: "event-reopen",
        sequence: 3,
        eventType: "register_reopened",
        payload: expect.objectContaining({
          reason: "Corrected count",
        }),
      }),
    ]);
  });

  it("embeds prior cart events into the sale upload event", () => {
    const events: PosLocalEventRecord[] = [
      buildLocalEvent({
        localEventId: "event-session",
        sequence: 1,
        type: "session.started",
      }),
      buildLocalEvent({
        localEventId: "event-cart",
        sequence: 2,
        type: "cart.item_added",
        payload: {
          localItemId: "local-item-1",
          productId: "product-1",
          productSkuId: "sku-1",
          productName: "Wig Cap",
          productSku: "CAP-1",
          quantity: 2,
          price: 25,
        },
      }),
      buildLocalEvent({
        localEventId: "event-sale",
        sequence: 3,
        type: "transaction.completed",
        payload: {
          localPosSessionId: "local-session-1",
          localTransactionId: "local-txn-1",
          receiptNumber: "LOCAL-1-000001",
          subtotal: 50,
          tax: 0,
          total: 50,
          payments: [{ method: "cash", amount: 50, timestamp: 3 }],
        },
      }),
    ];

    expect(buildPosLocalSyncUploadEvents([events[2]], events)).toEqual([
      expect.objectContaining({
        localEventId: "event-sale",
        sequence: 1,
        eventType: "sale_completed",
        payload: expect.objectContaining({
          localPosSessionId: "local-session-1",
          localTransactionId: "local-txn-1",
          localReceiptNumber: "LOCAL-1-000001",
          items: [
            expect.objectContaining({
              localTransactionItemId: "local-item-1",
              productSkuId: "sku-1",
              quantity: 2,
              unitPrice: 25,
            }),
          ],
        }),
      }),
    ]);
  });

  it("uses the completed sale item snapshot instead of stale prior cart events", () => {
    const events: PosLocalEventRecord[] = [
      buildLocalEvent({
        localEventId: "event-cart",
        sequence: 1,
        type: "cart.item_added",
        payload: {
          localItemId: "local-item-1",
          productId: "product-1",
          productSkuId: "sku-1",
          productName: "Wig Cap",
          productSku: "CAP-1",
          quantity: 2,
          price: 25,
        },
      }),
      buildLocalEvent({
        localEventId: "event-sale",
        sequence: 2,
        type: "transaction.completed",
        payload: {
          localPosSessionId: "local-session-1",
          localTransactionId: "local-txn-1",
          receiptNumber: "LOCAL-1-000001",
          subtotal: 25,
          tax: 0,
          total: 25,
          items: [
            {
              localItemId: "local-item-1",
              productId: "product-1",
              productSkuId: "sku-1",
              productName: "Wig Cap",
              productSku: "CAP-1",
              quantity: 1,
              price: 25,
            },
          ],
          payments: [{ method: "cash", amount: 25, timestamp: 3 }],
        },
      }),
    ];

    expect(buildPosLocalSyncUploadEvents([events[1]], events)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          items: [
            expect.objectContaining({
              localTransactionItemId: "local-item-1",
              quantity: 1,
              unitPrice: 25,
            }),
          ],
        }),
      }),
    ]);
  });

  it("does not count already-synced online events in pending upload sequences", () => {
    const events: PosLocalEventRecord[] = [
      buildLocalEvent({
        localEventId: "event-register",
        sequence: 1,
        type: "register.opened",
        sync: { status: "synced" },
      }),
      buildLocalEvent({
        localEventId: "event-sale",
        sequence: 2,
        type: "transaction.completed",
        payload: {
          localPosSessionId: "local-session-1",
          localTransactionId: "local-txn-1",
          receiptNumber: "LOCAL-1-000001",
          subtotal: 25,
          tax: 0,
          total: 25,
          items: [
            {
              localItemId: "local-item-1",
              productId: "product-1",
              productSkuId: "sku-1",
              productName: "Wig Cap",
              productSku: "CAP-1",
              quantity: 1,
              price: 25,
            },
          ],
          payments: [{ method: "cash", amount: 25, timestamp: 3 }],
        },
      }),
    ];

    expect(buildPosLocalSyncUploadEvents([events[1]], events)).toEqual([
      expect.objectContaining({
        localEventId: "event-sale",
        sequence: 1,
      }),
    ]);
  });

  it("continues sequence numbering after previously uploaded synced events", () => {
    const events: PosLocalEventRecord[] = [
      buildLocalEvent({
        localEventId: "event-uploaded",
        sequence: 1,
        type: "transaction.completed",
        sync: { status: "synced", uploaded: true },
      }),
      buildLocalEvent({
        localEventId: "event-pending",
        sequence: 2,
        type: "transaction.completed",
        payload: {
          localPosSessionId: "local-session-2",
          localTransactionId: "local-txn-2",
          receiptNumber: "LOCAL-1-000002",
          subtotal: 25,
          tax: 0,
          total: 25,
          items: [
            {
              localItemId: "local-item-2",
              productId: "product-1",
              productSkuId: "sku-1",
              productName: "Wig Cap",
              productSku: "CAP-1",
              quantity: 1,
              price: 25,
            },
          ],
          payments: [{ method: "cash", amount: 25, timestamp: 4 }],
        },
      }),
    ];

    expect(buildPosLocalSyncUploadEvents([events[1]], events)).toEqual([
      expect.objectContaining({
        localEventId: "event-pending",
        sequence: 2,
      }),
    ]);
  });

  it("continues sequence numbering after an uploaded offline register open", () => {
    const events: PosLocalEventRecord[] = [
      buildLocalEvent({
        localEventId: "event-uploaded-open",
        sequence: 1,
        type: "register.opened",
        sync: { status: "synced", uploaded: true },
      }),
      buildLocalEvent({
        localEventId: "event-pending",
        sequence: 2,
        type: "transaction.completed",
        payload: {
          localPosSessionId: "local-session-2",
          localTransactionId: "local-txn-2",
          receiptNumber: "LOCAL-1-000002",
          subtotal: 25,
          tax: 0,
          total: 25,
          items: [
            {
              localItemId: "local-item-2",
              productId: "product-1",
              productSkuId: "sku-1",
              productName: "Wig Cap",
              productSku: "CAP-1",
              quantity: 1,
              price: 25,
            },
          ],
          payments: [{ method: "cash", amount: 25, timestamp: 4 }],
        },
      }),
    ];

    expect(buildPosLocalSyncUploadEvents([events[1]], events)).toEqual([
      expect.objectContaining({
        localEventId: "event-pending",
        sequence: 2,
      }),
    ]);
  });

  it("continues sequence numbering after uploaded events whose proof token was scrubbed", () => {
    const uploadedOpen = buildLocalEvent({
      localEventId: "event-uploaded-open",
      sequence: 1,
      type: "register.opened",
      sync: { status: "synced", uploaded: true },
    });
    const scrubbedUploadedOpen = { ...uploadedOpen };
    delete scrubbedUploadedOpen.staffProofToken;
    const events: PosLocalEventRecord[] = [
      scrubbedUploadedOpen,
      buildLocalEvent({
        localEventId: "event-pending",
        sequence: 2,
        type: "transaction.completed",
        payload: {
          localPosSessionId: "local-session-2",
          localTransactionId: "local-txn-2",
          receiptNumber: "LOCAL-1-000002",
          subtotal: 25,
          tax: 0,
          total: 25,
          items: [
            {
              localItemId: "local-item-2",
              productId: "product-1",
              productSkuId: "sku-1",
              productName: "Wig Cap",
              productSku: "CAP-1",
              quantity: 1,
              price: 25,
            },
          ],
          payments: [{ method: "cash", amount: 25, timestamp: 4 }],
        },
      }),
    ];

    expect(buildPosLocalSyncUploadEvents([events[1]], events)).toEqual([
      expect.objectContaining({
        localEventId: "event-pending",
        sequence: 2,
      }),
    ]);
  });

  it("normalizes local payment payloads before upload", () => {
    const events: PosLocalEventRecord[] = [
      buildLocalEvent({
        localEventId: "event-sale",
        sequence: 1,
        type: "transaction.completed",
        payload: {
          localPosSessionId: "local-session-1",
          localTransactionId: "local-txn-1",
          receiptNumber: "LOCAL-1-000001",
          subtotal: 25,
          tax: 0,
          total: 25,
          items: [
            {
              localItemId: "local-item-1",
              productId: "product-1",
              productSkuId: "sku-1",
              productName: "Wig Cap",
              productSku: "CAP-1",
              quantity: 1,
              price: 25,
            },
          ],
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "cash",
              amount: 25,
              timestamp: 4,
              ignored: "client-only",
            },
            "not-a-payment",
          ],
        },
      }),
    ];

    expect(buildPosLocalSyncUploadEvents(events, events)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          payments: [
            {
              localPaymentId: "local-payment-1",
              method: "cash",
              amount: 25,
              timestamp: 4,
            },
            {
              localPaymentId: undefined,
              method: "",
              amount: 0,
              timestamp: 0,
            },
          ],
        }),
      }),
    ]);
  });

  it("continues sequence numbering after server-accepted review events", () => {
    const events: PosLocalEventRecord[] = [
      buildLocalEvent({
        localEventId: "event-review",
        sequence: 1,
        type: "transaction.completed",
        sync: { status: "needs_review", uploaded: true },
      }),
      buildLocalEvent({
        localEventId: "event-pending",
        sequence: 2,
        type: "register.closeout_started",
      }),
    ];

    expect(buildPosLocalSyncUploadEvents([events[1]], events)).toEqual([
      expect.objectContaining({
        localEventId: "event-pending",
        sequence: 2,
      }),
    ]);
  });
});

function buildLocalEvent(
  overrides: Partial<PosLocalEventRecord>,
): PosLocalEventRecord {
  return {
    createdAt: 1,
    localEventId: "event-1",
    localRegisterSessionId: "local-register-1",
    localPosSessionId: "local-session-1",
    payload: {},
    registerNumber: "1",
    schemaVersion: 1,
    sequence: 1,
    staffProfileId: "staff-1",
    staffProofToken: "proof-token-1",
    storeId: "store-1",
    sync: { status: "pending" },
    terminalId: "terminal-1",
    type: "register.opened",
    ...overrides,
  };
}
