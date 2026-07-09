import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import {
  adjustTransactionItems,
  resolveTransactionItemAdjustmentApprovalDecisionWithCtx,
  type TransactionItemAdjustmentPayload,
} from "./commands/adjustTransactionItems";
import { consumeCommandApprovalProofWithCtx } from "../../operations/approvalActions";
import { createApprovalRequesterChallengeWithCtx } from "../../operations/approvalRequesterChallenges";
import { recordInventoryMovementWithCtx } from "../../operations/inventoryMovements";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import { recordPaymentAllocationWithCtx } from "../../operations/paymentAllocations";
import { recordRegisterSessionTraceBestEffort } from "../../operations/registerSessionTracing";
import {
  getPosTransactionById,
  getStoreById,
  listTransactionItems,
} from "../infrastructure/repositories/transactionRepository";

vi.mock("../../operations/approvalActions", () => ({
  APPROVAL_ACTIONS: {
    registerSessionCloseoutModificationSubmit: {
      key: "register.closeout.modification.submit",
      label: "Submit closeout modification",
    },
    registerSessionCloseoutReopen: {
      key: "register.closeout.reopen",
      label: "Reopen register closeout",
    },
    registerSessionOpeningFloatCorrection: {
      key: "register.opening_float.correct",
      label: "Correct opening float",
    },
    registerSessionVarianceReview: {
      key: "register.variance.review",
      label: "Review register variance",
    },
    transactionItemAdjustment: {
      key: "pos.transaction.adjust_items",
      label: "Adjust transaction items",
    },
  },
  consumeCommandApprovalProofWithCtx: vi.fn(),
}));

vi.mock(
  "../../operations/approvalRequesterChallenges",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../operations/approvalRequesterChallenges")
      >();

    return {
      ...actual,
      createApprovalRequesterChallengeWithCtx: vi.fn(),
    };
  },
);

vi.mock("../../operations/inventoryMovements", () => ({
  recordInventoryMovementWithCtx: vi.fn(),
}));

vi.mock("../../operations/operationalEvents", () => ({
  recordOperationalEventWithCtx: vi.fn(),
}));

vi.mock("../../operations/paymentAllocations", () => ({
  recordPaymentAllocationWithCtx: vi.fn(),
}));

vi.mock("../../operations/registerSessionTracing", () => ({
  recordRegisterSessionTraceBestEffort: vi.fn(),
}));

vi.mock("../infrastructure/repositories/transactionRepository", () => ({
  createTransactionAdjustmentForTransaction: vi.fn(async (ctx, args) => {
    const transaction = await ctx.db.get("posTransaction", args.transactionId);
    if (!transaction) {
      throw new Error("POS transaction not found.");
    }
    const adjustmentId = await ctx.db.insert(
      "posTransactionAdjustment",
      args.adjustment,
    );
    const lineIds = [];
    for (const line of args.lines) {
      lineIds.push(
        await ctx.db.insert("posTransactionAdjustmentLine", {
          ...line,
          adjustmentId,
        }),
      );
    }
    return { adjustmentId, lineIds };
  }),
  getActiveTransactionAdjustment: vi.fn(async (ctx, args) => {
    return (
      Array.from(ctx.tables?.posTransactionAdjustment?.values?.() ?? []).find(
        (adjustment: any) =>
          adjustment.storeId === args.storeId &&
          adjustment.transactionId === args.transactionId &&
          adjustment.status === "pending_approval",
      ) ?? null
    );
  }),
  getProductSkuById: vi.fn(async (ctx, productSkuId) =>
    ctx.db.get("productSku", productSkuId),
  ),
  getPosTransactionById: vi.fn(),
  getStoreById: vi.fn(),
  listTransactionItems: vi.fn(async (ctx, transactionId) =>
    Array.from(ctx.tables?.posTransactionItem?.values?.() ?? []).filter(
      (item: any) => item.transactionId === transactionId,
    ),
  ),
}));

type FakeTable = Map<string, Record<string, any>>;

