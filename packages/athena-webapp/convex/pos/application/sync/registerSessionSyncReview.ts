import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import {
  isRegisterCloseoutReviewConflict,
  REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY,
} from "../../../../shared/registerSessionLifecyclePolicy";

const SYNC_CONFLICT_LIMIT = 500;
const MANAGER_REJECTED_SYNC_REVIEW_CODE = "manager_rejected";
const SYNCED_SALE_INVENTORY_REVIEW_WORK_ITEM_TYPE =
  "synced_sale_inventory_review";
export const REGISTER_NOT_OPEN_SYNC_REVIEW_SUMMARY =
  "Register was not open before this sale synced.";
export const STAFF_ACCESS_SYNC_REVIEW_SUMMARY =
  "Staff access changed before this POS history synced.";
export const SERVICE_CUSTOMER_ATTRIBUTION_SYNC_REVIEW_SUMMARY =
  "Service line is missing customer attribution.";
export const CLOSED_REGISTER_SYNCED_CLOSEOUT_SUMMARY =
  "Register session is not open for synced POS closeout.";
export const INVENTORY_SYNC_REVIEW_SUMMARY =
  "Inventory needs manager review for a synced offline sale.";
export const MISSING_REGISTER_SESSION_MAPPING_SYNC_REVIEW_SUMMARY =
  "Register session mapping is missing for synced POS history.";
export const DUPLICATE_POS_SESSION_SALE_SYNC_REVIEW_SUMMARY =
  "Local POS session id was reused by a different synced sale.";
export const DUPLICATE_REGISTER_OPEN_SYNC_REVIEW_SUMMARIES = new Set([
  "A register session is already open for this terminal.",
  "A register session is already open for this register number.",
  "Local register session id was reused by a different synced register open.",
]);

export type RegisterSessionSyncReviewActionPolicy =
  "apply_or_reject" | "override_or_reject" | "reject_only";

export type RegisterSessionSyncReviewKind =
  | "duplicate_register_closeout"
  | "duplicate_register_open"
  | "duplicate_pos_session_sale"
  | "register_closeout_variance"
  | "register_not_open_sale"
  | "missing_register_session_mapping"
  | "server_rejected"
  | "service_customer_attribution"
  | "inventory_review"
  | "staff_access"
  | "unknown";

export type RegisterSessionSyncSaleSummary = {
  cashAmount?: number | null;
  itemCount?: number | null;
  items?: Array<{
    name: string;
    productSkuId?: string | null;
    quantity?: number | null;
    sku?: string | null;
    total?: number | null;
  }>;
  localReceiptNumber?: string | null;
  localTransactionId?: string | null;
  occurredAt?: number | null;
  paymentMethods?: string[];
  receiptNumber?: string | null;
  staffName?: string | null;
  staffProfileId?: Id<"staffProfile"> | null;
  total?: number | null;
  totalPaid?: number | null;
  transactionId?: Id<"posTransaction"> | null;
};

export type RegisterSessionSyncConflict = {
  _id: string;
  conflictType?: string;
  createdAt: number;
  details?: Record<string, unknown>;
  localEventId: string;
  localRegisterSessionId?: string;
  sequence: number;
  sale?: RegisterSessionSyncSaleSummary | null;
  sourceEventNotes?: string | null;
  status: string;
  storeId?: Id<"store">;
  summary?: string;
  terminalId?: Id<"posTerminal">;
};

export type RegisterSessionLocalSyncStatus = {
  status: "needs_review";
  reconciliationItems: Array<{
    createdAt?: number | null;
    countedCash?: number | null;
    expectedCash?: number | null;
    id?: string;
    localEventId?: string | null;
    notes?: string | null;
    reviewKind?: RegisterSessionSyncReviewKind;
    actionPolicy?: RegisterSessionSyncReviewActionPolicy;
    sequence?: number | null;
    status?: string | null;
    summary?: string | null;
    sale?: RegisterSessionSyncSaleSummary | null;
    inventoryReview?: {
      activeHeldQuantity?: number | null;
      availableInventoryCount?: number | null;
      heldForSession?: number | null;
      inventoryImportProvisionalSkuId?: string | null;
      pendingCheckoutItemId?: string | null;
      productSkuId?: string | null;
      quantityAvailable?: number | null;
      quantityAvailableAfterHolds?: number | null;
      reason?: string | null;
      requestedQuantity?: number | null;
    } | null;
    type?: string | null;
    variance?: number | null;
  }>;
};

