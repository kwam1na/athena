import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  deleteRegisterSessionWithAuthority,
  insertRegisterSessionWithAuthority,
  replaceRegisterSessionWithAuthority,
} from "../operations/registerSessionAuthorityRevision";
import { SHARED_DEMO_BASELINE_VERSION } from "./config";

export const SHARED_DEMO_MUTABLE_TABLES = [
  // Device registration is durable POS foundation, not resettable store data.
  // Keeping it outside this registry prevents a scheduled restore from
  // invalidating a mounted local-first register.
  { domain: "pos", tableName: "posLocalSyncConflict" },
  { domain: "pos", tableName: "posLocalSyncCursor" },
  { domain: "pos", tableName: "posLocalSyncMapping" },
  { domain: "pos", tableName: "posLocalSyncEvent" },
  { domain: "pos", tableName: "posLifecycleJournal" },
  { domain: "pos", tableName: "posLifecycleJournalCursor" },
  { domain: "pos", tableName: "posRegisterMappingAuthority" },
  { domain: "pos", tableName: "posRegisterAuthorityReplicationStatus" },
  { domain: "pos", tableName: "posPendingCheckoutItem" },
  { domain: "pos", tableName: "posSessionItem" },
  { domain: "pos", tableName: "posSession" },
  { domain: "pos", tableName: "posTransactionItem" },
  { domain: "pos", tableName: "posTransaction" },
  { domain: "inventory", tableName: "inventoryMovement" },
  { domain: "inventory", tableName: "expenseTransactionItem" },
  { domain: "inventory", tableName: "expenseTransaction" },
  { domain: "inventory", tableName: "product" },
  { domain: "inventory", tableName: "productSku" },
  { domain: "inventory", tableName: "productSkuSearch" },
  { domain: "inventory", tableName: "reportingInventoryPosition" },
  { domain: "inventory", tableName: "reportingInventoryPositionRevision" },
  { domain: "inventory", tableName: "reportingInventoryEffect" },
  { domain: "inventory", tableName: "reportingInventoryEffectSourceReference" },
  { domain: "inventory", tableName: "reportingInventoryDeficitLedger" },
  { domain: "inventory", tableName: "reportingInventoryDeficitLot" },
  { domain: "inventory", tableName: "reportingInventoryDeficitResolutionWork" },
  { domain: "inventory", tableName: "stockAdjustmentBatch" },
  { domain: "inventory", tableName: "cycleCountDraft" },
  { domain: "inventory", tableName: "cycleCountDraftLine" },
  { domain: "cash", tableName: "posRegisterSessionActivity" },
  { domain: "cash", tableName: "registerSession" },
  { domain: "orders", tableName: "onlineOrderItem" },
  { domain: "orders", tableName: "onlineOrder" },
  { domain: "operations", tableName: "approvalRequest" },
  { domain: "operations", tableName: "approvalProof" },
  { domain: "operations", tableName: "approvalRequesterChallenge" },
  { domain: "operations", tableName: "managerElevation" },
  { domain: "operations", tableName: "operationalWorkItem" },
  { domain: "operations", tableName: "operationalEvent" },
  { domain: "operations", tableName: "paymentAllocation" },
  { domain: "operations", tableName: "dailyOpening" },
  { domain: "staff", tableName: "staffProfile" },
  { domain: "staff", tableName: "staffCredential" },
  { domain: "staff", tableName: "staffMessage" },
  // Derived reporting state. A demo sale runs `recordFacts` like any other
  // store's, so these fill up during a session and MUST be purged with the
  // transactions that produced them — `reportFact` above all, because
  // `foldDay` rebuilds a day from surviving facts and would otherwise
  // resurrect revenue whose POS rows the restore already deleted.
  { derived: true, domain: "reports", tableName: "reportFact" },
  { derived: true, domain: "reports", tableName: "reportDay" },
  { derived: true, domain: "reports", tableName: "reportSkuDay" },
  { derived: true, domain: "reports", tableName: "reportOverview" },
  { derived: true, domain: "reports", tableName: "reportPeriodSkuRollup" },
  { derived: true, domain: "reports", tableName: "reportDirtyDay" },
  { derived: true, domain: "reports", tableName: "reportWeekCurrent" },
  { derived: true, domain: "reports", tableName: "reportWeekAccepted" },
  { derived: true, domain: "reports", tableName: "reportDirtyWeek" },
] as const;
const RESTORE_BATCH_LIMIT = 500;

