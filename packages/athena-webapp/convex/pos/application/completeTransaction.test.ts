import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "../../workflowTraces/core";
import {
  completeTransaction,
  createTransactionFromSessionHandler,
  buildCompleteTransactionResult,
  resolveTransactionVoidApprovalDecisionWithCtx,
  voidTransaction,
} from "./commands/completeTransaction";
import {
  consumeInventoryHoldsForSession,
  readActiveInventoryHoldQuantitiesForSession,
  validateInventoryAvailability,
} from "../../inventory/helpers/inventoryHolds";
import {
  recordInventoryMovementWithCtx,
  recordInventoryMovementWithDispositionWithCtx,
} from "../../operations/inventoryMovements";
import {
  createPosTransaction,
  createPosTransactionItem,
  getPosTransactionById,
  getPosSessionById,
  getRegisterSessionById,
  getProductSkuById,
  getStoreById,
  listTransactionAdjustments,
  listSessionItems,
  listTransactionItems,
  patchPosTransaction,
  patchPosSession,
  patchProductSku,
} from "../infrastructure/repositories/transactionRepository";
import {
  recordRetailSalePaymentAllocations,
  recordRetailVoidPaymentAllocations,
} from "../infrastructure/integrations/paymentAllocationService";
import { updateCustomerStats } from "../infrastructure/repositories/customerRepository";
import { consumeCommandApprovalProofWithCtx } from "../../operations/approvalActions";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";

vi.mock("../../workflowTraces/core", () => ({
  appendWorkflowTraceEventWithCtx: vi.fn(),
  createWorkflowTraceWithCtx: vi.fn(),
  registerWorkflowTraceLookupWithCtx: vi.fn(),
}));

vi.mock("../infrastructure/repositories/transactionRepository", () => ({
  createPosTransaction: vi.fn(),
  createPosTransactionItem: vi.fn(),
  getPosSessionById: vi.fn(),
  getRegisterSessionById: vi.fn(),
  getPosTransactionById: vi.fn(),
  getProductSkuById: vi.fn(),
  getStoreById: vi.fn(),
  listTransactionAdjustments: vi.fn(),
  listSessionItems: vi.fn(),
  listTransactionItems: vi.fn(),
  patchPosSession: vi.fn(),
  patchPosTransaction: vi.fn(),
  patchProductSku: vi.fn(),
}));

vi.mock("../infrastructure/integrations/paymentAllocationService", () => ({
  recordRetailSalePaymentAllocations: vi.fn(),
  recordRetailVoidPaymentAllocations: vi.fn(),
}));

vi.mock("../../operations/approvalActions", () => ({
  APPROVAL_ACTIONS: {
    transactionVoid: {
      key: "pos.transaction.void",
      label: "Void completed transaction",
    },
  },
  consumeCommandApprovalProofWithCtx: vi.fn(),
}));

vi.mock("../../operations/operationalEvents", () => ({
  recordOperationalEventWithCtx: vi.fn(),
}));

vi.mock("../infrastructure/repositories/customerRepository", () => ({
  updateCustomerStats: vi.fn(),
}));

vi.mock("../../inventory/helpers/inventoryHolds", () => ({
  consumeInventoryHoldsForSession: vi.fn(),
  readActiveInventoryHoldQuantitiesForSession: vi.fn(),
  validateInventoryAvailability: vi.fn(),
}));