type ListOpenLocalSyncConflictsOptions = {
  includeRejectedEvidence?: boolean;
  includeTransactionMappingEvidence?: boolean;
  limit?: number;
  registerSessionIds?: Array<Id<"registerSession">>;
};

function getSyncConflictReconciliationType(
  review: RegisterSessionSyncReviewClassification,
) {
  if (
    review.reviewKind === "duplicate_register_closeout" ||
    review.reviewKind === "register_closeout_variance"
  ) {
    return "register_closeout";
  }

  if (review.reviewKind === "server_rejected") {
    return "server_rejected";
  }

  return review.conflictType ?? null;
}

type RegisterSessionSyncReviewClassification = {
  actionPolicy: RegisterSessionSyncReviewActionPolicy;
  conflictType?: string;
  reviewKind: RegisterSessionSyncReviewKind;
};

export function classifyRegisterSessionSyncReview(
  conflict: Pick<
    RegisterSessionSyncConflict,
    "conflictType" | "details" | "localEventId" | "status" | "summary"
  >,
): RegisterSessionSyncReviewClassification {
  const summary = conflict.summary?.trim() ?? "";
  const details = conflict.details ?? {};

  if (
    conflict.status === "rejected" ||
    conflict.conflictType === "server_rejected"
  ) {
    return {
      actionPolicy: "override_or_reject",
      conflictType: "server_rejected",
      reviewKind: "server_rejected",
    };
  }

  if (summary === CLOSED_REGISTER_SYNCED_CLOSEOUT_SUMMARY) {
    return {
      actionPolicy: "reject_only",
      conflictType: conflict.conflictType,
      reviewKind: "duplicate_register_closeout",
    };
  }

  if (
    summary === DUPLICATE_POS_SESSION_SALE_SYNC_REVIEW_SUMMARY ||
    (conflict.conflictType === "duplicate_local_id" &&
      details.localIdKind === "posSession" &&
      typeof details.localTransactionId === "string")
  ) {
    return {
      actionPolicy: "apply_or_reject",
      conflictType: conflict.conflictType,
      reviewKind: "duplicate_pos_session_sale",
    };
  }

  if (DUPLICATE_REGISTER_OPEN_SYNC_REVIEW_SUMMARIES.has(summary)) {
    return {
      actionPolicy: "reject_only",
      conflictType: conflict.conflictType,
      reviewKind: "duplicate_register_open",
    };
  }

  if (
    isRegisterCloseoutReviewConflict({
      details,
      localEventId: conflict.localEventId,
      status: conflict.status,
      summary,
    })
  ) {
    return {
      actionPolicy: "apply_or_reject",
      conflictType: conflict.conflictType,
      reviewKind: "register_closeout_variance",
    };
  }

  if (summary === MISSING_REGISTER_SESSION_MAPPING_SYNC_REVIEW_SUMMARY) {
    return {
      actionPolicy: "apply_or_reject",
      conflictType: conflict.conflictType,
      reviewKind: "missing_register_session_mapping",
    };
  }

  if (summary === REGISTER_NOT_OPEN_SYNC_REVIEW_SUMMARY) {
    return {
      actionPolicy: "apply_or_reject",
      conflictType: conflict.conflictType,
      reviewKind: "register_not_open_sale",
    };
  }

  if (summary === STAFF_ACCESS_SYNC_REVIEW_SUMMARY) {
    return {
      actionPolicy: "apply_or_reject",
      conflictType: conflict.conflictType,
      reviewKind: "staff_access",
    };
  }

  if (
    summary === INVENTORY_SYNC_REVIEW_SUMMARY ||
    conflict.conflictType === "inventory"
  ) {
    return {
      actionPolicy: "apply_or_reject",
      conflictType: conflict.conflictType,
      reviewKind: "inventory_review",
    };
  }

  if (summary === SERVICE_CUSTOMER_ATTRIBUTION_SYNC_REVIEW_SUMMARY) {
    return {
      actionPolicy: "reject_only",
      conflictType: conflict.conflictType,
      reviewKind: "service_customer_attribution",
    };
  }

  return {
    actionPolicy: "reject_only",
    conflictType: conflict.conflictType,
    reviewKind: "unknown",
  };
}

