import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import type { ApprovalRequirement } from "../../../../shared/approvalPolicy";
import { buildApprovalRequest } from "../../../operations/approvalRequestHelpers";
import {
  APPROVAL_ACTIONS,
  consumeCommandApprovalProofWithCtx,
} from "../../../operations/approvalActions";
import { recordInventoryMovementWithCtx } from "../../../operations/inventoryMovements";
import { recordOperationalEventWithCtx } from "../../../operations/operationalEvents";
import { recordPaymentAllocationWithCtx } from "../../../operations/paymentAllocations";
import { markCatalogSummaryNeedsRefresh } from "../../../inventory/catalogSummary";
import {
  recordRegisterSessionTraceBestEffort,
  type RegisterSessionTraceableSession,
  type RegisterSessionTraceStage,
} from "../../../operations/registerSessionTracing";
import {
  createTransactionAdjustmentForTransaction,
  getActiveTransactionAdjustment,
  getProductSkuById,
  getPosTransactionById,
  getStoreById,
  listTransactionItems,
} from "../../infrastructure/repositories/transactionRepository";
import type {
  TransactionAdjustmentCorrectedLine,
  TransactionAdjustmentPlan,
  TransactionAdjustmentSettlementDirection,
} from "./transactionAdjustmentPlanner";
import { planTransactionAdjustment } from "./transactionAdjustmentPlanner";
import { recordPendingCheckoutItemEvidenceCorrection } from "./createOrReusePendingCheckoutItem";

const ITEM_ADJUSTMENT_ACTION = APPROVAL_ACTIONS.transactionItemAdjustment;
const ITEM_ADJUSTMENT_ACTION_KEY = ITEM_ADJUSTMENT_ACTION.key;
export const ITEM_ADJUSTMENT_REQUEST_TYPE = "pos_item_adjustment";
const ITEM_ADJUSTMENT_SUBJECT_TYPE = "pos_transaction_item_adjustment";

type AdjustmentActor = {
  actorUserId?: Id<"athenaUser">;
  actorStaffProfileId?: Id<"staffProfile">;
};

export type TransactionItemAdjustmentLinePayload = {
  adjustedQuantity: number;
  inventoryDelta: number;
  originalQuantity: number;
  originalTransactionItemId?: Id<"posTransactionItem">;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  productId: Id<"product">;
  productName: string;
  productSku: string;
  productSkuId: Id<"productSku">;
  unitPrice: number;
};

export type TransactionItemAdjustmentPayload = {
  correctedTotal: number;
  lines: TransactionItemAdjustmentLinePayload[];
  originalTotal: number;
  settlementAmount: number;
  settlementDirection: TransactionAdjustmentSettlementDirection;
  settlementMethod?: string;
};

type AdjustmentPlan = {
  correctedSubtotal: number;
  correctedTax: number;
  correctedTotal: number;
  deltaTotal: number;
  fingerprint: string;
  lines: TransactionAdjustmentCorrectedLine[];
  originalSubtotal: number;
  originalTax: number;
  originalTotal: number;
  payloadSubject: string;
  settlementAmount: number;
  settlementDirection: TransactionAdjustmentSettlementDirection;
  settlementMethod?: string;
};

type AppliedAdjustmentResult = {
  adjustmentId: Id<"posTransactionAdjustment">;
  approvalProofId?: Id<"approvalProof">;
  approvalRequestId?: Id<"approvalRequest">;
  approverStaffProfileId?: Id<"staffProfile">;
  inventoryMovementIds: Array<Id<"inventoryMovement">>;
  lineIds: Array<Id<"posTransactionAdjustmentLine">>;
  operationalEventId?: Id<"operationalEvent">;
  paymentAllocationId?: Id<"paymentAllocation">;
  decisionApprovalProofId?: Id<"approvalProof">;
  decisionApprovedByStaffProfileId?: Id<"staffProfile">;
  payloadFingerprint: string;
  settlementAmount: number;
  settlementDirection: TransactionAdjustmentSettlementDirection;
  transactionId: Id<"posTransaction">;
};

function roundAmount(amount: number) {
  return Number(amount.toFixed(2));
}

function transactionLabel(transaction: { transactionNumber: string }) {
  return `Transaction #${transaction.transactionNumber}`;
}

function assertPayloadMatchesPlan(args: {
  payload: TransactionItemAdjustmentPayload;
  plan: TransactionAdjustmentPlan;
}) {
  if (roundAmount(args.payload.originalTotal) !== args.plan.originalTotals.total) {
    throw new Error("Item adjustment payload is stale for this transaction.");
  }

  if (
    roundAmount(args.payload.correctedTotal) !== args.plan.correctedTotals.total ||
    args.payload.settlementDirection !== args.plan.settlement.direction ||
    roundAmount(args.payload.settlementAmount) !== args.plan.settlement.amount
  ) {
    throw new Error("Item adjustment settlement does not match corrected totals.");
  }
}

async function reconcileStalePendingAdjustment(
  ctx: MutationCtx,
  activeAdjustment: Awaited<ReturnType<typeof getActiveTransactionAdjustment>>,
) {
  if (!activeAdjustment?.approvalRequestId) {
    return activeAdjustment;
  }

  const approvalRequest = await ctx.db.get(
    "approvalRequest",
    activeAdjustment.approvalRequestId,
  );
  if (!approvalRequest || approvalRequest.status === "pending") {
    return activeAdjustment;
  }

  const status =
    approvalRequest.status === "rejected" || approvalRequest.status === "cancelled"
      ? approvalRequest.status
      : "stale";
  const now = Date.now();
  await (ctx.db as any).patch("posTransactionAdjustment", activeAdjustment._id, {
    decidedAt: activeAdjustment.decidedAt ?? approvalRequest.decidedAt ?? now,
    status,
    updatedAt: now,
  });

  return null;
}

