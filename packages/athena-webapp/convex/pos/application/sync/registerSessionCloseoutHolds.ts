import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import { calculateRegisterSessionCashDelta } from "../../../operations/registerSessions";
import {
  classifyRegisterSessionSyncReview,
  listOpenLocalSyncConflictsByRegisterSession,
} from "./registerSessionSyncReview";

export type RegisterSessionCloseoutHoldKind =
  | "pending_completed_sale_void_approvals"
  | "pending_transaction_item_adjustment_approvals"
  | "repairable_missing_register_session_mapping_sales";

export type RegisterSessionCloseoutHold = {
  kind: RegisterSessionCloseoutHoldKind;
  cashAffecting: boolean;
  count: number;
  conflictIds?: string[];
  localEventIds?: string[];
  approvalRequestIds?: Array<Id<"approvalRequest">>;
};

export type RegisterSessionPendingVoidApprovalSummary = {
  cashAffectingCount: number;
  cashAdjustmentCount: number;
  cashAdjustmentDelta: number;
  cashAmount: number;
  count: number;
  items: Array<{
    approvalRequestId: Id<"approvalRequest">;
    cashAmount: number;
    requestedAt: number;
    transactionId: Id<"posTransaction"> | string;
    transactionNumber?: string | null;
    workItemId?: Id<"operationalWorkItem"> | null;
  }>;
};

export function hasCashAffectingCloseoutHolds(
  holds: RegisterSessionCloseoutHold[],
) {
  return holds.some((hold) => hold.cashAffecting && hold.count > 0);
}

export async function listPendingRegisterSessionApprovalRequests(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  args: {
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
  },
) {
  if (typeof ctx.db.query !== "function") {
    return [];
  }

  const query = ctx.db
    .query("approvalRequest")
    .withIndex("by_registerSessionId", (q) =>
      q.eq("registerSessionId", args.registerSessionId),
    );
  if (typeof query.collect !== "function") {
    return [];
  }

  const approvalRequests =
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- Register-session scoped manager-review queues are bounded by operational review volume and must not be truncated before final closeout.
    await query.collect();

  return approvalRequests.filter(
    (approvalRequest): approvalRequest is Doc<"approvalRequest"> =>
      approvalRequest.storeId === args.storeId &&
      approvalRequest.status === "pending",
  );
}

export function filterPendingCompletedSaleVoidApprovals(
  approvalRequests: Doc<"approvalRequest">[],
) {
  return approvalRequests.filter(
    (approvalRequest) =>
      approvalRequest.requestType === "pos_transaction_void" &&
      approvalRequest.subjectType === "pos_transaction",
  );
}

export function filterPendingTransactionItemAdjustmentApprovals(
  approvalRequests: Doc<"approvalRequest">[],
) {
  return approvalRequests.filter(
    (approvalRequest) =>
      approvalRequest.requestType === "pos_item_adjustment" &&
      approvalRequest.subjectType === "pos_transaction_item_adjustment",
  );
}

export async function listPendingCompletedSaleVoidApprovals(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  args: {
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
  },
) {
  return filterPendingCompletedSaleVoidApprovals(
    await listPendingRegisterSessionApprovalRequests(ctx, args),
  );
}

export async function listPendingTransactionItemAdjustmentApprovals(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  args: {
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
  },
) {
  return filterPendingTransactionItemAdjustmentApprovals(
    await listPendingRegisterSessionApprovalRequests(ctx, args),
  );
}

function getApprovalRequestTransactionId(
  approvalRequest: Doc<"approvalRequest">,
) {
  return approvalRequest.posTransactionId ?? approvalRequest.subjectId ?? "";
}

function getApprovalRequestTransactionNumber(
  approvalRequest: Doc<"approvalRequest">,
) {
  return typeof approvalRequest.metadata?.transactionNumber === "string"
    ? approvalRequest.metadata.transactionNumber
    : null;
}

function getTransactionPendingVoidCashAmount(
  transaction: Doc<"posTransaction"> | null,
  args: {
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
  },
) {
  if (
    !transaction ||
    transaction.storeId !== args.storeId ||
    transaction.registerSessionId !== args.registerSessionId
  ) {
    return 0;
  }

  return calculateRegisterSessionCashDelta({
    changeGiven: transaction.changeGiven,
    payments: transaction.payments,
  });
}

