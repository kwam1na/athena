/* eslint-disable @convex-dev/no-collect-in-query -- V26-276 service case summaries intentionally read complete case- and work-item-scoped ledgers so balances, approvals, and inventory history stay correct until paginated views land. */

import { mutation, query, MutationCtx, QueryCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { resolveRegisterSessionForInStoreCollectionWithCtx } from "../cashControls/paymentAllocationAttribution";
import { summarizeInventoryMovements } from "../operations/inventoryMovements";
import {
  createOperationalWorkItemWithCtx,
  updateOperationalWorkItemStatusWithCtx,
} from "../operations/operationalWorkItems";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import {
  recordPaymentAllocationWithCtx,
  summarizePaymentAllocations,
} from "../operations/paymentAllocations";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { recordServiceCaseTraceBestEffort } from "./serviceCaseTracing";
import { getWorkflowTraceByLookupWithCtx } from "../workflowTraces/core";
import {
  SERVICE_CASE_LOOKUP_TYPE,
  SERVICE_CASE_WORKFLOW_TYPE,
} from "../workflowTraces/adapters/serviceCase";
import { applyInventoryEffectWithCtx } from "../reporting/inventory/effects";
import type { OutboundValuationBasisSnapshot } from "../reporting/inventory/types";
import { resolveReportingOperatingPeriodWithCtx } from "../reporting/operatingPeriods";
import {
  appendReportingIngressWithCtx,
  type ReportingIngressLineInput,
} from "../reporting/ingress";
import { canonicalReportingBusinessEventKey } from "../reporting/factIdentity";
import { requireReadySharedDemoStoreCapabilityIfApplicable } from "../sharedDemo/actor";

export const SERVICE_CASE_STATUSES = [
  "intake",
  "scheduled",
  "in_progress",
  "awaiting_approval",
  "awaiting_pickup",
  "completed",
  "cancelled",
] as const;

export type ServiceCaseStatus = (typeof SERVICE_CASE_STATUSES)[number];

export const SERVICE_CASE_PAYMENT_STATUSES = [
  "unpaid",
  "deposit_paid",
  "partially_paid",
  "paid",
  "refunded",
] as const;

export type ServiceCasePaymentStatus =
  (typeof SERVICE_CASE_PAYMENT_STATUSES)[number];

export const SERVICE_CASE_LINE_TYPES = [
  "labor",
  "material",
  "adjustment",
] as const;

export type ServiceCaseLineType = (typeof SERVICE_CASE_LINE_TYPES)[number];

const TERMINAL_SERVICE_CASE_STATUSES = new Set<ServiceCaseStatus>([
  "completed",
  "cancelled",
]);

const SERVICE_CASE_STATUS_TRANSITIONS: Record<
  ServiceCaseStatus,
  ServiceCaseStatus[]
> = {
  intake: ["scheduled", "in_progress", "cancelled"],
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["awaiting_approval", "awaiting_pickup", "completed", "cancelled"],
  awaiting_approval: ["in_progress", "cancelled"],
  awaiting_pickup: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function mapServiceCaseStatusToWorkItemStatus(
  status: ServiceCaseStatus,
) {
  switch (status) {
    case "intake":
    case "scheduled":
      return "open";
    case "in_progress":
    case "awaiting_approval":
    case "awaiting_pickup":
      return "in_progress";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
  }
}

function deriveServiceCasePaymentStatus(args: {
  totalAmount: number;
  totalIn: number;
  totalOut: number;
}) {
  if (args.totalOut > 0 && args.totalOut >= args.totalIn) {
    return "refunded" as ServiceCasePaymentStatus;
  }

  if (args.totalIn <= 0) {
    return "unpaid" as ServiceCasePaymentStatus;
  }

  if (args.totalAmount <= 0) {
    return "deposit_paid" as ServiceCasePaymentStatus;
  }

  if (args.totalIn >= args.totalAmount) {
    return "paid" as ServiceCasePaymentStatus;
  }

  return "partially_paid" as ServiceCasePaymentStatus;
}

async function listServiceCaseLineItemsWithCtx(
  ctx: { db: QueryCtx["db"] },
  serviceCaseId: Id<"serviceCase">
) {
  return ctx.db
    .query("serviceCaseLineItem")
    .withIndex("by_serviceCaseId", (q) => q.eq("serviceCaseId", serviceCaseId))
    .collect();
}

async function listServiceInventoryUsageWithCtx(
  ctx: { db: QueryCtx["db"] },
  serviceCaseId: Id<"serviceCase">
) {
  return ctx.db
    .query("serviceInventoryUsage")
    .withIndex("by_serviceCaseId", (q) => q.eq("serviceCaseId", serviceCaseId))
    .collect();
}

function uncostedServiceReturnBasis(
  quantity: number,
): OutboundValuationBasisSnapshot {
  return {
    allocatedKnownCost: 0,
    basisVersion: 0,
    costedQuantity: 0,
    currency: null,
    knownCostPoolBefore: 0,
    roundedWeightedAverageUnitCost: null,
    uncostedQuantity: quantity,
    unresolvedDeficitQuantity: 0,
  };
}

function roundServiceReturnCost(
  total: number,
  part: number,
  whole: number,
): number {
  if (part === 0 || total === 0) return 0;
  if (part === whole) return total;
  const numerator = BigInt(total) * BigInt(part);
  const denominator = BigInt(whole);
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

async function resolveServiceReturnBasisWithCtx(
  ctx: MutationCtx,
  args: {
    productSkuId: Id<"productSku">;
    quantity: number;
    serviceCaseId: Id<"serviceCase">;
  },
): Promise<OutboundValuationBasisSnapshot> {
  const priorUsage = (await listServiceInventoryUsageWithCtx(
    ctx,
    args.serviceCaseId,
  )).filter((usage) => usage.productSkuId === args.productSkuId);
  const consumed = priorUsage.filter((usage) => usage.usageType === "consumed");
  const alreadyReturned = priorUsage
    .filter((usage) => usage.usageType === "returned")
    .reduce((sum, usage) => sum + usage.quantity, 0);

  // Without a source-consumption selector, more than one consumption is
  // ambiguous. Keep the return explicitly uncosted instead of guessing.
  if (
    consumed.length !== 1 ||
    alreadyReturned + args.quantity > consumed[0].quantity ||
    !consumed[0].inventoryMovementId
  ) {
    return uncostedServiceReturnBasis(args.quantity);
  }

  const movement = await ctx.db.get(
    "inventoryMovement",
    consumed[0].inventoryMovementId,
  );
  if (!movement?.reportingInventoryEffectId) {
    return uncostedServiceReturnBasis(args.quantity);
  }
  const effect = await ctx.db.get(
    "reportingInventoryEffect",
    movement.reportingInventoryEffectId,
  );
  if (!effect || effect.businessEventKey !== movement.businessEventKey) {
    return uncostedServiceReturnBasis(args.quantity);
  }

  const originalCostedQuantity = Math.max(0, -effect.costedQuantityDelta);
  const originalUncostedQuantity =
    Math.max(0, -effect.uncostedQuantityDelta) +
    Math.max(0, effect.unresolvedDeficitDelta);
  if (
    originalCostedQuantity + originalUncostedQuantity !== consumed[0].quantity
  ) {
    return uncostedServiceReturnBasis(args.quantity);
  }

  const remainingUncostedQuantity = Math.max(
    0,
    originalUncostedQuantity - alreadyReturned,
  );
  const returnedFromCosted = Math.max(
    0,
    alreadyReturned - originalUncostedQuantity,
  );
  const remainingCostedQuantity = Math.max(
    0,
    originalCostedQuantity - returnedFromCosted,
  );
  const originalKnownCost = effect.outboundBasisMinor ?? 0;
  if (originalCostedQuantity > 0 && !effect.currencyCode) {
    return uncostedServiceReturnBasis(args.quantity);
  }
  const remainingKnownCost = roundServiceReturnCost(
    originalKnownCost,
    remainingCostedQuantity,
    originalCostedQuantity || 1,
  );

  return {
    allocatedKnownCost: remainingKnownCost,
    basisVersion: 0,
    costedQuantity: remainingCostedQuantity,
    currency: remainingCostedQuantity > 0 ? effect.currencyCode ?? null : null,
    knownCostPoolBefore: remainingKnownCost,
    roundedWeightedAverageUnitCost:
      remainingCostedQuantity > 0
        ? roundServiceReturnCost(
            remainingKnownCost,
            1,
            remainingCostedQuantity,
          )
        : null,
    uncostedQuantity: remainingUncostedQuantity,
    unresolvedDeficitQuantity: 0,
  };
}

async function listServiceCaseAllocationsWithCtx(
  ctx: { db: QueryCtx["db"] },
  storeId: Id<"store">,
  serviceCaseId: Id<"serviceCase">
) {
  return ctx.db
    .query("paymentAllocation")
    .withIndex("by_storeId_target", (q) =>
      q.eq("storeId", storeId).eq("targetType", "service_case").eq("targetId", serviceCaseId)
    )
    .collect();
}

async function listPendingApprovalRequestsWithCtx(
  ctx: { db: QueryCtx["db"] },
  workItemId: Id<"operationalWorkItem">
) {
  const approvalRequests = await ctx.db
    .query("approvalRequest")
    .withIndex("by_workItemId", (q) => q.eq("workItemId", workItemId))
    .collect();

  return approvalRequests.filter((approvalRequest) => approvalRequest.status === "pending");
}

async function syncServiceCaseFinancialsWithCtx(
  ctx: MutationCtx,
  serviceCase: {
    _id: Id<"serviceCase">;
    quotedAmount?: number;
    storeId: Id<"store">;
  }
) {
  const [lineItems, paymentAllocations] = await Promise.all([
    listServiceCaseLineItemsWithCtx(ctx, serviceCase._id),
    listServiceCaseAllocationsWithCtx(ctx, serviceCase.storeId, serviceCase._id),
  ]);

  const totalAmount =
    lineItems.length > 0
      ? lineItems.reduce((sum, lineItem) => sum + lineItem.amount, 0)
      : serviceCase.quotedAmount ?? 0;
  const paymentSummary = summarizePaymentAllocations(paymentAllocations);
  const balanceDueAmount = Math.max(totalAmount - paymentSummary.netAmount, 0);
  const paymentStatus = deriveServiceCasePaymentStatus({
    totalAmount,
    totalIn: paymentSummary.totalIn,
    totalOut: paymentSummary.totalOut,
  });

  await ctx.db.patch("serviceCase", serviceCase._id, {
    balanceDueAmount,
    paymentStatus,
    totalAmount,
    updatedAt: Date.now(),
  });

  return ctx.db.get("serviceCase", serviceCase._id);
}

async function getServiceCaseContext(
  ctx: MutationCtx,
  serviceCaseId: Id<"serviceCase">
) {
  const serviceCase = await ctx.db.get("serviceCase", serviceCaseId);

  if (!serviceCase) {
    return userError({
      code: "not_found",
      message: "Service case not found.",
    });
  }

  const [workItem, store] = await Promise.all([
    ctx.db.get("operationalWorkItem", serviceCase.operationalWorkItemId),
    ctx.db.get("store", serviceCase.storeId),
  ]);

  if (!workItem) {
    return userError({
      code: "not_found",
      message: "Operational work item not found for service case.",
    });
  }

  if (!store) {
    return userError({
      code: "not_found",
      message: "Store not found.",
    });
  }

  return ok({ serviceCase, store, workItem });
}

export function assertValidServiceCaseStatusTransition(
  currentStatus: ServiceCaseStatus,
  nextStatus: ServiceCaseStatus
): CommandResult<null> {
  if (!SERVICE_CASE_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
    return userError({
      code: "validation_failed",
      message: "Invalid service case status transition.",
    });
  }

  return ok(null);
}

export function buildServiceCase(args: {
  appointmentId?: Id<"serviceAppointment">;
  assignedStaffProfileId?: Id<"staffProfile">;
  createdByUserId?: Id<"athenaUser">;
  customerProfileId: Id<"customerProfile">;
  notes?: string;
  operationalWorkItemId: Id<"operationalWorkItem">;
  organizationId?: Id<"organization">;
  quotedAmount?: number;
  serviceCatalogId?: Id<"serviceCatalog">;
  serviceMode: "same_day" | "consultation" | "repair" | "revamp";
  storeId: Id<"store">;
}) {
  const totalAmount = args.quotedAmount ?? 0;
  const now = Date.now();
  const { createdByUserId: _createdByUserId, ...serviceCaseFields } = args;

  return {
    ...serviceCaseFields,
    balanceDueAmount: totalAmount,
    createdAt: now,
    lastStatusChangedAt: now,
    paymentStatus: "unpaid" as ServiceCasePaymentStatus,
    status: "intake" as ServiceCaseStatus,
    totalAmount,
    updatedAt: now,
  };
}

export function buildServiceCaseLineItem(args: {
  description: string;
  lineType: ServiceCaseLineType;
  quantity: number;
  serviceCaseId: Id<"serviceCase">;
  unitPrice: number;
}): CommandResult<{
  amount: number;
  createdAt: number;
  description: string;
  lineType: ServiceCaseLineType;
  quantity: number;
  serviceCaseId: Id<"serviceCase">;
  unitPrice: number;
}> {
  if (args.quantity <= 0) {
    return userError({
      code: "validation_failed",
      message: "Line item quantity must be greater than zero.",
    });
  }

  if (args.unitPrice < 0) {
    return userError({
      code: "validation_failed",
      message: "Line item unit price cannot be negative.",
    });
  }

  return ok({
    ...args,
    amount: args.quantity * args.unitPrice,
    createdAt: Date.now(),
  });
}

export async function createServiceCaseWithCtx(
  ctx: MutationCtx,
  args: Parameters<typeof buildServiceCase>[0]
) {
  await requireReadySharedDemoStoreCapabilityIfApplicable(
    ctx,
    "service.cases.manage",
    args.storeId,
  );
  const existingServiceCase = await ctx.db
    .query("serviceCase")
    .withIndex("by_operationalWorkItemId", (q) =>
      q.eq("operationalWorkItemId", args.operationalWorkItemId)
    )
    .first();

  if (existingServiceCase) {
    return ok(existingServiceCase);
  }

  const serviceCaseId = await ctx.db.insert("serviceCase", buildServiceCase(args));
  const serviceCase = await ctx.db.get("serviceCase", serviceCaseId);

  if (!serviceCase) {
    throw new Error("Unable to create the service case.");
  }

  const workItem = await ctx.db.get("operationalWorkItem", args.operationalWorkItemId);
  if (workItem) {
    await ctx.db.patch("operationalWorkItem", args.operationalWorkItemId, {
      metadata: {
        ...(workItem.metadata ?? {}),
        appointmentId: args.appointmentId ?? null,
        serviceCaseId,
        serviceCatalogId: args.serviceCatalogId ?? null,
        serviceMode: args.serviceMode,
      },
    });
  }

  await recordOperationalEventWithCtx(ctx, {
    actorUserId: args.createdByUserId,
    customerProfileId: args.customerProfileId,
    eventType: "service_case_created",
    organizationId: args.organizationId,
    storeId: args.storeId,
    subjectId: serviceCaseId,
    subjectType: "service_case",
    workItemId: args.operationalWorkItemId,
  });

  await recordServiceCaseTraceBestEffort(ctx, {
    actorUserId: args.createdByUserId,
    serviceCase,
    stage: "created",
  });

  return ok(serviceCase);
}

export const createServiceCase = mutation({
  args: {
    appointmentId: v.optional(v.id("serviceAppointment")),
    assignedStaffProfileId: v.optional(v.id("staffProfile")),
    createdByUserId: v.optional(v.id("athenaUser")),
    customerProfileId: v.id("customerProfile"),
    notes: v.optional(v.string()),
    operationalWorkItemId: v.id("operationalWorkItem"),
    quotedAmount: v.optional(v.number()),
    serviceCatalogId: v.optional(v.id("serviceCatalog")),
    serviceMode: v.union(
      v.literal("same_day"),
      v.literal("consultation"),
      v.literal("repair"),
      v.literal("revamp")
    ),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      return userError({
        code: "not_found",
        message: "Store not found.",
      });
    }

    const workItem = await ctx.db.get("operationalWorkItem", args.operationalWorkItemId);
    if (!workItem || workItem.storeId !== args.storeId) {
      return userError({
        code: "not_found",
        message: "Operational work item not found for this store.",
      });
    }

    return createServiceCaseWithCtx(ctx, {
      ...args,
      organizationId: store.organizationId,
    });
  },
});

export const listActiveServiceCases = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const serviceCases = await ctx.db
      .query("serviceCase")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    const activeServiceCases = serviceCases.filter(
      (serviceCase) => !TERMINAL_SERVICE_CASE_STATUSES.has(serviceCase.status)
    );

    return Promise.all(
      activeServiceCases.map(async (serviceCase) => {
        const [
          customerProfile,
          staffProfile,
          serviceCatalogItem,
          workItem,
          pendingApprovals,
          trace,
        ] =
          await Promise.all([
            ctx.db.get("customerProfile", serviceCase.customerProfileId),
            serviceCase.assignedStaffProfileId
              ? ctx.db.get("staffProfile", serviceCase.assignedStaffProfileId)
              : null,
            serviceCase.serviceCatalogId
              ? ctx.db.get("serviceCatalog", serviceCase.serviceCatalogId)
              : null,
            ctx.db.get("operationalWorkItem", serviceCase.operationalWorkItemId),
            listPendingApprovalRequestsWithCtx(ctx, serviceCase.operationalWorkItemId),
            getWorkflowTraceByLookupWithCtx(ctx, {
              storeId: serviceCase.storeId,
              workflowType: SERVICE_CASE_WORKFLOW_TYPE,
              lookupType: SERVICE_CASE_LOOKUP_TYPE,
              lookupValue: serviceCase._id,
            }),
          ]);

        return {
          ...serviceCase,
          customerName: customerProfile?.fullName ?? null,
          pendingApprovalCount: pendingApprovals.length,
          serviceCatalogName: serviceCatalogItem?.name ?? null,
          staffName: staffProfile?.fullName ?? null,
          workItemTitle: workItem?.title ?? null,
          workflowTraceId: trace?.traceId,
        };
      })
    );
  },
});

