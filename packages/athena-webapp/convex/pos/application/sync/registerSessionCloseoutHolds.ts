import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import {
  classifyRegisterSessionSyncReview,
  listOpenLocalSyncConflictsByRegisterSession,
} from "./registerSessionSyncReview";

export type RegisterSessionCloseoutHoldKind =
  | "pending_completed_sale_void_approvals"
  | "repairable_missing_register_session_mapping_sales";

export type RegisterSessionCloseoutHold = {
  kind: RegisterSessionCloseoutHoldKind;
  cashAffecting: boolean;
  count: number;
  conflictIds?: string[];
  localEventIds?: string[];
  approvalRequestIds?: Array<Id<"approvalRequest">>;
};

export function hasCashAffectingCloseoutHolds(
  holds: RegisterSessionCloseoutHold[],
) {
  return holds.some((hold) => hold.cashAffecting && hold.count > 0);
}

async function listPendingCompletedSaleVoidApprovals(
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
      approvalRequest.status === "pending" &&
      approvalRequest.requestType === "pos_transaction_void" &&
      approvalRequest.subjectType === "pos_transaction",
  );
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

  const pendingVoidApprovals = await listPendingCompletedSaleVoidApprovals(
    ctx,
    args,
  );
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