async function buildServerAdjustmentPlan(
  ctx: MutationCtx,
  args: {
    payload: TransactionItemAdjustmentPayload;
    transaction: Awaited<ReturnType<typeof requireCompletedTransaction>>;
  },
): Promise<AdjustmentPlan> {
  if (args.payload.lines.length === 0) {
    throw new Error("Item adjustment must include at least one changed line.");
  }

  const originalItems = await listTransactionItems(ctx, args.transaction._id);
  const addedProductSkuIds = Array.from(
    new Set(
      args.payload.lines
        .filter((line) => !line.originalTransactionItemId)
        .map((line) => line.productSkuId),
    ),
  );
  const skuSnapshots = await Promise.all(
    addedProductSkuIds.map(async (productSkuId) => {
      const sku = await getProductSkuById(ctx, productSkuId);
      if (!sku) {
        return null;
      }

      const product = await ctx.db.get("product", sku.productId);

      return {
        ...sku,
        productAvailability: product?.availability,
        productIsVisible: product?.isVisible,
      };
    }),
  );
  const activeAdjustment = await getActiveTransactionAdjustment(ctx, {
    storeId: args.transaction.storeId,
    transactionId: args.transaction._id,
  });
  const effectiveActiveAdjustment = await reconcileStalePendingAdjustment(
    ctx,
    activeAdjustment,
  );
  const planned = planTransactionAdjustment({
    activeAdjustment: effectiveActiveAdjustment,
    draft: {
      existingLines: args.payload.lines.flatMap((line) =>
        line.originalTransactionItemId
          ? [
              {
                correctedQuantity: line.adjustedQuantity,
                transactionItemId: line.originalTransactionItemId,
              },
            ]
          : [],
      ),
      addedLines: args.payload.lines.flatMap((line) =>
        line.originalTransactionItemId
          ? []
          : [
              {
                productSkuId: line.productSkuId,
                quantity: line.adjustedQuantity,
              },
            ],
      ),
    },
    originalItems,
    skuSnapshots: skuSnapshots.filter(Boolean) as NonNullable<
      (typeof skuSnapshots)[number]
    >[],
    transaction: args.transaction,
  });

  if (planned.kind !== "ok") {
    throw new Error(planned.error.message);
  }

  assertPayloadMatchesPlan({
    payload: args.payload,
    plan: planned.data,
  });

  if (planned.data.settlement.direction !== "none" && !args.payload.settlementMethod?.trim()) {
    throw new Error("Settlement method is required for item adjustments.");
  }

  return {
    correctedSubtotal: planned.data.correctedTotals.subtotal,
    correctedTax: planned.data.correctedTotals.tax,
    correctedTotal: planned.data.correctedTotals.total,
    deltaTotal: planned.data.deltaTotal,
    fingerprint: planned.data.payloadFingerprint,
    lines: planned.data.correctedLines,
    originalSubtotal: planned.data.originalTotals.subtotal,
    originalTax: planned.data.originalTotals.tax,
    originalTotal: planned.data.originalTotals.total,
    payloadSubject: planned.data.payloadSubject,
    settlementAmount: planned.data.settlement.amount,
    settlementDirection: planned.data.settlement.direction,
    settlementMethod: args.payload.settlementMethod?.trim() || undefined,
  };
}

function buildAdjustmentApprovalRequirement(args: {
  approvalRequestId?: Id<"approvalRequest">;
  plan: AdjustmentPlan;
  transaction: {
    _id: Id<"posTransaction">;
    transactionNumber: string;
  };
}): ApprovalRequirement {
  return {
    action: ITEM_ADJUSTMENT_ACTION,
    reason:
      "Manager approval is required to adjust items on a completed transaction.",
    requiredRole: "manager",
    selfApproval: "allowed",
    subject: {
      id: args.plan.payloadSubject,
      label: `${transactionLabel(args.transaction)} item adjustment`,
      type: ITEM_ADJUSTMENT_SUBJECT_TYPE,
    },
    copy: {
      title: "Manager approval required",
      message:
        "A manager needs to review this completed transaction item adjustment before it is applied.",
      primaryActionLabel: "Request approval",
      secondaryActionLabel: "Got it",
    },
    resolutionModes: [
      { kind: "inline_manager_proof" },
      {
        kind: "async_request",
        requestType: ITEM_ADJUSTMENT_REQUEST_TYPE,
        approvalRequestId: args.approvalRequestId,
      },
    ],
    metadata: {
      correctedTotal: args.plan.correctedTotal,
      deltaTotal: args.plan.deltaTotal,
      payloadFingerprint: args.plan.fingerprint,
      settlementAmount: args.plan.settlementAmount,
      settlementDirection: args.plan.settlementDirection,
      settlementMethod: args.plan.settlementMethod,
      transactionNumber: args.transaction.transactionNumber,
    },
  };
}

