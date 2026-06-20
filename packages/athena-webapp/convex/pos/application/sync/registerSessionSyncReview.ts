import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

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
export const REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY =
  "Register closeout variance requires manager review before synced closeout can be applied.";
export const INVENTORY_SYNC_REVIEW_SUMMARY =
  "Inventory needs manager review for a synced offline sale.";

export type RegisterSessionSyncReviewActionPolicy =
  | "apply_or_reject"
  | "override_or_reject"
  | "reject_only";

export type RegisterSessionSyncReviewKind =
  | "duplicate_register_closeout"
  | "register_closeout_variance"
  | "register_not_open_sale"
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
  const localEventId = conflict.localEventId?.toLowerCase() ?? "";
  const summary = conflict.summary?.trim() ?? "";
  const normalizedSummary = summary.toLowerCase();
  const details = conflict.details ?? {};
  const hasVarianceDetails =
    typeof details.countedCash === "number" ||
    typeof details.expectedCash === "number" ||
    typeof details.variance === "number";

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
    summary === REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY ||
    localEventId.includes("register-closed") ||
    localEventId.includes("register-closeout") ||
    normalizedSummary.includes("register closeout") ||
    hasVarianceDetails
  ) {
    return {
      actionPolicy: "apply_or_reject",
      conflictType: conflict.conflictType,
      reviewKind: "register_closeout_variance",
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
  const receiptNumber = stringDetail(syncEvent.payload, "receiptNumber");
  const inventoryReviewWorkItems = await ctx.db
    .query("operationalWorkItem")
    .withIndex("by_storeId_type", (q) =>
      q
        .eq("storeId", storeId)
        .eq("type", SYNCED_SALE_INVENTORY_REVIEW_WORK_ITEM_TYPE),
    )
    .take(SYNC_CONFLICT_LIMIT);

  return inventoryReviewWorkItems.some((workItem) => {
    if (workItem.status !== "open") {
      return false;
    }

    const metadata = workItem.metadata ?? {};
    const metadataLocalRegisterSessionId =
      typeof metadata.localRegisterSessionId === "string"
        ? metadata.localRegisterSessionId
        : null;

    return (
      metadata.localEventId === conflict.localEventId ||
      (localTransactionId !== null &&
        metadata.localTransactionId === localTransactionId) ||
      (receiptNumber !== null &&
        metadata.receiptNumber === receiptNumber &&
        metadataLocalRegisterSessionId === conflict.localRegisterSessionId)
    );
  });
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

export async function listOpenLocalSyncConflictsByRegisterSession(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
  options: { includeRejectedEvidence?: boolean } = {},
) {
  const [needsReviewConflicts, resolvedConflicts, rejectedEvents] =
    await Promise.all([
      ctx.db
        .query("posLocalSyncConflict")
        .withIndex("by_store_status", (q) =>
          q.eq("storeId", storeId).eq("status", "needs_review"),
        )
        .take(SYNC_CONFLICT_LIMIT),
      ctx.db
        .query("posLocalSyncConflict")
        .withIndex("by_store_status", (q) =>
          q.eq("storeId", storeId).eq("status", "resolved"),
        )
        .take(SYNC_CONFLICT_LIMIT),
      options.includeRejectedEvidence
        ? ctx.db
            .query("posLocalSyncEvent")
            .withIndex("by_store_status", (q) =>
              q.eq("storeId", storeId).eq("status", "rejected"),
            )
            .take(SYNC_CONFLICT_LIMIT)
        : Promise.resolve([]),
    ]);
  const projectedInventoryReviewResults = await Promise.all(
    needsReviewConflicts.map(async (conflict) => ({
      conflict,
      hasInventoryWorkItem:
        await hasInventoryReviewWorkItemForProjectedSale(ctx, storeId, conflict),
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
  const openConflictEventKeys = new Set(
    activeNeedsReviewConflicts.map(syncConflictEventKey),
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
    ...activeNeedsReviewConflicts,
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

      return null;
    }),
  );

  return entries.reduce((conflictsBySessionId, entry) => {
    if (!entry) return conflictsBySessionId;
    const [registerSessionId, conflict] = entry;
    conflictsBySessionId.set(registerSessionId, [
      ...(conflictsBySessionId.get(registerSessionId) ?? []),
      conflict,
    ]);
    return conflictsBySessionId;
  }, new Map<Id<"registerSession">, RegisterSessionSyncConflict[]>());
}