function createFakeCtx() {
  const tables: Record<string, FakeTable> = {
    approvalRequest: new Map(),
    posTransactionAdjustment: new Map(),
    posTransactionAdjustmentLine: new Map(),
    posPendingCheckoutItem: new Map([
      [
        "pending-1",
        {
          _id: "pending-1",
          evidence: {
            totalQuantitySold: 2,
            transactionCount: 1,
          },
          storeId: "store-1",
          status: "pending_review",
        },
      ],
    ]),
    posTransaction: new Map([
      [
        "txn-1",
        {
          _id: "txn-1",
          storeId: "store-1",
          status: "completed",
        },
      ],
    ]),
    posTransactionItem: new Map([
      [
        "item-1",
        {
          _id: "item-1",
          transactionId: "txn-1",
          productId: "product-1",
          productSkuId: "sku-1",
          productName: "Closure Wig",
          productSku: "SKU-1",
          quantity: 2,
          unitPrice: 500,
          totalPrice: 1000,
        },
      ],
    ]),
    product: new Map([
      [
        "product-1",
        {
          _id: "product-1",
          availability: "live",
          isVisible: true,
        },
      ],
      [
        "product-2",
        {
          _id: "product-2",
          availability: "live",
          isVisible: true,
        },
      ],
    ]),
    productSku: new Map([
      [
        "sku-1",
        {
          _id: "sku-1",
          productId: "product-1",
          storeId: "store-1",
          inventoryCount: 10,
          price: 500,
          quantityAvailable: 10,
          sku: "SKU-1",
        },
      ],
      [
        "sku-2",
        {
          _id: "sku-2",
          productId: "product-2",
          storeId: "store-1",
          inventoryCount: 5,
          price: 500,
          quantityAvailable: 5,
          sku: "SKU-2",
        },
      ],
    ]),
    registerSession: new Map([
      [
        "register-session-1",
        {
          _id: "register-session-1",
          countedCash: 1200,
          expectedCash: 1000,
          openedAt: 1,
          openingFloat: 1000,
          organizationId: "org-1",
          registerNumber: "3",
          storeId: "store-1",
          status: "active",
          terminalId: "terminal-1",
        },
      ],
    ]),
  };

  const makeQuery = (tableName: string) => {
    const constraints: Record<string, unknown> = {};
    const chain = {
      eq(field: string, value: unknown) {
        constraints[field] = value;
        return chain;
      },
    };
    const result = {
      first: async () =>
        Array.from(tables[tableName]?.values() ?? []).find((row) =>
          Object.entries(constraints).every(
            ([field, value]) => row[field] === value,
          ),
        ) ?? null,
      collect: async () =>
        Array.from(tables[tableName]?.values() ?? []).filter((row) =>
          Object.entries(constraints).every(
            ([field, value]) => row[field] === value,
          ),
        ),
      take: async (limit: number) =>
        Array.from(tables[tableName]?.values() ?? [])
          .filter((row) =>
            Object.entries(constraints).every(
              ([field, value]) => row[field] === value,
            ),
          )
          .slice(0, limit),
    };

    return {
      withIndex: (_indexName: string, builder: (q: typeof chain) => unknown) => {
        builder(chain);
        return result;
      },
    };
  };

  return {
    ctx: {
      tables,
      db: {
        get: vi.fn(async (tableName: string, id: string) => {
          return tables[tableName]?.get(id) ?? null;
        }),
        insert: vi.fn(async (tableName: string, value: Record<string, any>) => {
          const table = (tables[tableName] ??= new Map());
          const id = `${tableName}-${table.size + 1}`;
          table.set(id, { ...value, _id: id });
          return id;
        }),
        patch: vi.fn(async (tableName: string, id: string, patch: Record<string, any>) => {
          const table = tables[tableName];
          const existing = table?.get(id);
          if (existing) {
            table.set(id, { ...existing, ...patch });
          }
        }),
        query: vi.fn((tableName: string) => makeQuery(tableName)),
      },
    },
    tables,
  };
}

function basePayload(
  overrides: Partial<TransactionItemAdjustmentPayload> = {},
): TransactionItemAdjustmentPayload {
  return {
    correctedTotal: 500,
    originalTotal: 1000,
    settlementAmount: 500,
    settlementDirection: "refund",
    settlementMethod: "cash",
    lines: [
      {
        adjustedQuantity: 1,
        inventoryDelta: 1,
        originalQuantity: 2,
        originalTransactionItemId: "item-1" as Id<"posTransactionItem">,
        productId: "product-1" as Id<"product">,
        productName: "Closure Wig",
        productSku: "SKU-1",
        productSkuId: "sku-1" as Id<"productSku">,
        unitPrice: 500,
      },
    ],
    ...overrides,
  };
}

function mockCompletedTransaction() {
  vi.mocked(getPosTransactionById).mockResolvedValue({
    _id: "txn-1" as Id<"posTransaction">,
    customerProfileId: "customer-1" as Id<"customerProfile">,
    registerSessionId: "register-session-1" as Id<"registerSession">,
    storeId: "store-1" as Id<"store">,
    status: "completed",
    subtotal: 1000,
    tax: 0,
    total: 1000,
    transactionNumber: "POS-111111",
  } as never);
  vi.mocked(getStoreById).mockResolvedValue({
    _id: "store-1",
    organizationId: "org-1",
  } as never);
  vi.mocked(listTransactionItems).mockImplementation(async (ctx: any, transactionId) =>
    Array.from(ctx.tables.posTransactionItem.values()).filter(
      (item: any) => item.transactionId === transactionId,
    ) as never,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mockCompletedTransaction();
  vi.mocked(recordInventoryMovementWithCtx).mockResolvedValue({
    _id: "movement-1" as Id<"inventoryMovement">,
  } as never);
  vi.mocked(recordPaymentAllocationWithCtx).mockResolvedValue({
    _id: "allocation-1" as Id<"paymentAllocation">,
  } as never);
  vi.mocked(recordOperationalEventWithCtx).mockResolvedValue({
    _id: "event-1" as Id<"operationalEvent">,
  } as never);
  vi.mocked(recordRegisterSessionTraceBestEffort).mockResolvedValue({
    traceCreated: true,
    traceId: "register_session:register-session-1",
  } as never);
  vi.mocked(createApprovalRequesterChallengeWithCtx).mockResolvedValue({
    kind: "ok",
    data: {
      requesterBinding: {
        kind: "operational_staff_challenge",
        challengeId: "requester-challenge-1",
        requestedByStaffProfileId: "cashier-1",
      },
    },
  } as never);
});

