import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { buildApprovalRequest } from "./approvalRequests";
import { normalizeLookupValue, normalizePhoneNumber } from "./helpers/linking";
import { recordInventoryMovementWithCtx } from "./inventoryMovements";
import { createOperationalWorkItemWithCtx } from "./operationalWorkItems";
import { recordOperationalEventWithCtx } from "./operationalEvents";
import { recordPaymentAllocationWithCtx } from "./paymentAllocations";

const MAX_CUSTOMER_SEARCH_RESULTS = 25;
const MAX_STAFF_RESULTS = 100;

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function splitFullName(fullName: string) {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstName: undefined, lastName: undefined };
  }

  const [firstName, ...rest] = trimmed.split(/\s+/);
  return {
    firstName,
    lastName: rest.length > 0 ? rest.join(" ") : undefined,
  };
}

export function validateServiceIntakeInput(args: {
  assignedStaffProfileId?: string | null;
  customerFullName?: string | null;
  customerProfileId?: string | null;
  depositAmount?: number | null;
  depositMethod?: string | null;
  serviceTitle?: string | null;
}) {
  const errors: string[] = [];

  if (!args.assignedStaffProfileId) {
    errors.push("An assignee is required.");
  }

  if (!args.serviceTitle?.trim()) {
    errors.push("A service title is required.");
  }

  if (!args.customerProfileId && !args.customerFullName?.trim()) {
    errors.push("A customer name is required when no customer is linked.");
  }

  if (args.depositAmount !== undefined && args.depositAmount !== null) {
    if (args.depositAmount <= 0) {
      errors.push("Deposit amount must be greater than zero.");
    }

    if (!args.depositMethod) {
      errors.push("Select how the deposit was collected.");
    }
  }

  return errors;
}

async function resolveServiceIntakeCustomerProfile(
  ctx: Parameters<typeof mutation>[0] extends never ? never : any,
  args: {
    customerEmail?: string;
    customerFullName?: string;
    customerNotes?: string;
    customerPhoneNumber?: string;
    customerProfileId?: string;
    organizationId?: string;
    storeId: string;
  }
) {
  if (args.customerProfileId) {
    const existingProfile = await ctx.db.get(
      "customerProfile",
      args.customerProfileId
    );

    if (!existingProfile || existingProfile.storeId !== args.storeId) {
      throw new Error("Selected customer could not be found for this store.");
    }

    return existingProfile;
  }

  const normalizedEmail = normalizeLookupValue(args.customerEmail);
  const normalizedPhoneNumber = normalizePhoneNumber(args.customerPhoneNumber);
  let existingProfile = null;

  if (normalizedEmail) {
    existingProfile = await ctx.db
      .query("customerProfile")
      .withIndex("by_storeId_email", (q: any) =>
        q.eq("storeId", args.storeId).eq("email", normalizedEmail)
      )
      .first();
  }

  if (!existingProfile && normalizedPhoneNumber) {
    existingProfile = await ctx.db
      .query("customerProfile")
      .withIndex("by_storeId_phoneNumber", (q: any) =>
        q.eq("storeId", args.storeId).eq("phoneNumber", normalizedPhoneNumber)
      )
      .first();
  }

  if (existingProfile) {
    await ctx.db.patch("customerProfile", existingProfile._id, {
      email: existingProfile.email ?? normalizedEmail,
      fullName: existingProfile.fullName || args.customerFullName,
      notes: existingProfile.notes ?? trimOptional(args.customerNotes),
      phoneNumber: existingProfile.phoneNumber ?? normalizedPhoneNumber,
    });

    return ctx.db.get("customerProfile", existingProfile._id);
  }

  const fullName = trimOptional(args.customerFullName);
  if (!fullName) {
    throw new Error("A customer name is required.");
  }

  const { firstName, lastName } = splitFullName(fullName);
  const customerProfileId = await ctx.db.insert("customerProfile", {
    email: normalizedEmail,
    firstName,
    fullName,
    lastName,
    notes: trimOptional(args.customerNotes),
    organizationId: args.organizationId,
    phoneNumber: normalizedPhoneNumber,
    preferredContactChannel: normalizedEmail ? "email" : "phone",
    status: "active",
    storeId: args.storeId,
  });

  return ctx.db.get("customerProfile", customerProfileId);
}

