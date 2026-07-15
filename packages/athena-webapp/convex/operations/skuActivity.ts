import { internalMutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { requireSharedDemoStoreReadIfApplicable } from "../sharedDemo/actor";

export type SkuActivityStatus =
  | "active"
  | "released"
  | "consumed"
  | "expired"
  | "committed"
  | "inferred";

export type RecordSkuActivityEventArgs = {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  productSkuId: Id<"productSku">;
  productId?: Id<"product">;
  activityType: string;
  status?: SkuActivityStatus | string;
  occurredAt: number;
  sourceType: string;
  sourceId: string;
  sourceLineId?: string;
  idempotencyKey: string;
  quantityDelta?: number;
  reservationQuantity?: number;
  stockQuantityDelta?: number;
  actorUserId?: Id<"athenaUser">;
  actorStaffProfileId?: Id<"staffProfile">;
  customerProfileId?: Id<"customerProfile">;
  workItemId?: Id<"operationalWorkItem">;
  registerSessionId?: Id<"registerSession">;
  terminalId?: Id<"posTerminal">;
  onlineOrderId?: Id<"onlineOrder">;
  posTransactionId?: Id<"posTransaction">;
  checkoutSessionId?: Id<"checkoutSession">;
  inventoryMovementId?: Id<"inventoryMovement">;
  inventoryHoldId?: Id<"inventoryHold">;
  workflowTraceId?: string;
  operationalEventId?: Id<"operationalEvent">;
  sourceLabel?: string;
  metadata?: Record<string, unknown>;
};

type SkuActivityEventRecord = RecordSkuActivityEventArgs & {
  _id?: Id<"skuActivityEvent"> | string;
  createdAt: number;
};

type ProductSkuRecord = {
  _id: Id<"productSku">;
  inventoryCount: number;
  productId: Id<"product">;
  productName?: string;
  quantityAvailable: number;
  sku?: string;
  storeId: Id<"store">;
};

const ACTIVE_RESERVATION_STATUS = "active";
const CHECKOUT_SOURCE_TYPES = new Set([
  "checkout",
  "checkoutSession",
  "checkout_session",
  "storefront_checkout",
]);
const POS_SOURCE_TYPES = new Set(["posSession", "pos_session", "pos"]);
const SKU_ACTIVITY_SOURCE_LOOKUP_LIMIT = 500;
const SKU_ACTIVITY_TIMELINE_LIMIT = 1000;
const UNTRUSTED_SKU_EVIDENCE_DEFAULT_LIMIT = 20;
const UNTRUSTED_SKU_EVIDENCE_MAX_LIMIT = 500;
const UNTRUSTED_SKU_EVIDENCE_SOURCE_CANDIDATE_LIMIT = 500;
const UNTRUSTED_SKU_TRANSACTION_HISTORY_DEFAULT_LIMIT = 100;
const UNTRUSTED_SKU_TRANSACTION_HISTORY_MAX_LIMIT = 500;
const UNTRUSTED_SKU_TRANSACTION_HISTORY_SCAN_LIMIT = 1000;
const UNTRUSTED_SKU_TRANSACTION_ADJUSTMENT_LIMIT = 20;

type UntrustedSkuSaleEvidenceReviewStatus = "open" | "reviewed" | "all";
type UntrustedSkuSaleEvidenceSourceType =
  | "inventoryImportProvisionalSku"
  | "posPendingCheckoutItem";
type UntrustedSkuSaleEvidenceSourceFilter =
  | "all"
  | "legacy_import"
  | "pending_checkout";

const OPEN_IMPORT_PROVISIONAL_STATUSES: Array<
  Doc<"inventoryImportProvisionalSku">["status"]
> = ["active"];
const REVIEWED_IMPORT_PROVISIONAL_STATUSES: Array<
  Doc<"inventoryImportProvisionalSku">["status"]
> = ["finalized", "rejected", "closed"];
const OPEN_PENDING_CHECKOUT_STATUSES: Array<
  Doc<"posPendingCheckoutItem">["status"]
> = ["pending_review", "flagged"];
const REVIEWED_PENDING_CHECKOUT_STATUSES: Array<
  Doc<"posPendingCheckoutItem">["status"]
> = ["approved", "linked_to_catalog", "rejected"];

function trimRequired(value: string | undefined, message: string) {
  if (!value?.trim()) {
    throw new Error(message);
  }

  return value.trim();
}

function getImpactQuantities(args: RecordSkuActivityEventArgs) {
  return [
    args.quantityDelta,
    args.reservationQuantity,
    args.stockQuantityDelta,
  ].filter((quantity) => quantity !== undefined);
}

function assertSkuActivityArgs(args: RecordSkuActivityEventArgs) {
  if (!args.storeId) {
    throw new Error("SKU activity requires a store.");
  }

  if (!args.productSkuId) {
    throw new Error("SKU activity requires a product SKU.");
  }

  trimRequired(args.activityType, "SKU activity requires an activity type.");
  trimRequired(args.sourceType, "SKU activity requires a source type.");
  trimRequired(args.sourceId, "SKU activity requires a source id.");
  trimRequired(args.idempotencyKey, "SKU activity requires an idempotency key.");

  const impactQuantities = getImpactQuantities(args);
  const hasNonZeroImpact = impactQuantities.some((quantity) => quantity !== 0);

  if (!hasNonZeroImpact && !args.status?.trim()) {
    throw new Error("Zero-impact SKU activity requires explicit status context.");
  }
}

export function buildSkuActivityEvent(args: RecordSkuActivityEventArgs) {
  assertSkuActivityArgs(args);

  return {
    ...args,
    activityType: args.activityType.trim(),
    idempotencyKey: args.idempotencyKey.trim(),
    sourceId: args.sourceId.trim(),
    sourceLineId: args.sourceLineId?.trim() || undefined,
    sourceType: args.sourceType.trim(),
    status: args.status?.trim() || undefined,
    createdAt: Date.now(),
  };
}

function assertIdempotentReplayMatches(
  existingEvent: {
    activityType: string;
    productSkuId: Id<"productSku">;
    quantityDelta?: number;
    reservationQuantity?: number;
    sourceId: string;
    sourceLineId?: string;
    sourceType: string;
    stockQuantityDelta?: number;
    storeId: Id<"store">;
  },
  args: RecordSkuActivityEventArgs
) {
  if (
    existingEvent.storeId !== args.storeId ||
    existingEvent.productSkuId !== args.productSkuId ||
    existingEvent.activityType !== args.activityType.trim() ||
    existingEvent.sourceType !== args.sourceType.trim() ||
    existingEvent.sourceId !== args.sourceId.trim() ||
    existingEvent.sourceLineId !== (args.sourceLineId?.trim() || undefined) ||
    existingEvent.quantityDelta !== args.quantityDelta ||
    existingEvent.reservationQuantity !== args.reservationQuantity ||
    existingEvent.stockQuantityDelta !== args.stockQuantityDelta
  ) {
    throw new Error(
      "SKU activity idempotency key conflicts with an existing event."
    );
  }
}

async function assertProductSkuBelongsToStore(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  args: {
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  }
) {
  const productSku = (await ctx.db.get(
    "productSku",
    args.productSkuId
  )) as ProductSkuRecord | null;

  if (!productSku || productSku.storeId !== args.storeId) {
    throw new Error("Selected SKU could not be found for this store.");
  }

  return productSku;
}

export async function recordSkuActivityEventWithCtx(
  ctx: MutationCtx,
  args: RecordSkuActivityEventArgs
) {
  const event = buildSkuActivityEvent(args);

  await assertProductSkuBelongsToStore(ctx, {
    productSkuId: event.productSkuId,
    storeId: event.storeId,
  });

  const existingEvent = await ctx.db
    .query("skuActivityEvent")
    .withIndex("by_storeId_idempotencyKey", (q) =>
      q.eq("storeId", event.storeId).eq("idempotencyKey", event.idempotencyKey)
    )
    .first();

  if (existingEvent) {
    assertIdempotentReplayMatches(existingEvent, event);
    return existingEvent;
  }

  const eventId = await ctx.db.insert("skuActivityEvent", event);
  return ctx.db.get("skuActivityEvent", eventId);
}

export const recordSkuActivityEvent = internalMutation({
  args: {
    storeId: v.id("store"),
    organizationId: v.optional(v.id("organization")),
    productSkuId: v.id("productSku"),
    productId: v.optional(v.id("product")),
    activityType: v.string(),
    status: v.optional(v.string()),
    occurredAt: v.number(),
    sourceType: v.string(),
    sourceId: v.string(),
    sourceLineId: v.optional(v.string()),
    idempotencyKey: v.string(),
    quantityDelta: v.optional(v.number()),
    reservationQuantity: v.optional(v.number()),
    stockQuantityDelta: v.optional(v.number()),
    actorUserId: v.optional(v.id("athenaUser")),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    customerProfileId: v.optional(v.id("customerProfile")),
    workItemId: v.optional(v.id("operationalWorkItem")),
    registerSessionId: v.optional(v.id("registerSession")),
    terminalId: v.optional(v.id("posTerminal")),
    onlineOrderId: v.optional(v.id("onlineOrder")),
    posTransactionId: v.optional(v.id("posTransaction")),
    checkoutSessionId: v.optional(v.id("checkoutSession")),
    inventoryMovementId: v.optional(v.id("inventoryMovement")),
    inventoryHoldId: v.optional(v.id("inventoryHold")),
    workflowTraceId: v.optional(v.string()),
    operationalEventId: v.optional(v.id("operationalEvent")),
    sourceLabel: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.any())),
  },
  handler: (ctx, args) => recordSkuActivityEventWithCtx(ctx, args),
});