export const getServiceCaseDetails = query({
  args: {
    serviceCaseId: v.id("serviceCase"),
  },
  handler: async (ctx, args) => {
    const serviceCase = await ctx.db.get("serviceCase", args.serviceCaseId);

    if (!serviceCase) {
      return null;
    }

    const [
      lineItems,
      inventoryUsage,
      paymentAllocations,
      pendingApprovals,
      workItem,
      trace,
    ] =
      await Promise.all([
        ctx.db
          .query("serviceCaseLineItem")
          .withIndex("by_serviceCaseId", (q) => q.eq("serviceCaseId", args.serviceCaseId))
          .collect(),
        ctx.db
          .query("serviceInventoryUsage")
          .withIndex("by_serviceCaseId", (q) => q.eq("serviceCaseId", args.serviceCaseId))
          .collect(),
        ctx.db
          .query("paymentAllocation")
          .withIndex("by_storeId_target", (q) =>
            q
              .eq("storeId", serviceCase.storeId)
              .eq("targetType", "service_case")
              .eq("targetId", args.serviceCaseId)
          )
          .collect(),
        listPendingApprovalRequestsWithCtx(ctx, serviceCase.operationalWorkItemId),
        ctx.db.get("operationalWorkItem", serviceCase.operationalWorkItemId),
        getWorkflowTraceByLookupWithCtx(ctx, {
          storeId: serviceCase.storeId,
          workflowType: SERVICE_CASE_WORKFLOW_TYPE,
          lookupType: SERVICE_CASE_LOOKUP_TYPE,
          lookupValue: serviceCase._id,
        }),
      ]);

    return {
      ...serviceCase,
      inventorySummary: summarizeInventoryMovements(
        inventoryUsage
          .filter((usage) => typeof usage.inventoryMovementId === "string")
          .map((usage) => ({
            quantityDelta: usage.usageType === "returned" ? usage.quantity : -usage.quantity,
          }))
      ),
      lineItems,
      paymentAllocations,
      pendingApprovals,
      paymentSummary: summarizePaymentAllocations(paymentAllocations),
      workItem,
      workflowTraceId: trace?.traceId,
    };
  },
});

