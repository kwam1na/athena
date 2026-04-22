import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";

type PosTransactionReadCtx = QueryCtx | MutationCtx;

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
    storeId: Id<"store">;
    limit?: number;
  },
) {
  return ctx.db
    .query("posTransaction")
    .withIndex("by_storeId_status_completedAt", (q) =>
      q.eq("storeId", args.storeId).eq("status", "completed"),
    )
    .order("desc")
    .take(args.limit ?? 50);
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

export async function patchProductSku(
  ctx: MutationCtx,
  skuId: Id<"productSku">,
  patch: Partial<Omit<Doc<"productSku">, "_id" | "_creationTime">>,
) {
  await ctx.db.patch("productSku", skuId, patch);
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