async function requireCompletedTransaction(
  ctx: MutationCtx,
  transactionId: Id<"posTransaction">,
) {
  const transaction = await getPosTransactionById(ctx, transactionId);

  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  if (transaction.status !== "completed") {
    throw new Error("Only completed transactions can be adjusted.");
  }

  return transaction;
}

async function findAppliedAdjustmentByFingerprint(
  ctx: MutationCtx,
  args: {
    fingerprint: string;
    payloadSubject: string;
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
  },
): Promise<AppliedAdjustmentResult | null> {
  const existing = await (ctx.db as any)
    .query("posTransactionAdjustment")
    .withIndex("by_storeId_transactionId_payloadFingerprint", (q: any) =>
      q
        .eq("storeId", args.storeId)
        .eq("transactionId", args.transactionId)
        .eq("payloadFingerprint", args.fingerprint),
    )
    .first();

  if (
    !existing ||
    existing.status !== "applied" ||
    existing.payloadSubject !== args.payloadSubject
  ) {
    return null;
  }

  const lines = await (ctx.db as any)
    .query("posTransactionAdjustmentLine")
    .withIndex("by_adjustmentId", (q: any) => q.eq("adjustmentId", existing._id))
    .collect();

  return {
    adjustmentId: existing._id,
    approvalProofId: existing.approvalProofId,
    approvalRequestId: existing.approvalRequestId,
    approverStaffProfileId: existing.approverStaffProfileId,
    inventoryMovementIds: existing.inventoryMovementIds ?? [],
    lineIds: lines.map((line: { _id: Id<"posTransactionAdjustmentLine"> }) => line._id),
    operationalEventId: existing.operationalEventId,
    paymentAllocationId: existing.paymentAllocationId,
    payloadFingerprint: existing.payloadFingerprint,
    settlementAmount: existing.settlementAmount,
    settlementDirection: existing.settlementDirection,
    transactionId: existing.transactionId,
  };
}

async function getRegisterSessionForTrace(
  ctx: MutationCtx,
  args: {
    registerSessionId?: Id<"registerSession">;
    storeId: Id<"store">;
  },
) {
  if (!args.registerSessionId) {
    return null;
  }

  const session = await ctx.db.get("registerSession", args.registerSessionId);

  if (!session || session.storeId !== args.storeId) {
    return null;
  }

  return session as RegisterSessionTraceableSession;
}

async function recordItemAdjustmentRegisterSessionTrace(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    adjustmentId?: Id<"posTransactionAdjustment">;
    approvalRequestId?: Id<"approvalRequest">;
    plan: AdjustmentPlan;
    registerSessionExpectedCashDelta?: number;
    stage: Extract<
      RegisterSessionTraceStage,
      "item_adjustment_approval_pending" | "item_adjustment_applied"
    >;
    transaction: {
      _id: Id<"posTransaction">;
      registerSessionId?: Id<"registerSession">;
      storeId: Id<"store">;
      transactionNumber: string;
    };
  },
) {
  const session = await getRegisterSessionForTrace(ctx, {
    registerSessionId: args.transaction.registerSessionId,
    storeId: args.transaction.storeId,
  });

  if (!session) {
    return;
  }

  await recordRegisterSessionTraceBestEffort(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    adjustmentId: args.adjustmentId,
    amount: args.plan.settlementAmount,
    approvalRequestId: args.approvalRequestId,
    registerSessionExpectedCashDelta: args.registerSessionExpectedCashDelta,
    session,
    settlementDirection: args.plan.settlementDirection,
    settlementMethod: args.plan.settlementMethod,
    stage: args.stage,
    transactionId: args.transaction._id,
    transactionNumber: args.transaction.transactionNumber,
  });
}

async function createApprovalRequestForAdjustment(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    plan: AdjustmentPlan;
    reason?: string;
    transaction: {
      _id: Id<"posTransaction">;
      registerSessionId?: Id<"registerSession">;
      storeId: Id<"store">;
      transactionNumber: string;
    };
  },
) {
  const store = await getStoreById(ctx, args.transaction.storeId);
  const approvalRequestId = await ctx.db.insert(
    "approvalRequest",
    buildApprovalRequest({
      metadata: {
        actionKey: ITEM_ADJUSTMENT_ACTION_KEY,
        correctedTotal: args.plan.correctedTotal,
        deltaTotal: args.plan.deltaTotal,
        originalTotal: args.plan.originalTotal,
        payload: {
          correctedTotal: args.plan.correctedTotal,
          lines: args.plan.lines.map((line) => ({
            adjustedQuantity: line.correctedQuantity,
            inventoryDelta: line.inventoryDelta,
            originalQuantity: line.originalQuantity,
            originalTransactionItemId: line.originalTransactionItemId,
            productId: line.productId,
            productName: line.productName,
            productSku: line.productSku,
            productSkuId: line.productSkuId,
            pendingCheckoutItemId: line.pendingCheckoutItemId,
            unitPrice: line.unitPrice,
          })),
          originalTotal: args.plan.originalTotal,
          settlementAmount: args.plan.settlementAmount,
          settlementDirection: args.plan.settlementDirection,
          settlementMethod: args.plan.settlementMethod,
        },
        payloadFingerprint: args.plan.fingerprint,
        payloadSubject: args.plan.payloadSubject,
        settlementAmount: args.plan.settlementAmount,
        settlementDirection: args.plan.settlementDirection,
        settlementMethod: args.plan.settlementMethod,
        transactionId: args.transaction._id,
        transactionNumber: args.transaction.transactionNumber,
      },
      notes: args.reason,
      organizationId: store?.organizationId,
      posTransactionId: args.transaction._id,
      reason:
        "Manager approval is required to adjust items on a completed transaction.",
      registerSessionId: args.transaction.registerSessionId,
      requestType: ITEM_ADJUSTMENT_REQUEST_TYPE,
      requestedByStaffProfileId: args.actorStaffProfileId,
      requestedByUserId: args.actorUserId,
      storeId: args.transaction.storeId,
      subjectId: args.plan.payloadSubject,
      subjectType: ITEM_ADJUSTMENT_SUBJECT_TYPE,
    }),
  );

  await recordItemAdjustmentRegisterSessionTrace(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    approvalRequestId,
    plan: args.plan,
    stage: "item_adjustment_approval_pending",
    transaction: args.transaction,
  });

  return approvalRequestId;
}

