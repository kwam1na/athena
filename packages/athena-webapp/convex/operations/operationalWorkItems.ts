import {
  internalMutation,
  internalQuery,
  MutationCtx,
  QueryCtx,
  query,
} from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { admitSharedDemoPublicQuery } from "../operationAdmission/publicQuery";
import {
  getOpenWorkCountSummaryReadDefinition,
  getPendingApprovalCountSummaryReadDefinition,
  getQueueSnapshotReadDefinition,
} from "../operationAdmission/readDefinitions";
import type { OperationQueryCtx } from "../operationAdmission/types";
import { listOpenLocalSyncConflictsByRegisterSession } from "../cashControls/deposits";
import { listOpenLocalSyncConflictsByRegisterSessionWithCompleteness } from "../pos/application/sync/registerSessionSyncReview";
import {
  operationalWorkMetadataString as metadataString,
  projectLogicalOperationalWork,
  stableOperationalWorkItemSourceIdentity,
} from "./logicalOperationalWork";

const MAX_QUEUE_ITEMS = 100;
const QUEUE_LANE_PROBE_LIMIT = 1_000;
const ACTIVE_REPAIR_PROBE_LIMIT = 1_000;
const OPEN_WORK_COUNT_ITEM_PROBE_LIMIT = 500;
const OPEN_WORK_COUNT_REPAIR_PROBE_LIMIT = 100;
const PENDING_APPROVAL_COUNT_PROBE_LIMIT = 100;
const APPROVAL_REQUEST_PROBE_LIMIT = MAX_QUEUE_ITEMS + 1;
const OPEN_WORK_ITEM_STATUSES = ["open", "in_progress"] as const;
const REGISTER_SYNC_REVIEW_REQUEST_TYPE = "register_sync_review";
const REGISTER_SYNC_REVIEW_SUBJECT_TYPE = "register_session_sync_review";
const QUEUE_APPROVAL_REQUEST_TYPES = [
  "inventory_adjustment_review",
  "online_order_return_review",
  "payment_method_correction",
  "pos_item_adjustment",
  "pos_item_adjustment_review",
  "pos_transaction_void",
  "service_deposit_review",
  "variance_review",
] as const;
const QUEUE_WORK_ITEM_TYPES = [
  "catalog_taxonomy_setup",
  "daily_close_carry_forward",
  "pos_pending_checkout_item_review",
  "purchase_order",
  "service_appointment",
  "service_case",
  "service_intake",
  "stock_adjustment_review",
  "synced_sale_inventory_review",
] as const;

async function authorizeOperationalWorkSummaryRead(
  ctx: QueryCtx,
  args: { storeId: Id<"store"> },
  failureMessage: string,
) {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  const admittedActor = (ctx as Partial<OperationQueryCtx>).operationAdmission
    ?.actor;
  const athenaUser = admittedActor
    ? ({ _id: admittedActor.athenaUserId } as const)
    : await requireAuthenticatedAthenaUserWithCtx(ctx);

  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin", "pos_only"],
    failureMessage,
    organizationId: store.organizationId,
    userId: athenaUser._id,
  });
}

async function filterArchivedPendingCheckoutWorkItems(
  ctx: QueryCtx,
  items: Array<Doc<"operationalWorkItem">>,
) {
  const productCache = new Map<Id<"product">, Doc<"product"> | null>();
  const filteredItems = [];

  for (const item of items) {
    if (item.type !== "pos_pending_checkout_item_review") {
      filteredItems.push(item);
      continue;
    }

    const provisionalProductId = metadataString(
      item.metadata,
      "provisionalProductId",
    ) as Id<"product"> | null;
    if (!provisionalProductId) {
      filteredItems.push(item);
      continue;
    }

    if (!productCache.has(provisionalProductId)) {
      productCache.set(
        provisionalProductId,
        await ctx.db.get("product", provisionalProductId),
      );
    }

    if (productCache.get(provisionalProductId)?.availability === "archived") {
      continue;
    }

    filteredItems.push(item);
  }

  return filteredItems;
}