export const addServiceCaseLineItem = mutation({
  args: {
    description: v.string(),
    lineType: v.union(
      v.literal("labor"),
      v.literal("material"),
      v.literal("adjustment")
    ),
    quantity: v.number(),
    serviceCaseId: v.id("serviceCase"),
    unitPrice: v.number(),
  },
  handler: async (ctx, args) => {
    const serviceCaseContext = await getServiceCaseContext(ctx, args.serviceCaseId);
    if (serviceCaseContext.kind === "user_error") {
      return serviceCaseContext;
    }

    const { serviceCase, workItem } = serviceCaseContext.data;
    await requireReadySharedDemoStoreCapabilityIfApplicable(
      ctx,
      "service.cases.manage",
      serviceCase.storeId,
    );
    const lineItemResult = buildServiceCaseLineItem(args);
    if (lineItemResult.kind === "user_error") {
      return lineItemResult;
    }

    const lineItemId = await ctx.db.insert(
      "serviceCaseLineItem",
      lineItemResult.data
    );

    const nextServiceCase = await syncServiceCaseFinancialsWithCtx(ctx, serviceCase);

    await recordOperationalEventWithCtx(ctx, {
      customerProfileId: serviceCase.customerProfileId,
      eventType: "service_case_line_item_added",
      organizationId: serviceCase.organizationId,
      storeId: serviceCase.storeId,
      subjectId: serviceCase._id,
      subjectType: "service_case",
      workItemId: workItem._id,
    });

    await recordServiceCaseTraceBestEffort(ctx, {
      amount: lineItemResult.data.amount,
      lineItemId,
      lineType: args.lineType,
      quantity: args.quantity,
      serviceCase: nextServiceCase ?? serviceCase,
      stage: "line_item_added",
    });

    return ok({
      lineItem: await ctx.db.get("serviceCaseLineItem", lineItemId),
      serviceCase: nextServiceCase,
    });
  },
});