vi.mock("../../operations/inventoryMovements", () => ({
  recordInventoryMovementWithCtx: vi.fn(),
  recordInventoryMovementWithDispositionWithCtx: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(validateInventoryAvailability).mockResolvedValue({
    success: true,
    available: 10,
  });
  vi.mocked(consumeInventoryHoldsForSession).mockResolvedValue(new Map());
  vi.mocked(readActiveInventoryHoldQuantitiesForSession).mockResolvedValue(
    new Map(),
  );
});

function expectNoCompletionSideEffects() {
  expect(createPosTransaction).not.toHaveBeenCalled();
  expect(createPosTransactionItem).not.toHaveBeenCalled();
  expect(patchProductSku).not.toHaveBeenCalled();
  expect(recordInventoryMovementWithCtx).not.toHaveBeenCalled();
  expect(patchPosSession).not.toHaveBeenCalled();
  expect(patchPosTransaction).not.toHaveBeenCalled();
  expect(recordRetailSalePaymentAllocations).not.toHaveBeenCalled();
  expect(updateCustomerStats).not.toHaveBeenCalled();
  expect(createWorkflowTraceWithCtx).not.toHaveBeenCalled();
  expect(registerWorkflowTraceLookupWithCtx).not.toHaveBeenCalled();
  expect(appendWorkflowTraceEventWithCtx).not.toHaveBeenCalled();
}

function expectNoVoidBusinessSideEffects() {
  expect(patchPosTransaction).not.toHaveBeenCalled();
  expect(patchProductSku).not.toHaveBeenCalled();
  expect(recordRetailVoidPaymentAllocations).not.toHaveBeenCalled();
  expect(recordInventoryMovementWithCtx).not.toHaveBeenCalled();
  expect(recordInventoryMovementWithDispositionWithCtx).not.toHaveBeenCalled();
}

function createVoidCtx(overrides?: {
  approvalRequests?: unknown[];
  completedDailyCloses?: unknown[];
  inventoryMovements?: unknown[];
  insert?: ReturnType<typeof vi.fn>;
  patch?: ReturnType<typeof vi.fn>;
  paymentAllocations?: unknown[];
}) {
  const approvalRequests = overrides?.approvalRequests ?? [];
  return {
    db: {
      get: vi.fn(async (tableName: string, id: string) => {
        if (tableName === "approvalRequest") {
          return (
            approvalRequests.find(
              (request) => (request as { _id?: string })._id === id,
            ) ?? null
          );
        }

        return null;
      }),
      insert:
        overrides?.insert ??
        vi.fn(async (tableName: string) =>
          tableName === "approvalRequest" ? "approval-request-1" : `${tableName}-1`,
        ),
      patch: overrides?.patch ?? vi.fn(),
      query: vi.fn((tableName: string) => ({
        withIndex: vi.fn(() => ({
          collect: vi
            .fn()
            .mockResolvedValue(
              tableName === "dailyClose"
                ? (overrides?.completedDailyCloses ?? [])
                : tableName === "approvalRequest"
                  ? approvalRequests
                : tableName === "inventoryMovement"
                  ? (overrides?.inventoryMovements ?? [])
                : tableName === "paymentAllocation"
                  ? (overrides?.paymentAllocations ?? [])
                : [],
            ),
          take: vi
            .fn()
            .mockResolvedValue(
              tableName === "dailyClose"
                ? (overrides?.completedDailyCloses ?? [])
                : tableName === "approvalRequest"
                  ? approvalRequests
                : tableName === "inventoryMovement"
                  ? (overrides?.inventoryMovements ?? [])
                : tableName === "paymentAllocation"
                  ? (overrides?.paymentAllocations ?? [])
                : [],
            ),
        })),
      })),
    },
    runMutation: vi.fn(),
  };
}

describe("buildCompleteTransactionResult", () => {
  it("returns ok with transaction data when completion succeeds", () => {
    const result = buildCompleteTransactionResult({
      transactionId: "txn-1" as Id<"posTransaction">,
      transactionNumber: "POS-TXN-001",
      paymentAllocated: true,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected successful completion result");
    }
    expect(result.data.transactionNumber).toBe("POS-TXN-001");
  });

  it("does not fail completion when no payment allocations are recorded", () => {
    const result = buildCompleteTransactionResult({
      transactionId: "txn-1" as Id<"posTransaction">,
      transactionNumber: "POS-TXN-001",
      paymentAllocated: false,
    });

    expect(result.status).toBe("ok");
  });

  it("returns validationFailed when transaction identifiers are missing", () => {
    const result = buildCompleteTransactionResult({
      transactionId: null,
      transactionNumber: null,
      paymentAllocated: true,
    });

    expect(result.status).toBe("validationFailed");
  });
});

describe("voidTransaction", () => {
  const completedTransaction = {
    _id: "txn-1" as Id<"posTransaction">,
    changeGiven: 2,
    completedAt: Date.UTC(2026, 4, 21, 10),
    customerProfileId: "customer-1" as Id<"customerProfile">,
    payments: [{ method: "cash", amount: 12, timestamp: 1 }],
    registerNumber: "1",
    registerSessionId: "register-1" as Id<"registerSession">,
    status: "completed",
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    transactionNumber: "POS-0001",
  };

  beforeEach(() => {
    vi.mocked(getPosTransactionById).mockResolvedValue(
      completedTransaction as never,
    );
    vi.mocked(getStoreById).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      status: "open",
      storeId: "store-1",
      terminalId: "terminal-1",
    } as never);
    vi.mocked(listTransactionAdjustments).mockResolvedValue([] as never);
    vi.mocked(listTransactionItems).mockResolvedValue([
      {
        _id: "txn-item-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productName: "Sneaker",
        productSku: "SKU-1",
        quantity: 1,
      },
    ] as never);
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      inventoryCount: 4,
      productId: "product-1",
      quantityAvailable: 4,
      sku: "SKU-1",
      storeId: "store-1",
    } as never);
    vi.mocked(recordOperationalEventWithCtx).mockResolvedValue({
      _id: "event-1",
    } as never);
    vi.mocked(recordRetailVoidPaymentAllocations).mockResolvedValue([
      { _id: "payment-allocation-1" },
    ] as never);
    vi.mocked(recordInventoryMovementWithCtx).mockResolvedValue({
      _id: "inventory-movement-1",
    } as never);
    vi.mocked(recordInventoryMovementWithDispositionWithCtx).mockResolvedValue({
      disposition: "inserted",
      movement: { _id: "inventory-movement-1" },
    } as never);
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "approval-proof-1",
        approvedByStaffProfileId: "manager-1",
      },
    } as never);
  });

  it("returns approval_required without mutating ledger state on the first attempt", async () => {
    const ctx = createVoidCtx();

    await expect(
      voidTransaction(ctx as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        reason: "Duplicate sale",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({
      kind: "approval_required",
      approval: {
        action: { key: "pos.transaction.void" },
        requiredRole: "manager",
        subject: {
          id: "txn-1",
          type: "pos_transaction",
        },
      },
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "approvalRequest",
      expect.objectContaining({
        requestType: "pos_transaction_void",
        subjectId: "txn-1",
        subjectType: "pos_transaction",
      }),
    );
    expectNoVoidBusinessSideEffects();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("returns approval_required without an operator reason", async () => {
    const ctx = createVoidCtx();

    await expect(
      voidTransaction(ctx as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({
      kind: "approval_required",
      approval: {
        metadata: expect.not.objectContaining({
          reason: expect.anything(),
        }),
      },
    });

    const approvalRequestPayload = vi.mocked(ctx.db.insert).mock.calls.find(
      ([tableName]) => tableName === "approvalRequest",
    )?.[1];
    expect(approvalRequestPayload).not.toHaveProperty("notes");
    expectNoVoidBusinessSideEffects();
  });

  it("reuses a pending void approval request on command retries", async () => {
    const ctx = createVoidCtx({
      approvalRequests: [
        {
          _id: "approval-existing-1",
          requestType: "pos_transaction_void",
          status: "pending",
          storeId: "store-1",
          subjectId: "txn-1",
          subjectType: "pos_transaction",
        },
      ],
    });

    await expect(
      voidTransaction(ctx as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        reason: "Duplicate sale",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({
      kind: "approval_required",
      approval: {
        resolutionModes: expect.arrayContaining([
          expect.objectContaining({
            approvalRequestId: "approval-existing-1",
            kind: "async_request",
          }),
        ]),
      },
    });

    expect(ctx.db.insert).not.toHaveBeenCalled();
    expectNoVoidBusinessSideEffects();
  });

  it("blocks mixed service sales before creating a void approval request", async () => {
    const ctx = createVoidCtx({
      paymentAllocations: [
        {
          _id: "allocation-service-1",
          amount: 15000,
          direction: "in",
          posTransactionId: "txn-1",
          registerSessionId: "register-session-1",
          status: "recorded",
          targetId: "case-1",
          targetType: "service_case",
        },
      ],
    });

    const result = await voidTransaction(ctx as never, {
      actorStaffProfileId: "staff-1" as Id<"staffProfile">,
      transactionId: "txn-1" as Id<"posTransaction">,
      reason: "Customer changed service plan",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "Mixed service sales cannot be voided from POS yet. Reverse the service payment in Service Ops before voiding the retail sale.",
      },
    });
    expect(ctx.db.insert).not.toHaveBeenCalledWith(
      "approvalRequest",
      expect.anything(),
    );
    expectNoVoidBusinessSideEffects();
  });

  it("consumes a manager approval proof and records payment, register, inventory, and audit reversal evidence", async () => {
    const ctx = createVoidCtx();
    vi.mocked(recordOperationalEventWithCtx)
      .mockResolvedValueOnce({ _id: "approval-event-1" } as never)
      .mockResolvedValueOnce({ _id: "void-event-1" } as never);

    await expect(
      voidTransaction(ctx as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        approvalProofId: "approval-proof-1" as Id<"approvalProof">,
        reason: "Duplicate sale",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      data: {
        approvalProofId: "approval-proof-1",
        approverStaffProfileId: "manager-1",
        inventoryMovementIds: ["inventory-movement-1"],
        operationalEventId: "void-event-1",
        paymentAllocationIds: ["payment-allocation-1"],
        transactionId: "txn-1",
        transactionNumber: "POS-0001",
      },
    });

    expect(consumeCommandApprovalProofWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: expect.objectContaining({ key: "pos.transaction.void" }),
        approvalProofId: "approval-proof-1",
        requestedByStaffProfileId: "staff-1",
        requiredRole: "manager",
        storeId: "store-1",
        subject: {
          id: "txn-1",
          type: "pos_transaction",
        },
      }),
    );
    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        adjustmentKind: "void",
        changeGiven: 2,
        idempotencyKey: "posTransaction:txn-1:void",
        registerSessionId: "register-1",
      }),
    );
    expect(recordRetailVoidPaymentAllocations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        changeGiven: 2,
        organizationId: "org-1",
          posTransactionId: "txn-1",
          registerSessionId: "register-1",
        }),
      );
    expect(recordInventoryMovementWithDispositionWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        movementType: "pos_transaction_void",
        quantityDelta: 1,
        reasonCode: "pos_transaction_void",
        sourceId: "txn-1",
        sourceType: "posTransaction",
      }),
    );
    expect(patchProductSku).toHaveBeenCalledWith(expect.anything(), "sku-1", {
      inventoryCount: 5,
      quantityAvailable: 5,
    });
    expect(patchPosTransaction).toHaveBeenCalledWith(
      expect.anything(),
      "txn-1",
      expect.objectContaining({
        status: "void",
        voidApprovalProofId: "approval-proof-1",
        voidOperationalEventId: "void-event-1",
        voidReason: "Duplicate sale",
        voidedByStaffProfileId: "staff-1",
      }),
    );
  });

  it("marks the matching pending approval request approved when a void completes", async () => {
    const ctx = createVoidCtx({
      approvalRequests: [
        {
          _id: "approval-request-1",
          requestType: "pos_transaction_void",
          status: "pending",
          storeId: "store-1",
          subjectId: "txn-1",
          subjectType: "pos_transaction",
        },
      ],
    });

    await expect(
      voidTransaction(ctx as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        approvalProofId: "approval-proof-1" as Id<"approvalProof">,
        approvalRequestId: "approval-request-1" as Id<"approvalRequest">,
        reason: "Duplicate sale",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      data: {
        approvalRequestId: "approval-request-1",
      },
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "approvalRequest",
      "approval-request-1",
      expect.objectContaining({
        status: "approved",
        reviewedByStaffProfileId: "manager-1",
      }),
    );
    expect(ctx.db.patch).not.toHaveBeenCalledWith(
      "approvalRequest",
      "approval-request-1",
      expect.objectContaining({
        reviewedByUserId: "user-1",
      }),
    );
    expect(recordOperationalEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        approvalRequestId: "approval-request-1",
        eventType: "pos_transaction_void_approval_proof_consumed",
      }),
    );
  });

  it("applies a completed-sale void when a queued approval request is approved", async () => {
    const ctx = createVoidCtx({
      approvalRequests: [
        {
          _id: "approval-request-1",
          posTransactionId: "txn-1",
          requestType: "pos_transaction_void",
          requestedByStaffProfileId: "staff-1",
          requestedByUserId: "cashier-user-1",
          status: "pending",
          storeId: "store-1",
          subjectId: "txn-1",
          subjectType: "pos_transaction",
        },
      ],
    });

    await expect(
      resolveTransactionVoidApprovalDecisionWithCtx(ctx as never, {
        approvalProofId: "decision-proof-1" as Id<"approvalProof">,
        approvalRequestId: "approval-request-1" as Id<"approvalRequest">,
        decision: "approved",
        decisionNotes: "Duplicate sale",
        reviewedByStaffProfileId: "manager-1" as Id<"staffProfile">,
        reviewedByUserId: "manager-user-1" as Id<"athenaUser">,
      }),
    ).resolves.toMatchObject({
      approvalProofId: "decision-proof-1",
      approvalRequestId: "approval-request-1",
      approverStaffProfileId: "manager-1",
      transactionId: "txn-1",
    });

    expect(consumeCommandApprovalProofWithCtx).not.toHaveBeenCalled();
    expect(recordRetailVoidPaymentAllocations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        posTransactionId: "txn-1",
        registerSessionId: "register-1",
      }),
    );
    expect(recordInventoryMovementWithDispositionWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorStaffProfileId: "staff-1",
        actorUserId: "cashier-user-1",
        movementType: "pos_transaction_void",
        quantityDelta: 1,
      }),
    );
    expect(recordOperationalEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorStaffProfileId: "manager-1",
        actorUserId: "manager-user-1",
        eventType: "pos_transaction_void_approval_proof_consumed",
      }),
    );
    expect(recordOperationalEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorStaffProfileId: "staff-1",
        actorUserId: "cashier-user-1",
        eventType: "pos_transaction_voided",
        metadata: expect.objectContaining({
          approverStaffProfileId: "manager-1",
          reviewerUserId: "manager-user-1",
        }),
      }),
    );
    expect(patchPosTransaction).toHaveBeenCalledWith(
      expect.anything(),
      "txn-1",
      expect.objectContaining({
        status: "void",
        voidApprovalProofId: "decision-proof-1",
        voidApprovalRequestId: "approval-request-1",
        voidApprovedByStaffProfileId: "manager-1",
      }),
    );
    expect(ctx.db.patch).not.toHaveBeenCalledWith(
      "approvalRequest",
      "approval-request-1",
      expect.any(Object),
    );
  });

  it("does not apply void side effects when a queued void approval is rejected", async () => {
    const ctx = createVoidCtx({
      approvalRequests: [
        {
          _id: "approval-request-1",
          posTransactionId: "txn-1",
          requestType: "pos_transaction_void",
          requestedByStaffProfileId: "staff-1",
          status: "pending",
          storeId: "store-1",
          subjectId: "txn-1",
          subjectType: "pos_transaction",
        },
      ],
    });

    await expect(
      resolveTransactionVoidApprovalDecisionWithCtx(ctx as never, {
        approvalProofId: "decision-proof-1" as Id<"approvalProof">,
        approvalRequestId: "approval-request-1" as Id<"approvalRequest">,
        decision: "rejected",
        reviewedByStaffProfileId: "manager-1" as Id<"staffProfile">,
        reviewedByUserId: "manager-user-1" as Id<"athenaUser">,
      }),
    ).resolves.toBeNull();

    expectNoVoidBusinessSideEffects();
  });

  it.each([
    [
      "missing approval proof",
      {
        approvalProofId: undefined,
        reviewedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      },
      "Manager approval is required to void a completed sale.",
    ],
    [
      "missing reviewer staff",
      {
        approvalProofId: "decision-proof-1" as Id<"approvalProof">,
        reviewedByStaffProfileId: undefined,
      },
      "Manager approval is required to void a completed sale.",
    ],
  ])("rejects queued void approval with %s", async (_label, overrides, message) => {
    const ctx = createVoidCtx({
      approvalRequests: [
        {
          _id: "approval-request-1",
          posTransactionId: "txn-1",
          requestType: "pos_transaction_void",
          requestedByStaffProfileId: "staff-1",
          status: "pending",
          storeId: "store-1",
          subjectId: "txn-1",
          subjectType: "pos_transaction",
        },
      ],
    });

    await expect(
      resolveTransactionVoidApprovalDecisionWithCtx(ctx as never, {
        approvalRequestId: "approval-request-1" as Id<"approvalRequest">,
        decision: "approved",
        reviewedByUserId: "manager-user-1" as Id<"athenaUser">,
        ...overrides,
      }),
    ).rejects.toThrow(message);

    expectNoVoidBusinessSideEffects();
  });

  it("rejects queued void approvals missing transaction details", async () => {
    const ctx = createVoidCtx({
      approvalRequests: [
        {
          _id: "approval-request-1",
          requestType: "pos_transaction_void",
          requestedByStaffProfileId: "staff-1",
          status: "pending",
          storeId: "store-1",
          subjectType: "pos_transaction",
        },
      ],
    });

    await expect(
      resolveTransactionVoidApprovalDecisionWithCtx(ctx as never, {
        approvalProofId: "decision-proof-1" as Id<"approvalProof">,
        approvalRequestId: "approval-request-1" as Id<"approvalRequest">,
        decision: "approved",
        reviewedByStaffProfileId: "manager-1" as Id<"staffProfile">,
        reviewedByUserId: "manager-user-1" as Id<"athenaUser">,
      }),
    ).rejects.toThrow("Void approval request is missing transaction details.");

    expectNoVoidBusinessSideEffects();
  });

  it("rejects queued void approvals when the transaction is missing", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue(null);
    const ctx = createVoidCtx({
      approvalRequests: [
        {
          _id: "approval-request-1",
          posTransactionId: "txn-1",
          requestType: "pos_transaction_void",
          requestedByStaffProfileId: "staff-1",
          status: "pending",
          storeId: "store-1",
          subjectId: "txn-1",
          subjectType: "pos_transaction",
        },
      ],
    });

    await expect(
      resolveTransactionVoidApprovalDecisionWithCtx(ctx as never, {
        approvalProofId: "decision-proof-1" as Id<"approvalProof">,
        approvalRequestId: "approval-request-1" as Id<"approvalRequest">,
        decision: "approved",
        reviewedByStaffProfileId: "manager-1" as Id<"staffProfile">,
        reviewedByUserId: "manager-user-1" as Id<"athenaUser">,
      }),
    ).rejects.toThrow("Transaction not found.");

    expectNoVoidBusinessSideEffects();
  });

  it("rejects mismatched pending approval requests before consuming manager proof", async () => {
    const ctx = createVoidCtx({
      approvalRequests: [
        {
          _id: "approval-request-1",
          requestType: "pos_transaction_void",
          status: "pending",
          storeId: "store-1",
          subjectId: "txn-other",
          subjectType: "pos_transaction",
        },
      ],
    });

    await expect(
      voidTransaction(ctx as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        approvalProofId: "approval-proof-1" as Id<"approvalProof">,
        approvalRequestId: "approval-request-1" as Id<"approvalRequest">,
        reason: "Duplicate sale",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
      },
    });

    expect(consumeCommandApprovalProofWithCtx).not.toHaveBeenCalled();
    expectNoVoidBusinessSideEffects();
  });

  it("blocks completed sales without drawer identity before approval consumption", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      ...completedTransaction,
      registerSessionId: undefined,
      terminalId: undefined,
    } as never);

    await expect(
      voidTransaction(createVoidCtx() as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        approvalProofId: "approval-proof-1" as Id<"approvalProof">,
        reason: "Duplicate sale",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Register sale is missing drawer context.",
      },
    });

    expect(consumeCommandApprovalProofWithCtx).not.toHaveBeenCalled();
    expectNoVoidBusinessSideEffects();
  });

  it("aggregates duplicate SKU sale lines before restoring inventory", async () => {
    vi.mocked(listTransactionItems).mockResolvedValue([
      {
        _id: "txn-item-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productName: "Sneaker",
        productSku: "SKU-1",
        quantity: 1,
      },
      {
        _id: "txn-item-2",
        productId: "product-1",
        productSkuId: "sku-1",
        productName: "Sneaker",
        productSku: "SKU-1",
        quantity: 2,
      },
    ] as never);

    await expect(
      voidTransaction(createVoidCtx() as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        approvalProofId: "approval-proof-1" as Id<"approvalProof">,
        reason: "Duplicate sale",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({
      kind: "ok",
    });

    expect(recordInventoryMovementWithDispositionWithCtx).toHaveBeenCalledTimes(1);
    expect(recordInventoryMovementWithDispositionWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        productSkuId: "sku-1",
        quantityDelta: 3,
      }),
    );
    expect(patchProductSku).toHaveBeenCalledTimes(1);
    expect(patchProductSku).toHaveBeenCalledWith(expect.anything(), "sku-1", {
      inventoryCount: 7,
      quantityAvailable: 7,
    });
  });

  it("does not restore SKU quantities again when void inventory movement already exists", async () => {
    vi.mocked(recordInventoryMovementWithDispositionWithCtx).mockResolvedValueOnce({
      disposition: "existing",
      movement: { _id: "inventory-movement-existing" as Id<"inventoryMovement"> },
    } as never);

    await expect(
      voidTransaction(createVoidCtx() as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        approvalProofId: "approval-proof-1" as Id<"approvalProof">,
        reason: "Duplicate sale",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      data: {
        inventoryMovementIds: ["inventory-movement-existing"],
      },
    });

    expect(recordInventoryMovementWithDispositionWithCtx).toHaveBeenCalledTimes(1);
    expect(patchProductSku).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["closed", { _id: "register-1", status: "closed", storeId: "store-1", terminalId: "terminal-1" }],
    ["wrong-store", { _id: "register-1", status: "open", storeId: "store-other", terminalId: "terminal-1" }],
    ["wrong-terminal", { _id: "register-1", status: "open", storeId: "store-1", terminalId: "terminal-other" }],
  ] as const)(
    "blocks completed-sale voids with a %s register session before approval consumption",
    async (_label, registerSession) => {
      vi.mocked(getRegisterSessionById).mockResolvedValue(registerSession as never);

      await expect(
        voidTransaction(createVoidCtx() as never, {
          actorStaffProfileId: "staff-1" as Id<"staffProfile">,
          approvalProofId: "approval-proof-1" as Id<"approvalProof">,
          reason: "Duplicate sale",
          transactionId: "txn-1" as Id<"posTransaction">,
        }),
      ).resolves.toMatchObject({
        kind: "user_error",
        error: {
          code: "precondition_failed",
          message: "Drawer closed. Open the drawer before voiding this sale.",
        },
      });

      expect(consumeCommandApprovalProofWithCtx).not.toHaveBeenCalled();
      expectNoVoidBusinessSideEffects();
    },
  );

  it.each(["pending_approval", "applied"] as const)(
    "blocks transactions with %s item adjustments before approval consumption",
    async (status) => {
      vi.mocked(listTransactionAdjustments).mockResolvedValue([
        { _id: "adjustment-1", status },
      ] as never);

      await expect(
        voidTransaction(createVoidCtx() as never, {
          actorStaffProfileId: "staff-1" as Id<"staffProfile">,
          approvalProofId: "approval-proof-1" as Id<"approvalProof">,
          reason: "Duplicate sale",
          transactionId: "txn-1" as Id<"posTransaction">,
        }),
      ).resolves.toMatchObject({
        kind: "user_error",
        error: {
          code: "precondition_failed",
        },
      });

      expect(consumeCommandApprovalProofWithCtx).not.toHaveBeenCalled();
      expectNoVoidBusinessSideEffects();
    },
  );

  it("blocks transactions from a completed EOD Review before reversal writes", async () => {
    const ctx = createVoidCtx({
      completedDailyCloses: [
        {
          _id: "daily-close-1",
          lifecycleStatus: "active",
          operatingDate: "2026-05-21",
          reportSnapshot: {
            closeMetadata: {
              startAt: Date.UTC(2026, 4, 21, 0),
              endAt: Date.UTC(2026, 4, 22, 0),
            },
          },
          status: "completed",
          storeId: "store-1",
        },
      ],
    });

    await expect(
      voidTransaction(ctx as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        approvalProofId: "approval-proof-1" as Id<"approvalProof">,
        reason: "Duplicate sale",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "EOD Review is completed for this sale. Reopen EOD Review before voiding it.",
      },
    });

    expect(consumeCommandApprovalProofWithCtx).not.toHaveBeenCalled();
    expectNoVoidBusinessSideEffects();
  });
});