function metadataNumber(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metadataArrayCount(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return Array.isArray(value) ? value.length : null;
}

export const getOpenWorkCountSummary = query({
  args: {
    storeId: v.id("store"),
  },
  handler: admitSharedDemoPublicQuery(
    getOpenWorkCountSummaryReadDefinition,
    async (ctx, args: { storeId: Id<"store"> }) => {
      await authorizeOperationalWorkSummaryRead(
        ctx,
        args,
        "Only POS operators can view open work.",
      );

      const rawWorkItemLanes: Array<{
        incomplete: boolean;
        items: Array<Doc<"operationalWorkItem">>;
        type: string;
      }> = [];
      let remainingWorkItemBudget = OPEN_WORK_COUNT_ITEM_PROBE_LIMIT;
      for (const status of OPEN_WORK_ITEM_STATUSES) {
        for (const type of QUEUE_WORK_ITEM_TYPES) {
          const items = await ctx.db
            .query("operationalWorkItem")
            .withIndex("by_storeId_type_status", (q) =>
              q
                .eq("storeId", args.storeId)
                .eq("type", type)
                .eq("status", status),
            )
            .take(remainingWorkItemBudget + 1);
          const acceptedItems = items.slice(0, remainingWorkItemBudget);

          rawWorkItemLanes.push({
            incomplete: items.length > remainingWorkItemBudget,
            items: acceptedItems,
            type,
          });
          remainingWorkItemBudget -= acceptedItems.length;
        }
      }

      const activeOversizedRepairs: Array<
        Doc<"oversizedOperationalWorkRepair">
      > = [];
      let activeRepairReadIncomplete = false;
      let remainingRepairBudget = OPEN_WORK_COUNT_REPAIR_PROBE_LIMIT;
      for (const status of ["pending", "running", "paused"] as const) {
        const repairs = await ctx.db
          .query("oversizedOperationalWorkRepair")
          .withIndex("by_storeId_status", (q) =>
            q.eq("storeId", args.storeId).eq("status", status),
          )
          .take(remainingRepairBudget + 1);
        const acceptedRepairs = repairs.slice(0, remainingRepairBudget);

        activeRepairReadIncomplete ||= repairs.length > remainingRepairBudget;
        activeOversizedRepairs.push(...acceptedRepairs);
        remainingRepairBudget -= acceptedRepairs.length;
      }
      const workItemLanes = await Promise.all(
        rawWorkItemLanes.map(async (lane) => ({
          ...lane,
          items: await filterArchivedPendingCheckoutWorkItems(ctx, lane.items),
        })),
      );
      const incompleteTypes = new Set(
        workItemLanes
          .filter((lane) => lane.incomplete)
          .map((lane) => lane.type),
      );
      if (activeRepairReadIncomplete) {
        incompleteTypes.add("synced_sale_inventory_review");
      }

      const logicalWork = projectLogicalOperationalWork({
        incompleteTypes,
        items: workItemLanes.flatMap((lane) => lane.items),
        remediationSourceIdentitiesByGroupKey: new Map(
          activeOversizedRepairs.map((repair) => [
            repair.groupKey,
            new Set(repair.sourceIdentities),
          ]),
        ),
        sourceCompleteness:
          incompleteTypes.size > 0 ? "incomplete" : "complete",
      });

      return {
        completeness: logicalWork.completeness,
        count: logicalWork.observedCount,
      };
    },
  ),
});

export const getPendingApprovalCountSummary = query({
  args: {
    storeId: v.id("store"),
  },
  handler: admitSharedDemoPublicQuery(
    getPendingApprovalCountSummaryReadDefinition,
    async (ctx, args: { storeId: Id<"store"> }) => {
      await authorizeOperationalWorkSummaryRead(
        ctx,
        args,
        "Only POS operators can view approvals.",
      );

      const [approvalRead, syncConflictRead] = await Promise.all([
        (async () => {
          let count = 0;
          let incomplete = false;
          let remainingBudget = PENDING_APPROVAL_COUNT_PROBE_LIMIT;

          for (const requestType of QUEUE_APPROVAL_REQUEST_TYPES) {
            const requests = await ctx.db
              .query("approvalRequest")
              .withIndex("by_storeId_status_requestType", (q) =>
                q
                  .eq("storeId", args.storeId)
                  .eq("status", "pending")
                  .eq("requestType", requestType),
              )
              .take(remainingBudget + 1);
            const acceptedCount = Math.min(requests.length, remainingBudget);

            incomplete ||= requests.length > remainingBudget;
            count += acceptedCount;
            remainingBudget -= acceptedCount;
          }

          return { count, incomplete };
        })(),
        listOpenLocalSyncConflictsByRegisterSessionWithCompleteness(
          ctx,
          args.storeId,
          { limit: PENDING_APPROVAL_COUNT_PROBE_LIMIT },
        ),
      ]);

      return {
        completeness:
          approvalRead.incomplete ||
          syncConflictRead.completeness === "incomplete"
            ? "incomplete"
            : "complete",
        count: approvalRead.count + syncConflictRead.conflictsBySessionId.size,
      };
    },
  ),
});

function sanitizeOperationalWorkItemDetails(item: Doc<"operationalWorkItem">) {
  const metadata = item.metadata;

  switch (item.type) {
    case "catalog_taxonomy_setup":
      return {
        categorySlug: metadataString(metadata, "categorySlug"),
        productId: metadataString(metadata, "productId"),
        productName: metadataString(metadata, "productName"),
        productSkuId: metadataString(metadata, "productSkuId"),
        sku: metadataString(metadata, "sku"),
        subcategorySlug: metadataString(metadata, "subcategorySlug"),
      };
    case "daily_close_carry_forward":
      return {
        businessDate: metadataString(metadata, "businessDate"),
        followUpReason: metadataString(metadata, "followUpReason"),
      };
    case "pos_pending_checkout_item_review":
      return {
        lookupCode: metadataString(metadata, "lookupCode"),
        price: metadataNumber(metadata, "price"),
        provisionalProductId: metadataString(metadata, "provisionalProductId"),
        provisionalProductSkuId: metadataString(
          metadata,
          "provisionalProductSkuId",
        ),
        quantitySold: metadataNumber(metadata, "quantitySold"),
        totalQuantitySold: metadataNumber(metadata, "totalQuantitySold"),
      };
    case "purchase_order":
      return {
        displayNumber: metadataString(metadata, "displayNumber"),
        itemCount: metadataNumber(metadata, "itemCount"),
        purchaseOrderNumber: metadataString(metadata, "purchaseOrderNumber"),
        vendorName: metadataString(metadata, "vendorName"),
      };
    case "stock_adjustment_review":
      return {
        reasonLabel: metadataString(metadata, "reasonLabel"),
      };
    case "synced_sale_inventory_review": {
      const skippedLineCount = metadataArrayCount(
        metadata,
        "skippedMutationItems",
      );
      const trustedLineCount = metadataArrayCount(
        metadata,
        "trustedInventoryLines",
      );

      return {
        inventoryReviewLineCount:
          skippedLineCount && skippedLineCount > 0
            ? skippedLineCount
            : trustedLineCount,
        localRegisterSessionId: metadataString(
          metadata,
          "localRegisterSessionId",
        ),
        localTransactionId: metadataString(metadata, "localTransactionId"),
        primaryProductSkuId:
          item.productSkuId ?? metadataString(metadata, "primaryProductSkuId"),
        receiptNumber: metadataString(metadata, "receiptNumber"),
        registerSessionId: metadataString(metadata, "registerSessionId"),
        sourceId:
          metadataString(metadata, "sourceType") === "posTransaction"
            ? metadataString(metadata, "sourceId")
            : null,
        terminalId: metadataString(metadata, "terminalId"),
      };
    }
    default:
      return {};
  }
}

function projectOperationalWorkItemForQueue(args: {
  customerMap: Map<Id<"customerProfile">, Doc<"customerProfile">>;
  item: Doc<"operationalWorkItem">;
  staffMap: Map<Id<"staffProfile">, Doc<"staffProfile">>;
}) {
  const { customerMap, item, staffMap } = args;

  return {
    _id: item._id,
    approvalRequestId: item.approvalRequestId,
    approvalState: item.approvalState,
    assignedStaffName: item.assignedToStaffProfileId
      ? staffMap.get(item.assignedToStaffProfileId)?.fullName
      : null,
    completedAt: item.completedAt,
    createdAt: item.createdAt,
    customerName: item.customerProfileId
      ? customerMap.get(item.customerProfileId)?.fullName
      : null,
    details: sanitizeOperationalWorkItemDetails(item),
    dueAt: item.dueAt,
    priority: item.priority,
    sourceIdentity: stableOperationalWorkItemSourceIdentity(item),
    startedAt: item.startedAt,
    status: item.status,
    title: item.title,
    type: item.type,
  };
}

function approvalRequestTransactionId(request: Doc<"approvalRequest">) {
  if (
    request.requestType === "pos_item_adjustment" ||
    request.requestType === "pos_item_adjustment_review"
  ) {
    return request.metadata?.transactionId as Id<"posTransaction"> | undefined;
  }

  if (
    request.requestType === "payment_method_correction" &&
    request.subjectType === "pos_transaction"
  ) {
    return request.subjectId as Id<"posTransaction">;
  }

  if (
    request.requestType === "pos_transaction_void" &&
    request.subjectType === "pos_transaction"
  ) {
    return request.subjectId as Id<"posTransaction">;
  }

  return undefined;
}

function sanitizeApprovalRequestMetadata(
  metadata: Record<string, unknown> | undefined,
) {
  if (!metadata) {
    return undefined;
  }

  const payload =
    metadata.payload && typeof metadata.payload === "object"
      ? (metadata.payload as Record<string, unknown>)
      : {};

  const lineItems = Array.isArray(metadata.lineItems)
    ? metadata.lineItems
    : Array.isArray(payload.lines)
      ? payload.lines.map((line) => {
          const candidate =
            line && typeof line === "object"
              ? (line as Record<string, unknown>)
              : {};
          return {
            adjustedQuantity: candidate.adjustedQuantity,
            inventoryDelta: candidate.inventoryDelta,
            originalQuantity: candidate.originalQuantity,
            productName: candidate.productName,
            productSkuId: candidate.productSkuId,
            quantityDelta:
              typeof candidate.quantityDelta === "number"
                ? candidate.quantityDelta
                : typeof candidate.inventoryDelta === "number"
                  ? -candidate.inventoryDelta
                  : undefined,
            sku: candidate.sku ?? candidate.productSku,
            unitPrice: candidate.unitPrice,
          };
        })
      : undefined;

  return {
    actionKey: metadata.actionKey,
    adjustedTotal: metadata.adjustedTotal ?? metadata.correctedTotal,
    correctedTotal: metadata.correctedTotal,
    deltaTotal: metadata.deltaTotal,
    lineItems,
    originalTotal: metadata.originalTotal,
    payloadFingerprint: metadata.payloadFingerprint,
    payloadSubject: metadata.payloadSubject,
    settlementAmount: metadata.settlementAmount,
    settlementDirection: metadata.settlementDirection,
    settlementMethod: metadata.settlementMethod,
    totalDelta: metadata.totalDelta ?? metadata.deltaTotal,
    transactionId: metadata.transactionId,
    transactionNumber: metadata.transactionNumber,
  };
}

function formatRegisterSyncReviewTitle(conflictCount: number) {
  return conflictCount === 1
    ? "Synced register activity review"
    : `${conflictCount} synced register activity reviews`;
}

export function buildOperationalWorkItem(args: {
  storeId: Id<"store">;
  organizationId: Id<"organization">;
  type: string;
  status: string;
  priority: string;
  approvalState?: string;
  title: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  dueAt?: number;
  createdByUserId?: Id<"athenaUser">;
  createdByStaffProfileId?: Id<"staffProfile">;
  assignedToStaffProfileId?: Id<"staffProfile">;
  customerProfileId?: Id<"customerProfile">;
  productId?: Id<"product">;
  productSkuId?: Id<"productSku">;
  approvalRequestId?: Id<"approvalRequest">;
  appointmentId?: Id<"serviceAppointment">;
}) {
  return {
    ...args,
    approvalState: args.approvalState ?? "not_required",
    createdAt: Date.now(),
  };
}

export async function createOperationalWorkItemWithCtx(
  ctx: MutationCtx,
  args: Parameters<typeof buildOperationalWorkItem>[0],
) {
  const workItemId = await ctx.db.insert(
    "operationalWorkItem",
    buildOperationalWorkItem(args),
  );
  return ctx.db.get("operationalWorkItem", workItemId);
}

export const createOperationalWorkItem = internalMutation({
  args: {
    storeId: v.id("store"),
    organizationId: v.id("organization"),
    type: v.string(),
    status: v.string(),
    priority: v.string(),
    approvalState: v.optional(v.string()),
    title: v.string(),
    notes: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.any())),
    dueAt: v.optional(v.number()),
    createdByUserId: v.optional(v.id("athenaUser")),
    createdByStaffProfileId: v.optional(v.id("staffProfile")),
    assignedToStaffProfileId: v.optional(v.id("staffProfile")),
    customerProfileId: v.optional(v.id("customerProfile")),
    productId: v.optional(v.id("product")),
    productSkuId: v.optional(v.id("productSku")),
    approvalRequestId: v.optional(v.id("approvalRequest")),
    appointmentId: v.optional(v.id("serviceAppointment")),
  },
  handler: (ctx, args) => createOperationalWorkItemWithCtx(ctx, args),
});