export const recordServiceInventoryUsage = mutation({
  args: {
    notes: v.optional(v.string()),
    productSkuId: v.id("productSku"),
    quantity: v.number(),
    recordedByStaffProfileId: v.optional(v.id("staffProfile")),
    recordedByUserId: v.optional(v.id("athenaUser")),
    serviceCaseId: v.id("serviceCase"),
    usageType: v.optional(
      v.union(v.literal("planned"), v.literal("consumed"), v.literal("returned"))
    ),
  },
  handler: async (ctx, args) => {
    if (args.quantity <= 0) {
      return userError({
        code: "validation_failed",
        message: "Inventory usage quantity must be greater than zero.",
      });
    }

    const serviceCaseContext = await getServiceCaseContext(ctx, args.serviceCaseId);
    if (serviceCaseContext.kind === "user_error") {
      return serviceCaseContext;
    }

    const { serviceCase, store, workItem } = serviceCaseContext.data;
    await requireReadySharedDemoStoreCapabilityIfApplicable(
      ctx,
      "service.cases.manage",
      serviceCase.storeId,
    );
    const usageType = args.usageType ?? "consumed";
    const now = Date.now();
    const productSku = await ctx.db.get("productSku", args.productSkuId);
    if (!productSku || productSku.storeId !== serviceCase.storeId) {
      return userError({
        code: "not_found",
        message: "Selected inventory item could not be found for this store.",
      });
    }
    const returnBasis =
      usageType === "returned"
        ? await resolveServiceReturnBasisWithCtx(ctx, {
            productSkuId: args.productSkuId,
            quantity: args.quantity,
            serviceCaseId: args.serviceCaseId,
          })
        : null;
    const usageId = await ctx.db.insert("serviceInventoryUsage", {
      createdAt: now,
      notes: args.notes,
      productSkuId: args.productSkuId,
      quantity: args.quantity,
      recordedByStaffProfileId: args.recordedByStaffProfileId,
      recordedByUserId: args.recordedByUserId,
      serviceCaseId: args.serviceCaseId,
      usageType,
    });

    let inventoryMovement = null;
    if (usageType !== "planned") {
      const reportingPeriod = await resolveReportingOperatingPeriodWithCtx(ctx, {
        occurrenceAt: now,
        storeId: serviceCase.storeId,
      });
      const quantityDelta =
        usageType === "returned" ? args.quantity : -args.quantity;
      const nextOnHand = Math.max(
        0,
        productSku.inventoryCount + quantityDelta,
      );
      const nextSellable =
        usageType === "returned"
          ? Math.min(
              nextOnHand,
              productSku.quantityAvailable + args.quantity,
            )
          : Math.min(nextOnHand, productSku.quantityAvailable);
      const businessEventKey = `service_inventory_usage:${usageId}:${usageType}`;
      const inventoryEffect = await applyInventoryEffectWithCtx(ctx, {
        activityStatus: "committed",
        activityType:
          usageType === "returned"
            ? "stock_service_material_returned"
            : "stock_service_material_consumed",
        actorStaffProfileId: args.recordedByStaffProfileId,
        actorUserId: args.recordedByUserId,
        businessEventKey,
        compatibilityBalance: {
          onHandQuantity: nextOnHand,
          sellableQuantity: nextSellable,
        },
        completeness:
          reportingPeriod.kind === "resolved" ? "complete" : "partial",
        contentFingerprint: [
          "service-material:v1",
          String(args.serviceCaseId),
          String(usageId),
          String(args.productSkuId),
          usageType,
          String(args.quantity),
        ].join(":"),
        effectType: usageType === "returned" ? "return" : "adjustment",
        movementType:
          usageType === "returned"
            ? "service_material_returned"
            : "service_material_consumed",
        notes: args.notes,
        occurrenceAt: now,
        ...(reportingPeriod.kind === "resolved"
          ? {
              operatingDate: reportingPeriod.operatingDate,
              scheduleVersionId:
                reportingPeriod.scheduleVersionId as Id<"storeSchedule">,
            }
          : {}),
        organizationId: serviceCase.organizationId ?? store.organizationId,
        physicalQuantityDelta: quantityDelta,
        productId: productSku.productId,
        productSkuId: args.productSkuId,
        reasonCode:
          usageType === "returned"
            ? "service_case_material_return"
            : "service_case_material_consumption",
        recordedAt: now,
        sellableQuantityDelta:
          nextSellable - productSku.quantityAvailable,
        sourceDomain: "service",
        sourceId: String(usageId),
        sourceLineId: String(args.productSkuId),
        sourceType: "service_inventory_usage",
        storeId: serviceCase.storeId,
        valuation:
              usageType === "returned"
            ? {
                disposition: "sellable",
                financialContribution: "reverse_original_lane",
                kind: "return",
                originalBasis: returnBasis!,
                originalCostLane: "inventory_consumed",
                quantity: args.quantity,
              }
            : {
                disposition: "service_consumption",
                kind: "outbound",
                quantity: args.quantity,
              },
        workItemId: workItem._id,
      });
      inventoryMovement = inventoryEffect.movement;
    }

    if (inventoryMovement) {
      await ctx.db.patch("serviceInventoryUsage", usageId, {
        inventoryMovementId: inventoryMovement._id,
      });
    }

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: args.recordedByStaffProfileId,
      actorUserId: args.recordedByUserId,
      customerProfileId: serviceCase.customerProfileId,
      eventType: "service_case_inventory_usage_recorded",
      inventoryMovementId: inventoryMovement?._id,
      organizationId: serviceCase.organizationId,
      storeId: serviceCase.storeId,
      subjectId: serviceCase._id,
      subjectType: "service_case",
      workItemId: workItem._id,
    });

    await recordServiceCaseTraceBestEffort(ctx, {
      actorStaffProfileId: args.recordedByStaffProfileId,
      actorUserId: args.recordedByUserId,
      inventoryMovementId: inventoryMovement?._id,
      productSkuId: args.productSkuId,
      quantity: args.quantity,
      serviceCase,
      serviceInventoryUsageId: usageId,
      stage: "inventory_usage_recorded",
    });

    return ok(await ctx.db.get("serviceInventoryUsage", usageId));
  },
});

