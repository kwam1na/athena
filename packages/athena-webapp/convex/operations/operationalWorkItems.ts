import {
  internalMutation,
  internalQuery,
  MutationCtx,
  query,
} from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";

const MAX_QUEUE_ITEMS = 100;
const TERMINAL_WORK_ITEM_STATUSES = new Set(["completed", "cancelled"]);

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
  approvalRequestId?: Id<"approvalRequest">;
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
    approvalRequestId: v.optional(v.id("approvalRequest")),
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
  handler: async (ctx, args) =>
    ctx.db
      .query("operationalWorkItem")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .take(MAX_QUEUE_ITEMS)
      .then((items) =>
        items.filter(
          (item) => !["completed", "cancelled"].includes(item.status),
        ),
      ),
});

export const getQueueSnapshot = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const [workItems, approvalRequests] = await Promise.all([
      ctx.db
        .query("operationalWorkItem")
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .take(MAX_QUEUE_ITEMS),
      ctx.db
        .query("approvalRequest")
        .withIndex("by_storeId_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", "pending"),
        )
        .take(MAX_QUEUE_ITEMS),
    ]);

    const openWorkItems = workItems.filter(
      (item) => !TERMINAL_WORK_ITEM_STATUSES.has(item.status),
    );

    const customerIds = new Set<string>();
    const posTransactionIds = new Set<string>();
    const staffIds = new Set<string>();
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

      if (
        request.requestType === "payment_method_correction" &&
        request.subjectType === "pos_transaction"
      ) {
        posTransactionIds.add(request.subjectId);
      }
    }

    const [customers, staffProfiles, relatedWorkItems, posTransactions] =
      await Promise.all([
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
      ]);

    const customerMap = new Map<Id<"customerProfile">, Doc<"customerProfile">>(
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

    return {
      approvalRequests: approvalRequests.map((request) => {
        const linkedTransaction =
          request.subjectType === "pos_transaction"
            ? posTransactionMap.get(request.subjectId as Id<"posTransaction">)
            : null;

        return {
          ...request,
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
          workItemTitle: request.workItemId
            ? workItemMap.get(request.workItemId)?.title
            : null,
        };
      }),
      workItems: openWorkItems.map((item) => ({
        ...item,
        assignedStaffName: item.assignedToStaffProfileId
          ? staffMap.get(item.assignedToStaffProfileId)?.fullName
          : null,
        customerName: item.customerProfileId
          ? customerMap.get(item.customerProfileId)?.fullName
          : null,
      })),
    };
  },
});
