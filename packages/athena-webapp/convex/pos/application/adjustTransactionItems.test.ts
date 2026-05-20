import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import {
  adjustTransactionItems,
  resolveTransactionItemAdjustmentApprovalDecisionWithCtx,
  type TransactionItemAdjustmentPayload,
} from "./commands/adjustTransactionItems";
import { consumeCommandApprovalProofWithCtx } from "../../operations/approvalActions";
import { recordInventoryMovementWithCtx } from "../../operations/inventoryMovements";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import { recordPaymentAllocationWithCtx } from "../../operations/paymentAllocations";
import {
  getPosTransactionById,
  getStoreById,
  listTransactionItems,
} from "../infrastructure/repositories/transactionRepository";

vi.mock("../../operations/approvalActions", () => ({
  APPROVAL_ACTIONS: {
    transactionItemAdjustment: {
      key: "pos.transaction.adjust_items",
      label: "Adjust transaction items",
    },
  },
  consumeCommandApprovalProofWithCtx: vi.fn(),
}));

vi.mock("../../operations/inventoryMovements", () => ({
  recordInventoryMovementWithCtx: vi.fn(),
}));

vi.mock("../../operations/operationalEvents", () => ({
  recordOperationalEventWithCtx: vi.fn(),
}));

vi.mock("../../operations/paymentAllocations", () => ({
  recordPaymentAllocationWithCtx: vi.fn(),
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
          storeId: "store-1",
          status: "active",
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
    expect(tables.posTransactionAdjustment.size).toBe(0);
    expect(tables.posTransactionAdjustmentLine.size).toBe(0);
    expect(recordInventoryMovementWithCtx).not.toHaveBeenCalled();
    expect(recordPaymentAllocationWithCtx).not.toHaveBeenCalled();
    expect(recordOperationalEventWithCtx).not.toHaveBeenCalled();
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
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
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
          lineItems: [
            expect.objectContaining({
              adjustedQuantity: 1,
              originalQuantity: 2,
              productSku: "SKU-1",
              quantityDelta: -1,
            }),
          ],
        }),
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
      paymentAllocationId: "allocation-1",
      settlementDirection: "refund",
      transactionId: "txn-1",
    });
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
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
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
    expect(tables.approvalRequest.size).toBe(1);
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