export const recordServicePayment = mutation({
  args: {
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    actorUserId: v.optional(v.id("athenaUser")),
    amount: v.number(),
    businessEventKey: v.optional(v.string()),
    collectedInStore: v.optional(v.boolean()),
    direction: v.optional(v.union(v.literal("in"), v.literal("out"))),
    method: v.string(),
    notes: v.optional(v.string()),
    registerSessionId: v.optional(v.id("registerSession")),
    serviceCaseId: v.id("serviceCase"),
  },
  handler: async (ctx, args) => {
    const serviceCaseContext = await getServiceCaseContext(ctx, args.serviceCaseId);
    if (serviceCaseContext.kind === "user_error") {
      return serviceCaseContext;
    }

    const { serviceCase, workItem } = serviceCaseContext.data;
    await requireReadySharedDemoStoreCapabilityIfApplicable(
      ctx,
      "billing.manage",
      serviceCase.storeId,
    );
    const collectedInStore = args.collectedInStore ?? true;
    const resolvedRegisterSessionId = collectedInStore
      ? await resolveRegisterSessionForInStoreCollectionWithCtx(ctx, {
          actorStaffProfileId: args.actorStaffProfileId,
          actorUserId: args.actorUserId,
          registerSessionId: args.registerSessionId,
          storeId: serviceCase.storeId,
        })
      : undefined;

    const paymentAllocation = await recordPaymentAllocationWithCtx(ctx, {
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
      allocationType: args.direction === "out" ? "service_refund" : "service_payment",
      amount: args.amount,
      businessEventKey:
        args.businessEventKey ??
        `service:${serviceCase._id}:payment:${crypto.randomUUID()}`,
      collectedInStore,
      customerProfileId: serviceCase.customerProfileId,
      direction: args.direction,
      method: args.method,
      notes: args.notes,
      organizationId: serviceCase.organizationId,
      registerSessionId: resolvedRegisterSessionId,
      storeId: serviceCase.storeId,
      targetId: serviceCase._id,
      targetType: "service_case",
      workItemId: workItem._id,
    });

    const nextServiceCase = await syncServiceCaseFinancialsWithCtx(ctx, serviceCase);

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
      customerProfileId: serviceCase.customerProfileId,
      eventType: args.direction === "out" ? "service_case_refunded" : "service_case_paid",
      organizationId: serviceCase.organizationId,
      paymentAllocationId: paymentAllocation?._id,
      registerSessionId: resolvedRegisterSessionId,
      storeId: serviceCase.storeId,
      subjectId: serviceCase._id,
      subjectType: "service_case",
      workItemId: workItem._id,
    });

    await recordServiceCaseTraceBestEffort(ctx, {
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
      amount: args.amount,
      direction: args.direction ?? "in",
      method: args.method,
      paymentAllocationId: paymentAllocation?._id,
      registerSessionId: resolvedRegisterSessionId,
      serviceCase: nextServiceCase ?? serviceCase,
      stage: args.direction === "out" ? "refund_recorded" : "payment_recorded",
    });

    return ok(nextServiceCase);
  },
});

