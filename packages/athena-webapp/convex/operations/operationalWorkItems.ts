import { internalMutation, internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";

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
  handler: async (ctx, args) => {
    const workItemId = await ctx.db.insert(
      "operationalWorkItem",
      buildOperationalWorkItem(args)
    );
    return ctx.db.get(workItemId);
  },
});

export const updateOperationalWorkItemStatus = internalMutation({
  args: {
    workItemId: v.id("operationalWorkItem"),
    status: v.string(),
    approvalState: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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

    await ctx.db.patch(args.workItemId, nextFields);
    return ctx.db.get(args.workItemId);
  },
});

export const listOpenOperationalWorkItems = internalQuery({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) =>
    ctx.db
      .query("operationalWorkItem")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect()
      .then((items) =>
        items.filter((item) => !["completed", "cancelled"].includes(item.status))
      ),
});