function getNumberMetadata(
  approvalRequest: Doc<"approvalRequest">,
  key: string,
) {
  const value = approvalRequest.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getStringMetadata(
  approvalRequest: Doc<"approvalRequest">,
  key: string,
) {
  const value = approvalRequest.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function getPendingItemAdjustmentCashDelta(
  approvalRequest: Doc<"approvalRequest">,
) {
  const amount = Math.max(0, getNumberMetadata(approvalRequest, "settlementAmount"));
  const method = getStringMetadata(approvalRequest, "settlementMethod");
  const direction = getStringMetadata(approvalRequest, "settlementDirection");

  if (amount <= 0 || method !== "cash") {
    return 0;
  }

  if (direction === "collect" || direction === "collection") {
    return amount;
  }
  if (direction === "refund") {
    return -amount;
  }

  return 0;
}

export async function buildPendingCompletedSaleVoidApprovalSummary(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  args: {
    approvalRequests: Doc<"approvalRequest">[];
    itemAdjustmentApprovalRequests?: Doc<"approvalRequest">[];
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
  },
): Promise<RegisterSessionPendingVoidApprovalSummary> {
  const cashAdjustmentDeltas = (args.itemAdjustmentApprovalRequests ?? [])
    .map(getPendingItemAdjustmentCashDelta)
    .filter((delta) => delta !== 0);
  const items = (
    await Promise.all(
      [...args.approvalRequests]
        .sort((left, right) => left.createdAt - right.createdAt)
        .map(async (approvalRequest) => {
          const transaction =
            approvalRequest.posTransactionId !== undefined
              ? await ctx.db.get(
                  "posTransaction",
                  approvalRequest.posTransactionId,
                )
              : null;

          return {
            approvalRequestId: approvalRequest._id,
            cashAmount: getTransactionPendingVoidCashAmount(transaction, args),
            requestedAt: approvalRequest.createdAt,
            transactionId: getApprovalRequestTransactionId(approvalRequest),
            transactionNumber:
              getApprovalRequestTransactionNumber(approvalRequest),
            workItemId: approvalRequest.workItemId ?? null,
          };
        }),
    )
  ).filter((item) => item.transactionId);

  return {
    cashAffectingCount: items.filter((item) => item.cashAmount > 0).length,
    cashAdjustmentCount: cashAdjustmentDeltas.length,
    cashAdjustmentDelta: cashAdjustmentDeltas.reduce((sum, delta) => sum + delta, 0),
    cashAmount: items.reduce((sum, item) => sum + item.cashAmount, 0),
    count: items.length,
    items,
  };
}

function canListRegisterSessionSyncConflicts(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  storeId: Id<"store">,
) {
  if (typeof ctx.db.query !== "function") {
    return false;
  }

  let query;
  try {
    query = ctx.db
      .query("posLocalSyncConflict")
      .withIndex("by_store_status", (q) =>
        q.eq("storeId", storeId).eq("status", "needs_review"),
      );
  } catch {
    return false;
  }

  return typeof query.take === "function";
}

export async function listRegisterSessionCloseoutHolds(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  args: {
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
  },
): Promise<RegisterSessionCloseoutHold[]> {
  const holds: RegisterSessionCloseoutHold[] = [];

  const approvalRequests = await listPendingRegisterSessionApprovalRequests(
    ctx,
    args,
  );
  const pendingVoidApprovals =
    filterPendingCompletedSaleVoidApprovals(approvalRequests);
  const pendingItemAdjustmentApprovals =
    filterPendingTransactionItemAdjustmentApprovals(approvalRequests);
  if (pendingVoidApprovals.length > 0) {
    holds.push({
      kind: "pending_completed_sale_void_approvals",
      cashAffecting: true,
      count: pendingVoidApprovals.length,
      approvalRequestIds: pendingVoidApprovals.map(
        (approvalRequest) => approvalRequest._id,
      ),
    });
  }
  if (pendingItemAdjustmentApprovals.length > 0) {
    holds.push({
      kind: "pending_transaction_item_adjustment_approvals",
      cashAffecting: pendingItemAdjustmentApprovals.some(
        (approvalRequest) =>
          getPendingItemAdjustmentCashDelta(approvalRequest) !== 0,
      ),
      count: pendingItemAdjustmentApprovals.length,
      approvalRequestIds: pendingItemAdjustmentApprovals.map(
        (approvalRequest) => approvalRequest._id,
      ),
    });
  }

  const conflictsBySessionId = canListRegisterSessionSyncConflicts(
    ctx,
    args.storeId,
  )
    ? await listOpenLocalSyncConflictsByRegisterSession(ctx, args.storeId)
    : new Map<Id<"registerSession">, []>();
  const repairableConflicts = (
    conflictsBySessionId.get(args.registerSessionId) ?? []
  ).filter(
    (conflict) =>
      classifyRegisterSessionSyncReview(conflict).reviewKind ===
      "missing_register_session_mapping",
  );

  if (repairableConflicts.length > 0) {
    holds.push({
      kind: "repairable_missing_register_session_mapping_sales",
      cashAffecting: true,
      count: repairableConflicts.length,
      conflictIds: repairableConflicts.map((conflict) => conflict._id),
      localEventIds: repairableConflicts.map(
        (conflict) => conflict.localEventId,
      ),
    });
  }

  return holds;
}

export function getCloseoutHoldOperatorMessage(
  holds: RegisterSessionCloseoutHold[],
  action: "approve" | "deposit" | "finalize",
) {
  const cashAffectingHolds = holds.filter(
    (hold) => hold.cashAffecting && hold.count > 0,
  );
  if (cashAffectingHolds.length === 0) {
    return null;
  }

  if (
    cashAffectingHolds.length === 1 &&
    cashAffectingHolds[0].kind === "pending_completed_sale_void_approvals"
  ) {
    if (action === "deposit") {
      return "Resolve pending void approvals before recording a deposit.";
    }
    if (action === "approve") {
      return "Resolve pending void approvals before approving final closeout.";
    }
    return "Resolve pending void approvals before finalizing closeout.";
  }

  if (action === "deposit") {
    return "Resolve pending register corrections before recording a deposit.";
  }
  if (action === "approve") {
    return "Resolve pending register corrections before approving final closeout.";
  }
  return "Resolve pending register corrections before finalizing closeout.";
}
