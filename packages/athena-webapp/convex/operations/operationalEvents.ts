import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { buildOperationalEventMessage } from "./helpers/eventBuilders";

const PRODUCT_OPERATIONAL_EVENT_LIMIT = 100;

export type RecordOperationalEventArgs = {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  eventType: string;
  subjectType: string;
  subjectId: string;
  subjectLabel?: string;
  message?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  metadataDedupeKeys?: string[];
  actorUserId?: Id<"athenaUser">;
  actorStaffProfileId?: Id<"staffProfile">;
  actorType?: "human" | "automation";
  automationRunId?: Id<"automationRun">;
  automationPolicyVersion?: string;
  automationDecisionReason?: string;
  customerProfileId?: Id<"customerProfile">;
  workItemId?: Id<"operationalWorkItem">;
  registerSessionId?: Id<"registerSession">;
  terminalId?: Id<"posTerminal">;
  localEventId?: string;
  approvalRequestId?: Id<"approvalRequest">;
  inventoryMovementId?: Id<"inventoryMovement">;
  paymentAllocationId?: Id<"paymentAllocation">;
  onlineOrderId?: Id<"onlineOrder">;
  posTransactionId?: Id<"posTransaction">;
};

export function buildOperationalEvent(args: RecordOperationalEventArgs) {
  const { metadataDedupeKeys: _metadataDedupeKeys, ...eventArgs } = args;
  const normalizedArgs = normalizeOperationalEventTraceFields(eventArgs);

  return {
    ...normalizedArgs,
    message:
      args.message ??
      buildOperationalEventMessage({
        eventType: args.eventType,
        subjectType: args.subjectType,
        subjectLabel: args.subjectLabel,
      }),
    createdAt: Date.now(),
  };
}

export function normalizeOperationalEventTraceFields<
  EventArgs extends Omit<RecordOperationalEventArgs, "metadataDedupeKeys">,
>(args: EventArgs): EventArgs {
  const traceMetadata = buildTraceMetadata(args);
  if (!traceMetadata) return args;

  const metadata = args.metadata ?? {};

  return {
    ...args,
    metadata: {
      ...metadata,
      ...(traceMetadata.localEventId !== undefined &&
      metadata.localEventId === undefined
        ? { localEventId: traceMetadata.localEventId }
        : {}),
      ...(traceMetadata.posTransactionId !== undefined &&
      metadata.posTransactionId === undefined
        ? { posTransactionId: traceMetadata.posTransactionId }
        : {}),
      ...(traceMetadata.registerSessionId !== undefined &&
      metadata.registerSessionId === undefined
        ? { registerSessionId: traceMetadata.registerSessionId }
        : {}),
      ...(traceMetadata.terminalId !== undefined &&
      metadata.terminalId === undefined
        ? { terminalId: traceMetadata.terminalId }
        : {}),
      posTrace: {
        ...(isRecord(metadata.posTrace) ? metadata.posTrace : {}),
        ...traceMetadata,
      },
    },
  } as EventArgs;
}

function buildTraceMetadata(
  args: Omit<RecordOperationalEventArgs, "metadataDedupeKeys">
) {
  if (!shouldNormalizePosTrace(args)) return null;

  const traceMetadata = {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    localEventId: args.localEventId,
    posTransactionId: args.posTransactionId,
    registerSessionId: args.registerSessionId,
    terminalId: args.terminalId,
  };
  const compactTraceMetadata = Object.fromEntries(
    Object.entries(traceMetadata).filter(([, value]) => value !== undefined)
  );

  return Object.keys(compactTraceMetadata).length > 0
    ? compactTraceMetadata
    : null;
}

