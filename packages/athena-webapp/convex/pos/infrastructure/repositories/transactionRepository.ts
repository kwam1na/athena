import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";

type PosTransactionReadCtx = QueryCtx | MutationCtx;
type PosTransactionAdjustmentStatus =
  | "pending_approval"
  | "applied"
  | "rejected"
  | "cancelled"
  | "stale";

type PosTransactionAdjustmentInsert = {
  storeId: Id<"store">;
  transactionId: Id<"posTransaction">;
  registerSessionId?: Id<"registerSession">;
  requestedByUserId?: Id<"athenaUser">;
  requestedByStaffProfileId?: Id<"staffProfile">;
  approvalRequestId?: Id<"approvalRequest">;
  approvalProofId?: Id<"approvalProof">;
  decisionApprovalProofId?: Id<"approvalProof">;
  decisionApprovedByStaffProfileId?: Id<"staffProfile">;
  paymentAllocationId?: Id<"paymentAllocation">;
  operationalEventId?: Id<"operationalEvent">;
  status: PosTransactionAdjustmentStatus;
  originalSubtotal: number;
  originalTax: number;
  originalTotal: number;
  correctedSubtotal: number;
  correctedTax: number;
  correctedTotal: number;
  deltaTotal: number;
  settlementDirection: "collect" | "refund" | "none";
  settlementAmount: number;
  settlementMethod?: string;
  payloadFingerprint: string;
  payloadSubject: string;
  reason?: string;
  currency?: string;
  createdAt: number;
  updatedAt: number;
  appliedAt?: number;
  decidedAt?: number;
};

type PosTransactionAdjustmentLineInsert = {
  adjustmentId?: string;
  storeId: Id<"store">;
  transactionId: Id<"posTransaction">;
  lineType: "existing" | "added";
  originalTransactionItemId?: Id<"posTransactionItem">;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  productName: string;
  productSku: string;
  originalQuantity: number;
  correctedQuantity: number;
  quantityDelta: number;
  unitPrice: number;
  originalTotal: number;
  correctedTotal: number;
  inventoryDelta: number;
  createdAt: number;
};

async function readAllQueryResults<T>(query: AsyncIterable<T>) {
  const results: T[] = [];

  for await (const item of query) {
    results.push(item);
  }

  return results;
}

export async function getStoreById(
  ctx: PosTransactionReadCtx,
  storeId: Id<"store">,
) {
  return ctx.db.get("store", storeId);
}

export async function getProductSkuById(
  ctx: PosTransactionReadCtx,
  skuId: Id<"productSku">,
) {
  return ctx.db.get("productSku", skuId);
}

export async function getPosTransactionById(
  ctx: PosTransactionReadCtx,
  transactionId: Id<"posTransaction">,
) {
  return ctx.db.get("posTransaction", transactionId);
}

export async function getPosSessionById(
  ctx: PosTransactionReadCtx,
  sessionId: Id<"posSession">,
) {
  return ctx.db.get("posSession", sessionId);
}

export async function getRegisterSessionById(
  ctx: PosTransactionReadCtx,
  registerSessionId: Id<"registerSession">,
) {
  return ctx.db.get("registerSession", registerSessionId);
}

export async function getCashierById(
  ctx: PosTransactionReadCtx,
  staffProfileId: Id<"staffProfile">,
) {
  return ctx.db.get("staffProfile", staffProfileId);
}

export async function getCustomerById(
  ctx: PosTransactionReadCtx,
  customerId: Id<"posCustomer">,
) {
  return ctx.db.get("posCustomer", customerId);
}

export async function listTransactionItems(
  ctx: PosTransactionReadCtx,
  transactionId: Id<"posTransaction">,
) {
  return readAllQueryResults(
    ctx.db
      .query("posTransactionItem")
      .withIndex("by_transactionId", (q) => q.eq("transactionId", transactionId)),
  );
}

export async function listTransactionAdjustments(
  ctx: PosTransactionReadCtx,
  transactionId: Id<"posTransaction">,
) {
  return (ctx.db as any)
    .query("posTransactionAdjustment")
    .withIndex("by_transactionId", (q: any) =>
      q.eq("transactionId", transactionId),
    )
    .order("desc")
    .collect();
}

export async function listTransactionAdjustmentLines(
  ctx: PosTransactionReadCtx,
  adjustmentId: string,
) {
  return (ctx.db as any)
    .query("posTransactionAdjustmentLine")
    .withIndex("by_adjustmentId", (q: any) =>
      q.eq("adjustmentId", adjustmentId),
    )
    .collect();
}

export async function getActiveTransactionAdjustment(
  ctx: PosTransactionReadCtx,
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
        .eq("status", "pending_approval"),
    )
    .first();
}