function numberDetail(
  details: Record<string, unknown> | undefined,
  key: string,
) {
  const value = details?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringDetail(
  details: Record<string, unknown> | undefined,
  key: string,
) {
  const value = details?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function syncConflictEventKey(
  conflict: Pick<RegisterSessionSyncConflict, "localEventId" | "terminalId">,
) {
  return [conflict.terminalId, conflict.localEventId].join(":");
}

async function hasInventoryReviewWorkItemForProjectedSale(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
  conflict: Doc<"posLocalSyncConflict">,
) {
  if (
    classifyRegisterSessionSyncReview(conflict).reviewKind !==
    "inventory_review"
  ) {
    return false;
  }

  const syncEvent = await ctx.db
    .query("posLocalSyncEvent")
    .withIndex("by_store_terminal_localEvent", (q) =>
      q
        .eq("storeId", conflict.storeId)
        .eq("terminalId", conflict.terminalId)
        .eq("localEventId", conflict.localEventId),
    )
    .unique();
  if (
    syncEvent?.eventType !== "sale_completed" ||
    typeof syncEvent.projectedAt !== "number"
  ) {
    return false;
  }

  const localTransactionId =
    stringDetail(conflict.details, "localTransactionId") ??
    stringDetail(syncEvent.payload, "localTransactionId");
  if (!localTransactionId || !conflict.terminalId) {
    return false;
  }

  const canonicalLocalId = `${localTransactionId}:inventory-review`;
  const mapping = await ctx.db
    .query("posLocalSyncMapping")
    .withIndex("by_store_terminal_local", (q) =>
      q
        .eq("storeId", storeId)
        .eq("terminalId", conflict.terminalId!)
        .eq("localRegisterSessionId", conflict.localRegisterSessionId)
        .eq("localIdKind", "inventoryReviewWorkItem")
        .eq("localId", canonicalLocalId),
    )
    .unique();
  if (
    !mapping ||
    mapping.cloudTable !== "operationalWorkItem" ||
    !ctx.db.normalizeId("operationalWorkItem", mapping.cloudId)
  ) {
    return false;
  }

  const workItem = await ctx.db.get(
    "operationalWorkItem",
    mapping.cloudId as Id<"operationalWorkItem">,
  );
  if (
    !workItem ||
    workItem.storeId !== storeId ||
    !["open", "in_progress", "completed", "cancelled"].includes(
      workItem.status,
    ) ||
    workItem.type !== SYNCED_SALE_INVENTORY_REVIEW_WORK_ITEM_TYPE
  ) {
    return false;
  }

  const metadata = workItem.metadata ?? {};
  return (
    metadata.localEventId === conflict.localEventId &&
    metadata.localRegisterSessionId === conflict.localRegisterSessionId &&
    metadata.localTransactionId === localTransactionId
  );
}

async function isNonSaleMissingRegisterSessionMappingConflict(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
  conflict: Doc<"posLocalSyncConflict">,
) {
  if (
    classifyRegisterSessionSyncReview(conflict).reviewKind !==
      "missing_register_session_mapping" ||
    !conflict.terminalId
  ) {
    return false;
  }

  const syncEvent = await ctx.db
    .query("posLocalSyncEvent")
    .withIndex("by_store_terminal_localEvent", (q) =>
      q
        .eq("storeId", conflict.storeId ?? storeId)
        .eq("terminalId", conflict.terminalId!)
        .eq("localEventId", conflict.localEventId),
    )
    .unique();

  return Boolean(syncEvent && syncEvent.eventType !== "sale_completed");
}

function recordDetail(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayDetail(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map(recordDetail)
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function buildInventoryReviewDetail(details?: Record<string, unknown>) {
  if (!details) return null;

  const review = {
    activeHeldQuantity: numberDetail(details, "activeHeldQuantity"),
    availableInventoryCount: numberDetail(details, "availableInventoryCount"),
    heldForSession: numberDetail(details, "heldForSession"),
    inventoryImportProvisionalSkuId: stringDetail(
      details,
      "inventoryImportProvisionalSkuId",
    ),
    pendingCheckoutItemId: stringDetail(details, "pendingCheckoutItemId"),
    productSkuId: stringDetail(details, "productSkuId"),
    quantityAvailable: numberDetail(details, "quantityAvailable"),
    quantityAvailableAfterHolds: numberDetail(
      details,
      "quantityAvailableAfterHolds",
    ),
    reason: stringDetail(details, "reason"),
    requestedQuantity: numberDetail(details, "requestedQuantity"),
  };

  return Object.values(review).some((value) => value !== null) ? review : null;
}

function summarizeSaleItems(payload: Record<string, unknown>) {
  const retailItems = arrayDetail(payload.items).map((item) => {
    const quantity = numberDetail(item, "quantity");
    const unitPrice = numberDetail(item, "unitPrice");
    return {
      name:
        stringDetail(item, "productName") ??
        stringDetail(item, "name") ??
        "Sale item",
      productSkuId: stringDetail(item, "productSkuId"),
      quantity,
      sku: stringDetail(item, "productSku"),
      total:
        quantity !== null && unitPrice !== null
          ? Math.round(quantity * unitPrice * 100) / 100
          : null,
    };
  });
  const serviceItems = arrayDetail(payload.serviceLines).map((line) => ({
    name:
      stringDetail(line, "serviceCatalogName") ??
      stringDetail(line, "name") ??
      "Service line",
    quantity: numberDetail(line, "quantity"),
    sku: null,
    total: numberDetail(line, "totalPrice"),
  }));

  return [...retailItems, ...serviceItems];
}

function buildSyncSaleSummary(
  syncEvent?: Doc<"posLocalSyncEvent"> | null,
  transactionId?: Id<"posTransaction"> | null,
): RegisterSessionSyncSaleSummary | null {
  if (!syncEvent || syncEvent.eventType !== "sale_completed") {
    return null;
  }

  const payload = syncEvent.payload ?? {};
  const totals = recordDetail(payload.totals);
  const payments = arrayDetail(payload.payments);
  const items = summarizeSaleItems(payload);
  const paymentMethods = Array.from(
    new Set(
      payments
        .map((payment) => stringDetail(payment, "method"))
        .filter((method): method is string => Boolean(method)),
    ),
  );
  const totalPaid = payments.reduce(
    (sum, payment) => sum + Math.max(0, numberDetail(payment, "amount") ?? 0),
    0,
  );
  const cashAmount = payments
    .filter((payment) => stringDetail(payment, "method") === "cash")
    .reduce(
      (sum, payment) => sum + Math.max(0, numberDetail(payment, "amount") ?? 0),
      0,
    );

  return {
    cashAmount: cashAmount > 0 ? cashAmount : null,
    itemCount: items.reduce(
      (sum, item) => sum + Math.max(0, item.quantity ?? 0),
      0,
    ),
    items,
    localReceiptNumber: stringDetail(payload, "localReceiptNumber"),
    localTransactionId: stringDetail(payload, "localTransactionId"),
    occurredAt: syncEvent.occurredAt,
    paymentMethods,
    receiptNumber: stringDetail(payload, "receiptNumber"),
    staffProfileId: syncEvent.staffProfileId,
    total: totals ? numberDetail(totals, "total") : null,
    totalPaid,
    transactionId: transactionId ?? null,
  };
}

async function findTransactionIdForSyncEvent(
  ctx: Pick<QueryCtx, "db">,
  syncEvent?: Doc<"posLocalSyncEvent"> | null,
) {
  if (
    !syncEvent ||
    syncEvent.eventType !== "sale_completed" ||
    !syncEvent.localRegisterSessionId
  ) {
    return null;
  }

  const localTransactionId = stringDetail(
    syncEvent.payload,
    "localTransactionId",
  );
  if (!localTransactionId) {
    return null;
  }

  const mapping = await ctx.db
    .query("posLocalSyncMapping")
    .withIndex("by_store_terminal_local", (q) =>
      q
        .eq("storeId", syncEvent.storeId)
        .eq("terminalId", syncEvent.terminalId)
        .eq("localRegisterSessionId", syncEvent.localRegisterSessionId)
        .eq("localIdKind", "transaction")
        .eq("localId", localTransactionId),
    )
    .unique();

  return mapping?.cloudTable === "posTransaction"
    ? (mapping.cloudId as Id<"posTransaction">)
    : null;
}

async function findProjectedRegisterSessionIdForRepairableMissingMapping(
  ctx: Pick<QueryCtx, "db">,
  conflict: RegisterSessionSyncConflict,
) {
  if (
    classifyRegisterSessionSyncReview(conflict).reviewKind !==
      "missing_register_session_mapping" ||
    !conflict.terminalId
  ) {
    return null;
  }

  const syncEvent = await ctx.db
    .query("posLocalSyncEvent")
    .withIndex("by_store_terminal_localEvent", (q) =>
      q
        .eq("storeId", conflict.storeId!)
        .eq("terminalId", conflict.terminalId!)
        .eq("localEventId", conflict.localEventId),
    )
    .unique();
  if (syncEvent?.eventType !== "sale_completed") {
    return null;
  }

  const transactionId = await findTransactionIdForSyncEvent(ctx, syncEvent);
  if (!transactionId) {
    return null;
  }

  const transaction = await ctx.db.get("posTransaction", transactionId);
  if (
    !transaction ||
    transaction.storeId !== syncEvent.storeId ||
    transaction.terminalId !== syncEvent.terminalId ||
    transaction.status !== "completed" ||
    !transaction.registerSessionId
  ) {
    return null;
  }

  const registerSession = await ctx.db.get(
    "registerSession",
    transaction.registerSessionId,
  );
  if (
    !registerSession ||
    registerSession.storeId !== syncEvent.storeId ||
    registerSession.terminalId !== syncEvent.terminalId ||
    (registerSession.status !== "open" &&
      registerSession.status !== "active" &&
      registerSession.status !== "closing")
  ) {
    return null;
  }

  return registerSession._id;
}

function uniqueById<T extends { _id: string }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row._id)) return false;
    seen.add(row._id);
    return true;
  });
}

