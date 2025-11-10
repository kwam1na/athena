import { internalMutation, query } from "../_generated/server";
import { v } from "convex/values";

const entity = "organizationMember";

export const getAll = query({
  args: {
    organizationId: v.id("organization"),
  },
  returns: v.array(
    v.union(
      v.null(),
      v.object({
        _id: v.id("athenaUser"),
        _creationTime: v.number(),
        email: v.string(),
        firstName: v.optional(v.string()),
        lastName: v.optional(v.string()),
        phoneNumber: v.optional(v.string()),
        organizationId: v.optional(v.id("organization")),
      })
    )
  ),
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("organizationId"), args.organizationId))
      .collect();

    const res = await Promise.all(
      members.map((member) => ctx.db.get(member.userId))
    );

    return res.filter((o) => !!o);
  },
});

// Get user's role for a specific organization
export const getUserRole = query({
  args: {
    userId: v.id("athenaUser"),
    organizationId: v.id("organization"),
  },
  returns: v.union(
    v.null(),
    v.union(v.literal("full_admin"), v.literal("pos_only"))
  ),
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("organizationId"), args.organizationId)
        )
      )
      .first();

    return membership?.role ?? null;
  },
});

// Get computed permissions for a user in an organization
export const getUserPermissions = query({
  args: {
    userId: v.id("athenaUser"),
    organizationId: v.id("organization"),
  },
  returns: v.object({
    canAccessAdmin: v.boolean(),
    canAccessPOS: v.boolean(),
    role: v.union(
      v.null(),
      v.union(v.literal("full_admin"), v.literal("pos_only"))
    ),
  }),
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("organizationId"), args.organizationId)
        )
      )
      .first();

    const role = membership?.role ?? null;

    return {
      canAccessAdmin: role === "full_admin",
      canAccessPOS: role === "full_admin" || role === "pos_only",
      role,
    };
  },
});

// Check if user can access POS features
export const canAccessPOS = query({
  args: {
    userId: v.id("athenaUser"),
    organizationId: v.id("organization"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("organizationId"), args.organizationId)
        )
      )
      .first();

    const role = membership?.role;
    return role === "full_admin" || role === "pos_only";
  },
});

// Check if user can access admin features
export const canAccessAdmin = query({
  args: {
    userId: v.id("athenaUser"),
    organizationId: v.id("organization"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("organizationId"), args.organizationId)
        )
      )
      .first();

    return membership?.role === "full_admin";
  },
});

// Migration function to set default role for existing members
export const migrateExistingMembersToFullAdmin = internalMutation({
  args: {},
  returns: v.object({
    success: v.boolean(),
    updatedCount: v.number(),
  }),
  handler: async (ctx) => {
    const allMembers = await ctx.db.query(entity).collect();
    let updatedCount = 0;

    for (const member of allMembers) {
      // Check if role is already set to a valid value
      if (member.role !== "full_admin" && member.role !== "pos_only") {
        // Update to full_admin for existing members
        await ctx.db.patch(member._id, {
          role: "full_admin",
        });
        updatedCount++;
      }
    }

    return {
      success: true,
      updatedCount,
    };
  },
});