async function findPendingItemAdjustmentApprovalRequest(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
  },
) {
  const pendingRequests = await ctx.db
    .query("approvalRequest")
    .withIndex("by_storeId_status_posTransactionId", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "pending")
        .eq("posTransactionId", args.transactionId),
    )
    .take(5);

  return pendingRequests.find(
    (request) =>
      request.requestType === ITEM_ADJUSTMENT_REQUEST_TYPE &&
      request.subjectType === ITEM_ADJUSTMENT_SUBJECT_TYPE &&
      request.metadata?.transactionId === args.transactionId,
  ) ?? null;
}

async function findAppliedAdjustmentForTransaction(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
  },
) {
  return (ctx.db as any)
    .query("posTransactionAdjustment")
    .withIndex("by_storeId_transactionId_status", (q: any) =>
      q
        .eq("storeId", args.storeId)
        .eq("transactionId", args.transactionId)
        .eq("status", "applied"),
    )
    .first();
}

async function markPendingAdjustmentDecisionForApprovalRequest(
  ctx: MutationCtx,
  args: {
    approvalRequestId: Id<"approvalRequest">;
    decisionApprovalProofId?: Id<"approvalProof">;
    decisionApprovedByStaffProfileId?: Id<"staffProfile">;
    decision: "rejected" | "cancelled";
    now: number;
  },
) {
  const pendingAdjustment = await (ctx.db as any)
    .query("posTransactionAdjustment")
    .withIndex("by_approvalRequestId", (q: any) =>
      q.eq("approvalRequestId", args.approvalRequestId),
    )
    .first();

  if (!pendingAdjustment || pendingAdjustment.status !== "pending_approval") {
    return;
  }

  await (ctx.db as any).patch("posTransactionAdjustment", pendingAdjustment._id, {
    decidedAt: args.now,
    decisionApprovalProofId: args.decisionApprovalProofId,
    decisionApprovedByStaffProfileId: args.decisionApprovedByStaffProfileId,
    status: args.decision,
    updatedAt: args.now,
  });
}

async function requireMatchingPendingItemAdjustmentApprovalRequest(
  ctx: MutationCtx,
  args: {
    approvalRequestId?: Id<"approvalRequest">;
    plan: AdjustmentPlan;
    storeId: Id<"store">;
  },
) {
  if (!args.approvalRequestId) {
    return null;
  }

  const approvalRequest = await ctx.db.get(
    "approvalRequest",
    args.approvalRequestId,
  );

  if (
    !approvalRequest ||
    approvalRequest.requestType !== ITEM_ADJUSTMENT_REQUEST_TYPE ||
    approvalRequest.subjectType !== ITEM_ADJUSTMENT_SUBJECT_TYPE
  ) {
    throw new Error("Item adjustment approval request not found.");
  }

  if (approvalRequest.status !== "pending") {
    throw new Error("Item adjustment approval request has already been decided.");
  }

  if (approvalRequest.storeId !== args.storeId) {
    throw new Error("Item adjustment approval request does not match this store.");
  }

  if (
    approvalRequest.subjectId !== args.plan.payloadSubject ||
    approvalRequest.metadata?.payloadFingerprint !== args.plan.fingerprint
  ) {
    throw new Error("Item adjustment approval request does not match this payload.");
  }

  return approvalRequest;
}

async function consumeItemAdjustmentApprovalProof(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    approvalProofId: Id<"approvalProof">;
    plan: AdjustmentPlan;
    storeId: Id<"store">;
  },
) {
  const proof = await consumeCommandApprovalProofWithCtx(ctx, {
    action: ITEM_ADJUSTMENT_ACTION,
    approvalProofId: args.approvalProofId,
    requestedByStaffProfileId: args.actorStaffProfileId,
    requiredRole: "manager",
    storeId: args.storeId,
    subject: {
      id: args.plan.payloadSubject,
      type: ITEM_ADJUSTMENT_SUBJECT_TYPE,
    },
  });

  if (proof.kind !== "ok") {
    throw new Error(proof.error.message);
  }

  return proof.data;
}

