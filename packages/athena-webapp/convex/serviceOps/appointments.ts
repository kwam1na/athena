/* eslint-disable @convex-dev/no-collect-in-query -- V26-276 keeps service appointment screens and staff overlap checks store-scoped until we add pagination and time-windowed query helpers; truncating these indexed reads would hide real conflicts and appointments. */

import { mutation, query, type MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  createOperationalWorkItemWithCtx,
  updateOperationalWorkItemStatusWithCtx,
} from "../operations/operationalWorkItems";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { createServiceCaseWithCtx } from "./serviceCases";
import { recordServiceCaseTraceBestEffort } from "./serviceCaseTracing";
import { ok, userError, type CommandResult } from "../../shared/commandResult";

const NON_BLOCKING_APPOINTMENT_STATUSES = new Set([
  "cancelled",
  "completed",
  "converted_to_walk_in",
]);
const CURRENT_WORK_ITEM_STATUSES = ["open", "in_progress"] as const;
const LEGACY_APPOINTMENT_WORK_ITEM_PROBE_LIMIT = 1_000;

export function buildServiceAppointment(args: {
  assignedStaffProfileId: Id<"staffProfile">;
  createdByUserId?: Id<"athenaUser">;
  customerProfileId: Id<"customerProfile">;
  durationMinutes: number;
  notes?: string;
  organizationId?: Id<"organization">;
  serviceCatalogId: Id<"serviceCatalog">;
  serviceCaseId?: Id<"serviceCase">;
  startAt: number;
  storeId: Id<"store">;
}): CommandResult<{
  assignedStaffProfileId: Id<"staffProfile">;
  createdAt: number;
  createdByUserId?: Id<"athenaUser">;
  customerProfileId: Id<"customerProfile">;
  durationMinutes: number;
  endAt: number;
  notes?: string;
  organizationId?: Id<"organization">;
  serviceCatalogId: Id<"serviceCatalog">;
  serviceCaseId?: Id<"serviceCase">;
  startAt: number;
  status: "scheduled";
  storeId: Id<"store">;
  updatedAt: number;
}> {
  if (args.durationMinutes <= 0) {
    return userError({
      code: "validation_failed",
      message: "Service duration must be greater than zero.",
    });
  }

  const now = Date.now();
  return ok({
    ...args,
    createdAt: now,
    endAt: args.startAt + args.durationMinutes * 60_000,
    status: "scheduled" as const,
    updatedAt: now,
  });
}

export function findOverlappingAppointment(
  appointments: Array<{
    _id: string;
    endAt: number;
    startAt: number;
    status: string;
  }>,
  candidate: {
    endAt: number;
    startAt: number;
  }
) {
  return (
    appointments.find((appointment) => {
      if (NON_BLOCKING_APPOINTMENT_STATUSES.has(appointment.status)) {
        return false;
      }

      return (
        candidate.startAt < appointment.endAt &&
        candidate.endAt > appointment.startAt
      );
    }) ?? null
  );
}

export async function closeCurrentServiceAppointmentWorkItemsWithCtx(
  ctx: MutationCtx,
  args: {
    appointmentId: Id<"serviceAppointment">;
    status: "completed" | "cancelled";
    storeId: Id<"store">;
  },
) {
  const indexedWorkItemGroups = await Promise.all(
    CURRENT_WORK_ITEM_STATUSES.map((status) =>
      ctx.db
        .query("operationalWorkItem")
        .withIndex("by_storeId_type_status_appointmentId", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("type", "service_appointment")
            .eq("status", status)
            .eq("appointmentId", args.appointmentId),
        )
        .collect(),
    ),
  );
  const legacyWorkItemGroups = await Promise.all(
    CURRENT_WORK_ITEM_STATUSES.map((status) =>
      ctx.db
        .query("operationalWorkItem")
        .withIndex("by_storeId_type_status", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("type", "service_appointment")
            .eq("status", status),
        )
        .take(LEGACY_APPOINTMENT_WORK_ITEM_PROBE_LIMIT),
    ),
  );
  const workItemsById = new Map<
    Id<"operationalWorkItem">,
    Doc<"operationalWorkItem">
  >();

  for (const workItem of indexedWorkItemGroups.flat()) {
    workItemsById.set(workItem._id, workItem);
  }

  for (const workItem of legacyWorkItemGroups.flat()) {
    if (
      workItem.appointmentId ||
      workItem.metadata?.appointmentId !== args.appointmentId
    ) {
      continue;
    }

    workItemsById.set(workItem._id, workItem);
  }

  const patchedWorkItemIds: Array<Id<"operationalWorkItem">> = [];

  for (const workItem of workItemsById.values()) {
    await updateOperationalWorkItemStatusWithCtx(ctx, {
      status: args.status,
      workItemId: workItem._id,
    });
    patchedWorkItemIds.push(workItem._id);
  }

  return patchedWorkItemIds;
}