export const updateServiceCaseStatus = mutation({
  args: {
    notes: v.optional(v.string()),
    serviceCaseId: v.id("serviceCase"),
    status: v.union(
      v.literal("intake"),
      v.literal("scheduled"),
      v.literal("in_progress"),
      v.literal("awaiting_approval"),
      v.literal("awaiting_pickup"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
  },
  handler: async (ctx, args) => {
    const serviceCaseContext = await getServiceCaseContext(ctx, args.serviceCaseId);
    if (serviceCaseContext.kind === "user_error") {
      return serviceCaseContext;
    }

    const { serviceCase, store, workItem } = serviceCaseContext.data;
    await requireReadySharedDemoStoreCapabilityIfApplicable(
      ctx,
      "service.cases.manage",
      serviceCase.storeId,
    );

    const statusTransitionResult = assertValidServiceCaseStatusTransition(
      serviceCase.status,
      args.status
    );
    if (statusTransitionResult.kind === "user_error") {
      return statusTransitionResult;
    }

    const [lineItems, pendingApprovals, paymentAllocations] = await Promise.all([
      listServiceCaseLineItemsWithCtx(ctx, serviceCase._id),
      listPendingApprovalRequestsWithCtx(ctx, workItem._id),
      listServiceCaseAllocationsWithCtx(ctx, serviceCase.storeId, serviceCase._id),
    ]);

    const totalAmount =
      lineItems.length > 0
        ? lineItems.reduce((sum, lineItem) => sum + lineItem.amount, 0)
        : serviceCase.quotedAmount ?? 0;
    const paymentSummary = summarizePaymentAllocations(paymentAllocations);
    const balanceDueAmount = Math.max(totalAmount - paymentSummary.netAmount, 0);

    if (balanceDueAmount > 0 && args.status === "completed") {
      return userError({
        code: "precondition_failed",
        message: "Cannot complete a service case with an outstanding balance.",
      });
    }

    if (args.status === "completed" && pendingApprovals.length > 0) {
      return userError({
        code: "precondition_failed",
        message: "Resolve pending approvals before completing the service case.",
      });
    }

    if (args.status === "cancelled" && paymentSummary.netAmount > 0) {
      return userError({
        code: "precondition_failed",
        message: "Refund service payments before cancelling the case.",
      });
    }

    await syncServiceCaseFinancialsWithCtx(ctx, serviceCase);

    const now = Date.now();
    await ctx.db.patch("serviceCase", serviceCase._id, {
      cancelledAt: args.status === "cancelled" ? now : undefined,
      completedAt: args.status === "completed" ? now : undefined,
      lastStatusChangedAt: now,
      notes: args.notes ?? serviceCase.notes,
      status: args.status,
      updatedAt: now,
    });

    await updateOperationalWorkItemStatusWithCtx(ctx, {
      approvalState:
        args.status === "awaiting_approval"
          ? "pending"
          : pendingApprovals.length > 0
            ? "pending"
            : "not_required",
      status: mapServiceCaseStatusToWorkItemStatus(args.status),
      workItemId: workItem._id,
    });

    await recordOperationalEventWithCtx(ctx, {
      customerProfileId: serviceCase.customerProfileId,
      eventType: "service_case_status_updated",
      organizationId: serviceCase.organizationId,
      reason: args.status,
      storeId: serviceCase.storeId,
      subjectId: serviceCase._id,
      subjectType: "service_case",
      workItemId: workItem._id,
    });

    if (args.status === "completed") {
      const posServiceLine = await ctx.db
        .query("posTransactionServiceLine")
        .withIndex("by_serviceCaseId", (q) =>
          q.eq("serviceCaseId", serviceCase._id),
        )
        .first();
      if (!posServiceLine) {
        const lines: ReportingIngressLineInput[] =
          lineItems.length > 0
            ? lineItems.map((lineItem) => ({
                costStatus: "not_applicable",
                discountAmountMinor: 0,
                grossAmountMinor: lineItem.amount,
                lineKey: String(lineItem._id),
                lineKind: "service",
                netAmountMinor: lineItem.amount,
                quantity: lineItem.quantity,
                serviceCaseId: serviceCase._id,
              }))
            : [
                {
                  costStatus: "not_applicable",
                  discountAmountMinor: 0,
                  grossAmountMinor: totalAmount,
                  lineKey: "service",
                  lineKind: "service",
                  netAmountMinor: totalAmount,
                  quantity: 1,
                  serviceCaseId: serviceCase._id,
                },
              ];
        const currencyCode = store.currency?.trim().toUpperCase();
        await appendReportingIngressWithCtx(ctx, {
          acceptedAt: now,
          adapterVersion: 1,
          businessEventKey: canonicalReportingBusinessEventKey({
            kind: "service_completion",
            serviceCaseId: String(serviceCase._id),
          }),
          contentFingerprint: [
            "service-complete-v1",
            String(serviceCase._id),
            String(totalAmount),
            ...lines.flatMap((line) => [
              line.lineKey,
              String(line.quantity),
              String(line.netAmountMinor),
            ]),
          ].join(":"),
          ...(currencyCode
            ? { currencyCode, currencyMinorUnitScale: 2 }
            : {}),
          grossAmountMinor: totalAmount,
          lines,
          materialFields: [
            "amountMinor",
            "occurrenceAt",
            "quantity",
            "storeId",
          ],
          netAmountMinor: totalAmount,
          occurredAt: now,
          organizationId: serviceCase.organizationId ?? store.organizationId,
          quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
          sourceDomain: "service",
          sourceEventType: "service_completed",
          sourceReferences: [
            {
              relation: "owns",
              sourceId: String(serviceCase._id),
              sourceType: "service_case",
            },
          ],
          storeId: serviceCase.storeId,
        });
      }
    }

    const updatedServiceCase = await ctx.db.get("serviceCase", serviceCase._id);

    if (updatedServiceCase) {
      await recordServiceCaseTraceBestEffort(ctx, {
        nextStatus: args.status,
        previousStatus: serviceCase.status,
        serviceCase: updatedServiceCase,
        stage:
          args.status === "awaiting_approval"
            ? "approval_pending"
            : args.status === "awaiting_pickup"
              ? "awaiting_pickup"
              : args.status === "completed"
                ? "completed"
                : args.status === "cancelled"
                  ? "cancelled"
                  : "status_updated",
      });
    }

    return ok(updatedServiceCase);
  },
});

export const createWalkInServiceCase = mutation({
  args: {
    assignedStaffProfileId: v.id("staffProfile"),
    createdByUserId: v.optional(v.id("athenaUser")),
    customerProfileId: v.id("customerProfile"),
    notes: v.optional(v.string()),
    quotedAmount: v.optional(v.number()),
    serviceCatalogId: v.optional(v.id("serviceCatalog")),
    serviceMode: v.union(
      v.literal("same_day"),
      v.literal("consultation"),
      v.literal("repair"),
      v.literal("revamp")
    ),
    title: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireReadySharedDemoStoreCapabilityIfApplicable(
      ctx,
      "service.cases.manage",
      args.storeId,
    );
    const store = await ctx.db.get("store", args.storeId);

    if (!store) {
      return userError({
        code: "not_found",
        message: "Store not found.",
      });
    }

    const createdByStaffProfile = args.createdByUserId
      ? await ctx.db
          .query("staffProfile")
          .withIndex("by_storeId_linkedUserId", (q) =>
            q.eq("storeId", args.storeId).eq("linkedUserId", args.createdByUserId!)
          )
          .first()
      : null;

    const workItem = await createOperationalWorkItemWithCtx(ctx, {
      assignedToStaffProfileId: args.assignedStaffProfileId,
      createdByStaffProfileId: createdByStaffProfile?._id,
      createdByUserId: args.createdByUserId,
      customerProfileId: args.customerProfileId,
      notes: args.notes,
      organizationId: store.organizationId,
      priority: "normal",
      status: "open",
      storeId: args.storeId,
      title: args.title,
      type: "service_case",
    });

    if (!workItem) {
      return userError({
        code: "unavailable",
        message: "Unable to create the service work item.",
      });
    }

    return createServiceCaseWithCtx(ctx, {
      assignedStaffProfileId: args.assignedStaffProfileId,
      createdByUserId: args.createdByUserId,
      customerProfileId: args.customerProfileId,
      notes: args.notes,
      operationalWorkItemId: workItem._id,
      organizationId: store.organizationId,
      quotedAmount: args.quotedAmount,
      serviceCatalogId: args.serviceCatalogId,
      serviceMode: args.serviceMode,
      storeId: args.storeId,
    });
  },
});