async function applyInventoryDeltas(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    adjustmentId: Id<"posTransactionAdjustment">;
    customerProfileId?: Id<"customerProfile">;
    lines: AdjustmentPlan["lines"];
    organizationId?: Id<"organization">;
    reason?: string;
    registerSessionId?: Id<"registerSession">;
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
  },
) {
  const movementIds: Array<Id<"inventoryMovement">> = [];

  for (const line of args.lines) {
    if (line.pendingCheckoutItemId) {
      if (line.quantityDelta !== 0) {
        await recordPendingCheckoutItemEvidenceCorrection(ctx, {
          actorStaffProfileId: args.actorStaffProfileId,
          actorUserId: args.actorUserId,
          pendingCheckoutItemId: line.pendingCheckoutItemId,
          posTransactionId: args.transactionId,
          quantityDelta: line.quantityDelta,
          reason: "item_adjustment",
          storeId: args.storeId,
          timestamp: Date.now(),
        });
      }
      continue;
    }

    if (line.inventoryDelta === 0) {
      continue;
    }

    const productSku = await ctx.db.get("productSku", line.productSkuId);

    if (!productSku || productSku.storeId !== args.storeId) {
      throw new Error("Item adjustment SKU not found for this store.");
    }

    const nextInventoryCount = productSku.inventoryCount + line.inventoryDelta;
    const nextQuantityAvailable = productSku.quantityAvailable + line.inventoryDelta;

    if (nextInventoryCount < 0 || nextQuantityAvailable < 0) {
      throw new Error("Item adjustment cannot reduce inventory below zero.");
    }

    await ctx.db.patch("productSku", line.productSkuId, {
      inventoryCount: nextInventoryCount,
      quantityAvailable: nextQuantityAvailable,
    });

    const movement = await recordInventoryMovementWithCtx(ctx, {
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
      customerProfileId: args.customerProfileId,
      movementType: "pos_item_adjustment",
      notes: args.reason,
      organizationId: args.organizationId,
      posTransactionId: args.transactionId,
      productId: line.productId,
      productSkuId: line.productSkuId,
      quantityDelta: line.inventoryDelta,
      reasonCode:
        line.inventoryDelta > 0
          ? "pos_transaction_adjustment_restock"
          : "pos_transaction_adjustment_issue",
      registerSessionId: args.registerSessionId,
      sourceId: args.adjustmentId,
      sourceType: ITEM_ADJUSTMENT_SUBJECT_TYPE,
      storeId: args.storeId,
    });

    if (movement?._id) {
      movementIds.push(movement._id);
    }
  }

  return movementIds;
}

async function recordSettlementPaymentAllocation(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    adjustmentId: Id<"posTransactionAdjustment">;
    customerProfileId?: Id<"customerProfile">;
    organizationId?: Id<"organization">;
    plan: AdjustmentPlan;
    reason?: string;
    registerSessionId?: Id<"registerSession">;
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
  },
) {
  if (args.plan.settlementDirection === "none") {
    return null;
  }

  const allocation = await recordPaymentAllocationWithCtx(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    allocationType: "pos_item_adjustment",
    amount: args.plan.settlementAmount,
    collectedInStore: true,
    customerProfileId: args.customerProfileId,
    direction: args.plan.settlementDirection === "refund" ? "out" : "in",
    method: args.plan.settlementMethod ?? "cash",
    notes: args.reason,
    organizationId: args.organizationId,
    posTransactionId: args.transactionId,
    registerSessionId: args.registerSessionId,
    storeId: args.storeId,
    targetId: args.adjustmentId,
    targetType: "pos_transaction_adjustment",
  });

  return allocation?._id;
}

async function adjustRegisterSessionExpectedCashForSettlement(
  ctx: MutationCtx,
  args: {
    amount: number;
    direction: "collect" | "refund" | "none";
    method?: string;
    registerSessionId?: Id<"registerSession">;
    storeId: Id<"store">;
    validateOnly?: boolean;
  },
) {
  if (
    !args.registerSessionId ||
    args.method !== "cash" ||
    args.direction === "none" ||
    args.amount <= 0
  ) {
    return 0;
  }

  const registerSession = await ctx.db.get(
    "registerSession",
    args.registerSessionId,
  );

  if (!registerSession || registerSession.storeId !== args.storeId) {
    throw new Error("Register session not found for this transaction.");
  }

  if (registerSession.status !== "open" && registerSession.status !== "active") {
    throw new Error(
      "Register closeout is under review. Reopen the register before updating adjustment settlement.",
    );
  }

  const expectedCashDelta =
    args.direction === "collect" ? args.amount : -args.amount;
  const nextExpectedCash = registerSession.expectedCash + expectedCashDelta;

  if (nextExpectedCash < 0) {
    throw new Error("Register session expected cash cannot be negative.");
  }

  if (args.validateOnly) {
    return expectedCashDelta;
  }

  await ctx.db.patch("registerSession", args.registerSessionId, {
    expectedCash: nextExpectedCash,
    ...(registerSession.countedCash !== undefined
      ? { variance: registerSession.countedCash - nextExpectedCash }
      : {}),
  });

  return expectedCashDelta;
}