export const searchCustomers = query({
  args: {
    searchQuery: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    if (!args.searchQuery.trim()) {
      return [];
    }

    const normalizedSearch = args.searchQuery.trim().toLowerCase();
    const customers = await ctx.db
      .query("customerProfile")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .take(MAX_CUSTOMER_SEARCH_RESULTS);

    return customers
      .filter((customer) => {
        const nameMatch = customer.fullName.toLowerCase().includes(normalizedSearch);
        const emailMatch =
          customer.email?.toLowerCase().includes(normalizedSearch) ?? false;
        const phoneMatch = customer.phoneNumber?.includes(normalizedSearch) ?? false;
        return nameMatch || emailMatch || phoneMatch;
      })
      .map((customer) => ({
        _id: customer._id,
        email: customer.email,
        fullName: customer.fullName,
        phoneNumber: customer.phoneNumber,
      }));
  },
});

export const listAssignableStaff = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const [staffProfiles, roleAssignments] = await Promise.all([
      ctx.db
        .query("staffProfile")
        .withIndex("by_storeId_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", "active")
        )
        .take(MAX_STAFF_RESULTS),
      ctx.db
        .query("staffRoleAssignment")
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .take(MAX_STAFF_RESULTS),
    ]);

    return staffProfiles.map((staffProfile) => ({
      _id: staffProfile._id,
      email: staffProfile.email,
      fullName: staffProfile.fullName,
      roles: roleAssignments
        .filter(
          (assignment) =>
            assignment.staffProfileId === staffProfile._id &&
            assignment.status === "active"
        )
        .map((assignment) => assignment.role),
    }));
  },
});

