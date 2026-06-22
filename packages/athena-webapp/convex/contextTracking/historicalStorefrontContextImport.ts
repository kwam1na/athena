import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { contextEventAppendArgsValidator } from "../schemas/contextTracking";
import {
  compileLegacyStorefrontAnalyticsRow,
  type StorefrontContextAnalyticsRecord,
} from "./legacyStorefrontAnalytics";

type ContextEventAppendArgs = {
  [key: string]: unknown;
};

export const recordHistoricalStorefrontContextImportRun = internalMutation({
  args: {
    importRunId: v.string(),
    importBatchId: v.optional(v.string()),
    runKey: v.string(),
    storeId: v.id("store"),
    organizationId: v.optional(v.id("organization")),
    mode: v.union(v.literal("dry_run"), v.literal("write")),
    status: v.union(
      v.literal("dry_run_recorded"),
      v.literal("write_planned"),
      v.literal("write_applied"),
    ),
    windowStartAt: v.optional(v.number()),
    windowEndAt: v.optional(v.number()),
    cursor: v.optional(v.string()),
    nextCursor: v.optional(v.string()),
    reviewedMappingApproval: v.optional(
      v.object({
        approvedBy: v.string(),
        approvedAt: v.number(),
        mappingVersion: v.string(),
      }),
    ),
    report: v.record(v.string(), v.any()),
    now: v.optional(v.number()),
  },
  returns: v.object({
    importRunId: v.string(),
    recordedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const existing = await ctx.db
      .query("contextEventImportRun")
      .withIndex("by_storeId_importRunId", (q) =>
        q.eq("storeId", args.storeId).eq("importRunId", args.importRunId),
      )
      .first();

    const record = buildHistoricalStorefrontContextImportRunRecord({
      ...args,
      now,
    });
    const operation = selectHistoricalStorefrontContextImportRunWriteOperation(
      existing,
    );

    if (operation === "patch" && existing) {
      await ctx.db.patch("contextEventImportRun", existing._id, record);
    } else {
      await ctx.db.insert("contextEventImportRun", {
        ...record,
        createdAt: now,
      });
    }

    return { importRunId: args.importRunId, recordedAt: now };
  },
});

export function selectHistoricalStorefrontContextImportRunWriteOperation(
  existing: unknown,
) {
  return existing ? "patch" : "insert";
}

export function buildHistoricalStorefrontContextImportRunRecord(args: {
  importRunId: string;
  importBatchId?: string;
  runKey: string;
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  mode: "dry_run" | "write";
  status: "dry_run_recorded" | "write_planned" | "write_applied";
  windowStartAt?: number;
  windowEndAt?: number;
  cursor?: string;
  nextCursor?: string;
  reviewedMappingApproval?: HistoricalStorefrontImportApproval;
  report: Record<string, unknown>;
  now: number;
}) {
  return {
    importRunId: args.importRunId,
    importBatchId: args.importBatchId,
    runKey: args.runKey,
    storeId: args.storeId,
    organizationId: args.organizationId,
    mode: args.mode,
    status: args.status,
    windowStartAt: args.windowStartAt,
    windowEndAt: args.windowEndAt,
    cursor: args.cursor,
    nextCursor: args.nextCursor,
    reviewedMappingApproval: args.reviewedMappingApproval,
    report: args.report,
    updatedAt: args.now,
  };
}

export const quarantineHistoricalStorefrontContextImportRun = internalMutation({
  args: {
    storeId: v.id("store"),
    importRunId: v.string(),
    status: v.union(v.literal("quarantined"), v.literal("revoked")),
    reason: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  returns: v.object({
    importRunId: v.string(),
    patchedContextEventCount: v.number(),
    patchedImportRunCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    let patchedContextEventCount = 0;

    while (true) {
      const contextEvents = await ctx.db
        .query("contextEvent")
        .withIndex("by_storeId_historicalImportRunId_status", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("historicalImportRunId", args.importRunId)
            .eq("historicalImportStatus", "active"),
        )
        .take(500);

      if (contextEvents.length === 0) break;

      for (const event of contextEvents) {
        await ctx.db.patch(
          "contextEvent",
          event._id,
          buildHistoricalContextEventQuarantinePatch(args.status),
        );
      }

      patchedContextEventCount += contextEvents.length;
    }

    const importRuns = await ctx.db
      .query("contextEventImportRun")
      .withIndex("by_storeId_importRunId", (q) =>
        q.eq("storeId", args.storeId).eq("importRunId", args.importRunId),
      )
      .take(50);

    for (const importRun of importRuns) {
      await ctx.db.patch("contextEventImportRun", importRun._id, {
        ...buildHistoricalImportRunQuarantinePatch({
          status: args.status,
          reason: args.reason,
          now,
        }),
      });
    }

    return {
      importRunId: args.importRunId,
      patchedContextEventCount,
      patchedImportRunCount: importRuns.length,
    };
  },
});

export function buildHistoricalContextEventQuarantinePatch(
  status: "quarantined" | "revoked",
) {
  return {
    historicalImportStatus: status,
    nonCompilable: true,
  };
}

export function buildHistoricalImportRunQuarantinePatch(args: {
  status: "quarantined" | "revoked";
  reason?: string;
  now: number;
}) {
  return {
    status: args.status,
    quarantineReason: args.reason,
    updatedAt: args.now,
  };
}

export type HistoricalImportMode = "dry_run" | "write";

export type HistoricalStorefrontImportApproval = {
  approvedBy: string;
  approvedAt: number;
  mappingVersion: string;
};

export type HistoricalStorefrontImportRow = Parameters<
  typeof compileLegacyStorefrontAnalyticsRow
>[0] & {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  storeFrontActorKind?: "storefrontUser" | "guest";
};

export type HistoricalStorefrontImportInput = {
  importRunId: string;
  importBatchId?: string;
  mode: HistoricalImportMode;
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  windowStartAt?: number;
  windowEndAt?: number;
  cursor?: string;
  rows: HistoricalStorefrontImportRow[];
  existingIdempotencyKeys?: ReadonlySet<string>;
  conflictIdempotencyKeys?: ReadonlySet<string>;
  approval?: HistoricalStorefrontImportApproval;
  now?: number;
  maxBatchSize?: number;
  stopThresholds?: {
    maxRejectedRows?: number;
    maxConflictRows?: number;
  };
};

export type HistoricalStorefrontImportReport = {
  importRunId: string;
  mode: HistoricalImportMode;
  storeId: string;
  windowStartAt?: number;
  windowEndAt?: number;
  cursor?: string;
  nextCursor?: string;
  scannedRowCount: number;
  importableRowCount: number;
  duplicateRowCount: number;
  conflictRowCount: number;
  rejectedRowCount: number;
  omittedFieldCount: number;
  syntheticRowCount: number;
  stopped: boolean;
  stopReason?: string;
  eventFamilyCounts: Record<string, number>;
  actionCounts: Record<string, number>;
  payloadKeyCounts: Record<string, number>;
  rejectionReasons: Record<string, number>;
};

export type HistoricalStorefrontImportPlan = {
  report: HistoricalStorefrontImportReport;
  appendArgs: ContextEventAppendArgs[];
};

export function planHistoricalStorefrontContextImport(
  input: HistoricalStorefrontImportInput,
): HistoricalStorefrontImportPlan {
  if (input.mode === "write" && !input.approval) {
    return {
      appendArgs: [],
      report: buildStoppedReport(input, "write_requires_mapping_approval"),
    };
  }

  const now = input.now ?? Date.now();
  const maxBatchSize = input.maxBatchSize ?? input.rows.length;
  const report = createEmptyReport(input);
  const appendArgs: ContextEventAppendArgs[] = [];

  for (const row of input.rows.slice(0, maxBatchSize)) {
    report.scannedRowCount += 1;
    increment(report.actionCounts, row.action);
    for (const key of Object.keys(row.data ?? {})) {
      increment(report.payloadKeyCounts, key);
    }

    const compiled = compileLegacyStorefrontAnalyticsRow(row);
    if (!compiled) {
      report.rejectedRowCount += 1;
      increment(report.rejectionReasons, "unmappable_or_missing_required_context");
      if (shouldStop(input, report)) break;
      continue;
    }

    increment(report.eventFamilyCounts, compiled.contextEventId);
    if (compiled.synthetic) report.syntheticRowCount += 1;

    const idempotencyKey = buildHistoricalImportIdempotencyKey(
      input.importRunId,
      compiled,
    );
    if (input.conflictIdempotencyKeys?.has(idempotencyKey)) {
      report.conflictRowCount += 1;
      if (shouldStop(input, report)) break;
      continue;
    }
    if (input.existingIdempotencyKeys?.has(idempotencyKey)) {
      report.duplicateRowCount += 1;
      continue;
    }

    report.importableRowCount += 1;
    report.omittedFieldCount += countOmittedFields(row, compiled);
    if (input.mode === "dry_run") {
      if (shouldStop(input, report)) break;
      continue;
    }

    appendArgs.push(
      buildHistoricalContextEventAppendArgs({
        row,
        compiled,
        importRunId: input.importRunId,
        importBatchId: input.importBatchId,
        idempotencyKey,
        now,
      }),
    );

    if (shouldStop(input, report)) break;
  }

  report.nextCursor =
    input.rows.length > maxBatchSize
      ? String(input.rows[maxBatchSize - 1]?._id ?? maxBatchSize)
      : undefined;

  return { report, appendArgs: input.mode === "write" ? appendArgs : [] };
}

export function buildHistoricalImportIdempotencyKey(
  _importRunId: string,
  compiled: StorefrontContextAnalyticsRecord,
) {
  return [
    "historical_storefront_analytics",
    compiled.sourceTable,
    compiled.sourceId ?? compiled._id ?? "unknown",
    compiled.contextEventId,
    compiled.contextSchemaVersion,
  ].join(":");
}

export function buildHistoricalStorefrontContextImportRunKey(input: {
  storeId: string;
  windowStartAt?: number;
  windowEndAt?: number;
}) {
  return [
    "historical-storefront-context",
    input.storeId,
    input.windowStartAt ?? "start",
    input.windowEndAt ?? "end",
  ].join(":");
}

function buildHistoricalContextEventAppendArgs(input: {
  row: HistoricalStorefrontImportRow;
  compiled: StorefrontContextAnalyticsRecord;
  importRunId: string;
  importBatchId?: string;
  idempotencyKey: string;
  now: number;
}): ContextEventAppendArgs {
  const actorRef = input.row.storeFrontUserId && input.row.storeFrontActorKind
    ? {
        kind: input.row.storeFrontActorKind,
        id: String(input.row.storeFrontUserId),
      }
    : undefined;

  return {
    storeId: input.row.storeId,
    organizationId: input.row.organizationId,
    surface: "storefront",
    eventId: input.compiled.contextEventId,
    schemaVersion: input.compiled.contextSchemaVersion,
    idempotencyKey: input.idempotencyKey,
    occurredAt: input.compiled._creationTime,
    origin: input.row.origin,
    payload: input.compiled.payload,
    actorRef,
    sessionRef: undefined,
    primarySubject: buildPrimarySubject(input.compiled),
    subjectRefs: buildPrimarySubject(input.compiled)
      ? [buildPrimarySubject(input.compiled)!]
      : undefined,
    sourceRefs: [
      {
        table: input.compiled.sourceTable,
        id: input.compiled.sourceId ?? String(input.row._id),
        label: input.compiled.contextEventId,
        surface: "storefront",
        eventId: input.compiled.contextEventId,
        schemaVersion: input.compiled.contextSchemaVersion,
        redaction: "historical_import_no_raw_payload",
        synthetic: input.compiled.synthetic,
      },
      {
        table: "contextEventImportRun",
        id: input.importRunId,
        label: "historical_storefront_context_import",
        redaction: "metadata_only",
      },
    ],
    visibilityMode: "store_admin",
    retentionClass: "standard",
    synthetic: input.compiled.synthetic,
    historicalImportRunId: input.importRunId,
    historicalImportBatchId: input.importBatchId ?? input.importRunId,
    historicalImportStatus: "active",
  };
}

function buildPrimarySubject(compiled: StorefrontContextAnalyticsRecord) {
  if (compiled.contextEventId === "storefront.product_viewed") {
    return compiled.payload.productId
      ? { type: "product", id: String(compiled.payload.productId) }
      : undefined;
  }
  if (compiled.contextEventId === "storefront.cart_changed") {
    return compiled.payload.cartId
      ? { type: "cart", id: String(compiled.payload.cartId) }
      : undefined;
  }
  if (compiled.contextEventId === "storefront.checkout_state_changed") {
    if (compiled.payload.checkoutSessionId) {
      return {
        type: "checkoutSession",
        id: String(compiled.payload.checkoutSessionId),
      };
    }
    if (compiled.payload.orderId) {
      return { type: "onlineOrder", id: String(compiled.payload.orderId) };
    }
  }
  return undefined;
}

function countOmittedFields(
  row: HistoricalStorefrontImportRow,
  compiled: StorefrontContextAnalyticsRecord,
) {
  return Object.keys(row.data ?? {}).filter((key) => !(key in compiled.payload))
    .length;
}

function createEmptyReport(
  input: HistoricalStorefrontImportInput,
): HistoricalStorefrontImportReport {
  return {
    importRunId: input.importRunId,
    mode: input.mode,
    storeId: String(input.storeId),
    windowStartAt: input.windowStartAt,
    windowEndAt: input.windowEndAt,
    cursor: input.cursor,
    scannedRowCount: 0,
    importableRowCount: 0,
    duplicateRowCount: 0,
    conflictRowCount: 0,
    rejectedRowCount: 0,
    omittedFieldCount: 0,
    syntheticRowCount: 0,
    stopped: false,
    eventFamilyCounts: {},
    actionCounts: {},
    payloadKeyCounts: {},
    rejectionReasons: {},
  };
}

function buildStoppedReport(
  input: HistoricalStorefrontImportInput,
  stopReason: string,
): HistoricalStorefrontImportReport {
  return {
    ...createEmptyReport(input),
    stopped: true,
    stopReason,
  };
}

function shouldStop(
  input: HistoricalStorefrontImportInput,
  report: HistoricalStorefrontImportReport,
) {
  const maxRejectedRows = input.stopThresholds?.maxRejectedRows;
  if (maxRejectedRows !== undefined && report.rejectedRowCount > maxRejectedRows) {
    report.stopped = true;
    report.stopReason = "rejected_threshold_exceeded";
    return true;
  }

  const maxConflictRows = input.stopThresholds?.maxConflictRows;
  if (maxConflictRows !== undefined && report.conflictRowCount > maxConflictRows) {
    report.stopped = true;
    report.stopReason = "conflict_threshold_exceeded";
    return true;
  }

  return false;
}

function increment(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}