async function applyApprovedAdjustment(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    approvalProofId?: Id<"approvalProof">;
    approvalRequestId?: Id<"approvalRequest">;
    approverStaffProfileId?: Id<"staffProfile">;
    decisionApprovedByStaffProfileId?: Id<"staffProfile">;
    decisionApprovalProofId?: Id<"approvalProof">;
    plan: AdjustmentPlan;
    reason?: string;
    transaction: Awaited<ReturnType<typeof requireCompletedTransaction>>;
  },
): Promise<AppliedAdjustmentResult> {
  const existing = await findAppliedAdjustmentByFingerprint(ctx, {
    fingerprint: args.plan.fingerprint,
    payloadSubject: args.plan.payloadSubject,
    storeId: args.transaction.storeId,
    transactionId: args.transaction._id,
  });

  if (existing) {
    return existing;
  }

  const appliedAdjustment = await findAppliedAdjustmentForTransaction(ctx, {
    storeId: args.transaction.storeId,
    transactionId: args.transaction._id,
  });
  if (appliedAdjustment) {
    throw new Error(
      "This transaction already has an item adjustment applied.",
    );
  }

  const store = await getStoreById(ctx, args.transaction.storeId);
  await adjustRegisterSessionExpectedCashForSettlement(ctx, {
    amount: args.plan.settlementAmount,
    direction: args.plan.settlementDirection,
    method: args.plan.settlementMethod,
    registerSessionId: args.transaction.registerSessionId,
    storeId: args.transaction.storeId,
    validateOnly: true,
  });
  const now = Date.now();
  const created = await createTransactionAdjustmentForTransaction(ctx, {
    adjustment: {
      approvalProofId: args.approvalProofId,
      decisionApprovalProofId: args.decisionApprovalProofId,
      decisionApprovedByStaffProfileId: args.decisionApprovedByStaffProfileId,
      approvalRequestId: args.approvalRequestId,
      correctedSubtotal: args.plan.correctedSubtotal,
      correctedTax: args.plan.correctedTax,
      correctedTotal: args.plan.correctedTotal,
      createdAt: now,
      currency: "GHS",
      deltaTotal: args.plan.deltaTotal,
      originalSubtotal: args.plan.originalSubtotal,
      originalTax: args.plan.originalTax,
      originalTotal: args.plan.originalTotal,
      payloadFingerprint: args.plan.fingerprint,
      payloadSubject: args.plan.payloadSubject,
      reason: args.reason,
      registerSessionId: args.transaction.registerSessionId,
      requestedByStaffProfileId: args.actorStaffProfileId,
      requestedByUserId: args.actorUserId,
      settlementAmount: args.plan.settlementAmount,
      settlementDirection: args.plan.settlementDirection,
      settlementMethod: args.plan.settlementMethod,
      status: "pending_approval",
      storeId: args.transaction.storeId,
      transactionId: args.transaction._id,
      updatedAt: now,
    },
    lines: args.plan.lines.map((line) => ({
      correctedQuantity: line.correctedQuantity,
      correctedTotal: line.correctedTotal,
      createdAt: now,
      inventoryDelta: line.inventoryDelta,
      lineType: line.lineType,
      originalQuantity: line.originalQuantity,
      originalTotal: line.originalTotal,
      originalTransactionItemId: line.originalTransactionItemId,
      productId: line.productId,
      productName: line.productName,
      productSku: line.productSku,
      productSkuId: line.productSkuId,
      pendingCheckoutItemId: line.pendingCheckoutItemId,
      quantityDelta: line.quantityDelta,
      storeId: args.transaction.storeId,
      transactionId: args.transaction._id,
      unitPrice: line.unitPrice,
    })),
    storeId: args.transaction.storeId,
    transactionId: args.transaction._id,
  });
  const adjustmentId = created.adjustmentId as Id<"posTransactionAdjustment">;
  const lineIds = created.lineIds as Array<Id<"posTransactionAdjustmentLine">>;

  const inventoryMovementIds = await applyInventoryDeltas(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    adjustmentId,
    customerProfileId: args.transaction.customerProfileId,
    lines: args.plan.lines,
    organizationId: store?.organizationId,
    reason: args.reason,
    registerSessionId: args.transaction.registerSessionId,
    storeId: args.transaction.storeId,
    transactionId: args.transaction._id,
  });

  const paymentAllocationId = await recordSettlementPaymentAllocation(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    adjustmentId,
    customerProfileId: args.transaction.customerProfileId,
    organizationId: store?.organizationId,
    plan: args.plan,
    reason: args.reason,
    registerSessionId: args.transaction.registerSessionId,
    storeId: args.transaction.storeId,
    transactionId: args.transaction._id,
  }) ?? undefined;
  const registerSessionExpectedCashDelta =
    await adjustRegisterSessionExpectedCashForSettlement(ctx, {
      amount: args.plan.settlementAmount,
      direction: args.plan.settlementDirection,
      method: args.plan.settlementMethod,
      registerSessionId: args.transaction.registerSessionId,
      storeId: args.transaction.storeId,
    });

  const event = await recordOperationalEventWithCtx(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    approvalRequestId: args.approvalRequestId,
    customerProfileId: args.transaction.customerProfileId,
    eventType: "pos_transaction_item_adjustment_applied",
    message: `Applied item adjustment for ${transactionLabel(args.transaction)}.`,
    metadata: {
      actionKey: ITEM_ADJUSTMENT_ACTION_KEY,
      adjustmentId,
      approvalProofId: args.approvalProofId,
      decisionApprovalProofId: args.decisionApprovalProofId,
      decisionApprovedByStaffProfileId: args.decisionApprovedByStaffProfileId,
      approverStaffProfileId: args.approverStaffProfileId,
      correctedTotal: args.plan.correctedTotal,
      inventoryMovementIds,
      lineItems: args.plan.lines.map((line) => ({
        adjustedQuantity: line.correctedQuantity,
        inventoryDelta: line.inventoryDelta,
        originalQuantity: line.originalQuantity,
        originalTransactionItemId: line.originalTransactionItemId,
        productId: line.productId,
        productName: line.productName,
        productSku: line.productSku,
        productSkuId: line.productSkuId,
        pendingCheckoutItemId: line.pendingCheckoutItemId,
        quantityDelta: line.quantityDelta,
        unitPrice: line.unitPrice,
      })),
      originalTotal: args.plan.originalTotal,
      payloadFingerprint: args.plan.fingerprint,
      paymentAllocationId,
      registerSessionExpectedCashDelta,
      settlementAmount: args.plan.settlementAmount,
      settlementDirection: args.plan.settlementDirection,
      settlementMethod: args.plan.settlementMethod,
      transactionNumber: args.transaction.transactionNumber,
    },
    organizationId: store?.organizationId,
    paymentAllocationId: paymentAllocationId as Id<"paymentAllocation"> | undefined,
    posTransactionId: args.transaction._id,
    reason: args.reason,
    registerSessionId: args.transaction.registerSessionId,
    storeId: args.transaction.storeId,
    subjectId: args.transaction._id,
    subjectLabel: transactionLabel(args.transaction),
    subjectType: "pos_transaction",
  });

  await (ctx.db as any).patch("posTransactionAdjustment", adjustmentId, {
    appliedAt: now,
    decidedAt: now,
    operationalEventId: event?._id,
    paymentAllocationId,
    status: "applied",
    updatedAt: now,
  });

  await recordItemAdjustmentRegisterSessionTrace(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    adjustmentId,
    approvalRequestId: args.approvalRequestId,
    plan: args.plan,
    registerSessionExpectedCashDelta,
    stage: "item_adjustment_applied",
    transaction: args.transaction,
  });

  await markCatalogSummaryNeedsRefresh(ctx, args.transaction.storeId);

  return {
    adjustmentId,
    approvalProofId: args.approvalProofId,
    approvalRequestId: args.approvalRequestId,
    approverStaffProfileId: args.approverStaffProfileId,
    decisionApprovalProofId: args.decisionApprovalProofId,
    decisionApprovedByStaffProfileId: args.decisionApprovedByStaffProfileId,
    inventoryMovementIds,
    lineIds,
    operationalEventId: event?._id,
    paymentAllocationId,
    payloadFingerprint: args.plan.fingerprint,
    settlementAmount: args.plan.settlementAmount,
    settlementDirection: args.plan.settlementDirection,
    transactionId: args.transaction._id,
  };
}