async function listTargetRegisterSessionSyncFacts(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
  options: Required<
    Pick<ListOpenLocalSyncConflictsOptions, "registerSessionIds">
  > &
    Pick<
      ListOpenLocalSyncConflictsOptions,
      "includeRejectedEvidence" | "includeTransactionMappingEvidence"
    >,
) {
  const needsReviewConflicts: Doc<"posLocalSyncConflict">[] = [];
  const resolvedConflicts: Doc<"posLocalSyncConflict">[] = [];
  const rejectedEvents: Doc<"posLocalSyncEvent">[] = [];

  for (const registerSessionId of new Set(options.registerSessionIds)) {
    const registerSession = await ctx.db.get(
      "registerSession",
      registerSessionId,
    );
    if (
      !registerSession ||
      registerSession.storeId !== storeId ||
      !registerSession.terminalId
    ) {
      continue;
    }

    const terminalId = registerSession.terminalId;
    const registerSessionMappings = await ctx.db
      .query("posLocalSyncMapping")
      .withIndex("by_store_terminal_cloud", (q) =>
        q
          .eq("storeId", storeId)
          .eq("terminalId", terminalId)
          .eq("cloudTable", "registerSession")
          .eq("cloudId", registerSessionId),
      )
      .take(SYNC_CONFLICT_LIMIT);
    const localRegisterSessionIds = new Set<string>([
      registerSessionId,
      ...registerSessionMappings
        .map((mapping) => mapping.localRegisterSessionId)
        .filter((localId): localId is string => Boolean(localId)),
    ]);
    if (options.includeTransactionMappingEvidence) {
      const sessionTransactions = (
        await Promise.all(
          (["completed", "void"] as const).map((status) =>
            ctx.db
              .query("posTransaction")
              .withIndex(
                "by_storeId_status_registerSessionId_completedAt",
                (q) =>
                  q
                    .eq("storeId", storeId)
                    .eq("status", status)
                    .eq("registerSessionId", registerSessionId)
                    .gte("completedAt", 0),
              )
              .take(SYNC_CONFLICT_LIMIT),
          ),
        )
      ).flat();
      for (const transaction of sessionTransactions) {
        const transactionTerminalId = transaction.terminalId ?? terminalId;
        const transactionMappings = await ctx.db
          .query("posLocalSyncMapping")
          .withIndex("by_store_terminal_cloud", (q) =>
            q
              .eq("storeId", storeId)
              .eq("terminalId", transactionTerminalId)
              .eq("cloudTable", "posTransaction")
              .eq("cloudId", transaction._id),
          )
          .take(SYNC_CONFLICT_LIMIT);

        for (const mapping of transactionMappings) {
          if (mapping.localRegisterSessionId) {
            localRegisterSessionIds.add(mapping.localRegisterSessionId);
          }
        }
      }
    }

    for (const localRegisterSessionId of localRegisterSessionIds) {
      const conflicts = await ctx.db
        .query("posLocalSyncConflict")
        .withIndex("by_store_terminal_register", (q) =>
          q
            .eq("storeId", storeId)
            .eq("terminalId", terminalId)
            .eq("localRegisterSessionId", localRegisterSessionId),
        )
        .take(SYNC_CONFLICT_LIMIT);
      for (const conflict of conflicts) {
        if (conflict.status === "needs_review") {
          needsReviewConflicts.push(conflict);
        } else if (conflict.status === "resolved") {
          resolvedConflicts.push(conflict);
        }
      }

      if (options.includeRejectedEvidence) {
        const localEvents = await ctx.db
          .query("posLocalSyncEvent")
          .withIndex("by_store_terminal_register_sequence", (q) =>
            q
              .eq("storeId", storeId)
              .eq("terminalId", terminalId)
              .eq("localRegisterSessionId", localRegisterSessionId),
          )
          .take(SYNC_CONFLICT_LIMIT);
        rejectedEvents.push(
          ...localEvents.filter((event) => event.status === "rejected"),
        );
      }
    }
  }

  return {
    needsReviewConflicts: uniqueById(needsReviewConflicts),
    rejectedEvents: uniqueById(rejectedEvents),
    resolvedConflicts: uniqueById(resolvedConflicts),
  };
}