export async function updateOperationalWorkItemStatusWithCtx(
  ctx: MutationCtx,
  args: {
    workItemId: Id<"operationalWorkItem">;
    status: string;
    approvalState?: string;
  },
) {
  const nextFields: Record<string, unknown> = {
    status: args.status,
  };

  if (args.approvalState) {
    nextFields.approvalState = args.approvalState;
  }

  if (args.status === "in_progress") {
    nextFields.startedAt = Date.now();
  }

  if (args.status === "completed") {
    nextFields.completedAt = Date.now();
  }

  await ctx.db.patch("operationalWorkItem", args.workItemId, nextFields);
  return ctx.db.get("operationalWorkItem", args.workItemId);
}

export const updateOperationalWorkItemStatus = internalMutation({
  args: {
    workItemId: v.id("operationalWorkItem"),
    status: v.string(),
    approvalState: v.optional(v.string()),
  },
  handler: (ctx, args) => updateOperationalWorkItemStatusWithCtx(ctx, args),
});

export const listOpenOperationalWorkItems = internalQuery({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const workItems = await Promise.all(
      OPEN_WORK_ITEM_STATUSES.map((status) =>
        ctx.db
          .query("operationalWorkItem")
          .withIndex("by_storeId_status", (q) =>
            q.eq("storeId", args.storeId).eq("status", status),
          )
          .take(MAX_QUEUE_ITEMS),
      ),
    );

    return workItems.flat();
  },
});

