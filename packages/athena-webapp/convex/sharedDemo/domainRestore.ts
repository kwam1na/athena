import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { SHARED_DEMO_BASELINE_VERSION } from "./config";

export const SHARED_DEMO_MUTABLE_TABLES = [
  { domain: "pos", tableName: "posTransactionItem" },
  { domain: "pos", tableName: "posTransaction" },
  { domain: "inventory", tableName: "inventoryMovement" },
  { domain: "inventory", tableName: "product" },
  { domain: "inventory", tableName: "productSku" },
  { domain: "cash", tableName: "posRegisterSessionActivity" },
  { domain: "cash", tableName: "registerSession" },
  { domain: "orders", tableName: "onlineOrderItem" },
  { domain: "orders", tableName: "onlineOrder" },
  { domain: "operations", tableName: "operationalEvent" },
  { domain: "operations", tableName: "dailyOpening" },
  { domain: "staff", tableName: "staffProfile" },
  { domain: "staff", tableName: "staffMessage" },
] as const;
const RESTORE_BATCH_LIMIT = 500;

export function requireBoundedBatch<T>(rows: T[], tableName: string) {
  if (rows.length > RESTORE_BATCH_LIMIT) throw new Error(`Shared demo restore batch required for ${tableName}.`);
  return rows;
}

export function requireCurrentBaselineDocuments<T extends { baselineVersion: number }>(
  rows: T[],
  tableName: string,
) {
  if (rows.some((row) => row.baselineVersion !== SHARED_DEMO_BASELINE_VERSION)) {
    throw new Error(`Shared demo baseline version mismatch for ${tableName}.`);
  }
  return rows;
}

type RestoreRow = { _id: string; storeId: string; [key: string]: unknown };
type BaselineDocumentRow = {
  baselineVersion: number;
  document: Record<string, unknown>;
  documentId: string;
};

export function planDomainRestore(args: {
  baseline: RestoreRow[];
  current: RestoreRow[];
  storeId: string;
}) {
  const scoped = args.current.filter((row) => row.storeId === args.storeId);
  const untouched = args.current.filter((row) => row.storeId !== args.storeId);
  const baselineIds = new Set(args.baseline.map((row) => row._id));
  const currentIds = new Set(scoped.map((row) => row._id));
  if (args.baseline.some((row) => !currentIds.has(row._id))) {
    throw new Error("Protected shared demo baseline row is missing.");
  }
  return {
    remove: scoped.filter((row) => !baselineIds.has(row._id)).map((row) => row._id),
    replace: args.baseline,
    untouched,
  };
}

function withoutSystemFields(row: Record<string, unknown>) {
  const { _creationTime: _ignoredCreationTime, _id: _ignoredId, ...document } = row;
  return document;
}

// This is intentionally the sole dynamic-table adapter. Its table names are
// frozen by SHARED_DEMO_MUTABLE_TABLES and validated by the schema union.
async function listStoreRows(ctx: any, tableName: string, storeId: Id<"store">) {
  if (tableName === "posTransactionItem") {
    const parents = await ctx.db.query("posTransaction").withIndex("by_storeId", (q: any) => q.eq("storeId", storeId)).take(500);
    return requireBoundedBatch((await Promise.all(parents.map((parent: any) => ctx.db.query("posTransactionItem").withIndex("by_transactionId", (q: any) => q.eq("transactionId", parent._id)).take(RESTORE_BATCH_LIMIT + 1)))).flat(), tableName);
  }
  if (tableName === "onlineOrderItem") {
    const parents = await ctx.db.query("onlineOrder").withIndex("by_storeId", (q: any) => q.eq("storeId", storeId)).take(500);
    return requireBoundedBatch((await Promise.all(parents.map((parent: any) => ctx.db.query("onlineOrderItem").withIndex("by_orderId", (q: any) => q.eq("orderId", parent._id)).take(RESTORE_BATCH_LIMIT + 1)))).flat(), tableName);
  }
  if (tableName === "staffMessage") {
    return requireBoundedBatch(await ctx.db.query("staffMessage").withIndex("by_storeId_createdAt", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  const query = ctx.db.query(tableName);
  if (tableName === "posRegisterSessionActivity") {
    return requireBoundedBatch(await query.withIndex("by_store_registerSession_sequence", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "dailyOpening") {
    return requireBoundedBatch(await query.withIndex("by_storeId_operatingDate", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  return requireBoundedBatch(await query.withIndex("by_storeId", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
}

export async function captureBaselineDocumentsWithCtx(
  ctx: MutationCtx,
  args: { storeId: Id<"store"> },
) {
    const prior = await ctx.db.query("sharedDemoBaselineDocument").withIndex("by_storeId", (q) => q.eq("storeId", args.storeId)).take(500);
    for (const row of prior) await ctx.db.delete("sharedDemoBaselineDocument", row._id);
    let captured = 0;
    for (const entry of SHARED_DEMO_MUTABLE_TABLES) {
      const rows = await listStoreRows(ctx, entry.tableName, args.storeId);
      for (const row of rows) {
        await ctx.db.insert("sharedDemoBaselineDocument", {
          baselineVersion: SHARED_DEMO_BASELINE_VERSION,
          document: withoutSystemFields(row),
          documentId: String(row._id),
          storeId: args.storeId,
          tableName: entry.tableName,
        });
        captured += 1;
      }
    }
    return { captured };
}

export const captureBaselineDocuments = internalMutation({
  args: { storeId: v.id("store") },
  handler: captureBaselineDocumentsWithCtx,
});

export async function restoreMutableDemoStoreRowsWithCtx(ctx: any, storeId: Id<"store">) {
  let restored = 0;
  const actualCounts: Record<string, number> = {};
  const expectedCounts: Record<string, number> = {};
  for (const entry of SHARED_DEMO_MUTABLE_TABLES) {
    const [current, baselineRows]: [any[], BaselineDocumentRow[]] = await Promise.all([
      listStoreRows(ctx, entry.tableName, storeId),
      ctx.db.query("sharedDemoBaselineDocument").withIndex("by_storeId_tableName", (q: any) => q.eq("storeId", storeId).eq("tableName", entry.tableName)).take(500),
    ]);
    const baseline = requireCurrentBaselineDocuments(baselineRows, entry.tableName);
    const currentIds = new Set(current.map((row: any) => String(row._id)));
    if (baseline.some((row: any) => !currentIds.has(row.documentId))) {
      throw new Error("Protected shared demo baseline row is missing.");
    }
    const baselineIds = new Set(baseline.map((row: any) => row.documentId));
    for (const row of current) {
      if (!baselineIds.has(String(row._id))) await ctx.db.delete(entry.tableName, row._id);
    }
    for (const snapshot of baseline) {
      await ctx.db.replace(entry.tableName, snapshot.documentId, snapshot.document);
      restored += 1;
    }
    const verified = await listStoreRows(ctx, entry.tableName, storeId);
    if (verified.length !== baseline.length) throw new Error(`Shared demo restore verification failed for ${entry.tableName}.`);
    actualCounts[entry.domain] = (actualCounts[entry.domain] ?? 0) + verified.length;
    expectedCounts[entry.domain] = (expectedCounts[entry.domain] ?? 0) + baseline.length;
  }
  return { actualCounts, expectedCounts, restored };
}
