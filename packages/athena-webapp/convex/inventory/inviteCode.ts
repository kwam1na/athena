import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

export const redeem = mutation({
  args: { code: v.string(), email: v.string() },
  returns: v.object({
    success: v.boolean(),
    message: v.optional(v.string()),
    inviteCode: v.optional(
      v.object({
        _id: v.id("inviteCode"),
        _creationTime: v.number(),
        code: v.string(),
        recipientEmail: v.string(),
        recipientUserId: v.id("athenaUser"),
        organizationId: v.id("organization"),
        createdByUserId: v.id("athenaUser"),
        redeemedAt: v.optional(v.number()),
      })
    ),
  }),
  handler: async (ctx, args) => {
    // Find the invite code
    const inviteCode = await ctx.db
      .query("inviteCode")
      .filter((q) =>
        q.and(
          q.eq(q.field("code"), args.code),
          q.eq(q.field("recipientEmail"), args.email)
        )
      )
      .first();

    if (!inviteCode) {
      return { success: false, message: "Invalid invite code" };
    }

    if (inviteCode.redeemedAt) {
      return { success: false, message: "Invite code already redeemed" };
    }

    await ctx.db.patch(inviteCode._id, { redeemedAt: Date.now() });

    return { success: true, inviteCode };
  },
});

export const create = mutation({
  args: {
    organizationId: v.id("organization"),
    recipientEmail: v.string(),
    createdByUserId: v.id("athenaUser"),
    role: v.union(v.literal("full_admin"), v.literal("pos_only")),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.optional(v.string()),
    inviteCode: v.optional(v.id("inviteCode")),
  }),
  handler: async (ctx, args) => {
    // check if the email is associated with an existing user
    const user = await ctx.db
      .query("athenaUser")
      .filter((q) => q.eq(q.field("email"), args.recipientEmail))
      .first();

    let userId = user?._id;

    if (!user) {
      // create the user for the email
      userId = await ctx.db.insert("athenaUser", {
        email: args.recipientEmail,
      });
    }

    // check if the user is not already a member of this organization
    const member = await ctx.db
      .query("organizationMember")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.eq(q.field("organizationId"), args.organizationId)
        )
      )
      .first();

    if (!member) {
      // create the organization member
      await ctx.db.insert("organizationMember", {
        userId: userId!,
        organizationId: args.organizationId,
        role: args.role,
      });

      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const inviteCode = await ctx.db.insert("inviteCode", {
        code,
        recipientEmail: args.recipientEmail,
        recipientUserId: userId!,
        organizationId: args.organizationId,
        createdByUserId: args.createdByUserId,
      });

      return { success: true, inviteCode };
    }

    return {
      success: false,
      message: "User is already a member of the organization",
    };
  },
});

export const getAll = query({
  args: { organizationId: v.id("organization") },
  returns: v.array(
    v.object({
      _id: v.id("inviteCode"),
      _creationTime: v.number(),
      code: v.string(),
      recipientEmail: v.string(),
      recipientUserId: v.id("athenaUser"),
      organizationId: v.id("organization"),
      createdByUserId: v.id("athenaUser"),
      redeemedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("inviteCode")
      .filter((q) => q.eq(q.field("organizationId"), args.organizationId))
      .collect();
  },
});
