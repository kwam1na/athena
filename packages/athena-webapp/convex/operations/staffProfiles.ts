import { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import {
  deriveDefaultOperationalRoles,
  OperationalRole,
  uniqueOperationalRoles,
} from "./helpers/linking";

const MAX_STAFF_ROLE_ASSIGNMENTS = 10;

function buildFullName(firstName?: string, lastName?: string, email?: string) {
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  return fullName || email || "Unknown staff";
}

export function buildRoleAssignmentDrafts(args: {
  staffProfileId: Id<"staffProfile">;
  userId: Id<"athenaUser">;
  storeId: Id<"store">;
  organizationId: Id<"organization">;
  memberRole: "full_admin" | "pos_only";
  requestedRoles?: OperationalRole[];
}) {
  const roles = uniqueOperationalRoles([
    ...deriveDefaultOperationalRoles(args.memberRole),
    ...(args.requestedRoles ?? []),
  ]);

  return roles.map((role, index) => ({
    staffProfileId: args.staffProfileId,
    userId: args.userId,
    storeId: args.storeId,
    organizationId: args.organizationId,
    role,
    isPrimary: index === 0,
    status: "active" as const,
  }));
}

export const getByUserAndStore = internalQuery({
  args: {
    userId: v.id("athenaUser"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) =>
    ctx.db
      .query("staffProfile")
      .withIndex("by_storeId_userId", (q) =>
        q.eq("storeId", args.storeId).eq("userId", args.userId)
      )
      .first(),
});

export const ensureStaffProfile = internalMutation({
  args: {
    userId: v.id("athenaUser"),
    organizationId: v.id("organization"),
    storeId: v.id("store"),
    requestedRoles: v.optional(
      v.array(
        v.union(
          v.literal("manager"),
          v.literal("front_desk"),
          v.literal("stylist"),
          v.literal("technician"),
          v.literal("cashier")
        )
      )
    ),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get("athenaUser", args.userId);

    if (!user) {
      throw new Error("Athena user not found");
    }

    const membership = await ctx.db
      .query("organizationMember")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("organizationId"), args.organizationId)
        )
      )
      .first();

    if (!membership) {
      throw new Error("Organization membership not found");
    }

    const existingProfile = await ctx.db
      .query("staffProfile")
      .withIndex("by_storeId_userId", (q) =>
        q.eq("storeId", args.storeId).eq("userId", args.userId)
      )
      .first();

    const profilePayload = {
      storeId: args.storeId,
      organizationId: args.organizationId,
      userId: args.userId,
      memberRole: membership.role,
      fullName: buildFullName(user.firstName, user.lastName, user.email),
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      status: "active" as const,
    };

    const staffProfileId = existingProfile
      ? existingProfile._id
      : await ctx.db.insert("staffProfile", profilePayload);

    if (existingProfile) {
      await ctx.db.patch("staffProfile", existingProfile._id, profilePayload);
    }

    const requestedRoles = uniqueOperationalRoles([
      ...(membership.operationalRoles ?? []),
      ...(args.requestedRoles ?? []),
    ]);
    const desiredRoles = buildRoleAssignmentDrafts({
      staffProfileId,
      userId: args.userId,
      storeId: args.storeId,
      organizationId: args.organizationId,
      memberRole: membership.role,
      requestedRoles,
    });

    const existingAssignments = await ctx.db
      .query("staffRoleAssignment")
      .withIndex("by_staffProfileId", (q) => q.eq("staffProfileId", staffProfileId))
      .take(MAX_STAFF_ROLE_ASSIGNMENTS);

    for (const assignment of existingAssignments) {
      if (!desiredRoles.some((candidate) => candidate.role === assignment.role)) {
        await ctx.db.patch("staffRoleAssignment", assignment._id, {
          status: "inactive",
          isPrimary: false,
        });
      }
    }

    for (const assignment of desiredRoles) {
      const current = existingAssignments.find(
        (candidate) => candidate.role === assignment.role
      );

      if (current) {
        await ctx.db.patch("staffRoleAssignment", current._id, {
          status: "active",
          isPrimary: assignment.isPrimary,
        });
        continue;
      }

      await ctx.db.insert("staffRoleAssignment", {
        ...assignment,
        staffProfileId,
        userId: args.userId,
        storeId: args.storeId,
        organizationId: args.organizationId,
        assignedAt: Date.now(),
      });
    }

    await ctx.db.patch("organizationMember", membership._id, {
      operationalRoles: desiredRoles.map((assignment) => assignment.role),
    });

    return ctx.db.get("staffProfile", staffProfileId);
  },
});