function shouldNormalizePosTrace(
  args: Omit<RecordOperationalEventArgs, "metadataDedupeKeys">
) {
  if (
    args.localEventId ||
    args.posTransactionId ||
    args.registerSessionId ||
    args.terminalId
  ) {
    return true;
  }

  return (
    args.eventType.startsWith("pos_") ||
    args.eventType.startsWith("manager_elevation.") ||
    [
      "managerElevation",
      "posRecoveryCredential",
      "posTerminal",
      "posTransaction",
      "pos_transaction",
      "registerSession",
      "register_session",
    ].includes(args.subjectType)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function matchesExistingEvent(
  existingEvent: {
    eventType: string;
    subjectType: string;
    subjectId: string;
    reason?: string;
    approvalRequestId?: Id<"approvalRequest">;
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    actorType?: "human" | "automation";
    automationDecisionReason?: string;
    automationPolicyVersion?: string;
    automationRunId?: Id<"automationRun">;
    customerProfileId?: Id<"customerProfile">;
    inventoryMovementId?: Id<"inventoryMovement">;
    onlineOrderId?: Id<"onlineOrder">;
    paymentAllocationId?: Id<"paymentAllocation">;
    posTransactionId?: Id<"posTransaction">;
    registerSessionId?: Id<"registerSession">;
    terminalId?: Id<"posTerminal">;
    localEventId?: string;
    workItemId?: Id<"operationalWorkItem">;
    metadata?: Record<string, unknown>;
  },
  args: RecordOperationalEventArgs
) {
  return (
    existingEvent.eventType === args.eventType &&
    existingEvent.subjectType === args.subjectType &&
    existingEvent.subjectId === args.subjectId &&
    existingEvent.reason === args.reason &&
    existingEvent.approvalRequestId === args.approvalRequestId &&
    existingEvent.actorStaffProfileId === args.actorStaffProfileId &&
    existingEvent.actorUserId === args.actorUserId &&
    existingEvent.actorType === args.actorType &&
    existingEvent.automationRunId === args.automationRunId &&
    existingEvent.automationPolicyVersion === args.automationPolicyVersion &&
    existingEvent.automationDecisionReason ===
      args.automationDecisionReason &&
    existingEvent.customerProfileId === args.customerProfileId &&
    existingEvent.inventoryMovementId === args.inventoryMovementId &&
    existingEvent.onlineOrderId === args.onlineOrderId &&
    existingEvent.paymentAllocationId === args.paymentAllocationId &&
    existingEvent.posTransactionId === args.posTransactionId &&
    existingEvent.registerSessionId === args.registerSessionId &&
    existingEvent.terminalId === args.terminalId &&
    existingEvent.localEventId === args.localEventId &&
    existingEvent.workItemId === args.workItemId &&
    metadataDedupeKeysMatch(
      existingEvent.metadata,
      args.metadata,
      args.metadataDedupeKeys
    )
  );
}

function metadataDedupeKeysMatch(
  existingMetadata?: Record<string, unknown>,
  nextMetadata?: Record<string, unknown>,
  keys: string[] = []
) {
  return keys.every(
    (key) => existingMetadata?.[key] === nextMetadata?.[key]
  );
}

export async function recordOperationalEventWithCtx(
  ctx: MutationCtx,
  args: RecordOperationalEventArgs
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Subject-scoped dedupe must inspect the full indexed event history so idempotent replays do not create duplicates.
  const existingEvents = await ctx.db
    .query("operationalEvent")
    .withIndex("by_storeId_subject", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("subjectType", args.subjectType)
        .eq("subjectId", args.subjectId)
    )
    .collect();

  const existingEvent = existingEvents.find((event) =>
    matchesExistingEvent(event, args)
  );

  if (existingEvent) {
    return existingEvent;
  }

  const eventId = await ctx.db.insert(
    "operationalEvent",
    buildOperationalEvent(args)
  );

  return ctx.db.get("operationalEvent", eventId);
}

export async function listProductOperationalTimelineWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    productId: Id<"product">;
    storeId: Id<"store">;
  }
) {
  const product = await ctx.db.get("product", args.productId);
  if (!product || String(product.storeId) !== String(args.storeId)) {
    return [];
  }

  const productSkus = await ctx.db
    .query("productSku")
    .withIndex("by_productId", (q) => q.eq("productId", args.productId))
    .take(PRODUCT_OPERATIONAL_EVENT_LIMIT);

  const subjects = [
    { id: String(args.productId), sku: undefined, type: "product" },
    ...productSkus.map((sku) => ({
      id: String(sku._id),
      sku: sku.sku || undefined,
      type: "product_sku",
    })),
  ];

  const directEventGroups = await Promise.all(
    subjects.map((subject) =>
      ctx.db
        .query("operationalEvent")
        .withIndex("by_storeId_subject", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("subjectType", subject.type)
            .eq("subjectId", subject.id)
        )
        .take(PRODUCT_OPERATIONAL_EVENT_LIMIT)
        .then((events) =>
          events.map((event) => ({
            ...event,
            subjectSku: subject.sku,
          }))
        )
    )
  );

  const pendingCheckoutItemGroups = await Promise.all(
    productSkus.map((sku) =>
      ctx.db
        .query("posPendingCheckoutItem")
        .withIndex("by_storeId_provisionalProductSkuId", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("provisionalProductSkuId", sku._id)
        )
        .take(PRODUCT_OPERATIONAL_EVENT_LIMIT)
        .then((items) =>
          Promise.all(
            items.map((item) =>
              ctx.db
                .query("operationalEvent")
                .withIndex("by_storeId_subject", (q) =>
                  q
                    .eq("storeId", args.storeId)
                    .eq("subjectType", "pos_pending_checkout_item")
                    .eq("subjectId", String(item._id))
                )
                .take(PRODUCT_OPERATIONAL_EVENT_LIMIT)
                .then((events) =>
                  events.map((event) => ({
                    ...event,
                    subjectSku: sku.sku || undefined,
                  }))
                )
            )
          )
        )
    )
  );

  const linkedPendingCheckoutItemGroups = await Promise.all(
    productSkus.map((sku) =>
      ctx.db
        .query("posPendingCheckoutItem")
        .withIndex("by_storeId_status_approvedProductSkuId", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("status", "linked_to_catalog")
            .eq("approvedProductSkuId", sku._id)
        )
        .take(PRODUCT_OPERATIONAL_EVENT_LIMIT)
        .then((items) =>
          Promise.all(
            items.map((item) =>
              ctx.db
                .query("operationalEvent")
                .withIndex("by_storeId_subject", (q) =>
                  q
                    .eq("storeId", args.storeId)
                    .eq("subjectType", "pos_pending_checkout_item")
                    .eq("subjectId", String(item._id))
                )
                .take(PRODUCT_OPERATIONAL_EVENT_LIMIT)
                .then((events) =>
                  events.map((event) => ({
                    ...event,
                    subjectSku: sku.sku || undefined,
                  }))
                )
            )
          )
        )
    )
  );

  const eventsById = new Map(
    [
      ...directEventGroups,
      ...pendingCheckoutItemGroups.flat(),
      ...linkedPendingCheckoutItemGroups.flat(),
    ]
      .flat()
      .map((event) => [event._id, event]),
  );

  return Array.from(eventsById.values())
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, PRODUCT_OPERATIONAL_EVENT_LIMIT)
    .map((event) => ({
      createdAt: event.createdAt,
      id: event._id,
      message: event.message,
      metadata: event.metadata,
      subject: {
        id: event.subjectId,
        label: event.subjectLabel,
        sku: event.subjectSku,
        type: event.subjectType,
      },
      type: event.eventType,
    }));
}