export async function recordSkuActivityEventWithDb(
  db: MutationCtx["db"],
  args: RecordSkuActivityEventArgs
) {
  return recordSkuActivityEventWithCtx({ db } as MutationCtx, args);
}

export async function listSkuActivityEventsForSourceWithCtx(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    sourceType: string;
    sourceId: string;
  }
) {
  const events = await ctx.db
    .query("skuActivityEvent")
    .withIndex("by_storeId_source", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("sourceType", args.sourceType)
        .eq("sourceId", args.sourceId)
    )
    .take(SKU_ACTIVITY_SOURCE_LOOKUP_LIMIT + 1);

  if (events.length > SKU_ACTIVITY_SOURCE_LOOKUP_LIMIT) {
    throw new Error(
      "SKU activity has too many events for one source to summarize."
    );
  }

  return events;
}

async function resolveProductSkuForActivity(
  ctx: QueryCtx,
  args: {
    productSkuId?: Id<"productSku">;
    sku?: string;
    storeId: Id<"store">;
  }
) {
  if (args.productSkuId) {
    const productSku = (await ctx.db.get(
      "productSku",
      args.productSkuId
    )) as ProductSkuRecord | null;

    return productSku?.storeId === args.storeId ? productSku : null;
  }

  const sku = args.sku?.trim();
  if (!sku) {
    throw new Error("SKU activity lookup requires a productSkuId or SKU.");
  }

  return (await ctx.db
    .query("productSku")
    .withIndex("by_storeId_sku", (q) =>
      q.eq("storeId", args.storeId).eq("sku", sku)
    )
    .first()) as ProductSkuRecord | null;
}