export function buildRegisterSessionLocalSyncStatus(
  conflicts: RegisterSessionSyncConflict[],
  options: { staffNamesById?: Map<Id<"staffProfile">, string> } = {},
): RegisterSessionLocalSyncStatus | null {
  if (conflicts.length === 0) {
    return null;
  }

  return {
    status: "needs_review",
    reconciliationItems: conflicts.map((conflict) => {
      const review = classifyRegisterSessionSyncReview(conflict);

      const reconciliationItem = {
        actionPolicy: review.actionPolicy,
        createdAt: conflict.createdAt,
        countedCash: numberDetail(conflict.details, "countedCash"),
        expectedCash: numberDetail(conflict.details, "expectedCash"),
        id: conflict._id,
        localEventId: conflict.localEventId,
        notes:
          stringDetail(conflict.details, "notes") ?? conflict.sourceEventNotes,
        reviewKind: review.reviewKind,
        sequence: conflict.sequence,
        status: conflict.status,
        summary: conflict.summary,
        inventoryReview:
          review.reviewKind === "inventory_review"
            ? buildInventoryReviewDetail(conflict.details)
            : null,
        type: getSyncConflictReconciliationType(review),
        variance: numberDetail(conflict.details, "variance"),
      };

      if (!conflict.sale) {
        return reconciliationItem;
      }

      return {
        ...reconciliationItem,
        sale: {
          ...conflict.sale,
          staffName: conflict.sale.staffProfileId
            ? (options.staffNamesById?.get(conflict.sale.staffProfileId) ??
              null)
            : null,
        },
      };
    }),
  };
}