export const listAppointments = query({
  args: {
    status: v.optional(v.string()),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const appointments = await ctx.db
      .query("serviceAppointment")
      .withIndex("by_storeId_startAt", (q) => q.eq("storeId", args.storeId))
      .collect();

    if (!args.status) {
      return appointments;
    }

    return appointments.filter((appointment) => appointment.status === args.status);
  },
});

export const createAppointment = mutation({
  args: {
    assignedStaffProfileId: v.id("staffProfile"),
    createdByUserId: v.optional(v.id("athenaUser")),
    customerProfileId: v.id("customerProfile"),
    notes: v.optional(v.string()),
    serviceCatalogId: v.id("serviceCatalog"),
    startAt: v.number(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const [catalogItem, customerProfile, staffProfile] = await Promise.all([
      ctx.db.get("serviceCatalog", args.serviceCatalogId),
      ctx.db.get("customerProfile", args.customerProfileId),
      ctx.db.get("staffProfile", args.assignedStaffProfileId),
    ]);

    if (!catalogItem || catalogItem.storeId !== args.storeId) {
      return userError({
        code: "not_found",
        message: "Service catalog item not found for this store.",
      });
    }

    if (!customerProfile || customerProfile.storeId !== args.storeId) {
      return userError({
        code: "not_found",
        message: "Customer profile not found for this store.",
      });
    }

    if (
      !staffProfile ||
      staffProfile.storeId !== args.storeId ||
      staffProfile.status !== "active"
    ) {
      return userError({
        code: "precondition_failed",
        message: "Assigned staff member is not available for this store.",
      });
    }

    const appointmentResult = buildServiceAppointment({
      ...args,
      durationMinutes: catalogItem.durationMinutes,
      organizationId: catalogItem.organizationId,
    });
    if (appointmentResult.kind === "user_error") {
      return appointmentResult;
    }

    const appointment = appointmentResult.data;

    const existingAppointments = await ctx.db
      .query("serviceAppointment")
      .withIndex("by_staffProfileId_startAt", (q) =>
        q.eq("assignedStaffProfileId", args.assignedStaffProfileId)
      )
      .collect();

    if (findOverlappingAppointment(existingAppointments, appointment)) {
      return userError({
        code: "conflict",
        message: "Assigned staff member already has an appointment in this slot.",
      });
    }

    const appointmentId = await ctx.db.insert("serviceAppointment", appointment);

    await recordOperationalEventWithCtx(ctx, {
      actorUserId: args.createdByUserId,
      customerProfileId: args.customerProfileId,
      eventType: "service_appointment_created",
      organizationId: catalogItem.organizationId,
      storeId: args.storeId,
      subjectId: appointmentId,
      subjectLabel: catalogItem.name,
      subjectType: "service_appointment",
    });

    return ok(await ctx.db.get("serviceAppointment", appointmentId));
  },
});

export const rescheduleAppointment = mutation({
  args: {
    appointmentId: v.id("serviceAppointment"),
    notes: v.optional(v.string()),
    startAt: v.number(),
  },
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get("serviceAppointment", args.appointmentId);

    if (!appointment) {
      return userError({
        code: "not_found",
        message: "Appointment not found.",
      });
    }

    if (NON_BLOCKING_APPOINTMENT_STATUSES.has(appointment.status)) {
      return userError({
        code: "precondition_failed",
        message: "This appointment can no longer be rescheduled.",
      });
    }

    const catalogItem = await ctx.db.get("serviceCatalog", appointment.serviceCatalogId);
    if (!catalogItem) {
      return userError({
        code: "not_found",
        message: "Service catalog item not found.",
      });
    }

    const candidateAppointmentResult = buildServiceAppointment({
      assignedStaffProfileId: appointment.assignedStaffProfileId,
      createdByUserId: appointment.createdByUserId,
      customerProfileId: appointment.customerProfileId,
      durationMinutes: catalogItem.durationMinutes,
      notes: args.notes ?? appointment.notes,
      organizationId: appointment.organizationId,
      serviceCatalogId: appointment.serviceCatalogId,
      serviceCaseId: appointment.serviceCaseId,
      startAt: args.startAt,
      storeId: appointment.storeId,
    });
    if (candidateAppointmentResult.kind === "user_error") {
      return candidateAppointmentResult;
    }

    const candidateAppointment = candidateAppointmentResult.data;

    const existingAppointments = await ctx.db
      .query("serviceAppointment")
      .withIndex("by_staffProfileId_startAt", (q) =>
        q.eq("assignedStaffProfileId", appointment.assignedStaffProfileId)
      )
      .collect();

    const overlappingAppointment = findOverlappingAppointment(
      existingAppointments.filter(
        (existingAppointment) => existingAppointment._id !== appointment._id
      ),
      candidateAppointment
    );

    if (overlappingAppointment) {
      return userError({
        code: "conflict",
        message: "Assigned staff member already has an appointment in this slot.",
      });
    }

    await ctx.db.patch("serviceAppointment", appointment._id, {
      endAt: candidateAppointment.endAt,
      notes: candidateAppointment.notes,
      startAt: candidateAppointment.startAt,
      status: "rescheduled",
      updatedAt: Date.now(),
    });

    await recordOperationalEventWithCtx(ctx, {
      customerProfileId: appointment.customerProfileId,
      eventType: "service_appointment_rescheduled",
      organizationId: appointment.organizationId,
      storeId: appointment.storeId,
      subjectId: appointment._id,
      subjectType: "service_appointment",
    });

    return ok(await ctx.db.get("serviceAppointment", appointment._id));
  },
});