function getReservationSourceKindFromFields(args: {
  checkoutSessionId?: unknown;
  inventoryHoldId?: unknown;
  sourceType: string;
}) {
  if (
    args.checkoutSessionId ||
    CHECKOUT_SOURCE_TYPES.has(args.sourceType)
  ) {
    return "checkout";
  }

  if (args.inventoryHoldId || POS_SOURCE_TYPES.has(args.sourceType)) {
    return "pos";
  }

  return "other";
}

function getReservationSourceKind(event: SkuActivityEventRecord) {
  return getReservationSourceKindFromFields(event);
}

function getSourceLabel(event: SkuActivityEventRecord) {
  if (event.sourceLabel?.trim()) {
    return event.sourceLabel.trim();
  }

  const sourceKind = getReservationSourceKind(event);
  if (sourceKind === "pos") {
    return `POS session ${event.sourceId}`;
  }

  if (sourceKind === "checkout") {
    return `Checkout ${event.sourceId}`;
  }

  if (event.inventoryMovementId) {
    return `Inventory movement ${event.sourceId}`;
  }

  return `${event.sourceType} ${event.sourceId}`;
}

function getReservationGroupKey(event: SkuActivityEventRecord) {
  return [
    event.sourceType,
    event.sourceId,
    event.sourceLineId ?? event.inventoryHoldId ?? event.checkoutSessionId ?? "",
  ].join(":");
}

async function isLiveReservationStillActive(
  ctx: QueryCtx,
  event: SkuActivityEventRecord,
  now: number
) {
  if (event.inventoryHoldId) {
    const hold = (await ctx.db.get("inventoryHold", event.inventoryHoldId)) as {
      status?: string;
      expiresAt?: number;
    } | null;

    return !hold || (hold.status === ACTIVE_RESERVATION_STATUS && (hold.expiresAt ?? now + 1) > now);
  }

  if (event.checkoutSessionId) {
    const session = (await ctx.db.get(
      "checkoutSession",
      event.checkoutSessionId
    )) as {
      expiresAt?: number;
      hasCompletedCheckoutSession?: boolean;
    } | null;

    return (
      !session ||
      (!session.hasCompletedCheckoutSession && (session.expiresAt ?? now + 1) > now)
    );
  }

  return true;
}