export async function adjustTransactionItems(
  ctx: MutationCtx,
  args: {
    approvalProofId?: Id<"approvalProof">;
    approvalRequestId?: Id<"approvalRequest">;
    payload: TransactionItemAdjustmentPayload;
    reason?: string;
    transactionId: Id<"posTransaction">;
  } & AdjustmentActor,
) {
  const transaction = await requireCompletedTransaction(ctx, args.transactionId);
  const plan = await buildServerAdjustmentPlan(ctx, {
    payload: args.payload,
    transaction,
  });
  const existing = await findAppliedAdjustmentByFingerprint(ctx, {
    fingerprint: plan.fingerprint,
    payloadSubject: plan.payloadSubject,
    storeId: transaction.storeId,
    transactionId: transaction._id,
  });

  if (existing) {
    return existing;
  }

  const appliedAdjustment = await findAppliedAdjustmentForTransaction(ctx, {
    storeId: transaction.storeId,
    transactionId: transaction._id,
  });
  if (appliedAdjustment) {
    throw new Error(
      "This transaction already has an item adjustment applied.",
    );
  }

  if (!args.approvalProofId) {
    const pendingApprovalRequest = await findPendingItemAdjustmentApprovalRequest(ctx, {
      storeId: transaction.storeId,
      transactionId: transaction._id,
    });

    if (
      pendingApprovalRequest &&
      pendingApprovalRequest.metadata?.payloadFingerprint !== plan.fingerprint
    ) {
      throw new Error(
        "This transaction already has an item adjustment waiting for approval.",
      );
    }

    if (!pendingApprovalRequest) {
      await adjustRegisterSessionExpectedCashForSettlement(ctx, {
        amount: plan.settlementAmount,
        direction: plan.settlementDirection,
        method: plan.settlementMethod,
        registerSessionId: transaction.registerSessionId,
        storeId: transaction.storeId,
        validateOnly: true,
      });
    }

    const approvalRequestId =
      pendingApprovalRequest?._id ??
      (await createApprovalRequestForAdjustment(ctx, {
        actorStaffProfileId: args.actorStaffProfileId,
        actorUserId: args.actorUserId,
        plan,
        reason: args.reason,
        transaction,
      }));

    return {
      action: "approval_required" as const,
      approval: buildAdjustmentApprovalRequirement({
        approvalRequestId,
        plan,
        transaction,
      }),
      payloadFingerprint: plan.fingerprint,
      settlementAmount: plan.settlementAmount,
      settlementDirection: plan.settlementDirection,
      transactionId: args.transactionId,
    };
  }

  await adjustRegisterSessionExpectedCashForSettlement(ctx, {
    amount: plan.settlementAmount,
    direction: plan.settlementDirection,
    method: plan.settlementMethod,
    registerSessionId: transaction.registerSessionId,
    storeId: transaction.storeId,
    validateOnly: true,
  });

  const approvalRequest =
    await requireMatchingPendingItemAdjustmentApprovalRequest(ctx, {
      approvalRequestId: args.approvalRequestId,
      plan,
      storeId: transaction.storeId,
    });
  const approvalProof = await consumeItemAdjustmentApprovalProof(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    approvalProofId: args.approvalProofId,
    plan,
    storeId: transaction.storeId,
  });
  const result = await applyApprovedAdjustment(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    approvalProofId: approvalProof.approvalProofId,
    approvalRequestId: approvalRequest?._id,
    approverStaffProfileId: approvalProof.approvedByStaffProfileId,
    decisionApprovalProofId: approvalProof.approvalProofId,
    decisionApprovedByStaffProfileId: approvalProof.approvedByStaffProfileId,
    plan,
    reason: args.reason,
    transaction,
  });

  if (approvalRequest) {
    await ctx.db.patch("approvalRequest", approvalRequest._id, {
      decidedAt: Date.now(),
      decisionApprovalProofId: approvalProof.approvalProofId,
      decisionApprovedByStaffProfileId: approvalProof.approvedByStaffProfileId,
      decisionNotes: args.reason,
      reviewedByStaffProfileId: approvalProof.approvedByStaffProfileId,
      reviewedByUserId: args.actorUserId,
      status: "approved",
    });
  }

  return result;
}

