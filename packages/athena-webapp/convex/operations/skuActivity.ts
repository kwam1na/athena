import { internalMutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";

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
    sourceId: string;
    sourceType: string;
    storeId: Id<"store">;
  },
  args: RecordSkuActivityEventArgs
) {
  if (
    existingEvent.storeId !== args.storeId ||
    existingEvent.productSkuId !== args.productSkuId ||
    existingEvent.activityType !== args.activityType.trim() ||
    existingEvent.sourceType !== args.sourceType.trim() ||
    existingEvent.sourceId !== args.sourceId.trim()
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
  handler: (ctx, args) => getSkuActivityForProductSkuWithCtx(ctx, args),
});