/**
 * Ceiling for tables whose rows are a MULTIPLE of the domain rows beside them.
 * Every completed sale emits one payment fact plus one sale fact per line, so
 * `reportFact` crosses the shared 500 ceiling several times sooner than the
 * `posTransaction` rows it derives from — and an over-budget throw fails the
 * entire restore, which is far worse for the demo than a large read.
 */
const DERIVED_REPORT_BATCH_LIMIT = 2_000;

const RESTORE_BATCH_LIMIT_OVERRIDES: Record<string, number> = {
  reportFact: DERIVED_REPORT_BATCH_LIMIT,
  reportSkuDay: DERIVED_REPORT_BATCH_LIMIT,
};

/** Per-table row ceiling for one restore pass. */
export function restoreBatchLimitFor(tableName: string) {
  return RESTORE_BATCH_LIMIT_OVERRIDES[tableName] ?? RESTORE_BATCH_LIMIT;
}

/**
 * Derived tables are restored (purged) but never captured into a baseline.
 *
 * Capturing them would freeze whatever reporting rows happened to exist at
 * capture time into permanent baseline state — phantom revenue that every
 * later restore would faithfully reinstate. Nothing seeds them at provision,
 * so their baseline is empty by construction and restore is pure deletion.
 */
export function isDerivedRestoreTable(tableName: string) {
  return SHARED_DEMO_MUTABLE_TABLES.some(
    (entry) =>
      entry.tableName === tableName && "derived" in entry && entry.derived,
  );
}

export function requireBoundedBatch<T>(
  rows: T[],
  tableName: string,
  limit = RESTORE_BATCH_LIMIT,
) {
  if (rows.length > limit) throw new Error(`Demo restore batch required for ${tableName}.`);
  return rows;
}

export function requireCurrentBaselineDocuments<T extends { baselineVersion: number }>(
  rows: T[],
  tableName: string,
  baselineVersion = SHARED_DEMO_BASELINE_VERSION,
) {
  if (rows.some((row) => row.baselineVersion !== baselineVersion)) {
    throw new Error(`Demo baseline version mismatch for ${tableName}.`);
  }
  return rows;
}

type RestoreRow = { _id: string; storeId: string; [key: string]: unknown };
type BaselineDocumentRow = {
  baselineVersion: number;
  document: Record<string, unknown>;
  documentId: string;
};

export function planBaselineDocumentPromotion<
  T extends BaselineDocumentRow & { _id: unknown; tableName: string },
>(args: {
  fromVersion: number;
  rows: T[];
  toVersion: number;
  transformDocument?: (row: T) => Record<string, unknown>;
}) {
  if (args.rows.some((row) => row.baselineVersion !== args.fromVersion)) {
    throw new Error("Demo baseline promotion version mismatch.");
  }
  return args.rows.map(
    (row): {
      baselineVersion: number;
      document: Record<string, unknown>;
      rowId: T["_id"];
    } => ({
      baselineVersion: args.toVersion,
      document: args.transformDocument?.(row) ?? row.document,
      rowId: row._id,
    }),
  );
}

export function planDomainRestore(args: {
  baseline: RestoreRow[];
  current: RestoreRow[];
  storeId: string;
}) {
  const scoped = args.current.filter((row) => row.storeId === args.storeId);
  const untouched = args.current.filter((row) => row.storeId !== args.storeId);
  const baselineIds = new Set(args.baseline.map((row) => row._id));
  const currentIds = new Set(scoped.map((row) => row._id));
  return {
    missing: args.baseline.filter((row) => !currentIds.has(row._id)),
    remove: scoped.filter((row) => !baselineIds.has(row._id)).map((row) => row._id),
    replace: args.baseline,
    untouched,
  };
}