async function buildActiveReservationEntries(
  ctx: QueryCtx,
  events: SkuActivityEventRecord[],
  now: number
) {
  const latestReservationEvents = new Map<string, SkuActivityEventRecord>();

  for (const event of events) {
    if (!event.activityType.includes("reservation")) {
      continue;
    }

    const key = getReservationGroupKey(event);
    const current = latestReservationEvents.get(key);
    if (!current || event.occurredAt > current.occurredAt) {
      latestReservationEvents.set(key, event);
    }
  }

  const entries = [];
  for (const event of latestReservationEvents.values()) {
    const quantity = Math.max(0, event.reservationQuantity ?? 0);
    if (event.status !== ACTIVE_RESERVATION_STATUS || quantity === 0) {
      continue;
    }

    if (!(await isLiveReservationStillActive(ctx, event, now))) {
      continue;
    }

    entries.push({
      activityEventId: event._id,
      checkoutSessionId: event.checkoutSessionId,
      inventoryHoldId: event.inventoryHoldId,
      quantity,
      sourceId: event.sourceId,
      sourceLabel: getSourceLabel(event),
      sourceLineId: event.sourceLineId,
      sourceType: event.sourceType,
      status: event.status,
      occurredAt: event.occurredAt,
    });
  }

  return entries.sort((left, right) => right.occurredAt - left.occurredAt);
}

function summarizeActiveReservations(
  entries: Array<{ quantity: number; sourceType: string; checkoutSessionId?: unknown; inventoryHoldId?: unknown }>
) {
  return entries.reduce(
    (summary, entry) => {
      const sourceKind = getReservationSourceKindFromFields(entry);
      if (sourceKind === "checkout") {
        summary.checkoutQuantity += entry.quantity;
      } else if (sourceKind === "pos") {
        summary.posQuantity += entry.quantity;
      } else {
        summary.otherQuantity += entry.quantity;
      }

      summary.totalQuantity += entry.quantity;
      return summary;
    },
    {
      checkoutQuantity: 0,
      entries,
      otherQuantity: 0,
      posQuantity: 0,
      totalQuantity: 0,
    }
  );
}

function buildAvailabilityWarnings(args: {
  checkoutQuantity: number;
  productSku: ProductSkuRecord;
}) {
  const durableGap = Math.max(
    0,
    args.productSku.inventoryCount - args.productSku.quantityAvailable
  );
  const unexplainedGap = Math.max(0, durableGap - args.checkoutQuantity);

  if (unexplainedGap === 0) {
    return [];
  }

  return [
    {
      code: "unexplained_availability_gap",
      message:
        "SKU availability is lower than on-hand stock without matching active checkout reservation activity.",
      quantity: unexplainedGap,
    },
  ];
}

function buildTimeline(events: SkuActivityEventRecord[]) {
  return [...events]
    .sort((left, right) => {
      if (right.occurredAt !== left.occurredAt) {
        return right.occurredAt - left.occurredAt;
      }

      return String(right._id ?? "").localeCompare(String(left._id ?? ""));
    })
    .map((event) => ({
      _id: event._id,
      activityType: event.activityType,
      checkoutSessionId: event.checkoutSessionId,
      inventoryHoldId: event.inventoryHoldId,
      inventoryMovementId: event.inventoryMovementId,
      metadata: event.metadata,
      occurredAt: event.occurredAt,
      quantityDelta: event.quantityDelta,
      reservationQuantity: event.reservationQuantity,
      sourceId: event.sourceId,
      sourceLabel: getSourceLabel(event),
      sourceLineId: event.sourceLineId,
      sourceType: event.sourceType,
      status: event.status,
      stockQuantityDelta: event.stockQuantityDelta,
    }));
}

async function requireSkuActivityStoreAccess(
  ctx: QueryCtx,
  storeId: Id<"store">
) {
  const [store, demoActor] = await Promise.all([
    ctx.db.get("store", storeId),
    requireSharedDemoStoreReadIfApplicable(ctx, storeId),
  ]);
  if (!store) {
    throw new Error("Store not found.");
  }
  if (demoActor) return;

  const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin", "pos_only"],
    failureMessage: "You do not have access to SKU activity.",
    organizationId: store.organizationId,
    userId: athenaUser._id,
  });

}

function boundedNumber(
  value: number | undefined,
  fallback: number,
  max: number
) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(max, Math.floor(value)));
}

function getImportStatusesForReviewStatus(
  reviewStatus: UntrustedSkuSaleEvidenceReviewStatus
) {
  if (reviewStatus === "open") {
    return OPEN_IMPORT_PROVISIONAL_STATUSES;
  }

  if (reviewStatus === "reviewed") {
    return [
      ...OPEN_IMPORT_PROVISIONAL_STATUSES,
      ...REVIEWED_IMPORT_PROVISIONAL_STATUSES,
    ];
  }

  return [
    ...OPEN_IMPORT_PROVISIONAL_STATUSES,
    ...REVIEWED_IMPORT_PROVISIONAL_STATUSES,
  ];
}

function getPendingCheckoutStatusesForReviewStatus(
  reviewStatus: UntrustedSkuSaleEvidenceReviewStatus
) {
  if (reviewStatus === "open") {
    return OPEN_PENDING_CHECKOUT_STATUSES;
  }

  if (reviewStatus === "reviewed") {
    return REVIEWED_PENDING_CHECKOUT_STATUSES;
  }

  return [
    ...OPEN_PENDING_CHECKOUT_STATUSES,
    ...REVIEWED_PENDING_CHECKOUT_STATUSES,
  ];
}

