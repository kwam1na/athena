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
      buildLocalEvent({ type: "pending_checkout_item.defined" }),
      buildLocalEvent({ type: "transaction.completed" }),
      buildLocalEvent({ type: "cart.cleared" }),
      buildLocalEvent({ type: "register.closeout_started" }),
    ];
    const localOnlyEvents = [
      buildLocalEvent({ type: "session.started" }),
      buildLocalEvent({ type: "cart.item_added" }),
      buildLocalEvent({ type: "register.reopened" }),
      buildLocalEvent({ localRegisterSessionId: undefined }),
      buildLocalEvent({ staffProfileId: undefined }),
    ];
    const prooflessUploadEvent = buildLocalEvent({ staffProofToken: undefined });

    expect(syncableEvents.map(isSyncablePosLocalEvent)).toEqual([
      true,
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
    expect(isSyncablePosLocalEvent(prooflessUploadEvent)).toBe(true);
    expect(
      buildPosLocalSyncUploadEvents([prooflessUploadEvent], [prooflessUploadEvent]),
    ).toEqual([
      expect.objectContaining({
        localEventId: prooflessUploadEvent.localEventId,
        sequence: prooflessUploadEvent.uploadSequence,
        staffProfileId: prooflessUploadEvent.staffProfileId,
      }),
    ]);
  });

  it("maps syncable register lifecycle events to server upload events with syncable sequence numbers", () => {
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
        uploadSequence: 2,
        type: "register.closeout_started",
        payload: { countedCash: 125, notes: "Closed" },
      }),
      buildLocalEvent({
        localEventId: "event-reopen",
        sequence: 4,
        uploadSequence: 3,
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
    ]);
  });

  it("does not select local reopen events for upload before manager-review replay exists", () => {
    const event = buildLocalEvent({
      localEventId: "event-reopen",
      sequence: 1,
      type: "register.reopened",
      payload: { reason: "Corrected count" },
    });

    expect(isSyncablePosLocalEvent(event)).toBe(false);
    expect(buildPosLocalSyncUploadEvents([event], [event])).toEqual([]);
  });

  it("maps clear-only sales to syncable sale clear events", () => {
    const event = buildLocalEvent({
      localEventId: "event-clear",
      sequence: 1,
      type: "cart.cleared",
      payload: {
        localPosSessionId: "session-1",
        reason: "Sale cleared",
      },
    });

    expect(buildPosLocalSyncUploadEvents([event], [event])).toEqual([
      expect.objectContaining({
        localEventId: "event-clear",
        sequence: 1,
        eventType: "sale_cleared",
        payload: {
          localPosSessionId: "local-session-1",
          reason: "Sale cleared",
        },
      }),
    ]);
  });

  it("maps pending checkout item definitions to deterministic redacted upload events", () => {
    const event = buildLocalEvent({
      localEventId: "event-pending-item",
      sequence: 2,
      uploadSequence: 2,
      type: "pending_checkout_item.defined",
      payload: {
        localPendingCheckoutItemId: "local-pending-item-1",
        name: "Bundle Wig",
        lookupCode: "  999888777666  ",
        searchContext: {
          query: " bundle wig ",
          source: "barcode",
          matched: "none",
          customerEmail: "customer@example.com",
        },
        price: 45,
        quantitySold: 2,
        localMetadata: {
          source: "offline_search",
          reusedExistingPendingItem: true,
          createdOffline: true,
          appSessionValidation: "unverified",
          rawTerminalProof: "raw-terminal-proof",
          paymentToken: "payment-token",
        },
      },
    });

    const uploadEvents = buildPosLocalSyncUploadEvents([event], [event]);

    expect(uploadEvents).toEqual([
      {
        localEventId: "event-pending-item",
        localRegisterSessionId: "local-register-1",
        sequence: 2,
        eventType: "pending_checkout_item_defined",
        occurredAt: 1,
        staffProfileId: "staff-1",
        staffProofToken: "proof-token-1",
        payload: {
          localPendingCheckoutItemId: "local-pending-item-1",
          name: "Bundle Wig",
          lookupCode: "999888777666",
          searchContext: {
            query: "bundle wig",
            source: "barcode",
            matched: "none",
          },
          price: 45,
          quantitySold: 2,
          localMetadata: {
            schema: "pos_pending_checkout_item_local_metadata_v1",
            source: "offline_search",
            reusedExistingPendingItem: true,
            createdOffline: true,
            appSessionValidation: "unverified",
          },
        },
      },
    ]);

    const serialized = JSON.stringify(uploadEvents);
    expect(serialized).toBe(
      '[{"localEventId":"event-pending-item","localRegisterSessionId":"local-register-1","eventType":"pending_checkout_item_defined","occurredAt":1,"staffProfileId":"staff-1","staffProofToken":"proof-token-1","payload":{"localPendingCheckoutItemId":"local-pending-item-1","name":"Bundle Wig","lookupCode":"999888777666","searchContext":{"query":"bundle wig","source":"barcode","matched":"none"},"price":45,"quantitySold":2,"localMetadata":{"schema":"pos_pending_checkout_item_local_metadata_v1","source":"offline_search","reusedExistingPendingItem":true,"createdOffline":true,"appSessionValidation":"unverified"}},"sequence":2}]',
    );
    expect(serialized).not.toContain("customer@example.com");
    expect(serialized).not.toContain("raw-terminal-proof");
    expect(serialized).not.toContain("payment-token");
  });

  it("counts uploaded sale clear events when sequencing later uploads", () => {
    const events: PosLocalEventRecord[] = [
      buildLocalEvent({
        localEventId: "event-open",
        sequence: 1,
        sync: { status: "synced", uploaded: true },
        type: "register.opened",
      }),
      buildLocalEvent({
        localEventId: "event-clear",
        localPosSessionId: "local-session-cleared",
        sequence: 2,
        sync: { status: "synced", uploaded: true },
        type: "cart.cleared",
        payload: {
          localPosSessionId: "local-session-cleared",
          reason: "Sale cleared",
        },
      }),
      buildLocalEvent({
        localEventId: "event-sale",
        sequence: 3,
        type: "transaction.completed",
        payload: {
          localPosSessionId: "local-session-2",
          localTransactionId: "local-txn-1",
          receiptNumber: "LOCAL-1-000002",
          subtotal: 0,
          tax: 0,
          total: 0,
          payments: [],
        },
      }),
    ];

    expect(buildPosLocalSyncUploadEvents([events[2]], events)).toEqual([
      expect.objectContaining({
        localEventId: "event-sale",
        sequence: 3,
      }),
    ]);
  });

  it("uses the stored sale sequence when a prior sale clear is skipped", () => {
    const events: PosLocalEventRecord[] = [
      buildLocalEvent({
        localEventId: "event-open",
        sequence: 1,
        sync: { status: "synced", uploaded: true },
        type: "register.opened",
      }),
      buildLocalEvent({
        localEventId: "event-clear",
        sequence: 2,
        type: "cart.cleared",
        payload: {
          localPosSessionId: "local-session-1",
          reason: "Sale cleared",
        },
      }),
      buildLocalEvent({
        localEventId: "event-sale",
        sequence: 3,
        uploadSequence: 3,
        type: "transaction.completed",
        payload: {
          localPosSessionId: "local-session-1",
          localTransactionId: "local-txn-1",
          receiptNumber: "LOCAL-1-000002",
          subtotal: 0,
          tax: 0,
          total: 0,
          payments: [],
        },
      }),
    ];

    expect(buildPosLocalSyncUploadEvents([events[2]], events)).toEqual([
      expect.objectContaining({
        localEventId: "event-sale",
        sequence: 3,
      }),
    ]);
  });

  it("uses the stored closeout sequence when an uploaded sale clear is skipped", () => {
    const events: PosLocalEventRecord[] = [
      buildLocalEvent({
        localEventId: "event-open",
        sequence: 1,
        sync: { status: "synced", uploaded: true },
        type: "register.opened",
      }),
      buildLocalEvent({
        localEventId: "event-clear",
        sequence: 2,
        sync: { status: "synced", uploaded: true },
        type: "cart.cleared",
        payload: {
          localPosSessionId: "local-session-1",
          reason: "Sale cleared",
        },
      }),
      buildLocalEvent({
        localEventId: "event-sale",
        sequence: 3,
        sync: { status: "synced", uploaded: true },
        type: "transaction.completed",
        payload: {
          localPosSessionId: "local-session-1",
          localTransactionId: "local-txn-1",
          receiptNumber: "LOCAL-1-000002",
          subtotal: 0,
          tax: 0,
          total: 0,
          payments: [],
        },
      }),
      buildLocalEvent({
        localEventId: "event-closeout",
        sequence: 4,
        uploadSequence: 4,
        type: "register.closeout_started",
        payload: {
          countedCash: 0,
        },
      }),
    ];

    expect(buildPosLocalSyncUploadEvents([events[3]], events)).toEqual([
      expect.objectContaining({
        localEventId: "event-closeout",
        sequence: 4,
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
        uploadSequence: 1,
        type: "transaction.completed",
        payload: {
          localPosSessionId: "local-session-1",
          localTransactionId: "local-txn-1",
          localReceiptNumber: "local-txn-1",
          receiptNumber: "123456",
          customerProfileId: "profile-1",
          customerName: "Efua Mensah",
          customerEmail: "efua@example.com",
          customerPhone: "555-2222",
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
          localReceiptNumber: "local-txn-1",
          receiptNumber: "123456",
          customerProfileId: "profile-1",
          customerInfo: {
            name: "Efua Mensah",
            email: "efua@example.com",
            phone: "555-2222",
          },
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

  it("preserves provisional import row references in sale uploads", () => {
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
              inventoryImportProvisionalSkuId: "provisional-import-sku-1",
              productName: "Imported Wig Cap",
              productSku: "IMP-CAP-1",
              quantity: 1,
              price: 25,
            },
          ],
          payments: [{ method: "cash", amount: 25, timestamp: 3 }],
        },
      }),
    ];

    expect(buildPosLocalSyncUploadEvents(events, events)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          items: [
            expect.objectContaining({
              localTransactionItemId: "local-item-1",
              inventoryImportProvisionalSkuId: "provisional-import-sku-1",
              productSkuId: "sku-1",
              quantity: 1,
            }),
          ],
        }),
      }),
    ]);
  });

  it("embeds completed service lines in the sale upload event", () => {
    const events: PosLocalEventRecord[] = [
      buildLocalEvent({
        localEventId: "event-sale",
        sequence: 1,
        type: "transaction.completed",
        payload: {
          localPosSessionId: "local-session-1",
          localTransactionId: "local-txn-1",
          localReceiptNumber: "local-txn-1",
          receiptNumber: "123456",
          customerProfileId: "profile-1",
          subtotal: 100,
          tax: 0,
          total: 100,
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
            },
          ],
          payments: [{ method: "cash", amount: 100, timestamp: 3 }],
        },
      }),
    ];

    expect(buildPosLocalSyncUploadEvents(events, events)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
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
            },
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
        uploadSequence: undefined,
      }),
      buildLocalEvent({
        localEventId: "event-sale",
        sequence: 2,
        uploadSequence: 1,
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

  it("builds upload payloads for actor events whose proof token is unavailable", () => {
    const prooflessOpen = buildLocalEvent({
      localEventId: "event-open",
      sequence: 1,
      type: "register.opened",
      uploadSequence: 1,
    });
    delete prooflessOpen.staffProofToken;

    expect(buildPosLocalSyncUploadEvents([prooflessOpen], [prooflessOpen])).toEqual([
      expect.objectContaining({
        localEventId: "event-open",
        sequence: 1,
        staffProfileId: "staff-1",
      }),
    ]);
    expect(buildPosLocalSyncUploadEvents([prooflessOpen], [prooflessOpen])[0])
      .not.toHaveProperty("staffProofToken");
  });

  it("defers app-session-unverified events until supported validation is present", () => {
    const event = buildLocalEvent({
      localEventId: "event-offline-sale",
      type: "transaction.completed",
      validationMetadata: {
        flags: [
          "app-session-unverified",
          "cloud-validation-uncertain",
        ],
        observedAt: 2_000,
        uploadDeferredUntil: "app-session-validated",
      },
      payload: {
        localPosSessionId: "local-session-1",
        localTransactionId: "local-txn-1",
        receiptNumber: "LOCAL-1-000001",
        subtotal: 25,
        tax: 0,
        total: 25,
        customerEmail: "customer@example.com",
        payments: [{ method: "cash", amount: 25, timestamp: 4 }],
      },
    });

    expect(isSyncablePosLocalEvent(event)).toBe(false);
    expect(buildPosLocalSyncUploadEvents([event], [event])).toEqual([]);

    expect(
      isSyncablePosLocalEvent(event, {
        appSessionValidation: "supported",
      }),
    ).toBe(true);
    expect(
      buildPosLocalSyncUploadEvents([event], [event], {
        appSessionValidation: "supported",
      }),
    ).toEqual([
      expect.objectContaining({
        localEventId: "event-offline-sale",
        eventType: "sale_completed",
      }),
    ]);
    expect(
      JSON.stringify(
        buildPosLocalSyncUploadEvents([event], [event], {
          appSessionValidation: "supported",
        }),
      ),
    ).toContain("customer@example.com");
  });

  it("uses stored upload sequence instead of recomputing from currently uploadable rows", () => {
    const events: PosLocalEventRecord[] = [
      buildLocalEvent({
        localEventId: "event-local-only",
        sequence: 10,
        type: "cart.item_added",
      }),
      buildLocalEvent({
        localEventId: "event-open",
        sequence: 20,
        type: "register.opened",
        uploadSequence: 1,
      }),
      buildLocalEvent({
        localEventId: "event-sale",
        sequence: 30,
        type: "transaction.completed",
        uploadSequence: 2,
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
          payments: [{ method: "cash", amount: 25, timestamp: 4 }],
        },
      }),
    ];

    expect(buildPosLocalSyncUploadEvents([events[2]], events)).toEqual([
      expect.objectContaining({
        localEventId: "event-sale",
        sequence: 2,
      }),
    ]);
  });

  it("orders upload payloads by stored upload sequence when local event order disagrees", () => {
    const events: PosLocalEventRecord[] = [
      buildLocalEvent({
        localEventId: "event-created-first-upload-second",
        sequence: 10,
        type: "register.closeout_started",
        uploadSequence: 2,
      }),
      buildLocalEvent({
        localEventId: "event-created-second-upload-first",
        sequence: 20,
        type: "register.opened",
        uploadSequence: 1,
      }),
    ];

    expect(
      buildPosLocalSyncUploadEvents([events[0], events[1]], events).map(
        (event) => ({
          localEventId: event.localEventId,
          sequence: event.sequence,
        }),
      ),
    ).toEqual([
      {
        localEventId: "event-created-second-upload-first",
        sequence: 1,
      },
      {
        localEventId: "event-created-first-upload-second",
        sequence: 2,
      },
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

  it("maps drawerless expense events without a local register session", () => {
    const event = buildLocalEvent({
      localEventId: "expense-event-1",
      localRegisterSessionId: undefined,
      sequence: 1,
      type: "expense.completed",
      payload: {
        localExpenseSessionId: "local-expense-session-1",
        localExpenseEventId: "local-expense-event-1",
        notes: "Damaged stock",
        subtotal: 25,
        tax: 0,
        total: 25,
        items: [
          {
            localItemId: "local-expense-line-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productName: "Repair kit",
            productSku: "KIT-1",
            quantity: 1,
            price: 25,
          },
        ],
      },
    });

    expect(isSyncablePosLocalEvent(event)).toBe(true);
    expect(buildPosLocalSyncUploadEvents([event], [event])).toEqual([
      {
        syncScope: "expense",
        localEventId: "expense-event-1",
        localExpenseSessionId: "local-expense-session-1",
        sequence: 1,
        eventType: "expense_recorded",
        occurredAt: 1,
        staffProfileId: "staff-1",
        staffProofToken: "proof-token-1",
        payload: {
          localExpenseSessionId: "local-expense-session-1",
          localExpenseEventId: "local-expense-event-1",
          notes: "Damaged stock",
          totals: { subtotal: 25, tax: 0, total: 25 },
          items: [
            {
              localTransactionItemId: "local-expense-line-1",
              productId: "product-1",
              productSkuId: "sku-1",
              productName: "Repair kit",
              productSku: "KIT-1",
              barcode: undefined,
              quantity: 1,
              unitPrice: 25,
              image: undefined,
            },
          ],
        },
      },
    ]);
  });
});

function buildLocalEvent(
  overrides: Partial<PosLocalEventRecord>,
): PosLocalEventRecord {
  const type = overrides.type ?? "register.opened";
  const sync = overrides.sync ?? { status: "pending" as const };
  const uploadSequence =
    Object.prototype.hasOwnProperty.call(overrides, "uploadSequence")
      ? overrides.uploadSequence
      : isUploadSequenceEventType(type) &&
          (sync.status !== "synced" || sync.uploaded === true)
        ? (overrides.sequence ?? 1)
        : undefined;

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
    sync,
    terminalId: "terminal-1",
    type,
    ...(uploadSequence ? { uploadSequence } : {}),
    ...overrides,
  };
}

function isUploadSequenceEventType(type: PosLocalEventRecord["type"]) {
  return (
    type === "register.opened" ||
    type === "pending_checkout_item.defined" ||
    type === "cart.cleared" ||
    type === "transaction.completed" ||
    type === "register.closeout_started" ||
    type === "expense.completed"
  );
}