describe("completeTransaction checkout side effects", () => {
  it("requires a terminal before recording a direct register sale", async () => {
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);

    await expect(
      completeTransaction({ runMutation: vi.fn() } as never, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 1,
            price: 10,
            name: "Sneaker",
            sku: "SKU-1",
          },
        ],
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
        subtotal: 10,
        tax: 0,
        total: 10,
        registerSessionId: "register-1" as Id<"registerSession">,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "Register session transactions must include a terminal.",
        }),
      }),
    );

    expectNoCompletionSideEffects();
  });

  it("records register sale and payment allocation for a direct register sale", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runMutation,
    } as never;

    vi.mocked(getStoreById).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);
    vi.mocked(createPosTransaction).mockResolvedValue("txn-1" as never);
    vi.mocked(recordRetailSalePaymentAllocations).mockResolvedValue(true);
    vi.mocked(createPosTransactionItem).mockResolvedValue(
      "txn-item-1" as never,
    );
    vi.mocked(patchProductSku).mockResolvedValue(undefined as never);

    await expect(
      completeTransaction(ctx, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 1,
            price: 10,
            name: "Sneaker",
            sku: "SKU-1",
          },
        ],
        payments: [{ method: "cash", amount: 12, timestamp: 1 }],
        subtotal: 10,
        tax: 0,
        total: 10,
        registerNumber: "1",
        terminalId: "terminal-1" as Id<"posTerminal">,
        registerSessionId: "register-1" as Id<"registerSession">,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "ok",
        data: expect.objectContaining({
          transactionId: "txn-1",
          transactionItems: ["txn-item-1"],
        }),
      }),
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        adjustmentKind: "sale",
        changeGiven: 2,
        registerSessionId: "register-1",
        registerNumber: "1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(recordRetailSalePaymentAllocations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        changeGiven: 2,
        organizationId: "org-1",
        posTransactionId: "txn-1",
        registerSessionId: "register-1",
        storeId: "store-1",
      }),
    );
    expect(recordInventoryMovementWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        movementType: "sale",
        sourceType: "posTransaction",
        sourceId: "txn-1",
        quantityDelta: -1,
        productSkuId: "sku-1",
        posTransactionId: "txn-1",
        registerSessionId: "register-1",
        reasonCode: "pos_sale",
      }),
    );
  });

  it("does not create side effects when payments are empty", async () => {
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);

    await expect(
      completeTransaction({} as never, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 1,
            price: 10,
            name: "Sneaker",
            sku: "SKU-1",
          },
        ],
        payments: [],
        subtotal: 10,
        tax: 0,
        total: 10,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "At least one payment is required.",
      },
    });

    expectNoCompletionSideEffects();
  });

  it("does not create side effects when payment is insufficient", async () => {
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);

    await expect(
      completeTransaction({} as never, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 1,
            price: 10,
            name: "Sneaker",
            sku: "SKU-1",
          },
        ],
        payments: [{ method: "cash", amount: 9, timestamp: 1 }],
        subtotal: 10,
        tax: 0,
        total: 10,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Insufficient payment. Total: 10.00, Paid: 9.00",
      },
    });

    expectNoCompletionSideEffects();
  });

  it("does not create side effects when a direct sale SKU is missing", async () => {
    vi.mocked(getProductSkuById).mockResolvedValue(null as never);

    await expect(
      completeTransaction({} as never, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-missing" as Id<"productSku">,
            quantity: 1,
            price: 10,
            name: "Sneaker",
            sku: "SKU-MISSING",
          },
        ],
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
        subtotal: 10,
        tax: 0,
        total: 10,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Product SKU sku-missing not found.",
      },
    });

    expectNoCompletionSideEffects();
  });

  it("aggregates duplicate SKU quantities before availability checks", async () => {
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 3,
      productId: "product-1",
      quantityAvailable: 3,
      sku: "SKU-1",
    } as never);

    await expect(
      completeTransaction({} as never, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 2,
            price: 10,
            name: "sneaker",
            sku: "SKU-1",
          },
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 2,
            price: 10,
            name: "sneaker",
            sku: "SKU-1",
          },
        ],
        payments: [{ method: "cash", amount: 40, timestamp: 1 }],
        subtotal: 40,
        tax: 0,
        total: 40,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "conflict",
        message:
          "Insufficient inventory for Sneaker (SKU-1). Available: 3, Total Requested: 4",
      },
    });

    expect(getProductSkuById).toHaveBeenCalledTimes(1);
    expectNoCompletionSideEffects();
  });
});