function getSourceReviewState(
  status: string,
  openStatuses: readonly string[]
): "open" | "reviewed" {
  return openStatuses.includes(status) ? "open" : "reviewed";
}

function getInventoryImportEvidenceReviewState(
  row: Doc<"inventoryImportProvisionalSku">
) {
  if (row.finalizedAt !== undefined) {
    return "reviewed" as const;
  }

  return getSourceReviewState(row.status, OPEN_IMPORT_PROVISIONAL_STATUSES);
}

function buildInventoryImportEvidenceSource(
  row: Doc<"inventoryImportProvisionalSku">
) {
  return {
    id: row._id,
    sourceType: "inventoryImportProvisionalSku" as const,
    reviewState: getInventoryImportEvidenceReviewState(row),
    status: row.status,
    title: row.importedProductName,
    sku: row.importedSku ?? null,
    lookupCode: row.importedBarcode ?? row.importedSku ?? null,
    unitPrice: row.importedPrice,
    importKey: row.importKey,
    reviewVersionNumber: row.reviewVersionNumber,
    rowNumber: row.rowNumber,
    productId: row.productId ?? null,
    productSkuId: row.productSkuId ?? null,
    evidence: {
      saleCount: row.saleEvidence.saleCount,
      totalQuantitySold: row.saleEvidence.totalQuantitySold,
      lastSoldAt: row.saleEvidence.lastSoldAt ?? null,
      lastPosTransactionId: row.saleEvidence.lastPosTransactionId ?? null,
    },
    lastActivityAt: row.saleEvidence.lastSoldAt ?? row.updatedAt,
    updatedAt: row.updatedAt,
  };
}

async function hasArchivedLinkedProduct(
  ctx: QueryCtx,
  productCache: Map<Id<"product">, Doc<"product"> | null>,
  row: Doc<"inventoryImportProvisionalSku">
) {
  if (!row.productId) {
    return false;
  }

  if (!productCache.has(row.productId)) {
    productCache.set(row.productId, await ctx.db.get("product", row.productId));
  }

  const product = productCache.get(row.productId);
  return Boolean(
    product &&
      product.storeId === row.storeId &&
      product.availability === "archived"
  );
}

function buildPendingCheckoutEvidenceSource(
  row: Doc<"posPendingCheckoutItem">
) {
  return {
    id: row._id,
    sourceType: "posPendingCheckoutItem" as const,
    reviewState: getSourceReviewState(
      row.status,
      OPEN_PENDING_CHECKOUT_STATUSES
    ),
    status: row.status,
    reviewPriority: row.reviewPriority,
    title: row.name,
    sku: row.lookupCode ?? null,
    lookupCode: row.lookupCode ?? null,
    unitPrice: row.provisionalPrice,
    productId: row.provisionalProductId ?? row.approvedProductId ?? null,
    productSkuId:
      row.provisionalProductSkuId ?? row.approvedProductSkuId ?? null,
    operationalWorkItemId: row.operationalWorkItemId ?? null,
    evidence: {
      saleCount: row.evidence.transactionCount,
      totalQuantitySold: row.evidence.totalQuantitySold,
      lastSoldAt: row.evidence.lastSeenAt,
      lastPosTransactionId: row.evidence.lastPosTransactionId ?? null,
      offlineSaleCount: row.evidence.offlineSaleCount ?? 0,
      observedLookupCodes: row.evidence.observedLookupCodes,
      observedPrices: row.evidence.observedPrices,
    },
    lastActivityAt: row.evidence.lastSeenAt,
    updatedAt: row.updatedAt,
  };
}

async function listInventoryImportEvidenceSources(
  ctx: QueryCtx,
  args: {
    reviewStatus: UntrustedSkuSaleEvidenceReviewStatus;
    storeId: Id<"store">;
  }
) {
  const rows: Doc<"inventoryImportProvisionalSku">[] = [];
  const productCache = new Map<Id<"product">, Doc<"product"> | null>();
  for (const status of getImportStatusesForReviewStatus(args.reviewStatus)) {
    const matches = await ctx.db
      .query("inventoryImportProvisionalSku")
      .withIndex("by_storeId_status_saleEvidenceQuantity", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", status)
          .gt("saleEvidence.totalQuantitySold", 0)
      )
      .order("desc")
      .take(UNTRUSTED_SKU_EVIDENCE_SOURCE_CANDIDATE_LIMIT);

    rows.push(...matches);
  }

  const sources = [];
  for (const row of rows) {
    const reviewState = getInventoryImportEvidenceReviewState(row);
    if (args.reviewStatus !== "all" && reviewState !== args.reviewStatus) {
      continue;
    }

    if (await hasArchivedLinkedProduct(ctx, productCache, row)) {
      continue;
    }
    sources.push(buildInventoryImportEvidenceSource(row));
  }

  return sources;
}

