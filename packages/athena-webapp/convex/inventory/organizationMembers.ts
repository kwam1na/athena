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
    const members = [];
    for await (const member of ctx.db
      .query("organizationMember")
      .withIndex("by_organizationId_userId", (q) =>
        q.eq("organizationId", args.organizationId),
      )) {
      members.push(member);
    }

    const res = await Promise.all(
      members.map((member) => ctx.db.get("athenaUser", member.userId))
    );

    // Project each athenaUser to exactly the validated shape. Returning the raw
    // doc leaks whatever columns the table happens to carry (e.g.
    // `normalizedEmail`), which the return validator rejects and which the
    // members UI does not need.
    return res
      .filter((user): user is NonNullable<typeof user> => !!user)
      .map((user) => ({
        _id: user._id,
        _creationTime: user._creationTime,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        organizationId: user.organizationId,
      }));
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
    let updatedCount = 0;

    for await (const member of ctx.db.query("organizationMember")) {
      // Check if role is already set to a valid value
      if (member.role !== "full_admin" && member.role !== "pos_only") {
        // Update to full_admin for existing members
        await ctx.db.patch("organizationMember", member._id, {
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