export async function listOpenLocalSyncConflictsByRegisterSessionWithCompleteness(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
  options: ListOpenLocalSyncConflictsOptions = {},
) {
  const syncConflictLimit = Math.min(
    SYNC_CONFLICT_LIMIT,
    Math.max(1, Math.floor(options.limit ?? SYNC_CONFLICT_LIMIT)),
  );
  const hasTargetRegisterSessions = Boolean(options.registerSessionIds?.length);
  const targetedFacts = hasTargetRegisterSessions
    ? await listTargetRegisterSessionSyncFacts(ctx, storeId, {
        includeRejectedEvidence: options.includeRejectedEvidence,
        includeTransactionMappingEvidence:
          options.includeTransactionMappingEvidence,
        registerSessionIds: options.registerSessionIds!,
      })
    : { needsReviewConflicts: [], rejectedEvents: [], resolvedConflicts: [] };
  const [needsReviewConflictProbe, conflictedEventProbe, rejectedEventProbe] =
    hasTargetRegisterSessions
      ? [[], [], []]
      : await Promise.all([
          ctx.db
            .query("posLocalSyncConflict")
            .withIndex("by_store_status", (q) =>
              q.eq("storeId", storeId).eq("status", "needs_review"),
            )
            .take(syncConflictLimit + 1),
          ctx.db
            .query("posLocalSyncEvent")
            .withIndex("by_store_status", (q) =>
              q.eq("storeId", storeId).eq("status", "conflicted"),
            )
            .take(syncConflictLimit + 1),
          options.includeRejectedEvidence
            ? ctx.db
                .query("posLocalSyncEvent")
                .withIndex("by_store_status", (q) =>
                  q.eq("storeId", storeId).eq("status", "rejected"),
                )
                .take(syncConflictLimit + 1)
            : Promise.resolve([]),
        ]);
  const readIncomplete =
    !hasTargetRegisterSessions &&
    (needsReviewConflictProbe.length > syncConflictLimit ||
      conflictedEventProbe.length > syncConflictLimit ||
      rejectedEventProbe.length > syncConflictLimit);
  const cappedNeedsReviewConflicts = needsReviewConflictProbe.slice(
    0,
    syncConflictLimit,
  );
  const cappedConflictedEvents = conflictedEventProbe.slice(
    0,
    syncConflictLimit,
  );
  const cappedRejectedEvents = rejectedEventProbe.slice(0, syncConflictLimit);
  const cappedResolvedConflicts = (
    await Promise.all(
      [...cappedConflictedEvents, ...cappedRejectedEvents].map((event) =>
        ctx.db
          .query("posLocalSyncConflict")
          .withIndex("by_store_terminal_localEvent", (q) =>
            q
              .eq("storeId", event.storeId)
              .eq("terminalId", event.terminalId)
              .eq("localEventId", event.localEventId),
          )
          .take(syncConflictLimit + 1),
      ),
    )
  ).flatMap((conflicts) =>
    conflicts.filter((conflict) => conflict.status === "resolved"),
  );
  const needsReviewConflicts = uniqueById([
    ...cappedNeedsReviewConflicts,
    ...targetedFacts.needsReviewConflicts,
  ]);
  const resolvedConflicts = uniqueById([
    ...cappedResolvedConflicts,
    ...targetedFacts.resolvedConflicts,
  ]);
  const rejectedEvents = uniqueById([
    ...cappedRejectedEvents,
    ...targetedFacts.rejectedEvents,
  ]);
  const projectedInventoryReviewResults = await Promise.all(
    needsReviewConflicts.map(async (conflict) => ({
      conflict,
      hasInventoryWorkItem: await hasInventoryReviewWorkItemForProjectedSale(
        ctx,
        storeId,
        conflict,
      ),
    })),
  );
  const projectedInventoryReviewEventKeys = new Set(
    projectedInventoryReviewResults
      .filter((result) => result.hasInventoryWorkItem)
      .map((result) => syncConflictEventKey(result.conflict)),
  );
  const activeNeedsReviewConflicts = projectedInventoryReviewResults
    .filter((result) => !result.hasInventoryWorkItem)
    .map((result) => result.conflict);
  const activeRegisterReviewResults = await Promise.all(
    activeNeedsReviewConflicts.map(async (conflict) => ({
      conflict,
      isNonSaleMissingRegisterSessionMapping:
        await isNonSaleMissingRegisterSessionMappingConflict(
          ctx,
          storeId,
          conflict,
        ),
    })),
  );
  const activeRegisterReviewConflicts = activeRegisterReviewResults
    .filter((result) => !result.isNonSaleMissingRegisterSessionMapping)
    .map((result) => result.conflict);
  const varianceCloseoutEventKeys = new Set(
    activeRegisterReviewConflicts
      .filter(
        (conflict) =>
          classifyRegisterSessionSyncReview(conflict).reviewKind ===
          "register_closeout_variance",
      )
      .map(syncConflictEventKey),
  );
  const reviewableNeedsReviewConflicts = activeRegisterReviewConflicts.filter(
    (conflict) =>
      !(
        classifyRegisterSessionSyncReview(conflict).reviewKind ===
          "duplicate_register_closeout" &&
        varianceCloseoutEventKeys.has(syncConflictEventKey(conflict))
      ),
  );
  const openConflictEventKeys = new Set(
    reviewableNeedsReviewConflicts.map(syncConflictEventKey),
  );
  const staleResolvedConflicts = await Promise.all(
    resolvedConflicts.map(async (conflict) => {
      const conflictEventKey = syncConflictEventKey(conflict);
      if (
        openConflictEventKeys.has(conflictEventKey) ||
        projectedInventoryReviewEventKeys.has(conflictEventKey)
      ) {
        return null;
      }

      const syncEvent = await ctx.db
        .query("posLocalSyncEvent")
        .withIndex("by_store_terminal_localEvent", (q) =>
          q
            .eq("storeId", conflict.storeId)
            .eq("terminalId", conflict.terminalId)
            .eq("localEventId", conflict.localEventId),
        )
        .unique();

      if (syncEvent?.status === "conflicted") {
        if (
          classifyRegisterSessionSyncReview(conflict).reviewKind ===
            "missing_register_session_mapping" &&
          syncEvent.eventType !== "sale_completed"
        ) {
          return null;
        }

        return { ...conflict, status: "needs_review" };
      }

      if (
        options.includeRejectedEvidence &&
        syncEvent?.status === "rejected" &&
        syncEvent.rejectionCode !== MANAGER_REJECTED_SYNC_REVIEW_CODE
      ) {
        return {
          ...conflict,
          conflictType: "server_rejected",
          status: "rejected",
          summary:
            syncEvent.rejectionMessage ??
            "Server rejected synced register activity for this drawer.",
        };
      }

      return null;
    }),
  );
  const conflicts: RegisterSessionSyncConflict[] = [
    ...reviewableNeedsReviewConflicts,
    ...staleResolvedConflicts.filter(
      (conflict): conflict is Doc<"posLocalSyncConflict"> => conflict !== null,
    ),
  ];
  const conflictsWithSourceEventEvidence = await Promise.all(
    conflicts.map(async (conflict) => {
      const { terminalId } = conflict;
      if (!terminalId) {
        return conflict;
      }

      const syncEvent = await ctx.db
        .query("posLocalSyncEvent")
        .withIndex("by_store_terminal_localEvent", (q) =>
          q
            .eq("storeId", conflict.storeId ?? storeId)
            .eq("terminalId", terminalId)
            .eq("localEventId", conflict.localEventId),
        )
        .unique();
      const sourceEventNotes =
        stringDetail(conflict.details, "notes") ??
        stringDetail(syncEvent?.payload, "notes");
      const sale = buildSyncSaleSummary(
        syncEvent,
        await findTransactionIdForSyncEvent(ctx, syncEvent),
      );

      return sourceEventNotes || sale
        ? { ...conflict, sale, sourceEventNotes }
        : conflict;
    }),
  );
  conflicts.splice(0, conflicts.length, ...conflictsWithSourceEventEvidence);
  const includedConflictKeys = new Set(
    conflicts.map((conflict) =>
      [conflict.terminalId, conflict.localEventId].join(":"),
    ),
  );
  if (options.includeRejectedEvidence) {
    for (const event of rejectedEvents) {
      if (event.rejectionCode === MANAGER_REJECTED_SYNC_REVIEW_CODE) continue;

      const key = [event.terminalId, event.localEventId].join(":");
      if (includedConflictKeys.has(key)) continue;

      conflicts.push({
        _id: event._id,
        conflictType: "server_rejected",
        createdAt: event.acceptedAt ?? event.submittedAt,
        details: {},
        localEventId: event.localEventId,
        localRegisterSessionId: event.localRegisterSessionId,
        sale: buildSyncSaleSummary(
          event,
          await findTransactionIdForSyncEvent(ctx, event),
        ),
        sequence: event.sequence,
        status: event.status,
        storeId: event.storeId,
        summary:
          event.rejectionMessage ??
          "Server rejected synced register activity for this drawer.",
        terminalId: event.terminalId,
      });
    }
  }
  const entries = await Promise.all(
    conflicts.map(async (conflict) => {
      const { terminalId, localRegisterSessionId } = conflict;
      if (!terminalId || !localRegisterSessionId) {
        return null;
      }
      const conflictStoreId = conflict.storeId ?? storeId;

      const registerSessionMapping = await ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_local", (q) =>
          q
            .eq("storeId", conflictStoreId)
            .eq("terminalId", terminalId)
            .eq("localRegisterSessionId", localRegisterSessionId)
            .eq("localIdKind", "registerSession")
            .eq("localId", localRegisterSessionId),
        )
        .unique();
      if (registerSessionMapping?.cloudTable === "registerSession") {
        return [
          registerSessionMapping.cloudId as Id<"registerSession">,
          conflict,
        ] as const;
      }

      const normalizeId = (
        ctx.db as unknown as {
          normalizeId?: (
            tableName: string,
            value: string,
          ) => Id<"registerSession"> | null;
        }
      ).normalizeId;
      const cloudRegisterSessionId =
        normalizeId?.call(ctx.db, "registerSession", localRegisterSessionId) ??
        null;
      if (cloudRegisterSessionId) {
        const registerSession = await ctx.db.get(
          "registerSession",
          cloudRegisterSessionId,
        );
        if (!registerSession) return null;
        if (
          registerSession.storeId === conflictStoreId &&
          registerSession.terminalId === terminalId
        ) {
          return [cloudRegisterSessionId, conflict] as const;
        }
      }

      const repairableRegisterSessionId =
        await findProjectedRegisterSessionIdForRepairableMissingMapping(ctx, {
          ...conflict,
          storeId: conflictStoreId,
        });
      if (repairableRegisterSessionId) {
        return [repairableRegisterSessionId, conflict] as const;
      }

      return null;
    }),
  );

  const conflictsBySessionId = entries.reduce((result, entry) => {
    if (!entry) return result;
    const [registerSessionId, conflict] = entry;
    result.set(registerSessionId, [
      ...(result.get(registerSessionId) ?? []),
      conflict,
    ]);
    return result;
  }, new Map<Id<"registerSession">, RegisterSessionSyncConflict[]>());

  return {
    completeness: readIncomplete
      ? ("incomplete" as const)
      : ("complete" as const),
    conflictsBySessionId,
  };
}

export async function listOpenLocalSyncConflictsByRegisterSession(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
  options: ListOpenLocalSyncConflictsOptions = {},
) {
  return (
    await listOpenLocalSyncConflictsByRegisterSessionWithCompleteness(
      ctx,
      storeId,
      options,
    )
  ).conflictsBySessionId;
}