async function listPendingCheckoutEvidenceSources(
  ctx: QueryCtx,
  args: {
    reviewStatus: UntrustedSkuSaleEvidenceReviewStatus;
    storeId: Id<"store">;
  }
) {
  const rows: Doc<"posPendingCheckoutItem">[] = [];
  for (const status of getPendingCheckoutStatusesForReviewStatus(
    args.reviewStatus
  )) {
    const matches = await ctx.db
      .query("posPendingCheckoutItem")
      .withIndex("by_storeId_status_evidenceQuantity", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", status)
          .gt("evidence.totalQuantitySold", 0)
      )
      .order("desc")
      .take(UNTRUSTED_SKU_EVIDENCE_SOURCE_CANDIDATE_LIMIT);

    rows.push(...matches);
  }

  return rows.map(buildPendingCheckoutEvidenceSource);
}

async function listTransactionItemsForUntrustedSource(
  ctx: QueryCtx,
  args: {
    sourceId: string;
    sourceType: UntrustedSkuSaleEvidenceSourceType;
  }
) {
  const readLimit = UNTRUSTED_SKU_TRANSACTION_HISTORY_SCAN_LIMIT + 1;

  if (args.sourceType === "inventoryImportProvisionalSku") {
    return ctx.db
      .query("posTransactionItem")
      .withIndex("by_inventoryImportProvisionalSkuId", (q) =>
        q.eq(
          "inventoryImportProvisionalSkuId",
          args.sourceId as Id<"inventoryImportProvisionalSku">
        )
      )
      .take(readLimit);
  }

  return ctx.db
    .query("posTransactionItem")
    .withIndex("by_pendingCheckoutItemId", (q) =>
      q.eq("pendingCheckoutItemId", args.sourceId as Id<"posPendingCheckoutItem">)
    )
    .take(readLimit);
}

async function summarizeTransactionItemAdjustments(
  ctx: QueryCtx,
  item: Doc<"posTransactionItem">
) {
  const lines = await ctx.db
    .query("posTransactionAdjustmentLine")
    .withIndex("by_originalTransactionItemId", (q) =>
      q.eq("originalTransactionItemId", item._id)
    )
    .take(UNTRUSTED_SKU_TRANSACTION_ADJUSTMENT_LIMIT + 1);

  const adjustments = [];
  for (const line of lines.slice(0, UNTRUSTED_SKU_TRANSACTION_ADJUSTMENT_LIMIT)) {
    const adjustment = await ctx.db.get("posTransactionAdjustment", line.adjustmentId);
    if (!adjustment || adjustment.transactionId !== item.transactionId) {
      continue;
    }

    adjustments.push({
      adjustmentId: adjustment._id,
      status: adjustment.status,
      createdAt: adjustment.createdAt,
      appliedAt: adjustment.appliedAt ?? null,
      quantityDelta: line.quantityDelta,
      originalQuantity: line.originalQuantity,
      correctedQuantity: line.correctedQuantity,
    });
  }

  adjustments.sort((left, right) => {
    const leftTime = left.appliedAt ?? left.createdAt;
    const rightTime = right.appliedAt ?? right.createdAt;
    return rightTime - leftTime;
  });

  const latestApplied = adjustments.find(
    (adjustment) => adjustment.status === "applied"
  );

  return {
    appliedQuantityDelta:
      adjustments
        .filter((adjustment) => adjustment.status === "applied")
        .reduce((total, adjustment) => total + adjustment.quantityDelta, 0),
    count: adjustments.length,
    isTruncated: lines.length > UNTRUSTED_SKU_TRANSACTION_ADJUSTMENT_LIMIT,
    latestAppliedAt: latestApplied?.appliedAt ?? null,
    latestStatus: adjustments[0]?.status ?? null,
  };
}

