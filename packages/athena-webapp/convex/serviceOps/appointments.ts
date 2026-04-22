/* eslint-disable @convex-dev/no-collect-in-query -- V26-276 keeps service appointment screens and staff overlap checks store-scoped until we add pagination and time-windowed query helpers; truncating these indexed reads would hide real conflicts and appointments. */

import { mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { createOperationalWorkItemWithCtx } from "../operations/operationalWorkItems";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { createServiceCaseWithCtx } from "./serviceCases";

const NON_BLOCKING_APPOINTMENT_STATUSES = new Set([
  "cancelled",
  "completed",
  "converted_to_walk_in",
]);

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
}) {
  if (args.durationMinutes <= 0) {
    throw new Error("Service duration must be greater than zero");
  }

  const now = Date.now();
  return {
    ...args,
    createdAt: now,
    endAt: args.startAt + args.durationMinutes * 60_000,
    status: "scheduled" as const,
    updatedAt: now,
  };
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
      throw new Error("Service catalog item not found for this store.");
    }

    if (!customerProfile || customerProfile.storeId !== args.storeId) {
      throw new Error("Customer profile not found for this store.");
    }

    if (
      !staffProfile ||
      staffProfile.storeId !== args.storeId ||
      staffProfile.status !== "active"
    ) {
      throw new Error("Assigned staff member is not available for this store.");
    }

    const appointment = buildServiceAppointment({
      ...args,
      durationMinutes: catalogItem.durationMinutes,
      organizationId: catalogItem.organizationId,
    });

    const existingAppointments = await ctx.db
      .query("serviceAppointment")
      .withIndex("by_staffProfileId_startAt", (q) =>
        q.eq("assignedStaffProfileId", args.assignedStaffProfileId)
      )
      .collect();

    if (findOverlappingAppointment(existingAppointments, appointment)) {
      throw new Error("Assigned staff member already has an appointment in this slot.");
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

    return ctx.db.get("serviceAppointment", appointmentId);
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
      throw new Error("Appointment not found.");
    }

    if (NON_BLOCKING_APPOINTMENT_STATUSES.has(appointment.status)) {
      throw new Error("This appointment can no longer be rescheduled.");
    }

    const catalogItem = await ctx.db.get("serviceCatalog", appointment.serviceCatalogId);
    if (!catalogItem) {
      throw new Error("Service catalog item not found.");
    }

    const candidateAppointment = buildServiceAppointment({
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
      throw new Error("Assigned staff member already has an appointment in this slot.");
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

    return ctx.db.get("serviceAppointment", appointment._id);
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
      throw new Error("Appointment not found.");
    }

    await ctx.db.patch("serviceAppointment", appointment._id, {
      cancelledAt: Date.now(),
      notes: args.notes ?? appointment.notes,
      status: "cancelled",
      updatedAt: Date.now(),
    });

    await recordOperationalEventWithCtx(ctx, {
      customerProfileId: appointment.customerProfileId,
      eventType: "service_appointment_cancelled",
      organizationId: appointment.organizationId,
      storeId: appointment.storeId,
      subjectId: appointment._id,
      subjectType: "service_appointment",
    });

    return ctx.db.get("serviceAppointment", appointment._id);
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
      throw new Error("Appointment not found.");
    }

    if (appointment.serviceCaseId) {
      throw new Error("Appointment already has a service case.");
    }

    const [catalogItem, customerProfile, store] = await Promise.all([
      ctx.db.get("serviceCatalog", appointment.serviceCatalogId),
      ctx.db.get("customerProfile", appointment.customerProfileId),
      ctx.db.get("store", appointment.storeId),
    ]);

    if (!catalogItem) {
      throw new Error("Service catalog item not found.");
    }

    if (!customerProfile) {
      throw new Error("Customer profile not found.");
    }

    if (!store) {
      throw new Error("Store not found.");
    }

    const createdByStaffProfile = args.createdByUserId
      ? await ctx.db
          .query("staffProfile")
          .withIndex("by_storeId_linkedUserId", (q) =>
            q
              .eq("storeId", appointment.storeId)
              .eq("linkedUserId", args.createdByUserId!)
          )
          .first()
      : null;

    const workItem = await createOperationalWorkItemWithCtx(ctx, {
      assignedToStaffProfileId: appointment.assignedStaffProfileId,
      createdByStaffProfileId: createdByStaffProfile?._id,
      createdByUserId: args.createdByUserId,
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
      type: "service_appointment",
    });

    if (!workItem) {
      throw new Error("Unable to create an operational work item for this appointment.");
    }

    const serviceCase = await createServiceCaseWithCtx(ctx, {
      appointmentId: appointment._id,
      assignedStaffProfileId: appointment.assignedStaffProfileId,
      createdByUserId: args.createdByUserId,
      customerProfileId: appointment.customerProfileId,
      notes: appointment.notes,
      operationalWorkItemId: workItem._id,
      organizationId: store.organizationId,
      quotedAmount: catalogItem.basePrice,
      serviceCatalogId: appointment.serviceCatalogId,
      serviceMode: catalogItem.serviceMode,
      storeId: appointment.storeId,
    });

    await ctx.db.patch("serviceAppointment", appointment._id, {
      convertedAt: Date.now(),
      serviceCaseId: serviceCase._id,
      status: "converted_to_walk_in",
      updatedAt: Date.now(),
    });

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: createdByStaffProfile?._id,
      actorUserId: args.createdByUserId,
      customerProfileId: customerProfile._id,
      eventType: "service_appointment_converted_to_walk_in",
      organizationId: store.organizationId,
      storeId: appointment.storeId,
      subjectId: appointment._id,
      subjectLabel: catalogItem.name,
      subjectType: "service_appointment",
      workItemId: workItem._id,
    });

    return {
      appointmentId: appointment._id,
      serviceCaseId: serviceCase._id,
      workItemId: workItem._id,
    };
  },
});