export const cancelAppointment = mutation({
  args: {
    appointmentId: v.id("serviceAppointment"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get("serviceAppointment", args.appointmentId);

    if (!appointment) {
      return userError({
        code: "not_found",
        message: "Appointment not found.",
      });
    }

    if (!appointment.organizationId) {
      return userError({
        code: "precondition_failed",
        message: "Appointment is missing organization context.",
      });
    }

    const store = await ctx.db.get("store", appointment.storeId);

    if (!store) {
      return userError({
        code: "not_found",
        message: "Store not found.",
      });
    }

    if (store.organizationId !== appointment.organizationId) {
      return userError({
        code: "precondition_failed",
        message: "Appointment store does not match its organization.",
      });
    }

    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "Only store admins can cancel service appointments.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    const actorUserId = athenaUser._id;
    const actorStaffProfile = await ctx.db
      .query("staffProfile")
      .withIndex("by_storeId_linkedUserId", (q) =>
        q.eq("storeId", appointment.storeId).eq("linkedUserId", actorUserId),
      )
      .first();

    await ctx.db.patch("serviceAppointment", appointment._id, {
      cancelledAt: Date.now(),
      notes: args.notes ?? appointment.notes,
      status: "cancelled",
      updatedAt: Date.now(),
    });
    const closedWorkItemIds =
      await closeCurrentServiceAppointmentWorkItemsWithCtx(ctx, {
        appointmentId: appointment._id,
        status: "cancelled",
        storeId: appointment.storeId,
      });

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: actorStaffProfile?._id,
      actorUserId,
      customerProfileId: appointment.customerProfileId,
      eventType: "service_appointment_cancelled",
      metadata: {
        closedWorkItemIds,
        nextWorkItemStatus: "cancelled",
        previousStatus: appointment.status,
      },
      organizationId: appointment.organizationId,
      storeId: appointment.storeId,
      subjectId: appointment._id,
      subjectType: "service_appointment",
    });

    return ok(await ctx.db.get("serviceAppointment", appointment._id));
  },
});