describe("completeTransaction trace ordering", () => {
  it("does not write a POS sale trace for direct-sale completion", async () => {
    vi.mocked(getStoreById).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);
    vi.mocked(createPosTransaction).mockResolvedValue("txn-1" as never);
    vi.mocked(recordRetailSalePaymentAllocations).mockResolvedValue(true);
    vi.mocked(updateCustomerStats).mockRejectedValue(
      new Error("customer stats unavailable"),
    );

    const traceEvents: string[] = [];
    vi.mocked(createWorkflowTraceWithCtx).mockImplementation(
      async (_ctx, input) => {
        traceEvents.push(`trace:create:${input.status}`);
        return "trace-1" as never;
      },
    );
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockImplementation(
      async () => {
        traceEvents.push("trace:lookup");
        return "lookup-1" as never;
      },
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockImplementation(
      async (_ctx, input) => {
        traceEvents.push(`trace:event:${input.step}`);
        return "event-1" as never;
      },
    );

    await expect(
      completeTransaction({} as never, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 1,
            price: 10,
            name: "Sneaker",
            sku: "SKU-1",
          },
        ],
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
        subtotal: 10,
        tax: 0,
        total: 10,
      }),
    ).resolves.toMatchObject({ kind: "ok" });

    expect(traceEvents).toEqual([]);
    expect(patchPosTransaction).not.toHaveBeenCalledWith(
      expect.anything(),
      "txn-1",
      expect.objectContaining({
        workflowTraceId: expect.any(String),
      }),
    );
  });

  it("does not write a POS sale trace for session-based checkout", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runMutation,
    } as never;

    vi.mocked(getStoreById).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      customerProfileId: "profile-1",
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-1",
      status: "open",
      terminalId: "terminal-1",
      registerNumber: "1",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);
    vi.mocked(createPosTransaction).mockResolvedValue("txn-1" as never);
    vi.mocked(recordRetailSalePaymentAllocations).mockResolvedValue(true);
    vi.mocked(createPosTransactionItem).mockResolvedValue(
      "txn-item-1" as never,
    );
    vi.mocked(patchProductSku).mockResolvedValue(undefined as never);
    vi.mocked(patchPosSession).mockRejectedValue(
      new Error("session patch unavailable"),
    );

    const traceEvents: string[] = [];
    vi.mocked(createWorkflowTraceWithCtx).mockImplementation(
      async (_ctx, input) => {
        traceEvents.push(`trace:create:${input.status}`);
        return "trace-1" as never;
      },
    );
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockImplementation(
      async () => {
        traceEvents.push("trace:lookup");
        return "lookup-1" as never;
      },
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockImplementation(
      async (_ctx, input) => {
        traceEvents.push(`trace:event:${input.step}`);
        return "event-1" as never;
      },
    );

    await expect(
      createTransactionFromSessionHandler(ctx, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).rejects.toThrow("session patch unavailable");

    expect(traceEvents).toEqual([]);
    expect(patchPosTransaction).not.toHaveBeenCalledWith(
      expect.anything(),
      "txn-1",
      expect.objectContaining({
        workflowTraceId: expect.any(String),
      }),
    );
  });

  it("uses the stored session drawer binding during session-based checkout", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runMutation,
    } as never;

    vi.mocked(getStoreById).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      customerProfileId: "profile-1",
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-1",
      status: "open",
      terminalId: "terminal-1",
      registerNumber: "1",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);
    vi.mocked(createPosTransaction).mockResolvedValue("txn-1" as never);
    vi.mocked(recordRetailSalePaymentAllocations).mockResolvedValue(true);
    vi.mocked(createPosTransactionItem).mockResolvedValue(
      "txn-item-1" as never,
    );
    vi.mocked(patchProductSku).mockResolvedValue(undefined as never);
    vi.mocked(patchPosSession).mockResolvedValue(undefined as never);
    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );
    vi.mocked(patchPosTransaction).mockResolvedValue(undefined as never);
    vi.mocked(consumeInventoryHoldsForSession).mockResolvedValue(
      new Map([["sku-1" as Id<"productSku">, 1]]),
    );

    await expect(
      createTransactionFromSessionHandler(ctx, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "ok",
        data: expect.objectContaining({
          transactionId: "txn-1",
        }),
      }),
    );

    expect(createPosTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        registerSessionId: "register-1",
        customerProfileId: "profile-1",
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        registerSessionId: "register-1",
      }),
    );
    expect(recordRetailSalePaymentAllocations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        registerSessionId: "register-1",
      }),
    );
    expect(consumeInventoryHoldsForSession).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        sessionId: "session-1",
        items: [{ skuId: "sku-1", quantity: 1 }],
      }),
    );
    expect(patchProductSku).toHaveBeenCalledWith(expect.anything(), "sku-1", {
      quantityAvailable: 9,
      inventoryCount: 9,
    });
    expect(recordInventoryMovementWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        movementType: "sale",
        sourceType: "posTransaction",
        sourceId: "txn-1",
        quantityDelta: -1,
        productSkuId: "sku-1",
        posTransactionId: "txn-1",
        registerSessionId: "register-1",
        actorStaffProfileId: "staff-1",
        customerProfileId: "profile-1",
        reasonCode: "pos_sale",
      }),
    );
  });

  it("rejects session checkout when submitted totals no longer match persisted items", async () => {
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 191_000,
      tax: 0,
      total: 191_000,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Nugs",
        price: 8_000,
        quantity: 1,
        image: undefined,
      },
      {
        _id: "session-item-2",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-2",
        productSkuId: "sku-2",
        productSku: "SKU-2",
        productName: "Agya",
        price: 25_000,
        quantity: 1,
        image: undefined,
      },
      {
        _id: "session-item-3",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-3",
        productSkuId: "sku-3",
        productSku: "SKU-3",
        productName: "Vibes",
        price: 50_000,
        quantity: 1,
        image: undefined,
      },
      {
        _id: "session-item-4",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-4",
        productSkuId: "sku-4",
        productSku: "SKU-4",
        productName: "Modelo",
        price: 2_400,
        quantity: 1,
        image: undefined,
      },
    ] as never);

    const result = await createTransactionFromSessionHandler({} as never, {
      sessionId: "session-1" as Id<"posSession">,
      staffProfileId: "staff-1" as Id<"staffProfile">,
      payments: [{ method: "cash", amount: 191_000, timestamp: 1 }],
      submittedTotals: {
        subtotal: 191_000,
        tax: 0,
        total: 191_000,
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "conflict",
          message:
            "Sale total changed. Review the cart and take payment again.",
        }),
      }),
    );
    expectNoCompletionSideEffects();
  });

  it("uses persisted session items as the canonical sale total", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runMutation,
    } as never;

    vi.mocked(getStoreById).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 191_000,
      tax: 0,
      total: 191_000,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-1",
      status: "open",
      terminalId: "terminal-1",
      registerNumber: "1",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Nugs",
        price: 8_000,
        quantity: 1,
        image: undefined,
      },
      {
        _id: "session-item-2",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-2",
        productSkuId: "sku-2",
        productSku: "SKU-2",
        productName: "Agya",
        price: 25_000,
        quantity: 1,
        image: undefined,
      },
      {
        _id: "session-item-3",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-3",
        productSkuId: "sku-3",
        productSku: "SKU-3",
        productName: "Vibes",
        price: 50_000,
        quantity: 1,
        image: undefined,
      },
      {
        _id: "session-item-4",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-4",
        productSkuId: "sku-4",
        productSku: "SKU-4",
        productName: "Modelo",
        price: 2_400,
        quantity: 1,
        image: undefined,
      },
    ] as never);
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);
    vi.mocked(createPosTransaction).mockResolvedValue("txn-1" as never);
    vi.mocked(recordRetailSalePaymentAllocations).mockResolvedValue(true);
    vi.mocked(createPosTransactionItem).mockResolvedValue(
      "txn-item-1" as never,
    );
    vi.mocked(patchProductSku).mockResolvedValue(undefined as never);
    vi.mocked(patchPosSession).mockResolvedValue(undefined as never);

    const result = await createTransactionFromSessionHandler(ctx, {
      sessionId: "session-1" as Id<"posSession">,
      staffProfileId: "staff-1" as Id<"staffProfile">,
      payments: [{ method: "cash", amount: 85_400, timestamp: 1 }],
      submittedTotals: {
        subtotal: 85_400,
        tax: 0,
        total: 85_400,
      },
    });

    expect(result).toEqual(expect.objectContaining({ kind: "ok" }));
    expect(createPosTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        subtotal: 85_400,
        tax: 0,
        total: 85_400,
        totalPaid: 85_400,
        changeGiven: undefined,
      }),
    );
    expect(recordRetailSalePaymentAllocations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payments: [{ method: "cash", amount: 85_400, timestamp: 1 }],
      }),
    );
  });

  it("keeps legacy pre-ledger session availability unchanged when no hold row exists", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runMutation,
    } as never;

    vi.mocked(getStoreById).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-legacy",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-1",
      status: "open",
      terminalId: "terminal-1",
      registerNumber: "1",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-legacy",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);
    vi.mocked(createPosTransaction).mockResolvedValue("txn-1" as never);
    vi.mocked(recordRetailSalePaymentAllocations).mockResolvedValue(true);
    vi.mocked(createPosTransactionItem).mockResolvedValue(
      "txn-item-1" as never,
    );
    vi.mocked(patchProductSku).mockResolvedValue(undefined as never);
    vi.mocked(patchPosSession).mockResolvedValue(undefined as never);
    vi.mocked(patchPosTransaction).mockResolvedValue(undefined as never);
    vi.mocked(consumeInventoryHoldsForSession).mockResolvedValue(new Map());

    await expect(
      createTransactionFromSessionHandler(ctx, {
        sessionId: "session-legacy" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(expect.objectContaining({ kind: "ok" }));

    expect(patchProductSku).toHaveBeenCalledWith(expect.anything(), "sku-1", {
      quantityAvailable: 10,
      inventoryCount: 9,
    });
    expect(recordInventoryMovementWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        movementType: "sale",
        sourceType: "posTransaction",
        sourceId: "txn-1",
        quantityDelta: -1,
        productSkuId: "sku-1",
        posTransactionId: "txn-1",
        registerSessionId: "register-1",
        actorStaffProfileId: "staff-1",
        reasonCode: "pos_sale",
      }),
    );
  });

  it("blocks ledger sessions before side effects when active hold coverage is missing", async () => {
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-ledger",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      inventoryHoldMode: "ledger",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-1",
      status: "open",
      terminalId: "terminal-1",
      registerNumber: "1",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-ledger",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);
    vi.mocked(readActiveInventoryHoldQuantitiesForSession).mockResolvedValue(
      new Map(),
    );

    await expect(
      createTransactionFromSessionHandler({ db: {} } as never, {
        sessionId: "session-ledger" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "conflict",
          message:
            "Inventory hold expired for Sneaker. Scan it again before completing this sale.",
        }),
      }),
    );

    expectNoCompletionSideEffects();
  });

  it("fails before transaction side effects when the checkout cashier does not own the session", async () => {
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);

    await expect(
      createTransactionFromSessionHandler({} as never, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-2" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "This session is not associated with your cashier.",
        }),
      }),
    );

    expect(listSessionItems).not.toHaveBeenCalled();
    expectNoCompletionSideEffects();
  });

  it("fails when a session sale is not bound to an open drawer", async () => {
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);

    await expect(
      createTransactionFromSessionHandler({} as never, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "Open the cash drawer before completing this sale.",
        }),
      }),
    );
  });

  it("fails safely when a session sale is bound to a closed drawer", async () => {
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-1",
      status: "closed",
      terminalId: "terminal-1",
      registerNumber: "1",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);

    await expect(
      createTransactionFromSessionHandler({} as never, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "Open the cash drawer before completing this sale.",
        }),
      }),
    );

    expect(createPosTransaction).not.toHaveBeenCalled();
  });

  it("fails safely when a session sale is bound to a closing drawer", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runMutation,
    } as never;

    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-1",
      status: "closing",
      terminalId: "terminal-1",
      registerNumber: "1",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);

    await expect(
      createTransactionFromSessionHandler(ctx, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "Open the cash drawer before completing this sale.",
        }),
      }),
    );

    expect(runMutation).not.toHaveBeenCalled();
    expectNoCompletionSideEffects();
  });

  it("fails safely when a session sale drawer belongs to another store", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runMutation,
    } as never;

    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-2",
      status: "open",
      terminalId: "terminal-1",
      registerNumber: "1",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);

    await expect(
      createTransactionFromSessionHandler(ctx, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "Open the cash drawer before completing this sale.",
        }),
      }),
    );

    expect(runMutation).not.toHaveBeenCalled();
    expectNoCompletionSideEffects();
  });

  it("fails safely when a provided drawer conflicts with the session drawer", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runMutation,
    } as never;

    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);

    await expect(
      createTransactionFromSessionHandler(ctx, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
        registerSessionId: "register-2" as Id<"registerSession">,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "Open the cash drawer before completing this sale.",
        }),
      }),
    );

    expect(getRegisterSessionById).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expectNoCompletionSideEffects();
  });

  it("fails safely when a session sale is bound to a mismatched drawer", async () => {
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-1",
      status: "open",
      terminalId: "terminal-9",
      registerNumber: "9",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);

    await expect(
      createTransactionFromSessionHandler({} as never, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "Open the cash drawer before completing this sale.",
        }),
      }),
    );

    expect(createPosTransaction).not.toHaveBeenCalled();
  });

  it("does not persist workflowTraceId during direct sale completion", async () => {
    vi.mocked(getStoreById).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);
    vi.mocked(createPosTransaction).mockResolvedValue("txn-1" as never);
    vi.mocked(recordRetailSalePaymentAllocations).mockResolvedValue(true);
    vi.mocked(createPosTransactionItem).mockResolvedValue(
      "txn-item-1" as never,
    );
    vi.mocked(patchProductSku).mockResolvedValue(undefined as never);
    vi.mocked(updateCustomerStats).mockResolvedValue(undefined as never);
    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );
    vi.mocked(patchPosTransaction).mockRejectedValue(
      new Error("trace link patch unavailable"),
    );

    await expect(
      completeTransaction({} as never, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 1,
            price: 10,
            name: "Sneaker",
            sku: "SKU-1",
          },
        ],
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
        subtotal: 10,
        tax: 0,
        total: 10,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "ok",
        data: expect.objectContaining({
          transactionId: "txn-1",
        }),
      }),
    );
    expect(patchPosTransaction).not.toHaveBeenCalled();
  });
});