function readPayloadFromApprovalRequestMetadata(
  metadata: Record<string, unknown> | undefined,
): TransactionItemAdjustmentPayload {
  const payload = metadata?.payload;

  if (!payload || typeof payload !== "object") {
    throw new Error("Item adjustment approval request is missing adjustment details.");
  }

  return payload as TransactionItemAdjustmentPayload;
}

export async function resolveTransactionItemAdjustmentApprovalDecisionWithCtx(
  ctx: MutationCtx,
  args: {
    approvalRequestId: Id<"approvalRequest">;
    decisionApprovedByStaffProfileId?: Id<"staffProfile">;
    decisionApprovalProofId?: Id<"approvalProof">;
    decision: "approved" | "rejected" | "cancelled";
    reviewedByStaffProfileId?: Id<"staffProfile">;
    reviewedByUserId?: Id<"athenaUser">;
    decisionNotes?: string;
  },
) {
  const approvalRequest = await ctx.db.get(
    "approvalRequest",
    args.approvalRequestId,
  );

  if (
    !approvalRequest ||
    approvalRequest.requestType !== ITEM_ADJUSTMENT_REQUEST_TYPE ||
    approvalRequest.subjectType !== ITEM_ADJUSTMENT_SUBJECT_TYPE
  ) {
    throw new Error("Item adjustment approval request not found.");
  }

  if (args.decision !== "approved") {
    const decidedAt = Date.now();
    await markPendingAdjustmentDecisionForApprovalRequest(ctx, {
      approvalRequestId: args.approvalRequestId,
      decisionApprovalProofId: args.decisionApprovalProofId,
      decisionApprovedByStaffProfileId: args.decisionApprovedByStaffProfileId,
      decision: args.decision,
      now: decidedAt,
    });

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: args.reviewedByStaffProfileId,
      actorUserId: args.reviewedByUserId,
      approvalRequestId: args.approvalRequestId,
      eventType: "pos_transaction_item_adjustment_approval_rejected",
      message: `Item adjustment ${args.decision}.`,
      metadata: {
        actionKey: ITEM_ADJUSTMENT_ACTION_KEY,
        decisionApprovalProofId: args.decisionApprovalProofId,
        decisionApprovedByStaffProfileId: args.decisionApprovedByStaffProfileId,
        decision: args.decision,
        payloadFingerprint: approvalRequest.metadata?.payloadFingerprint,
      },
      reason: args.decisionNotes,
      storeId: approvalRequest.storeId,
      subjectId: approvalRequest.subjectId,
      subjectType: approvalRequest.subjectType,
    });
    return null;
  }

  const transactionId = approvalRequest.metadata?.transactionId as
    | Id<"posTransaction">
    | undefined;

  if (!transactionId) {
    throw new Error("Item adjustment approval request is missing adjustment details.");
  }

  const transaction = await requireCompletedTransaction(ctx, transactionId);

  if (transaction.storeId !== approvalRequest.storeId) {
    throw new Error("Item adjustment approval request does not match this store.");
  }

  const payload = readPayloadFromApprovalRequestMetadata(
    approvalRequest.metadata,
  );
  const plan = await buildServerAdjustmentPlan(ctx, {
    payload,
    transaction,
  });

  if (
    approvalRequest.subjectId !== plan.payloadSubject ||
    approvalRequest.metadata?.payloadFingerprint !== plan.fingerprint
  ) {
    throw new Error("Item adjustment approval request does not match this payload.");
  }

  const approverStaffProfileId =
    args.decisionApprovedByStaffProfileId ?? args.reviewedByStaffProfileId;

  return applyApprovedAdjustment(ctx, {
    actorStaffProfileId: approvalRequest.requestedByStaffProfileId,
    actorUserId: approvalRequest.requestedByUserId,
    approvalRequestId: args.approvalRequestId,
    approverStaffProfileId,
    decisionApprovedByStaffProfileId: args.decisionApprovedByStaffProfileId,
    decisionApprovalProofId: args.decisionApprovalProofId,
    plan,
    reason: approvalRequest.notes ?? approvalRequest.reason,
    transaction,
  });
}
