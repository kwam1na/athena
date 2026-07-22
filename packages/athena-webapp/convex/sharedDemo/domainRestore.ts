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
  // Keeping it outside this registry prevents an hourly restore from
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
  { domain: "inventory", tableName: "reportingInventoryOccurrenceReplay" },
  { domain: "inventory", tableName: "reportingInventoryOccurrenceReplayLot" },
  { domain: "inventory", tableName: "reportingInventoryOccurrenceReplayOutcome" },
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
  { domain: "reporting", tableName: "reportingIngress" },
  { domain: "reporting", tableName: "reportingIngressSourceReference" },
  { domain: "reporting", tableName: "reportingIngressLine" },
  { domain: "reporting", tableName: "reportingIngressConflict" },
  { domain: "reporting", tableName: "reportingFact" },
  { domain: "reporting", tableName: "reportingFactSourceReference" },
  { domain: "reporting", tableName: "reportingFactProcessingAttempt" },
  { domain: "reporting", tableName: "reportingQuarantine" },
  { domain: "reporting", tableName: "reportingProjectionHealth" },
  { domain: "reporting", tableName: "reportingReconciliationDiscrepancy" },
  { domain: "reporting", tableName: "reportingProjectionGeneration" },
  { domain: "reporting", tableName: "reportingProjectionActivation" },
  { domain: "reporting", tableName: "reportingStoreDayProjection" },
  { domain: "reporting", tableName: "reportingStoreIntradayProjection" },
  { domain: "reporting", tableName: "reportingStoreIntradayScheduleState" },
  { domain: "reporting", tableName: "reportingSkuDayProjection" },
  { domain: "reporting", tableName: "reportingCurrentValuationProjection" },
  { domain: "reporting", tableName: "reportingRangeProjection" },
  { domain: "reporting", tableName: "reportingAttentionProjection" },
  { domain: "reporting", tableName: "reportingDailyCloseProjection" },
  { domain: "reporting", tableName: "reportingSkuInsightProjection" },
  { domain: "reporting", tableName: "reportingMetricCoverage" },
  { domain: "reporting", tableName: "reportingStorePeriodSummary" },
  { domain: "reporting", tableName: "reportingSkuPeriodSummary" },
  { domain: "reporting", tableName: "reportingSkuPeriodClassification" },
  { domain: "reporting", tableName: "reportingPeriodRollup" },
  { domain: "reporting", tableName: "reportingPeriodFacet" },
  { domain: "reporting", tableName: "reportingInventoryExposureSummary" },
  { domain: "reporting", tableName: "reportingInventoryMovementSummary" },
  { domain: "reporting", tableName: "reportingInventoryPeriodSummary" },
  { domain: "reporting", tableName: "reportingDailyCloseTrust" },
  { domain: "reporting", tableName: "reportingReadCursorContext" },
  { domain: "reporting", tableName: "reportingWorkspaceMaterializationEpoch" },
  { domain: "reporting", tableName: "reportingWorkspaceReadModelActivation" },
  { domain: "reporting", tableName: "reportingReadBundle" },
  { domain: "reporting", tableName: "reportingReadBundleActivation" },
  { domain: "reporting", tableName: "reportingProjectionEvidence" },
  { domain: "reporting", tableName: "reportingSkuEvidence" },
  { domain: "staff", tableName: "staffProfile" },
  { domain: "staff", tableName: "staffCredential" },
  { domain: "staff", tableName: "staffMessage" },
] as const;
const RESTORE_BATCH_LIMIT = 500;
const REPORTING_STORE_INDEXES: Record<string, string> = {
  reportingAttentionProjection: "by_storeId_scope_primaryReason",
  reportingCurrentValuationProjection: "by_storeId_productSkuId",
  reportingDailyCloseProjection:
    "by_storeId_operatingDate_acceptedCloseVersion",
  reportingMetricCoverage: "by_storeId_metric_sourceDomain",
  reportingProjectionActivation:
    "by_storeId_projectionKind_activatedAt",
  reportingProjectionEvidence: "by_storeId_factId",
  reportingProjectionGeneration: "by_storeId_projectionKind_status",
  reportingRangeProjection: "by_storeId_rangeStartDate_rangeEndDate",
  reportingReadBundle: "by_storeId_createdAt",
  reportingReadBundleActivation: "by_storeId_activatedAt",
  reportingReadCursorContext: "by_storeId_athenaUserId_expiresAt",
  reportingSkuDayProjection: "by_storeId_productSkuId_operatingDate",
  reportingSkuEvidence: "by_storeId_productSkuId_recognitionAt_identityKey",
  reportingStoreDayProjection: "by_storeId_operatingDate_metric",
  reportingStoreIntradayProjection:
    "by_storeId_operatingDate_checkpointAt",
  reportingWorkspaceReadModelActivation:
    "by_storeId_projectionKind_activatedAt",
};