async function buildUntrustedSourceTransactionHistory(
  ctx: QueryCtx,
  args: {
    sourceId: string;
    sourceType: UntrustedSkuSaleEvidenceSourceType;
    storeId: Id<"store">;
    transactionLimit: number;
  }
) {
  const items = await listTransactionItemsForUntrustedSource(ctx, args);
  const candidates: Array<{
    item: Doc<"posTransactionItem">;
    transaction: Doc<"posTransaction">;
  }> = [];

  for (const item of items) {
    const transaction = await ctx.db.get("posTransaction", item.transactionId);
    if (
      !transaction ||
      transaction.storeId !== args.storeId ||
      typeof transaction.completedAt !== "number"
    ) {
      continue;
    }

    candidates.push({ item, transaction });
  }

  candidates.sort((left, right) => {
    if (right.transaction.completedAt !== left.transaction.completedAt) {
      return right.transaction.completedAt - left.transaction.completedAt;
    }

    return String(left.item._id).localeCompare(String(right.item._id));
  });

  const rows = [];
  for (const { item, transaction } of candidates.slice(
    0,
    args.transactionLimit
  )) {
    const adjustments = await summarizeTransactionItemAdjustments(ctx, item);
    const refundedQuantity = item.refundedQuantity ?? 0;
    const netQuantity = Math.max(
      0,
      item.quantity - refundedQuantity + adjustments.appliedQuantityDelta
    );

    rows.push({
      id: item._id,
      transactionId: transaction._id,
      transactionNumber: transaction.transactionNumber,
      transactionStatus: transaction.status,
      completedAt: transaction.completedAt,
      registerNumber: transaction.registerNumber ?? null,
      productId: item.productId,
      productSkuId: item.productSkuId,
      productName: item.productName,
      productSku: item.productSku,
      quantity: item.quantity,
      refundedQuantity,
      netQuantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      isRefunded: item.isRefunded ?? false,
      refundedAt: item.refundedAt ?? null,
      adjustments,
    });
  }

  return {
    isTruncated:
      candidates.length > args.transactionLimit ||
      items.length > UNTRUSTED_SKU_TRANSACTION_HISTORY_SCAN_LIMIT,
    rows,
  };
}

async function loadSelectedUntrustedEvidenceSource(
  ctx: QueryCtx,
  args: {
    reviewStatus: UntrustedSkuSaleEvidenceReviewStatus;
    selectedSource?: {
      sourceId: string;
      sourceType: UntrustedSkuSaleEvidenceSourceType;
    };
    storeId: Id<"store">;
    transactionLimit: number;
  }
) {
  if (!args.selectedSource) {
    return null;
  }

  const statusMatchesReviewFilter = (reviewState: "open" | "reviewed") =>
    args.reviewStatus === "all" || args.reviewStatus === reviewState;

  if (args.selectedSource.sourceType === "inventoryImportProvisionalSku") {
    const sourceId = ctx.db.normalizeId(
      "inventoryImportProvisionalSku",
      args.selectedSource.sourceId
    );
    if (!sourceId) {
      return null;
    }

    const row = await ctx.db.get(
      "inventoryImportProvisionalSku",
      sourceId
    );
    if (
      !row ||
      row.storeId !== args.storeId ||
      row.saleEvidence.totalQuantitySold <= 0 ||
      (await hasArchivedLinkedProduct(ctx, new Map(), row))
    ) {
      return null;
    }

    const source = buildInventoryImportEvidenceSource(row);
    if (!statusMatchesReviewFilter(source.reviewState)) {
      return null;
    }

    return {
      source,
      transactionHistory: await buildUntrustedSourceTransactionHistory(ctx, {
        sourceId: String(row._id),
        sourceType: "inventoryImportProvisionalSku",
        storeId: args.storeId,
        transactionLimit: args.transactionLimit,
      }),
    };
  }

  const sourceId = ctx.db.normalizeId(
    "posPendingCheckoutItem",
    args.selectedSource.sourceId
  );
  if (!sourceId) {
    return null;
  }

  const row = await ctx.db.get("posPendingCheckoutItem", sourceId);
  if (!row || row.storeId !== args.storeId || row.evidence.totalQuantitySold <= 0) {
    return null;
  }

  const source = buildPendingCheckoutEvidenceSource(row);
  if (!statusMatchesReviewFilter(source.reviewState)) {
    return null;
  }

  return {
    source,
    transactionHistory: await buildUntrustedSourceTransactionHistory(ctx, {
      sourceId: String(row._id),
      sourceType: "posPendingCheckoutItem",
      storeId: args.storeId,
      transactionLimit: args.transactionLimit,
    }),
  };
}

