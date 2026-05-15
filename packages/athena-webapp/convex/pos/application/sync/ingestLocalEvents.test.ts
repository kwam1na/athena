import { describe, expect, it } from "vitest";

import {
  createLocalSyncIngestionService,
  type PosLocalSyncBatchInput,
} from "./ingestLocalEvents";
import { createConvexLocalSyncRepository } from "../../infrastructure/repositories/localSyncRepository";
import { hashPosLocalStaffProofToken } from "./staffProof";
import type {
  LocalSyncConflictRecord,
  LocalSyncEventRecord,
  LocalSyncMappingRecord,
  LocalSyncRepository,
  PosLocalSyncEventInput,
  SyncProjectionRepository,
} from "./types";

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
      localRegisterSessionId: "local-register-1",
      acceptedThroughSequence: 1,
    });
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
    expect(result.data.syncCursor).toEqual({
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
        message: "POS sync batches must contain one local register session.",
      },
    });
    expect(repository.events).toEqual([]);
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
    expect(retry.data.syncCursor).toEqual({
      localRegisterSessionId: "local-register-1",
      acceptedThroughSequence: 2,
    });
    expect(repository.createdTransactions).toHaveLength(2);
    expect(repository.events.find((event) => event.sequence === 2)?.status).toBe(
      "projected",
    );
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
    expect(result.data.syncCursor).toEqual({
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
    expect(result.data.syncCursor).toEqual({
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
      localRegisterSessionId: "local-register-1",
      acceptedThroughSequence: 42,
      updatedAt: 100,
    });
    await repository.updateAcceptedThroughSequence({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      localRegisterSessionId: "local-register-1",
      acceptedThroughSequence: 64,
      updatedAt: 200,
    });

    await expect(
      repository.getAcceptedThroughSequence({
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
        localRegisterSessionId: "local-register-1",
      }),
    ).resolves.toBe(64);
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
    hasActivePosRole: boolean;
    existingPosSession: {
      _id: string;
      storeId: string;
      terminalId: string;
    };
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
    validCloudIds: Set<string>;
    validateLocalStaffProof: SyncProjectionRepository["validateLocalStaffProof"];
  }> = {},
): LocalSyncRepository & {
  conflicts: LocalSyncConflictRecord[];
  createdPaymentAllocations: unknown[];
	  createdRegisterSessions: unknown[];
	  createdTransactions: unknown[];
	  events: LocalSyncEventRecord[];
	  mappings: LocalSyncMappingRecord[];
	  registerSessionPatches: Array<{ registerSessionId: string; patch: unknown }>;
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
  const roleChecks: Array<{
    allowedRoles: string[];
    staffProfileId: string;
    storeId: string;
  }> = [];
	  const createdRegisterSessions: unknown[] = [];
	  const createdTransactions: unknown[] = [];
	  const createdPaymentAllocations: unknown[] = [];
	  const registerSessionPatches: Array<{
	    registerSessionId: string;
	    patch: unknown;
	  }> = [];
  const acceptedThroughSequenceByRegister = new Map<string, number>();
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

  return {
    conflicts,
    createdPaymentAllocations,
    createdRegisterSessions,
    createdTransactions,
	    events,
	    mappings,
	    registerSessionPatches,
	    roleChecks,
    async getTerminal(terminalId) {
      return terminal && terminal._id === terminalId
        ? (terminal as never)
        : null;
    },
    async getStaffProfile(staffProfileId) {
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
      return productId === "product-1"
        ? ({
            _id: "product-1",
            storeId: "store-1",
          } as never)
        : null;
    },
    async getProductSku(productSkuId) {
      return productSkuId === "sku-1"
        ? ({
            _id: "sku-1",
            storeId: "store-1",
            productId: "product-1",
            sku: "CAP-1",
            price: 25,
            quantityAvailable: 10,
            inventoryCount: 10,
            images: [],
          } as never)
        : null;
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
    async getActiveHeldQuantity() {
      return 0;
    },
    async readActiveInventoryHoldQuantitiesForSession() {
      return (
        overrides.consumedHoldQuantities ?? new Map([["sku-1", 1]])
      ) as never;
    },
    async consumeInventoryHoldsForSession() {
      return (
        overrides.consumedHoldQuantities ?? new Map([["sku-1", 1]])
      ) as never;
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
        acceptedThroughSequenceByRegister.get(args.localRegisterSessionId) ?? 0
      );
    },
    async updateAcceptedThroughSequence(args) {
      acceptedThroughSequenceByRegister.set(
        args.localRegisterSessionId,
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
        _id: `sync-mapping-${nextId++}`,
        ...input,
      } as LocalSyncMappingRecord;
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
      const conflict = {
        _id: `sync-conflict-${nextId++}`,
        ...input,
      } satisfies LocalSyncConflictRecord;
      conflicts.push(conflict);
      return conflict;
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
    async createTransaction(input) {
      const id = `transaction-${createdTransactions.length + 1}`;
      createdTransactions.push({ _id: id, ...input });
      return id as never;
    },
    async createTransactionItem() {
      return `transaction-item-${nextId++}` as never;
    },
    async patchProductSku() {},
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