export async function createTransactionAdjustmentForTransaction(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
    adjustment: PosTransactionAdjustmentInsert;
    lines: PosTransactionAdjustmentLineInsert[];
  },
) {
  const transaction = await ctx.db.get("posTransaction", args.transactionId);

  if (!transaction) {
    throw new Error("POS transaction not found.");
  }

  if (transaction.storeId !== args.storeId) {
    throw new Error("POS transaction does not belong to this store.");
  }

  if (transaction.status !== "completed") {
    throw new Error("Only completed POS transactions can be adjusted.");
  }

  const adjustmentId = (await (ctx.db as any).insert(
    "posTransactionAdjustment",
    args.adjustment,
  )) as string;
  const lineIds: string[] = [];

  for (const line of args.lines) {
    lineIds.push(
      (await (ctx.db as any).insert("posTransactionAdjustmentLine", {
        ...line,
        adjustmentId,
      })) as string,
    );
  }

  return {
    adjustmentId,
    lineIds,
  };
}

export async function listSessionItems(
  ctx: MutationCtx,
  sessionId: Id<"posSession">,
) {
  return readAllQueryResults(
    ctx.db
      .query("posSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId)),
  );
}

export async function listTransactionsByStore(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    limit?: number;
  },
) {
  return ctx.db
    .query("posTransaction")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .order("desc")
    .take(args.limit || 50);
}

export async function listCompletedTransactions(
  ctx: QueryCtx,
  args: {
    completedFrom?: number;
    registerSessionId?: Id<"registerSession">;
    storeId: Id<"store">;
    limit?: number;
  },
) {
  const limit = args.limit ?? 50;
  if (args.registerSessionId) {
    const [completed, voided] = await Promise.all(
      (["completed", "void"] as const).map((status) =>
        ctx.db
          .query("posTransaction")
          .withIndex("by_storeId_status_registerSessionId_completedAt", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("status", status)
              .eq("registerSessionId", args.registerSessionId)
              .gte("completedAt", args.completedFrom ?? 0),
          )
          .order("desc")
          .take(limit),
      ),
    );

    return [...completed, ...voided]
      .sort((first, second) => second.completedAt - first.completedAt)
      .slice(0, limit);
  }

  const [completed, voided] = await Promise.all(
    (["completed", "void"] as const).map((status) =>
      ctx.db
        .query("posTransaction")
        .withIndex("by_storeId_status_completedAt", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("status", status)
            .gte("completedAt", args.completedFrom ?? 0),
        )
        .order("desc")
        .take(limit),
    ),
  );

  return [...completed, ...voided]
    .sort((first, second) => second.completedAt - first.completedAt)
    .slice(0, limit);
}

export async function listCompletedTransactionsSince(
  ctx: QueryCtx,
  args: {
    completedFrom: number;
    limit?: number;
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("posTransaction")
    .withIndex("by_storeId_status_completedAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "completed")
        .gte("completedAt", args.completedFrom),
    )
    .order("desc")
    .take(args.limit ?? 400);
}

export async function listCompletedTransactionsForRange(
  ctx: QueryCtx,
  args: {
    completedFrom: number;
    completedTo: number;
    storeId: Id<"store">;
  },
) {
  return readAllQueryResults(
    ctx.db
      .query("posTransaction")
      .withIndex("by_storeId_status_completedAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", "completed")
          .gte("completedAt", args.completedFrom)
          .lte("completedAt", args.completedTo),
      ),
  );
}

export async function listCompletedTransactionsForDay(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    startOfDay: number;
    endOfDay: number;
  },
) {
  return readAllQueryResults(
    ctx.db
      .query("posTransaction")
      .withIndex("by_storeId_status_completedAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", "completed")
          .gte("completedAt", args.startOfDay)
          .lte("completedAt", args.endOfDay),
      ),
  );
}

export async function createPosTransaction(
  ctx: MutationCtx,
  input: Omit<Doc<"posTransaction">, "_id" | "_creationTime">,
) {
  return ctx.db.insert("posTransaction", input);
}

export async function createPosTransactionItem(
  ctx: MutationCtx,
  input: Omit<Doc<"posTransactionItem">, "_id" | "_creationTime">,
) {
  return ctx.db.insert("posTransactionItem", input);
}

export async function patchPosTransaction(
  ctx: MutationCtx,
  transactionId: Id<"posTransaction">,
  patch: Partial<Omit<Doc<"posTransaction">, "_id" | "_creationTime">>,
) {
  await ctx.db.patch("posTransaction", transactionId, patch);
}

export async function patchPosSession(
  ctx: MutationCtx,
  sessionId: Id<"posSession">,
  patch: Partial<Omit<Doc<"posSession">, "_id" | "_creationTime">>,
) {
  await ctx.db.patch("posSession", sessionId, patch);
}