describe("adjustTransactionItems", () => {
  it("requires approval for the full payload before writing effects", async () => {
    const { ctx, tables } = createFakeCtx();

    const result = await adjustTransactionItems(ctx as never, {
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
      payload: basePayload(),
      reason: "Customer was charged for two instead of one",
      transactionId: "txn-1" as Id<"posTransaction">,
    });

    expect(result).toMatchObject({
      action: "approval_required",
      approval: {
        action: {
          key: "pos.transaction.adjust_items",
        },
        requiredRole: "manager",
        resolutionModes: [
          {
            kind: "inline_manager_proof",
          },
          {
            kind: "async_request",
            requestType: "pos_item_adjustment",
            approvalRequestId: "approvalRequest-1",
          },
        ],
        subject: {
          type: "pos_transaction_item_adjustment",
        },
        requesterBinding: {
          kind: "operational_staff_challenge",
          challengeId: "requester-challenge-1",
          requestedByStaffProfileId: "cashier-1",
        },
      },
      transactionId: "txn-1",
    });
    expect(tables.approvalRequest.get("approvalRequest-1")).toMatchObject({
      requestType: "pos_item_adjustment",
      requestedByStaffProfileId: "cashier-1",
      status: "pending",
      storeId: "store-1",
      subjectType: "pos_transaction_item_adjustment",
      metadata: expect.objectContaining({
        actionKey: "pos.transaction.adjust_items",
        payloadFingerprint: expect.any(String),
        transactionId: "txn-1",
      }),
    });
    expect(createApprovalRequesterChallengeWithCtx).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        actionKey: "pos.transaction.adjust_items",
        requestedByStaffProfileId: "cashier-1",
        requiredRole: "manager",
        storeId: "store-1",
        subject: expect.objectContaining({
          type: "pos_transaction_item_adjustment",
        }),
      }),
    );
    expect(tables.posTransactionAdjustment.size).toBe(0);
    expect(tables.posTransactionAdjustmentLine.size).toBe(0);
    expect(recordInventoryMovementWithCtx).not.toHaveBeenCalled();
    expect(recordPaymentAllocationWithCtx).not.toHaveBeenCalled();
    expect(recordOperationalEventWithCtx).not.toHaveBeenCalled();
    expect(recordRegisterSessionTraceBestEffort).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        actorStaffProfileId: "cashier-1",
        amount: 500,
        approvalRequestId: "approvalRequest-1",
        settlementDirection: "refund",
        settlementMethod: "cash",
        stage: "item_adjustment_approval_pending",
        transactionId: "txn-1",
        transactionNumber: "POS-111111",
      }),
    );
  });

  it("rejects cash refunds that would make expected cash negative before creating approval requests", async () => {
    const { ctx, tables } = createFakeCtx();
    tables.registerSession.set("register-session-1", {
      ...(tables.registerSession.get("register-session-1") ?? {}),
      expectedCash: 400,
    });

    await expect(
      adjustTransactionItems(ctx as never, {
        actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
        payload: basePayload(),
        reason: "Customer was charged for two instead of one",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).rejects.toThrow("Register session expected cash cannot be negative.");

    expect(tables.approvalRequest.size).toBe(0);
    expect(tables.posTransactionAdjustment.size).toBe(0);
    expect(recordInventoryMovementWithCtx).not.toHaveBeenCalled();
    expect(recordPaymentAllocationWithCtx).not.toHaveBeenCalled();
    expect(recordOperationalEventWithCtx).not.toHaveBeenCalled();
    expect(recordRegisterSessionTraceBestEffort).not.toHaveBeenCalled();
  });

  it("applies a matching refund adjustment once without mutating original transaction rows", async () => {
    const { ctx, tables } = createFakeCtx();
    const first = await adjustTransactionItems(ctx as never, {
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
      payload: basePayload(),
      reason: "Customer was charged for two instead of one",
      transactionId: "txn-1" as Id<"posTransaction">,
    });
    const approvalRequestId =
      "action" in first && first.action === "approval_required"
        ? (first.approval.resolutionModes[1] as unknown as { approvalRequestId: Id<"approvalRequest"> })
            .approvalRequestId
        : undefined;
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      },
    } as never);

    const result = await adjustTransactionItems(ctx as never, {
      actorStaffProfileId: "cashier-2" as Id<"staffProfile">,
      approvalProofId: "proof-1" as Id<"approvalProof">,
      approvalRequestId,
      payload: basePayload(),
      reason: "Customer was charged for two instead of one",
      transactionId: "txn-1" as Id<"posTransaction">,
    });

    expect(consumeCommandApprovalProofWithCtx).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        action: expect.objectContaining({
          key: "pos.transaction.adjust_items",
        }),
        approvalProofId: "proof-1",
        requestedByStaffProfileId: "cashier-1",
        requiredRole: "manager",
        storeId: "store-1",
        subject: expect.objectContaining({
          type: "pos_transaction_item_adjustment",
        }),
      }),
    );
    expect(recordInventoryMovementWithCtx).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        movementType: "pos_item_adjustment",
        posTransactionId: "txn-1",
        productSkuId: "sku-1",
        quantityDelta: 1,
        sourceType: "pos_transaction_item_adjustment",
      }),
    );
    expect(recordPaymentAllocationWithCtx).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        allocationType: "pos_item_adjustment",
        amount: 500,
        direction: "out",
        method: "cash",
        posTransactionId: "txn-1",
        targetType: "pos_transaction_adjustment",
      }),
    );
    expect(recordOperationalEventWithCtx).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        eventType: "pos_transaction_item_adjustment_applied",
        metadata: expect.objectContaining({
          decisionApprovalProofId: "proof-1",
          decisionApprovedByStaffProfileId: "manager-1",
          lineItems: [
            expect.objectContaining({
              adjustedQuantity: 1,
              originalQuantity: 2,
              productSku: "SKU-1",
              quantityDelta: -1,
            }),
          ],
          transactionNumber: "POS-111111",
        }),
      }),
    );
    expect(recordRegisterSessionTraceBestEffort).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        amount: 500,
        approvalRequestId,
        settlementDirection: "refund",
        settlementMethod: "cash",
        stage: "item_adjustment_approval_pending",
        transactionId: "txn-1",
        transactionNumber: "POS-111111",
      }),
    );
    expect(recordRegisterSessionTraceBestEffort).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        adjustmentId: "posTransactionAdjustment-1",
        amount: 500,
        approvalRequestId,
        registerSessionExpectedCashDelta: -500,
        settlementDirection: "refund",
        settlementMethod: "cash",
        stage: "item_adjustment_applied",
        transactionId: "txn-1",
        transactionNumber: "POS-111111",
      }),
    );
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 11,
      quantityAvailable: 11,
    });
    expect(ctx.db.patch).not.toHaveBeenCalledWith(
      "posTransaction",
      expect.anything(),
      expect.anything(),
    );
    expect(ctx.db.patch).not.toHaveBeenCalledWith(
      "posTransactionItem",
      expect.anything(),
      expect.anything(),
    );
    expect(result).toMatchObject({
      adjustmentId: "posTransactionAdjustment-1",
      approvalProofId: "proof-1",
      approvalRequestId,
      decisionApprovalProofId: "proof-1",
      decisionApprovedByStaffProfileId: "manager-1",
      paymentAllocationId: "allocation-1",
      settlementDirection: "refund",
      transactionId: "txn-1",
    });
  });

  it("keeps no-requester pending adjustment approvals unbound on proof retry", async () => {
    const { ctx } = createFakeCtx();
    const first = await adjustTransactionItems(ctx as never, {
      payload: basePayload(),
      reason: "Customer was charged for two instead of one",
      transactionId: "txn-1" as Id<"posTransaction">,
    });
    const approvalRequestId =
      "action" in first && first.action === "approval_required"
        ? (first.approval.resolutionModes[1] as { approvalRequestId?: Id<"approvalRequest"> })
            .approvalRequestId
        : undefined;
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      },
    } as never);

    await adjustTransactionItems(ctx as never, {
      actorStaffProfileId: "cashier-2" as Id<"staffProfile">,
      approvalProofId: "proof-1" as Id<"approvalProof">,
      approvalRequestId,
      payload: basePayload(),
      reason: "Customer was charged for two instead of one",
      transactionId: "txn-1" as Id<"posTransaction">,
    });

    expect(first).toMatchObject({
      action: "approval_required",
      approval: expect.not.objectContaining({
        requesterBinding: expect.anything(),
      }),
    });
    expect(consumeCommandApprovalProofWithCtx).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        action: expect.objectContaining({
          key: "pos.transaction.adjust_items",
        }),
        approvalProofId: "proof-1",
        requestedByStaffProfileId: undefined,
        requiredRole: "manager",
        storeId: "store-1",
      }),
    );
  });

  it("records collection allocations for higher corrected totals", async () => {
    const { ctx } = createFakeCtx();
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      },
    } as never);

    await adjustTransactionItems(ctx as never, {
      approvalProofId: "proof-1" as Id<"approvalProof">,
      payload: basePayload({
        correctedTotal: 1500,
        lines: [
          {
            adjustedQuantity: 3,
            inventoryDelta: -1,
            originalQuantity: 2,
            originalTransactionItemId: "item-1" as Id<"posTransactionItem">,
            productId: "product-1" as Id<"product">,
            productName: "Closure Wig",
            productSku: "SKU-1",
            productSkuId: "sku-1" as Id<"productSku">,
            unitPrice: 500,
          },
        ],
        settlementAmount: 500,
        settlementDirection: "collect",
        settlementMethod: "cash",
      }),
      reason: "One item was missed",
      transactionId: "txn-1" as Id<"posTransaction">,
    });

    expect(recordPaymentAllocationWithCtx).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        amount: 500,
        direction: "in",
        method: "cash",
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith("registerSession", "register-session-1", {
      expectedCash: 1500,
      variance: -300,
    });
  });

  it("rejects cash settlements against closed register sessions before writing effects", async () => {
    const { ctx, tables } = createFakeCtx();
    tables.registerSession.set("register-session-1", {
      ...(tables.registerSession.get("register-session-1") ?? {}),
      status: "closed",
    });
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      },
    } as never);

    await expect(
      adjustTransactionItems(ctx as never, {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        payload: basePayload(),
        reason: "Customer was charged for two instead of one",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).rejects.toThrow(
      "Register closeout is under review. Reopen the register before updating adjustment settlement.",
    );

    expect(tables.posTransactionAdjustment.size).toBe(0);
    expect(recordInventoryMovementWithCtx).not.toHaveBeenCalled();
    expect(recordPaymentAllocationWithCtx).not.toHaveBeenCalled();
  });

  it("returns an existing pending approval for idempotent approval requests", async () => {
    const { ctx, tables } = createFakeCtx();

    const first = await adjustTransactionItems(ctx as never, {
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
      payload: basePayload(),
      reason: "Customer was charged for two instead of one",
      transactionId: "txn-1" as Id<"posTransaction">,
    });
    const second = await adjustTransactionItems(ctx as never, {
      actorStaffProfileId: "cashier-2" as Id<"staffProfile">,
      payload: basePayload(),
      reason: "Customer was charged for two instead of one",
      transactionId: "txn-1" as Id<"posTransaction">,
    });

    const firstApprovalRequestId =
      "action" in first && first.action === "approval_required"
        ? (first.approval.resolutionModes[1] as { approvalRequestId?: Id<"approvalRequest"> })
            .approvalRequestId
        : undefined;
    const secondApprovalRequestId =
      "action" in second && second.action === "approval_required"
        ? (second.approval.resolutionModes[1] as { approvalRequestId?: Id<"approvalRequest"> })
            .approvalRequestId
        : undefined;

    expect(firstApprovalRequestId).toBe("approvalRequest-1");
    expect(secondApprovalRequestId).toBe(firstApprovalRequestId);
    expect(second).toMatchObject({
      action: "approval_required",
      approval: {
        requesterBinding: {
          kind: "operational_staff_challenge",
          requestedByStaffProfileId: "cashier-1",
        },
      },
    });
    expect(createApprovalRequesterChallengeWithCtx).toHaveBeenLastCalledWith(
      ctx as never,
      expect.objectContaining({
        actionKey: "pos.transaction.adjust_items",
        requestedByStaffProfileId: "cashier-1",
        requiredRole: "manager",
        storeId: "store-1",
      }),
    );
    expect(tables.approvalRequest.size).toBe(1);
  });

  it("marks pending adjustment rows rejected when an async approval is rejected", async () => {
    const { ctx, tables } = createFakeCtx();
    tables.approvalRequest.set("approval-1", {
      _id: "approval-1",
      metadata: {
        payloadFingerprint: "pending-fingerprint",
        transactionId: "txn-1",
      },
      requestType: "pos_item_adjustment",
      status: "pending",
      storeId: "store-1",
      subjectId: "pos_transaction_item_adjustment:txn-1:pending-fingerprint",
      subjectType: "pos_transaction_item_adjustment",
    });
    tables.posTransactionAdjustment.set("adjustment-1", {
      _id: "adjustment-1",
      approvalRequestId: "approval-1",
      payloadFingerprint: "pending-fingerprint",
      status: "pending_approval",
      storeId: "store-1",
      transactionId: "txn-1",
    });

    await resolveTransactionItemAdjustmentApprovalDecisionWithCtx(ctx as never, {
      approvalRequestId: "approval-1" as Id<"approvalRequest">,
      decision: "rejected",
      decisionApprovalProofId: "decision-proof-1" as Id<"approvalProof">,
      decisionApprovedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      decisionNotes: "Not enough evidence",
      reviewedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      reviewedByUserId: "manager-user-1" as Id<"athenaUser">,
    });

    expect(tables.posTransactionAdjustment.get("adjustment-1")).toMatchObject({
      decidedAt: expect.any(Number),
      decisionApprovalProofId: "decision-proof-1",
      decisionApprovedByStaffProfileId: "manager-1",
      status: "rejected",
      updatedAt: expect.any(Number),
    });
    expect(recordOperationalEventWithCtx).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        eventType: "pos_transaction_item_adjustment_approval_rejected",
      }),
    );

    tables.approvalRequest.set("approval-1", {
      ...(tables.approvalRequest.get("approval-1") ?? {}),
      status: "rejected",
    });

    const next = await adjustTransactionItems(ctx as never, {
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
      payload: basePayload(),
      reason: "Try another adjustment after rejection",
      transactionId: "txn-1" as Id<"posTransaction">,
    });

    expect(next).toMatchObject({ action: "approval_required" });
  });

  it("does not block new submissions on pending adjustment rows whose approval was rejected", async () => {
    const { ctx, tables } = createFakeCtx();
    tables.approvalRequest.set("approval-1", {
      _id: "approval-1",
      decidedAt: 123,
      metadata: {
        payloadFingerprint: "rejected-fingerprint",
        transactionId: "txn-1",
      },
      requestType: "pos_item_adjustment",
      status: "rejected",
      storeId: "store-1",
      subjectId: "pos_transaction_item_adjustment:txn-1:rejected-fingerprint",
      subjectType: "pos_transaction_item_adjustment",
    });
    tables.posTransactionAdjustment.set("adjustment-1", {
      _id: "adjustment-1",
      approvalRequestId: "approval-1",
      payloadFingerprint: "rejected-fingerprint",
      status: "pending_approval",
      storeId: "store-1",
      transactionId: "txn-1",
    });

    const result = await adjustTransactionItems(ctx as never, {
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
      payload: basePayload(),
      reason: "Try another adjustment after rejection",
      transactionId: "txn-1" as Id<"posTransaction">,
    });

    expect(result).toMatchObject({ action: "approval_required" });
    expect(tables.posTransactionAdjustment.get("adjustment-1")).toMatchObject({
      decidedAt: 123,
      status: "rejected",
      updatedAt: expect.any(Number),
    });
    expect(tables.approvalRequest.size).toBe(2);
  });

  it("skips payment allocation when corrected total is unchanged", async () => {
    const { ctx } = createFakeCtx();
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      },
    } as never);

    await adjustTransactionItems(ctx as never, {
      approvalProofId: "proof-1" as Id<"approvalProof">,
      payload: basePayload({
        correctedTotal: 1000,
        lines: [
          {
            adjustedQuantity: 0,
            inventoryDelta: 2,
            originalQuantity: 2,
            originalTransactionItemId: "item-1" as Id<"posTransactionItem">,
            productId: "product-1" as Id<"product">,
            productName: "Closure Wig",
            productSku: "SKU-1",
            productSkuId: "sku-1" as Id<"productSku">,
            unitPrice: 500,
          },
          {
            adjustedQuantity: 2,
            inventoryDelta: -2,
            originalQuantity: 0,
            productId: "product-2" as Id<"product">,
            productName: "Body Wave",
            productSku: "SKU-2",
            productSkuId: "sku-2" as Id<"productSku">,
            unitPrice: 500,
          },
        ],
        settlementAmount: 0,
        settlementDirection: "none",
        settlementMethod: undefined,
      }),
      reason: "Equal value SKU swap",
      transactionId: "txn-1" as Id<"posTransaction">,
    });

    expect(recordInventoryMovementWithCtx).toHaveBeenCalled();
    expect(recordPaymentAllocationWithCtx).not.toHaveBeenCalled();
  });

  it("does not adjust trusted inventory when a pending checkout line is reduced", async () => {
    const { ctx, tables } = createFakeCtx();
    tables.posTransactionItem.set("item-1", {
      ...tables.posTransactionItem.get("item-1")!,
      pendingCheckoutItemId: "pending-1",
    });
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      },
    } as never);

    await adjustTransactionItems(ctx as never, {
      approvalProofId: "proof-1" as Id<"approvalProof">,
      payload: basePayload(),
      reason: "Correct pending checkout quantity",
      transactionId: "txn-1" as Id<"posTransaction">,
    });

    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 10,
      quantityAvailable: 10,
    });
    expect(tables.posPendingCheckoutItem.get("pending-1")?.evidence).toMatchObject({
      totalQuantitySold: 1,
      transactionCount: 1,
    });
    expect(recordInventoryMovementWithCtx).not.toHaveBeenCalled();
    expect(recordOperationalEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "pos_pending_checkout_item_evidence_corrected",
        metadata: expect.objectContaining({
          quantityDelta: -1,
          reason: "item_adjustment",
        }),
      }),
    );
  });

  it("rejects stale approval payloads before consuming proof or writing effects", async () => {
    const { ctx, tables } = createFakeCtx();
    tables.approvalRequest.set("approval-1", {
      _id: "approval-1",
      metadata: {
        payloadFingerprint: "older-payload",
        transactionId: "txn-1",
      },
      requestType: "pos_item_adjustment",
      status: "pending",
      storeId: "store-1",
      subjectType: "pos_transaction_item_adjustment",
    });

    await expect(
      adjustTransactionItems(ctx as never, {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvalRequestId: "approval-1" as Id<"approvalRequest">,
        payload: basePayload(),
        reason: "Customer was charged for two instead of one",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).rejects.toThrow("Item adjustment approval request does not match this payload.");
    expect(consumeCommandApprovalProofWithCtx).not.toHaveBeenCalled();
    expect(recordInventoryMovementWithCtx).not.toHaveBeenCalled();
    expect(recordPaymentAllocationWithCtx).not.toHaveBeenCalled();
  });

  it("rejects forged payload totals before creating approval requests", async () => {
    const { ctx, tables } = createFakeCtx();

    await expect(
      adjustTransactionItems(ctx as never, {
        actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
        payload: basePayload({
          correctedTotal: 900,
          settlementAmount: 100,
        }),
        reason: "Customer was charged for two instead of one",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).rejects.toThrow("Item adjustment settlement does not match corrected totals.");

    expect(tables.approvalRequest.size).toBe(0);
    expect(tables.posTransactionAdjustment.size).toBe(0);
    expect(recordInventoryMovementWithCtx).not.toHaveBeenCalled();
  });

  it("rejects POS-hidden SKUs in item adjustments", async () => {
    for (const [label, productPatch, skuPatch] of [
      ["SKU POS-hidden", {}, { posVisible: false }],
      ["product POS-hidden", { posVisible: false }, {}],
      ["legacy SKU hidden", {}, { isVisible: false }],
      ["legacy product hidden", { isVisible: false }, {}],
    ] as const) {
      const { ctx, tables } = createFakeCtx();
      tables.product.set("product-2", {
        ...tables.product.get("product-2"),
        ...productPatch,
      });
      tables.productSku.set("sku-2", {
        ...tables.productSku.get("sku-2"),
        ...skuPatch,
      });

      await expect(
        adjustTransactionItems(ctx as never, {
          actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
          payload: basePayload({
            correctedTotal: 1000,
            lines: [
              {
                adjustedQuantity: 0,
                inventoryDelta: 2,
                originalQuantity: 2,
                originalTransactionItemId: "item-1" as Id<"posTransactionItem">,
                productId: "product-1" as Id<"product">,
                productName: "Closure Wig",
                productSku: "SKU-1",
                productSkuId: "sku-1" as Id<"productSku">,
                unitPrice: 500,
              },
              {
                adjustedQuantity: 2,
                inventoryDelta: -2,
                originalQuantity: 0,
                productId: "product-2" as Id<"product">,
                productName: "Body Wave",
                productSku: "SKU-2",
                productSkuId: "sku-2" as Id<"productSku">,
                unitPrice: 500,
              },
            ],
            settlementAmount: 0,
            settlementDirection: "none",
            settlementMethod: undefined,
          }),
          reason: `Equal value swap with ${label}`,
          transactionId: "txn-1" as Id<"posTransaction">,
        }),
      ).rejects.toThrow(
        "The added SKU is not active for this store. Choose a live SKU before submitting the adjustment.",
      );

      expect(tables.approvalRequest.size).toBe(0);
      expect(recordInventoryMovementWithCtx).not.toHaveBeenCalled();
    }
  });

  it("rejects mismatched proofs before side effects", async () => {
    const { ctx } = createFakeCtx();
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Approval proof does not match this command.",
      },
    } as never);

    await expect(
      adjustTransactionItems(ctx as never, {
        approvalProofId: "proof-other-payload" as Id<"approvalProof">,
        payload: basePayload(),
        reason: "Customer was charged for two instead of one",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).rejects.toThrow("Approval proof does not match this command.");
    expect(recordInventoryMovementWithCtx).not.toHaveBeenCalled();
    expect(recordPaymentAllocationWithCtx).not.toHaveBeenCalled();
    expect(recordOperationalEventWithCtx).not.toHaveBeenCalled();
  });

  it("returns the existing applied result on idempotent retry", async () => {
    const { ctx } = createFakeCtx();
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      },
    } as never);
    const args = {
      approvalProofId: "proof-1" as Id<"approvalProof">,
      payload: basePayload(),
      reason: "Customer was charged for two instead of one",
      transactionId: "txn-1" as Id<"posTransaction">,
    };

    const first = await adjustTransactionItems(ctx as never, args);
    const second = await adjustTransactionItems(ctx as never, args);

    expect(first).toMatchObject({
      adjustmentId: "posTransactionAdjustment-1",
      paymentAllocationId: "allocation-1",
    });
    expect(second).toMatchObject({
      adjustmentId: "posTransactionAdjustment-1",
      paymentAllocationId: "allocation-1",
    });
    expect(consumeCommandApprovalProofWithCtx).toHaveBeenCalledTimes(1);
    expect(recordInventoryMovementWithCtx).toHaveBeenCalledTimes(1);
    expect(recordPaymentAllocationWithCtx).toHaveBeenCalledTimes(1);
  });

  it("blocks a second different item adjustment after one has been applied", async () => {
    const { ctx } = createFakeCtx();
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      },
    } as never);

    await adjustTransactionItems(ctx as never, {
      approvalProofId: "proof-1" as Id<"approvalProof">,
      payload: basePayload(),
      reason: "Customer was charged for two instead of one",
      transactionId: "txn-1" as Id<"posTransaction">,
    });

    await expect(
      adjustTransactionItems(ctx as never, {
        approvalProofId: "proof-2" as Id<"approvalProof">,
        payload: basePayload({
          correctedTotal: 0,
          lines: [
            {
              adjustedQuantity: 0,
              inventoryDelta: 2,
              originalQuantity: 2,
              originalTransactionItemId: "item-1" as Id<"posTransactionItem">,
              productId: "product-1" as Id<"product">,
              productName: "Closure Wig",
              productSku: "SKU-1",
              productSkuId: "sku-1" as Id<"productSku">,
              unitPrice: 500,
            },
          ],
          settlementAmount: 1000,
        }),
        reason: "Customer returned the remaining unit",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).rejects.toThrow(
      "This transaction already has an item adjustment applied.",
    );

    expect(recordInventoryMovementWithCtx).toHaveBeenCalledTimes(1);
    expect(recordPaymentAllocationWithCtx).toHaveBeenCalledTimes(1);
  });

  it("applies approved async item adjustment requests", async () => {
    const { ctx, tables } = createFakeCtx();
    const first = await adjustTransactionItems(ctx as never, {
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
      actorUserId: "user-1" as Id<"athenaUser">,
      payload: basePayload(),
      reason: "Customer was charged for two instead of one",
      transactionId: "txn-1" as Id<"posTransaction">,
    });
    const approvalRequestId =
      "action" in first && first.action === "approval_required"
        ? (first.approval.resolutionModes[1] as { approvalRequestId?: Id<"approvalRequest"> })
            .approvalRequestId
        : undefined;

    const result = await resolveTransactionItemAdjustmentApprovalDecisionWithCtx(
      ctx as never,
      {
        approvalRequestId: approvalRequestId as Id<"approvalRequest">,
        decision: "approved",
        reviewedByStaffProfileId: "manager-1" as Id<"staffProfile">,
        reviewedByUserId: "manager-user-1" as Id<"athenaUser">,
      },
    );

    expect(result).toMatchObject({
      adjustmentId: "posTransactionAdjustment-1",
      approvalRequestId,
      approverStaffProfileId: "manager-1",
      transactionId: "txn-1",
    });
    expect(tables.posTransactionAdjustment.size).toBe(1);
    expect(recordInventoryMovementWithCtx).toHaveBeenCalled();
  });

  it("records rejected async item adjustment requests without applying effects", async () => {
    const { ctx } = createFakeCtx();
    const first = await adjustTransactionItems(ctx as never, {
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
      payload: basePayload(),
      reason: "Customer was charged for two instead of one",
      transactionId: "txn-1" as Id<"posTransaction">,
    });
    const approvalRequestId =
      "action" in first && first.action === "approval_required"
        ? (first.approval.resolutionModes[1] as { approvalRequestId?: Id<"approvalRequest"> })
            .approvalRequestId
        : undefined;

    await expect(
      resolveTransactionItemAdjustmentApprovalDecisionWithCtx(ctx as never, {
        approvalRequestId: approvalRequestId as Id<"approvalRequest">,
        decision: "rejected",
        decisionApprovalProofId: "decision-proof-1" as Id<"approvalProof">,
        decisionApprovedByStaffProfileId: "manager-1" as Id<"staffProfile">,
        decisionNotes: "Not supported by receipt.",
        reviewedByStaffProfileId: "manager-1" as Id<"staffProfile">,
        reviewedByUserId: "manager-user-1" as Id<"athenaUser">,
      }),
    ).resolves.toBeNull();

    expect(recordOperationalEventWithCtx).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        approvalRequestId,
        eventType: "pos_transaction_item_adjustment_approval_rejected",
        metadata: expect.objectContaining({
          decisionApprovalProofId: "decision-proof-1",
          decisionApprovedByStaffProfileId: "manager-1",
        }),
      }),
    );
    expect(recordInventoryMovementWithCtx).not.toHaveBeenCalled();
    expect(recordPaymentAllocationWithCtx).not.toHaveBeenCalled();
  });

  it("rejects async approvals when the saved subject no longer matches the payload", async () => {
    const { ctx, tables } = createFakeCtx();
    const first = await adjustTransactionItems(ctx as never, {
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
      payload: basePayload(),
      reason: "Customer was charged for two instead of one",
      transactionId: "txn-1" as Id<"posTransaction">,
    });
    const approvalRequestId =
      "action" in first && first.action === "approval_required"
        ? (first.approval.resolutionModes[1] as { approvalRequestId?: Id<"approvalRequest"> })
            .approvalRequestId
        : undefined;
    tables.approvalRequest.set(approvalRequestId as string, {
      ...(tables.approvalRequest.get(approvalRequestId as string) ?? {}),
      subjectId: "pos_transaction_item_adjustment:txn-1:stale",
    });

    await expect(
      resolveTransactionItemAdjustmentApprovalDecisionWithCtx(ctx as never, {
        approvalRequestId: approvalRequestId as Id<"approvalRequest">,
        decision: "approved",
        reviewedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      }),
    ).rejects.toThrow("Item adjustment approval request does not match this payload.");

    expect(recordInventoryMovementWithCtx).not.toHaveBeenCalled();
    expect(recordPaymentAllocationWithCtx).not.toHaveBeenCalled();
  });
});