export const createServiceIntake = mutation({
  args: {
    assignedStaffProfileId: v.id("staffProfile"),
    createdByUserId: v.optional(v.id("athenaUser")),
    customerEmail: v.optional(v.string()),
    customerFullName: v.optional(v.string()),
    customerNotes: v.optional(v.string()),
    customerPhoneNumber: v.optional(v.string()),
    customerProfileId: v.optional(v.id("customerProfile")),
    depositAmount: v.optional(v.number()),
    depositMethod: v.optional(
      v.union(v.literal("cash"), v.literal("card"), v.literal("mobile_money"))
    ),
    intakeChannel: v.union(v.literal("walk_in"), v.literal("phone_booking")),
    itemDescription: v.optional(v.string()),
    notes: v.optional(v.string()),
    priority: v.optional(
      v.union(v.literal("normal"), v.literal("high"), v.literal("urgent"))
    ),
    scheduledAt: v.optional(v.number()),
    serviceTitle: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const validationErrors = validateServiceIntakeInput({
      assignedStaffProfileId: args.assignedStaffProfileId,
      customerFullName: args.customerFullName,
      customerProfileId: args.customerProfileId,
      depositAmount: args.depositAmount,
      depositMethod: args.depositMethod,
      serviceTitle: args.serviceTitle,
    });

    if (validationErrors.length > 0) {
      throw new Error(validationErrors.join(" "));
    }

    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      throw new Error("Store not found.");
    }

    const assignedStaffProfile = await ctx.db.get(
      "staffProfile",
      args.assignedStaffProfileId
    );

    if (
      !assignedStaffProfile ||
      assignedStaffProfile.storeId !== args.storeId ||
      assignedStaffProfile.status !== "active"
    ) {
      throw new Error("Assigned staff member is not available for this store.");
    }

    const createdByStaffProfile = args.createdByUserId
      ? await ctx.db
          .query("staffProfile")
          .withIndex("by_storeId_userId", (q) =>
            q.eq("storeId", args.storeId).eq("userId", args.createdByUserId!)
          )
          .first()
      : null;

    const customerProfile = await resolveServiceIntakeCustomerProfile(ctx, {
      customerEmail: args.customerEmail,
      customerFullName: args.customerFullName,
      customerNotes: args.customerNotes,
      customerPhoneNumber: args.customerPhoneNumber,
      customerProfileId: args.customerProfileId,
      organizationId: store.organizationId,
      storeId: args.storeId,
    });

    if (!customerProfile) {
      throw new Error("Unable to create or load the selected customer.");
    }

    const hasDeposit = args.depositAmount !== undefined && args.depositAmount > 0;
    const workItem = await createOperationalWorkItemWithCtx(ctx, {
      approvalState: hasDeposit ? "pending" : "not_required",
      assignedToStaffProfileId: args.assignedStaffProfileId,
      createdByStaffProfileId: createdByStaffProfile?._id,
      createdByUserId: args.createdByUserId,
      customerProfileId: customerProfile._id,
      dueAt: args.scheduledAt,
      metadata: {
        intakeChannel: args.intakeChannel,
        itemDescription: trimOptional(args.itemDescription),
        scheduledAt: args.scheduledAt ?? null,
        serviceTitle: args.serviceTitle,
      },
      notes: trimOptional(args.notes),
      organizationId: store.organizationId,
      priority: args.priority ?? "normal",
      status: "open",
      storeId: args.storeId,
      title: args.serviceTitle.trim(),
      type: "service_intake",
    });

    if (!workItem) {
      throw new Error("Unable to create the intake work item.");
    }

    const approvalRequest = hasDeposit
      ? await (async () => {
          const approvalRequestId = await ctx.db.insert(
            "approvalRequest",
            buildApprovalRequest({
              metadata: {
                depositAmount: args.depositAmount,
                depositMethod: args.depositMethod,
                intakeChannel: args.intakeChannel,
              },
              notes: trimOptional(args.notes),
              organizationId: store.organizationId,
              reason: `Approve deposit for ${args.serviceTitle.trim()}`,
              requestType: "service_deposit_review",
              requestedByStaffProfileId: createdByStaffProfile?._id,
              requestedByUserId: args.createdByUserId,
              storeId: args.storeId,
              subjectId: workItem._id,
              subjectType: "operational_work_item",
              workItemId: workItem._id,
            })
          );

          await ctx.db.patch("operationalWorkItem", workItem._id, {
            approvalRequestId,
          });

          return ctx.db.get("approvalRequest", approvalRequestId);
        })()
      : null;

    const inventoryMovement = await recordInventoryMovementWithCtx(ctx, {
      actorStaffProfileId: createdByStaffProfile?._id,
      actorUserId: args.createdByUserId,
      customerProfileId: customerProfile._id,
      movementType: "service_item_received",
      notes: trimOptional(args.itemDescription) ?? args.serviceTitle.trim(),
      organizationId: store.organizationId,
      quantityDelta: 1,
      reasonCode: "service_item_checkin",
      sourceId: workItem._id,
      sourceType: "service_intake",
      storeId: args.storeId,
      workItemId: workItem._id,
    });

    const paymentAllocation =
      hasDeposit && args.depositMethod
        ? await recordPaymentAllocationWithCtx(ctx, {
            actorStaffProfileId: createdByStaffProfile?._id,
            actorUserId: args.createdByUserId,
            allocationType: "service_deposit",
            amount: args.depositAmount!,
            collectedInStore: true,
            customerProfileId: customerProfile._id,
            method: args.depositMethod,
            organizationId: store.organizationId,
            storeId: args.storeId,
            targetId: workItem._id,
            targetType: "operational_work_item",
            workItemId: workItem._id,
          })
        : null;

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: createdByStaffProfile?._id,
      actorUserId: args.createdByUserId,
      approvalRequestId: approvalRequest?._id,
      customerProfileId: customerProfile._id,
      eventType: "service_intake_created",
      inventoryMovementId: inventoryMovement?._id,
      metadata: {
        depositAmount: args.depositAmount ?? null,
        depositMethod: args.depositMethod ?? null,
        intakeChannel: args.intakeChannel,
      },
      organizationId: store.organizationId,
      paymentAllocationId: paymentAllocation?._id,
      storeId: args.storeId,
      subjectId: workItem._id,
      subjectLabel: workItem.title,
      subjectType: "operational_work_item",
      workItemId: workItem._id,
    });

    return {
      approvalRequestId: approvalRequest?._id,
      customerProfileId: customerProfile._id,
      workItemId: workItem._id,
    };
  },
});