export function remapDocumentIds(
  value: unknown,
  documentIds: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === "string") return documentIds.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapDocumentIds(item, documentIds));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, remapDocumentIds(item, documentIds)]),
  );
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
  if (tableName === "expenseTransactionItem") {
    const parents = await ctx.db.query("expenseTransaction").withIndex("by_storeId", (q: any) => q.eq("storeId", storeId)).take(500);
    return requireBoundedBatch((await Promise.all(parents.map((parent: any) => ctx.db.query("expenseTransactionItem").withIndex("by_transactionId", (q: any) => q.eq("transactionId", parent._id)).take(RESTORE_BATCH_LIMIT + 1)))).flat(), tableName);
  }
  if (tableName === "onlineOrderItem") {
    const parents = await ctx.db.query("onlineOrder").withIndex("by_storeId", (q: any) => q.eq("storeId", storeId)).take(500);
    return requireBoundedBatch((await Promise.all(parents.map((parent: any) => ctx.db.query("onlineOrderItem").withIndex("by_orderId", (q: any) => q.eq("orderId", parent._id)).take(RESTORE_BATCH_LIMIT + 1)))).flat(), tableName);
  }
  if (tableName === "posSessionItem") {
    const parents = await ctx.db.query("posSession").withIndex("by_storeId", (q: any) => q.eq("storeId", storeId)).take(500);
    return requireBoundedBatch((await Promise.all(parents.map((parent: any) => ctx.db.query("posSessionItem").withIndex("by_sessionId", (q: any) => q.eq("sessionId", parent._id)).take(RESTORE_BATCH_LIMIT + 1)))).flat(), tableName);
  }
  if (tableName === "cycleCountDraftLine") {
    const parents = requireBoundedBatch(
      await ctx.db
        .query("cycleCountDraft")
        .withIndex("by_storeId_status_scope_owner", (q: any) =>
          q.eq("storeId", storeId),
        )
        .take(RESTORE_BATCH_LIMIT + 1),
      "cycleCountDraft",
    );
    return requireBoundedBatch(
      (
        await Promise.all(
          parents.map((parent: any) =>
            ctx.db
              .query("cycleCountDraftLine")
              .withIndex("by_draftId", (q: any) => q.eq("draftId", parent._id))
              .take(RESTORE_BATCH_LIMIT + 1),
          ),
        )
      ).flat(),
      tableName,
    );
  }
  if (
    tableName === "reportingInventoryDeficitLedger" ||
    tableName === "reportingInventoryDeficitLot"
  ) {
    const positions = requireBoundedBatch(
      await ctx.db
        .query("reportingInventoryPosition")
        .withIndex("by_storeId_productSkuId", (q: any) =>
          q.eq("storeId", storeId),
        )
        .take(RESTORE_BATCH_LIMIT + 1),
      "reportingInventoryPosition",
    );
    const indexName =
      tableName === "reportingInventoryDeficitLedger"
        ? "by_positionId_status"
        : "by_positionId";
    return requireBoundedBatch(
      (
        await Promise.all(
          positions.map((position: any) =>
            ctx.db
              .query(tableName)
              .withIndex(indexName, (q: any) =>
                q.eq("positionId", position._id),
              )
              .take(RESTORE_BATCH_LIMIT + 1),
          ),
        )
      ).flat(),
      tableName,
    );
  }
  if (tableName === "staffMessage") {
    return requireBoundedBatch(await ctx.db.query("staffMessage").withIndex("by_storeId_createdAt", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  const batchLimit = restoreBatchLimitFor(tableName);
  const query = ctx.db.query(tableName);
  // Derived reporting tables. Each declares the store-prefixed index the
  // reports schema actually ships; none of them carries a bare `by_storeId`.
  if (
    tableName === "reportFact" ||
    tableName === "reportDay" ||
    tableName === "reportDirtyDay"
  ) {
    return requireBoundedBatch(await query.withIndex("by_storeId_operatingDate", (q: any) => q.eq("storeId", storeId)).take(batchLimit + 1), tableName, batchLimit);
  }
  if (tableName === "reportSkuDay") {
    return requireBoundedBatch(await query.withIndex("by_storeId_operatingDate_productSkuId", (q: any) => q.eq("storeId", storeId)).take(batchLimit + 1), tableName, batchLimit);
  }
  if (tableName === "reportPeriodSkuRollup") {
    return requireBoundedBatch(await query.withIndex("by_storeId_periodKey_revenueSortKey", (q: any) => q.eq("storeId", storeId)).take(batchLimit + 1), tableName, batchLimit);
  }
  if (tableName === "reportWeekAccepted") {
    return requireBoundedBatch(await query.withIndex("by_storeId_cycleStartDate", (q: any) => q.eq("storeId", storeId)).take(batchLimit + 1), tableName, batchLimit);
  }
  if (tableName === "posRegisterSessionActivity") {
    return requireBoundedBatch(await query.withIndex("by_store_registerSession_sequence", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "posPendingCheckoutItem") {
    return requireBoundedBatch(await query.withIndex("by_storeId_status_updatedAt", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "cycleCountDraft") {
    return requireBoundedBatch(await query.withIndex("by_storeId_status_scope_owner", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "staffCredential") {
    return requireBoundedBatch(await query.withIndex("by_storeId_status", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "reportingInventoryDeficitResolutionWork") {
    return requireBoundedBatch(await query.withIndex("by_storeId_status_updatedAt", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "dailyOpening") {
    return requireBoundedBatch(await query.withIndex("by_storeId_operatingDate", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "posLocalSyncEvent" || tableName === "posLocalSyncMapping") {
    return requireBoundedBatch(await query.withIndex("by_store_terminal_localEvent", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "posLocalSyncConflict") {
    return requireBoundedBatch(await query.withIndex("by_store_status", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "posLocalSyncCursor" || tableName === "posRegisterMappingAuthority") {
    return requireBoundedBatch(await query.withIndex("by_store_terminal", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "posRegisterAuthorityReplicationStatus") {
    return requireBoundedBatch(await query.withIndex("by_store_terminal", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "posLifecycleJournal") {
    return requireBoundedBatch(await query.withIndex("by_storeId_eventKey", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "reportingInventoryPosition") {
    return requireBoundedBatch(await query.withIndex("by_storeId_productSkuId", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "reportingInventoryEffectSourceReference") {
    return requireBoundedBatch(await query.withIndex("by_storeId_sourceType_sourceId", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "reportingInventoryEffect") {
    return requireBoundedBatch(await query.withIndex("by_storeId_productSkuId_occurrenceAt", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "approvalProof" || tableName === "approvalRequesterChallenge") {
    return requireBoundedBatch(await query.withIndex("by_storeId_action_subject", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "managerElevation") {
    return requireBoundedBatch(await query.withIndex("by_storeId_terminalId_accountId", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  return requireBoundedBatch(await query.withIndex("by_storeId", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
}

export async function countMutableDemoStoreRowsWithCtx(
  ctx: Pick<MutationCtx, "db">,
  storeId: Id<"store">,
) {
  const counts: Record<string, number> = {};
  for (const entry of SHARED_DEMO_MUTABLE_TABLES) {
    counts[entry.tableName] = (
      await listStoreRows(ctx, entry.tableName, storeId)
    ).length;
  }
  return counts;
}

export async function captureBaselineDocumentsWithCtx(
  ctx: MutationCtx,
  args: { storeId: Id<"store"> },
) {
    const prior = await ctx.db.query("sharedDemoBaselineDocument").withIndex("by_storeId", (q) => q.eq("storeId", args.storeId)).take(2_001);
    if (prior.length > 2_000) throw new Error("Demo baseline document capacity exceeded.");
    for (const row of prior) await ctx.db.delete("sharedDemoBaselineDocument", row._id);
    let captured = 0;
    for (const entry of SHARED_DEMO_MUTABLE_TABLES) {
      // Derived rows are purged by restore, never frozen into the baseline.
      if (isDerivedRestoreTable(entry.tableName)) continue;
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

export async function promoteBaselineDocumentsWithCtx(
  ctx: MutationCtx,
  args: {
    fromVersion: number;
    storeId: Id<"store">;
    transformDocument?: (row: {
      document: Record<string, unknown>;
      documentId: string;
      tableName: string;
    }) => Record<string, unknown>;
  },
) {
  const rows = await ctx.db
    .query("sharedDemoBaselineDocument")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .take(2_001);
  if (rows.length > 2_000) {
    throw new Error("Demo baseline document capacity exceeded.");
  }
  const patches = planBaselineDocumentPromotion({
    fromVersion: args.fromVersion,
    rows,
    toVersion: SHARED_DEMO_BASELINE_VERSION,
    transformDocument: args.transformDocument,
  });
  for (const patch of patches) {
    await ctx.db.patch("sharedDemoBaselineDocument", patch.rowId, {
      baselineVersion: patch.baselineVersion,
      document: patch.document,
    });
  }
  return { promoted: patches.length };
}

export const captureBaselineDocuments = internalMutation({
  args: { storeId: v.id("store") },
  handler: captureBaselineDocumentsWithCtx,
});

export async function restoreMutableDemoStoreRowsWithCtx(
  ctx: any,
  storeId: Id<"store">,
  options?: { baselineVersion?: number; skipTables?: readonly string[] },
) {
  let restored = 0;
  const actualCounts: Record<string, number> = {};
  const expectedCounts: Record<string, number> = {};
  const tablePlans: Array<{
    baseline: BaselineDocumentRow[];
    current: any[];
    entry: (typeof SHARED_DEMO_MUTABLE_TABLES)[number];
  }> = [];
  for (const entry of SHARED_DEMO_MUTABLE_TABLES) {
    if (options?.skipTables?.includes(entry.tableName)) continue;
    const [current, baselineRows]: [any[], BaselineDocumentRow[]] = await Promise.all([
      listStoreRows(ctx, entry.tableName, storeId),
      ctx.db.query("sharedDemoBaselineDocument").withIndex("by_storeId_tableName", (q: any) => q.eq("storeId", storeId).eq("tableName", entry.tableName)).take(500),
    ]);
    const baseline = requireCurrentBaselineDocuments(
      baselineRows,
      entry.tableName,
      options?.baselineVersion,
    );
    tablePlans.push({ baseline, current, entry });
  }

  const documentIds = new Map<string, string>();
  for (const { baseline, current } of tablePlans) {
    const currentIds = new Set(current.map((row) => String(row._id)));
    for (const snapshot of baseline) {
      if (currentIds.has(snapshot.documentId)) {
        documentIds.set(snapshot.documentId, snapshot.documentId);
      }
    }
  }
  for (const { baseline, entry } of tablePlans) {
    for (const snapshot of baseline) {
      if (documentIds.has(snapshot.documentId)) continue;
      const recreatedId = entry.tableName === "registerSession"
        ? await insertRegisterSessionWithAuthority(ctx, snapshot.document as any)
        : await ctx.db.insert(entry.tableName, snapshot.document);
      documentIds.set(snapshot.documentId, String(recreatedId));
    }
  }

  for (const { baseline, current, entry } of tablePlans) {
    const baselineIds = new Set(baseline.map((row: any) => row.documentId));
    for (const row of current) {
      if (!baselineIds.has(String(row._id))) {
        if (entry.tableName === "registerSession") {
          await deleteRegisterSessionWithAuthority(ctx, row._id);
        } else {
          await ctx.db.delete(entry.tableName, row._id);
        }
      }
    }
    for (const snapshot of baseline) {
      const documentId = documentIds.get(snapshot.documentId);
      if (!documentId) throw new Error(`Demo baseline document could not be recreated for ${entry.tableName}.`);
      const document = remapDocumentIds(snapshot.document, documentIds);
      if (entry.tableName === "registerSession") {
        await replaceRegisterSessionWithAuthority(
          ctx,
          documentId as Id<"registerSession">,
          document as any,
        );
      } else {
        await ctx.db.replace(entry.tableName, documentId, document);
      }
      await ctx.db.patch("sharedDemoBaselineDocument", (snapshot as any)._id, {
        document,
        documentId,
      });
      restored += 1;
    }
    const verified = await listStoreRows(ctx, entry.tableName, storeId);
    if (verified.length !== baseline.length) throw new Error(`Demo restore verification failed for ${entry.tableName}.`);
    actualCounts[entry.domain] = (actualCounts[entry.domain] ?? 0) + verified.length;
    expectedCounts[entry.domain] = (expectedCounts[entry.domain] ?? 0) + baseline.length;
  }
  return { actualCounts, expectedCounts, restored };
}