export const getQueueSnapshot = query({
  args: {
    refreshNonce: v.optional(v.number()),
    storeId: v.id("store"),
    workType: v.optional(v.string()),
  },
  handler: admitSharedDemoPublicQuery(
    getQueueSnapshotReadDefinition,
    async (
      ctx,
      args: {
        refreshNonce?: number;
        storeId: Id<"store">;
        workType?: string;
      },
    ) => {
      await authorizeOperationalWorkSummaryRead(
        ctx,
        args,
        "Only POS operators can view approval queue.",
      );

      const [
        rawWorkItemLanes,
        approvalRequestLanes,
        syncConflictsBySessionId,
        activeOversizedRepairs,
      ] = await Promise.all([
        Promise.all(
          OPEN_WORK_ITEM_STATUSES.flatMap((status) =>
            QUEUE_WORK_ITEM_TYPES.map(async (type) => {
              const items = await ctx.db
                .query("operationalWorkItem")
                .withIndex("by_storeId_type_status", (q) =>
                  q
                    .eq("storeId", args.storeId)
                    .eq("type", type)
                    .eq("status", status),
                )
                .take(QUEUE_LANE_PROBE_LIMIT + 1);

              return {
                items: items.slice(0, QUEUE_LANE_PROBE_LIMIT),
                incomplete: items.length > QUEUE_LANE_PROBE_LIMIT,
                overflow: items.length > MAX_QUEUE_ITEMS,
                status,
                type,
              };
            }),
          ),
        ),
        Promise.all(
          QUEUE_APPROVAL_REQUEST_TYPES.map(async (requestType) => {
            const requests = await ctx.db
              .query("approvalRequest")
              .withIndex("by_storeId_status_requestType", (q) =>
                q
                  .eq("storeId", args.storeId)
                  .eq("status", "pending")
                  .eq("requestType", requestType),
              )
              .take(APPROVAL_REQUEST_PROBE_LIMIT);

            return {
              items: requests.slice(0, MAX_QUEUE_ITEMS),
              overflow: requests.length > MAX_QUEUE_ITEMS,
              requestType,
            };
          }),
        ),
        listOpenLocalSyncConflictsByRegisterSession(ctx, args.storeId),
        Promise.all(
          (["pending", "running", "paused"] as const).map((status) =>
            ctx.db
              .query("oversizedOperationalWorkRepair")
              .withIndex("by_storeId_status", (q) =>
                q.eq("storeId", args.storeId).eq("status", status),
              )
              .take(ACTIVE_REPAIR_PROBE_LIMIT + 1),
          ),
        ),
      ]);
      const workItemLanes = await Promise.all(
        rawWorkItemLanes.map(async (lane) => {
          const items = await filterArchivedPendingCheckoutWorkItems(
            ctx,
            lane.items,
          );

          return {
            ...lane,
            items,
            overflow: items.length > MAX_QUEUE_ITEMS,
          };
        }),
      );

      const activeRepairReadIncomplete = activeOversizedRepairs.some(
        (page) => page.length > ACTIVE_REPAIR_PROBE_LIMIT,
      );
      const completeActiveOversizedRepairs = activeOversizedRepairs.flatMap(
        (page) => page.slice(0, ACTIVE_REPAIR_PROBE_LIMIT),
      );
      const incompleteTypes = new Set(
        workItemLanes
          .filter((lane) => lane.incomplete)
          .map((lane) => lane.type),
      );
      if (activeRepairReadIncomplete) {
        incompleteTypes.add("synced_sale_inventory_review");
      }
      const logicalWork = projectLogicalOperationalWork({
        incompleteTypes,
        items: workItemLanes.flatMap((lane) => lane.items),
        remediationSourceIdentitiesByGroupKey: new Map(
          completeActiveOversizedRepairs.map((repair) => [
            repair.groupKey,
            new Set(repair.sourceIdentities),
          ]),
        ),
        sourceCompleteness:
          incompleteTypes.size > 0 ? "incomplete" : "complete",
      });
      const selectedOpenWorkGroups = args.workType
        ? logicalWork.groups.filter(
            (group) => group.representative.type === args.workType,
          )
        : logicalWork.groups;
      const openWorkGroups = selectedOpenWorkGroups.slice(0, MAX_QUEUE_ITEMS);
      const openWorkItems = openWorkGroups.flatMap((group) => group.items);
      const approvalRequests = approvalRequestLanes
        .flatMap((lane) => lane.items)
        .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
        .slice(0, MAX_QUEUE_ITEMS);
      const hiddenWorkGroups = selectedOpenWorkGroups.slice(MAX_QUEUE_ITEMS);
      const workItemSummaryByType = QUEUE_WORK_ITEM_TYPES.map((type) => {
        const groups = logicalWork.groups.filter(
          (group) => group.representative.type === type,
        );
        return {
          completeness: incompleteTypes.has(type) ? "incomplete" : "complete",
          count: groups.length,
          overflow: groups.length > MAX_QUEUE_ITEMS,
          type,
        };
      });
      const workItemOverflow = {
        inProgress:
          workItemLanes.some(
            (lane) => lane.status === "in_progress" && lane.overflow,
          ) ||
          hiddenWorkGroups.some((group) =>
            group.items.some((item) => item.status === "in_progress"),
          ),
        open:
          workItemLanes.some(
            (lane) => lane.status === "open" && lane.overflow,
          ) ||
          hiddenWorkGroups.some((group) =>
            group.items.some((item) => item.status === "open"),
          ),
      };

      const customerIds = new Set<string>();
      const posTransactionIds = new Set<string>();
      const registerSessionIds = new Set<string>();
      const staffIds = new Set<string>();
      const terminalIds = new Set<string>();
      const workItemIds = new Set<string>();

      for (const item of openWorkItems) {
        if (item.customerProfileId) {
          customerIds.add(item.customerProfileId);
        }

        if (item.assignedToStaffProfileId) {
          staffIds.add(item.assignedToStaffProfileId);
        }

        if (item.createdByStaffProfileId) {
          staffIds.add(item.createdByStaffProfileId);
        }
      }

      for (const request of approvalRequests) {
        if (request.requestedByStaffProfileId) {
          staffIds.add(request.requestedByStaffProfileId);
        }

        if (request.reviewedByStaffProfileId) {
          staffIds.add(request.reviewedByStaffProfileId);
        }

        if (request.workItemId) {
          workItemIds.add(request.workItemId);
        }

        const transactionId = approvalRequestTransactionId(request);
        if (transactionId) {
          posTransactionIds.add(transactionId);
        }

        if (request.registerSessionId) {
          registerSessionIds.add(request.registerSessionId);
        } else if (
          request.requestType === "variance_review" &&
          request.subjectType === "register_session"
        ) {
          registerSessionIds.add(request.subjectId);
        }
      }

      for (const registerSessionId of syncConflictsBySessionId.keys()) {
        registerSessionIds.add(registerSessionId);
      }

      const [
        customers,
        staffProfiles,
        relatedWorkItems,
        posTransactions,
        registerSessions,
      ] = await Promise.all([
        Promise.all(
          Array.from(customerIds).map(async (customerId) => {
            const customer = await ctx.db.get(
              "customerProfile",
              customerId as Id<"customerProfile">,
            );
            return customer ? [customer._id, customer] : null;
          }),
        ),
        Promise.all(
          Array.from(staffIds).map(async (staffId) => {
            const staffProfile = await ctx.db.get(
              "staffProfile",
              staffId as Id<"staffProfile">,
            );
            return staffProfile ? [staffProfile._id, staffProfile] : null;
          }),
        ),
        Promise.all(
          Array.from(workItemIds).map(async (workItemId) => {
            const workItem = await ctx.db.get(
              "operationalWorkItem",
              workItemId as Id<"operationalWorkItem">,
            );
            return workItem ? [workItem._id, workItem] : null;
          }),
        ),
        Promise.all(
          Array.from(posTransactionIds).map(async (transactionId) => {
            const transaction = await ctx.db.get(
              "posTransaction",
              transactionId as Id<"posTransaction">,
            );
            return transaction ? [transaction._id, transaction] : null;
          }),
        ),
        Promise.all(
          Array.from(registerSessionIds).map(async (registerSessionId) => {
            const registerSession = await ctx.db.get(
              "registerSession",
              registerSessionId as Id<"registerSession">,
            );
            return registerSession
              ? [registerSession._id, registerSession]
              : null;
          }),
        ),
      ]);

      const customerMap = new Map<
        Id<"customerProfile">,
        Doc<"customerProfile">
      >(
        customers.filter(Boolean) as Array<
          [Id<"customerProfile">, Doc<"customerProfile">]
        >,
      );
      const staffMap = new Map<Id<"staffProfile">, Doc<"staffProfile">>(
        staffProfiles.filter(Boolean) as Array<
          [Id<"staffProfile">, Doc<"staffProfile">]
        >,
      );
      const workItemMap = new Map<
        Id<"operationalWorkItem">,
        Doc<"operationalWorkItem">
      >(
        relatedWorkItems.filter(Boolean) as Array<
          [Id<"operationalWorkItem">, Doc<"operationalWorkItem">]
        >,
      );
      const posTransactionMap = new Map<
        Id<"posTransaction">,
        Doc<"posTransaction">
      >(
        posTransactions.filter(Boolean) as Array<
          [Id<"posTransaction">, Doc<"posTransaction">]
        >,
      );
      const transactionRegisterSessionIds = new Set<Id<"registerSession">>();
      for (const request of approvalRequests) {
        const linkedTransactionId = approvalRequestTransactionId(request);
        const linkedTransaction = linkedTransactionId
          ? posTransactionMap.get(linkedTransactionId)
          : null;
        if (
          linkedTransaction?.registerSessionId &&
          !registerSessionIds.has(linkedTransaction.registerSessionId)
        ) {
          transactionRegisterSessionIds.add(
            linkedTransaction.registerSessionId,
          );
        }
      }
      const transactionRegisterSessions = await Promise.all(
        Array.from(transactionRegisterSessionIds).map(
          async (registerSessionId) => {
            const registerSession = await ctx.db.get(
              "registerSession",
              registerSessionId,
            );
            return registerSession
              ? [registerSession._id, registerSession]
              : null;
          },
        ),
      );
      const registerSessionMap = new Map<
        Id<"registerSession">,
        Doc<"registerSession">
      >(
        [...registerSessions, ...transactionRegisterSessions].filter(
          Boolean,
        ) as Array<[Id<"registerSession">, Doc<"registerSession">]>,
      );
      for (const registerSession of registerSessionMap.values()) {
        if (registerSession.terminalId) {
          terminalIds.add(registerSession.terminalId);
        }
      }

      const terminals = await Promise.all(
        Array.from(terminalIds).map(async (terminalId) => {
          const terminal = await ctx.db.get(
            "posTerminal",
            terminalId as Id<"posTerminal">,
          );
          return terminal ? [terminal._id, terminal] : null;
        }),
      );
      const terminalMap = new Map<Id<"posTerminal">, Doc<"posTerminal">>(
        terminals.filter(Boolean) as Array<
          [Id<"posTerminal">, Doc<"posTerminal">]
        >,
      );

      const mappedApprovalRequests = approvalRequests.map((request) => {
        const linkedTransactionId = approvalRequestTransactionId(request);
        const linkedTransaction = linkedTransactionId
          ? posTransactionMap.get(linkedTransactionId)
          : null;
        let linkedRegisterSession: Doc<"registerSession"> | null | undefined =
          null;
        if (request.registerSessionId) {
          linkedRegisterSession = registerSessionMap.get(
            request.registerSessionId,
          );
        } else if (linkedTransaction?.registerSessionId) {
          linkedRegisterSession = registerSessionMap.get(
            linkedTransaction.registerSessionId,
          );
        } else if (
          request.requestType === "variance_review" &&
          request.subjectType === "register_session"
        ) {
          linkedRegisterSession = registerSessionMap.get(
            request.subjectId as Id<"registerSession">,
          );
        }

        return {
          _id: request._id,
          createdAt: request.createdAt,
          metadata: sanitizeApprovalRequestMetadata(request.metadata),
          notes: request.notes,
          reason: request.reason,
          requestType: request.requestType,
          status: request.status,
          storeId: request.storeId,
          subjectId: request.subjectId,
          subjectType: request.subjectType,
          requestedByStaffName: request.requestedByStaffProfileId
            ? staffMap.get(request.requestedByStaffProfileId)?.fullName
            : null,
          transactionSummary: linkedTransaction
            ? {
                completedAt: linkedTransaction.completedAt,
                paymentMethod: linkedTransaction.paymentMethod ?? null,
                total: linkedTransaction.total,
                totalPaid: linkedTransaction.totalPaid,
                transactionId: linkedTransaction._id,
                transactionNumber: linkedTransaction.transactionNumber,
              }
            : null,
          registerSessionSummary: linkedRegisterSession
            ? {
                countedCash: linkedRegisterSession.countedCash ?? null,
                expectedCash: linkedRegisterSession.expectedCash,
                registerNumber: linkedRegisterSession.registerNumber ?? null,
                registerSessionId: linkedRegisterSession._id,
                status: linkedRegisterSession.status,
                terminalName: linkedRegisterSession.terminalId
                  ? (terminalMap
                      .get(linkedRegisterSession.terminalId)
                      ?.displayName?.trim() ?? null)
                  : null,
                variance: linkedRegisterSession.variance ?? null,
              }
            : null,
          workItemTitle: request.workItemId
            ? workItemMap.get(request.workItemId)?.title
            : null,
        };
      });
      const mappedSyncReviewRequests = Array.from(
        syncConflictsBySessionId.entries(),
      ).map(([registerSessionId, conflicts]) => {
        const linkedRegisterSession = registerSessionMap.get(registerSessionId);
        const firstConflict = conflicts[0];

        return {
          _id: `register-sync-review:${registerSessionId}`,
          createdAt: firstConflict?.createdAt,
          metadata: {
            conflictCount: conflicts.length,
            reviewItems: conflicts.map((conflict) => ({
              id: conflict._id,
              localEventId: conflict.localEventId,
              sequence: conflict.sequence,
              summary: conflict.summary,
              type: conflict.conflictType,
            })),
          },
          notes: null,
          reason:
            firstConflict?.summary ??
            "Synced register activity needs manager review.",
          registerSessionSummary: linkedRegisterSession
            ? {
                countedCash: linkedRegisterSession.countedCash ?? null,
                expectedCash: linkedRegisterSession.expectedCash,
                registerNumber: linkedRegisterSession.registerNumber ?? null,
                registerSessionId: linkedRegisterSession._id,
                status: linkedRegisterSession.status,
                terminalName: linkedRegisterSession.terminalId
                  ? (terminalMap
                      .get(linkedRegisterSession.terminalId)
                      ?.displayName?.trim() ?? null)
                  : null,
                variance: linkedRegisterSession.variance ?? null,
              }
            : null,
          requestedByStaffName: null,
          requestType: REGISTER_SYNC_REVIEW_REQUEST_TYPE,
          status: "pending",
          storeId: args.storeId,
          subjectId: registerSessionId,
          subjectType: REGISTER_SYNC_REVIEW_SUBJECT_TYPE,
          transactionSummary: null,
          workItemTitle: formatRegisterSyncReviewTitle(conflicts.length),
        };
      });

      const combinedApprovalRequests = [
        ...mappedApprovalRequests,
        ...mappedSyncReviewRequests,
      ].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));

      return {
        approvalRequests: combinedApprovalRequests.slice(0, MAX_QUEUE_ITEMS),
        overflow: {
          approvalRequests:
            approvalRequestLanes.some((lane) => lane.overflow) ||
            combinedApprovalRequests.length > MAX_QUEUE_ITEMS,
          workItems: workItemOverflow,
        },
        workItemSummary: {
          byType: workItemSummaryByType,
          completeness: logicalWork.completeness,
          count: logicalWork.observedCount,
        },
        workItems: openWorkGroups.map((group) => {
          const projectedRepresentative = projectOperationalWorkItemForQueue({
            customerMap,
            item: group.representative,
            staffMap,
          });
          const hasAuthoritativeMembership = group.completeness === "complete";
          const members = hasAuthoritativeMembership
            ? group.representatives.map((item) =>
                projectOperationalWorkItemForQueue({
                  customerMap,
                  item,
                  staffMap,
                }),
              )
            : [];

          return {
            ...projectedRepresentative,
            priority: group.priority,
            status: group.status,
            logicalGroup: {
              completeness: group.completeness,
              key: group.key,
              memberIds: hasAuthoritativeMembership
                ? group.items.map((item) => item._id)
                : [],
              members,
              oldestActionableAt: group.oldestActionableAt,
              resolutionAvailability: group.resolutionAvailability,
            },
          };
        }),
      };
    },
  ),
});