export async function getUntrustedSkuSaleEvidenceWithCtx(
  ctx: QueryCtx,
  args: {
    limit?: number;
    reviewStatus?: UntrustedSkuSaleEvidenceReviewStatus;
    selectedSource?: {
      sourceId: string;
      sourceType: UntrustedSkuSaleEvidenceSourceType;
    };
    sourceFilter?: UntrustedSkuSaleEvidenceSourceFilter;
    storeId: Id<"store">;
    transactionLimit?: number;
  }
) {
  const reviewStatus = args.reviewStatus ?? "open";
  const sourceFilter = args.sourceFilter ?? "all";
  const limit = boundedNumber(
    args.limit,
    UNTRUSTED_SKU_EVIDENCE_DEFAULT_LIMIT,
    UNTRUSTED_SKU_EVIDENCE_MAX_LIMIT
  );
  const transactionLimit = boundedNumber(
    args.transactionLimit,
    UNTRUSTED_SKU_TRANSACTION_HISTORY_DEFAULT_LIMIT,
    UNTRUSTED_SKU_TRANSACTION_HISTORY_MAX_LIMIT
  );

  const [inventoryImportSources, pendingCheckoutSources] = await Promise.all([
    sourceFilter === "pending_checkout"
      ? Promise.resolve([])
      : listInventoryImportEvidenceSources(ctx, {
          reviewStatus,
          storeId: args.storeId,
        }),
    sourceFilter === "legacy_import"
      ? Promise.resolve([])
      : listPendingCheckoutEvidenceSources(ctx, {
          reviewStatus,
          storeId: args.storeId,
        }),
  ]);

  const orderedSources = [
    ...inventoryImportSources,
    ...pendingCheckoutSources,
  ].sort((left, right) => {
    if (right.lastActivityAt !== left.lastActivityAt) {
      return right.lastActivityAt - left.lastActivityAt;
    }

    return String(left.id).localeCompare(String(right.id));
  });

  return {
    reviewStatus,
    sourceFilter,
    sources: orderedSources.slice(0, limit),
    sourceLimit: limit,
    totalSourceCount: orderedSources.length,
    hasMoreSources: orderedSources.length > limit,
    selected: await loadSelectedUntrustedEvidenceSource(ctx, {
      reviewStatus,
      selectedSource: args.selectedSource,
      storeId: args.storeId,
      transactionLimit,
    }),
  };
}

export async function getSkuActivityForProductSkuWithCtx(
  ctx: QueryCtx,
  args: {
    now?: number;
    productSkuId?: Id<"productSku">;
    sku?: string;
    storeId: Id<"store">;
  }
) {
  const productSku = await resolveProductSkuForActivity(ctx, args);

  if (!productSku || productSku.storeId !== args.storeId) {
    return null;
  }

  const events = (await ctx.db
    .query("skuActivityEvent")
    .withIndex("by_storeId_productSkuId_occurredAt", (q) =>
      q.eq("storeId", args.storeId).eq("productSkuId", productSku._id)
    )
    .take(SKU_ACTIVITY_TIMELINE_LIMIT + 1)) as SkuActivityEventRecord[];

  if (events.length > SKU_ACTIVITY_TIMELINE_LIMIT) {
    throw new Error("SKU activity timeline is too large to summarize.");
  }

  const activeReservationEntries = await buildActiveReservationEntries(
    ctx,
    events,
    args.now ?? Date.now()
  );
  const activeReservations = summarizeActiveReservations(activeReservationEntries);

  return {
    productSku: {
      _id: productSku._id,
      productId: productSku.productId,
      productName: productSku.productName ?? null,
      sku: productSku.sku ?? null,
    },
    stock: {
      durableQuantityAvailable: productSku.quantityAvailable,
      inventoryCount: productSku.inventoryCount,
      quantityAvailable: productSku.quantityAvailable,
    },
    activeReservations,
    timeline: buildTimeline(events),
    warnings: buildAvailabilityWarnings({
      checkoutQuantity: activeReservations.checkoutQuantity,
      productSku,
    }),
  };
}

export const getSkuActivityForProductSku = query({
  args: {
    storeId: v.id("store"),
    productSkuId: v.optional(v.id("productSku")),
    sku: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSkuActivityStoreAccess(ctx, args.storeId);
    return getSkuActivityForProductSkuWithCtx(ctx, args);
  },
});

const untrustedSkuSaleEvidenceReviewStatusValidator = v.union(
  v.literal("open"),
  v.literal("reviewed"),
  v.literal("all")
);

const untrustedSkuSaleEvidenceSourceTypeValidator = v.union(
  v.literal("inventoryImportProvisionalSku"),
  v.literal("posPendingCheckoutItem")
);

const untrustedSkuSaleEvidenceSourceFilterValidator = v.union(
  v.literal("all"),
  v.literal("legacy_import"),
  v.literal("pending_checkout")
);

export const getUntrustedSkuSaleEvidence = query({
  args: {
    storeId: v.id("store"),
    reviewStatus: v.optional(untrustedSkuSaleEvidenceReviewStatusValidator),
    sourceFilter: v.optional(untrustedSkuSaleEvidenceSourceFilterValidator),
    limit: v.optional(v.number()),
    transactionLimit: v.optional(v.number()),
    selectedSource: v.optional(
      v.object({
        sourceType: untrustedSkuSaleEvidenceSourceTypeValidator,
        sourceId: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    await requireSkuActivityStoreAccess(ctx, args.storeId);
    return getUntrustedSkuSaleEvidenceWithCtx(ctx, args);
  },
});