export const recordOperationalEvent = internalMutation({
  args: {
    storeId: v.id("store"),
    organizationId: v.optional(v.id("organization")),
    eventType: v.string(),
    subjectType: v.string(),
    subjectId: v.string(),
    subjectLabel: v.optional(v.string()),
    message: v.optional(v.string()),
    reason: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.any())),
    metadataDedupeKeys: v.optional(v.array(v.string())),
    actorUserId: v.optional(v.id("athenaUser")),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    actorType: v.optional(
      v.union(v.literal("human"), v.literal("automation")),
    ),
    automationRunId: v.optional(v.id("automationRun")),
    automationPolicyVersion: v.optional(v.string()),
    automationDecisionReason: v.optional(v.string()),
    customerProfileId: v.optional(v.id("customerProfile")),
    workItemId: v.optional(v.id("operationalWorkItem")),
    registerSessionId: v.optional(v.id("registerSession")),
    terminalId: v.optional(v.id("posTerminal")),
    localEventId: v.optional(v.string()),
    approvalRequestId: v.optional(v.id("approvalRequest")),
    inventoryMovementId: v.optional(v.id("inventoryMovement")),
    paymentAllocationId: v.optional(v.id("paymentAllocation")),
    onlineOrderId: v.optional(v.id("onlineOrder")),
    posTransactionId: v.optional(v.id("posTransaction")),
  },
  handler: (ctx, args) => recordOperationalEventWithCtx(ctx, args),
});

export const listProductOperationalTimeline = query({
  args: {
    productId: v.id("product"),
    storeId: v.id("store"),
  },
  handler: (ctx, args) => listProductOperationalTimelineWithCtx(ctx, args),
});

export const listOperationalEventsForSubject = internalQuery({
  args: {
    storeId: v.id("store"),
    subjectType: v.string(),
    subjectId: v.string(),
  },
  handler: async (ctx, args) =>
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- This timeline query returns the full indexed history for one subject and should not silently truncate results.
    ctx.db
      .query("operationalEvent")
      .withIndex("by_storeId_subject", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("subjectType", args.subjectType)
          .eq("subjectId", args.subjectId)
      )
      .collect(),
});