const REPORTING_GENERATION_INDEXES: Record<string, string> = {
  reportingDailyCloseTrust: "by_generationId_operatingDate",
  reportingInventoryExposureSummary: "by_generationId_productSkuId",
  reportingInventoryMovementSummary:
    "by_generationId_periodKey_productSkuId",
  reportingInventoryPeriodSummary: "by_generationId_periodKey",
  reportingPeriodFacet: "by_generationId_periodKey_facet_value",
  reportingPeriodRollup:
    "by_generationId_periodKey_dimension_dimensionId",
  reportingSkuInsightProjection: "by_generationId_productSkuId",
  reportingSkuPeriodClassification: "by_gen_period_class_sku",
  reportingSkuPeriodSummary:
    "by_generationId_periodKey_productSkuId",
  reportingStoreIntradayScheduleState: "by_generationId_operatingDate",
  reportingStorePeriodSummary: "by_generationId_periodKey",
};

export function requireBoundedBatch<T>(rows: T[], tableName: string) {
  if (rows.length > RESTORE_BATCH_LIMIT) throw new Error(`Demo restore batch required for ${tableName}.`);
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
  const reportingStoreIndex = REPORTING_STORE_INDEXES[tableName];
  if (reportingStoreIndex) {
    return requireBoundedBatch(
      await ctx.db
        .query(tableName)
        .withIndex(reportingStoreIndex, (q: any) => q.eq("storeId", storeId))
        .take(RESTORE_BATCH_LIMIT + 1),
      tableName,
    );
  }
  const reportingGenerationIndex = REPORTING_GENERATION_INDEXES[tableName];
  if (
    reportingGenerationIndex ||
    tableName === "reportingWorkspaceMaterializationEpoch"
  ) {
    const generations = await ctx.db
      .query("reportingProjectionGeneration")
      .withIndex("by_storeId_projectionKind_status", (q: any) =>
        q.eq("storeId", storeId),
      )
      .take(RESTORE_BATCH_LIMIT + 1);
    requireBoundedBatch(generations, "reportingProjectionGeneration");
    const indexName =
      reportingGenerationIndex ??
      "by_sourceGenerationId_sourceWatermark";
    const parentField = reportingGenerationIndex
      ? "generationId"
      : "sourceGenerationId";
    const rows = (
      await Promise.all(
        generations.map((generation: any) =>
          ctx.db
            .query(tableName)
            .withIndex(indexName, (q: any) =>
              q.eq(parentField, generation._id),
            )
            .take(RESTORE_BATCH_LIMIT + 1),
        ),
      )
    ).flat();
    return requireBoundedBatch(rows, tableName);
  }
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
  if (
    tableName === "reportingInventoryOccurrenceReplayLot" ||
    tableName === "reportingInventoryOccurrenceReplayOutcome"
  ) {
    const replays = requireBoundedBatch(
      await ctx.db
        .query("reportingInventoryOccurrenceReplay")
        .withIndex("by_storeId_status_updatedAt", (q: any) =>
          q.eq("storeId", storeId),
        )
        .take(RESTORE_BATCH_LIMIT + 1),
      "reportingInventoryOccurrenceReplay",
    );
    const indexName =
      tableName === "reportingInventoryOccurrenceReplayLot"
        ? "by_replayId_status_occurredAt_outboundEffectId"
        : "by_replayId_status";
    return requireBoundedBatch(
      (
        await Promise.all(
          replays.map((replay: any) =>
            ctx.db
              .query(tableName)
              .withIndex(indexName, (q: any) => q.eq("replayId", replay._id))
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
  const query = ctx.db.query(tableName);
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
  if (
    tableName === "reportingInventoryDeficitResolutionWork" ||
    tableName === "reportingInventoryOccurrenceReplay"
  ) {
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
  if (tableName === "reportingIngress") {
    return requireBoundedBatch(await query.withIndex("by_storeId_status_acceptedAt", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (
    tableName === "reportingIngressSourceReference" ||
    tableName === "reportingFactSourceReference" ||
    tableName === "reportingInventoryEffectSourceReference"
  ) {
    return requireBoundedBatch(await query.withIndex("by_storeId_sourceType_sourceId", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "reportingIngressLine") {
    return requireBoundedBatch(await query.withIndex("by_storeId_productSkuId_createdAt", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (
    tableName === "reportingIngressConflict" ||
    tableName === "reportingQuarantine" ||
    tableName === "reportingReconciliationDiscrepancy"
  ) {
    return requireBoundedBatch(await query.withIndex("by_storeId_status_detectedAt", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "reportingFactProcessingAttempt") {
    return requireBoundedBatch(await query.withIndex("by_storeId_outcome_startedAt", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
  }
  if (tableName === "reportingProjectionHealth") {
    return requireBoundedBatch(await query.withIndex("by_storeId_sourceDomain_projectionKind", (q: any) => q.eq("storeId", storeId)).take(RESTORE_BATCH_LIMIT + 1), tableName);
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
