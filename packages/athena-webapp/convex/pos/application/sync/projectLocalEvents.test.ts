import { describe, expect, it } from "vitest";

import { projectLocalSyncEvent } from "./projectLocalEvents";
import type {
  LocalSyncConflictRecord,
  LocalSyncMappingRecord,
  ParsedPosLocalSyncEventInput,
  PosLocalSalePayload,
  PosLocalSyncEventInput,
  SyncProjectionRepository,
} from "./types";

type ParsedSaleCompletedEvent = Extract<
  ParsedPosLocalSyncEventInput,
  { eventType: "sale_completed" }
>;
type ParsedSaleClearedEvent = Extract<
  ParsedPosLocalSyncEventInput,
  { eventType: "sale_cleared" }
>;

describe("projectLocalSyncEvent", () => {
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
    expect(repository.createdOperationalEvents).toEqual([
      expect.objectContaining({
        eventType: "pos_local_sync.sale_projected",
        message: "Offline POS sale synced.",
        posTransactionId: "transaction-1",
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
        stage: "sale_recorded",
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

  it("conflicts manager-only register opens without valid offline staff proof", async () => {
    const repository = createProjectionRepository({ validStaffProof: false });

    const result = await projectLocalSyncEvent(repository, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      event: {
        localEventId: "event-register-opened-proof",
        localRegisterSessionId: "local-register-proof",
        sequence: 1,
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

  it("maps cashier-seeded already-open cloud register sessions before manager open permission", async () => {
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
    expect(repository.consumedHoldRequests).toEqual([
      expect.objectContaining({
        sessionId: "pos-session-1",
        items: [expect.objectContaining({ productSkuId: "sku-1", quantity: 2 })],
      }),
    ]);
    expect(repository.productPatches).toEqual([
      {
        productSkuId: "sku-1",
        patch: {
          inventoryCount: 8,
          quantityAvailable: 8,
        },
      },
    ]);
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
    expect(repository.productPatches).toEqual([
      {
        productSkuId: "sku-1",
        patch: {
          inventoryCount: 0,
          quantityAvailable: 0,
        },
      },
    ]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "inventory",
        summary: "Inventory needs manager review for a synced offline sale.",
      }),
    ]);
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
    expect(repository.productPatches).toEqual([
      {
        productSkuId: "sku-1",
        patch: {
          inventoryCount: 9,
          quantityAvailable: 9,
        },
      },
    ]);
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
    expect(repository.productPatches).toEqual([
      {
        productSkuId: "sku-1",
        patch: {
          inventoryCount: 0,
          quantityAvailable: 0,
        },
      },
    ]);
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
        sequence: 1,
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

  it("conflicts register opens when the terminal already has an open drawer", async () => {
    const repository = createProjectionRepository({
      blockingRegisterSession: {
        _id: "register-session-open",
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
      }),
    ]);
  });

  it("maps a direct cloud register open after staff authorization", async () => {
    const repository = createProjectionRepository({
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
    expect(reopen.conflicts).toEqual([
      expect.objectContaining({
        summary: "Staff access changed before this POS history synced.",
      }),
    ]);
  });

  it("conflicts non-zero offline closeout variance for manager review", async () => {
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

    expect(result.status).toBe("conflicted");
    expect(repository.registerSessionPatches).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        conflictType: "permission",
        summary:
          "Register closeout variance requires manager review before synced closeout can be applied.",
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

  it("projects a manager-reviewed sale against a closed register session", async () => {
    const repository = createProjectionRepository({
      registerSession: {
        _id: "register-session-1",
        expectedCash: 100,
        closeoutRecords: [],
        countedCash: 100,
        registerNumber: "1",
        status: "closed",
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

    expect(result.status).toBe("projected");
    expect(repository.createdTransactions).toEqual([
      expect.objectContaining({
        registerSessionId: "register-session-1",
        total: 25,
      }),
    ]);
    expect(repository.registerSessionPatches).toEqual(
      expect.arrayContaining([
        {
          registerSessionId: "register-session-1",
          patch: expect.objectContaining({
            expectedCash: 125,
            variance: -25,
          }),
        },
      ]),
    );
    expect(result.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cloudTable: "posTransaction",
          localId: "local-txn-1",
        }),
      ]),
    );
  });

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
});

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
      closeoutRecords: unknown[];
      closedAt?: number;
      closedByStaffProfileId?: string;
      countedCash?: number;
      notes?: string;
      registerNumber?: string;
      status: string;
      variance?: number;
    } | null;
    blockingRegisterSession: {
      _id: string;
      expectedCash: number;
      closeoutRecords: unknown[];
      registerNumber?: string;
      status: string;
    };
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
    validStaffProof: boolean;
  }> = {},
): SyncProjectionRepository & {
  createdConflicts: LocalSyncConflictRecord[];
  consumedHoldRequests: unknown[];
  releasedHoldRequests: unknown[];
  createdOperationalEvents: unknown[];
  createdPaymentAllocations: unknown[];
  createdPosSessions: unknown[];
  createdPosSessionItems: unknown[];
  createdServiceCaseLineItems: unknown[];
  createdServiceCases: unknown[];
  createdServiceWorkItems: unknown[];
  createdTransactionItems: unknown[];
  createdTransactionServiceLines: unknown[];
  createdTransactions: unknown[];
  posSessionPatches: unknown[];
  productPatches: unknown[];
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
      localIdKind: "registerSession",
      localId: "local-register-1",
      cloudTable: "registerSession",
      cloudId: "register-session-1" as never,
      createdAt: 1,
    },
  ];
  const createdConflicts: LocalSyncConflictRecord[] = [];
  const createdOperationalEvents: unknown[] = [];
  const createdPaymentAllocations: unknown[] = [];
  const createdPosSessions: unknown[] = [];
  const createdPosSessionItems: unknown[] = [];
  const createdServiceCaseLineItems: unknown[] = [];
  const createdServiceCases: unknown[] = [];
  const createdServiceWorkItems: unknown[] = [];
  const createdTransactionItems: unknown[] = [];
  const createdTransactionServiceLines: unknown[] = [];
  const createdTransactions: unknown[] = [];
  const posSessionPatches: unknown[] = [];
  const productPatches: unknown[] = [];
  const recordedPosSessionTraces: unknown[] = [];
  const recordedRegisterSessionTraces: unknown[] = [];
  const registerSessionPatches: unknown[] = [];
  const consumedHoldRequests: unknown[] = [];
  const releasedHoldRequests: unknown[] = [];
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
    createdPaymentAllocations,
    createdPosSessions,
    createdPosSessionItems,
    createdServiceCaseLineItems,
    createdServiceCases,
    createdServiceWorkItems,
    createdTransactionItems,
    createdTransactionServiceLines,
    createdTransactions,
    posSessionPatches,
    productPatches,
    recordedPosSessionTraces,
    recordedRegisterSessionTraces,
    registerSessionPatches,
    consumedHoldRequests,
    releasedHoldRequests,
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
    async createRegisterSession() {
      return "register-session-1" as never;
    },
    async findBlockingRegisterSession() {
      return (overrides.blockingRegisterSession as never) ?? null;
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
    async createTransactionServiceLine(input) {
      const id = `transaction-service-line-${createdTransactionServiceLines.length + 1}`;
      createdTransactionServiceLines.push({ _id: id, ...input });
      return id as never;
    },
    async patchProductSku(productSkuId, patch) {
      productPatches.push({ productSkuId, patch });
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