export const convertAppointmentToWalkIn = mutation({
  args: {
    appointmentId: v.id("serviceAppointment"),
    createdByUserId: v.optional(v.id("athenaUser")),
  },
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get("serviceAppointment", args.appointmentId);

    if (!appointment) {
      return userError({
        code: "not_found",
        message: "Appointment not found.",
      });
    }

    if (appointment.serviceCaseId) {
      return userError({
        code: "conflict",
        message: "Appointment already has a service case.",
      });
    }

    if (NON_BLOCKING_APPOINTMENT_STATUSES.has(appointment.status)) {
      return userError({
        code: "precondition_failed",
        message: "This appointment can no longer be converted.",
      });
    }

    if (!appointment.organizationId) {
      return userError({
        code: "precondition_failed",
        message: "Appointment is missing organization context.",
      });
    }

    const [catalogItem, customerProfile, store] = await Promise.all([
      ctx.db.get("serviceCatalog", appointment.serviceCatalogId),
      ctx.db.get("customerProfile", appointment.customerProfileId),
      ctx.db.get("store", appointment.storeId),
    ]);

    if (!catalogItem) {
      return userError({
        code: "not_found",
        message: "Service catalog item not found.",
      });
    }

    if (!customerProfile) {
      return userError({
        code: "not_found",
        message: "Customer profile not found.",
      });
    }

    if (!store) {
      return userError({
        code: "not_found",
        message: "Store not found.",
      });
    }

    if (store.organizationId !== appointment.organizationId) {
      return userError({
        code: "precondition_failed",
        message: "Appointment store does not match its organization.",
      });
    }

    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage:
        "Only store admins can convert service appointments to cases.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    const actorUserId = athenaUser._id;
    const createdByStaffProfile = await ctx.db
      .query("staffProfile")
      .withIndex("by_storeId_linkedUserId", (q) =>
        q.eq("storeId", appointment.storeId).eq("linkedUserId", actorUserId),
      )
      .first();

    const workItem = await createOperationalWorkItemWithCtx(ctx, {
      assignedToStaffProfileId: appointment.assignedStaffProfileId,
      appointmentId: appointment._id,
      createdByStaffProfileId: createdByStaffProfile?._id,
      createdByUserId: actorUserId,
      customerProfileId: appointment.customerProfileId,
      metadata: {
        appointmentId: appointment._id,
        serviceCatalogId: appointment.serviceCatalogId,
        startAt: appointment.startAt,
      },
      notes: appointment.notes,
      organizationId: store.organizationId,
      priority: "normal",
      status: "open",
      storeId: appointment.storeId,
      title: catalogItem.name,
      type: "service_case",
    });

    if (!workItem) {
      return userError({
        code: "unavailable",
        message: "Unable to create an operational work item for this appointment.",
      });
    }

    const serviceCase = await createServiceCaseWithCtx(ctx, {
      appointmentId: appointment._id,
      assignedStaffProfileId: appointment.assignedStaffProfileId,
      createdByUserId: actorUserId,
      customerProfileId: appointment.customerProfileId,
      notes: appointment.notes,
      operationalWorkItemId: workItem._id,
      organizationId: store.organizationId,
      quotedAmount: catalogItem.basePrice,
      serviceCatalogId: appointment.serviceCatalogId,
      serviceMode: catalogItem.serviceMode,
      storeId: appointment.storeId,
    });
    if (serviceCase.kind === "user_error") {
      return serviceCase;
    }

    const createdServiceCase = serviceCase.data;

    await ctx.db.patch("serviceAppointment", appointment._id, {
      convertedAt: Date.now(),
      serviceCaseId: createdServiceCase._id,
      status: "converted_to_walk_in",
      updatedAt: Date.now(),
    });
    const closedAppointmentWorkItemIds =
      await closeCurrentServiceAppointmentWorkItemsWithCtx(ctx, {
        appointmentId: appointment._id,
        status: "completed",
        storeId: appointment.storeId,
      });

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: createdByStaffProfile?._id,
      actorUserId,
      customerProfileId: customerProfile._id,
      eventType: "service_appointment_converted_to_walk_in",
      metadata: {
        closedAppointmentWorkItemIds,
        nextAppointmentWorkItemStatus: "completed",
        previousStatus: appointment.status,
        serviceCaseId: createdServiceCase._id,
        serviceCaseWorkItemId: workItem._id,
      },
      organizationId: store.organizationId,
      storeId: appointment.storeId,
      subjectId: appointment._id,
      subjectLabel: catalogItem.name,
      subjectType: "service_appointment",
      workItemId: workItem._id,
    });

    await recordServiceCaseTraceBestEffort(ctx, {
      actorStaffProfileId: createdByStaffProfile?._id,
      actorUserId,
      appointmentId: appointment._id,
      serviceCase: createdServiceCase,
      stage: "appointment_converted",
    });

    return ok({
      appointmentId: appointment._id,
      serviceCaseId: createdServiceCase._id,
      workItemId: workItem._id,
    });
  },
});
