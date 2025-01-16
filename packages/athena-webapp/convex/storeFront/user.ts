import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { addressSchema } from "../schemas/storeFront";

const entity = "storeFrontUser";

export const getAll = query({
  handler: async (ctx) => {
    return await ctx.db.query(entity).collect();
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    try {
      return await ctx.db.get(args.id);
    } catch (e) {
      return null;
    }
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    shippingAddress: v.optional(addressSchema),
    billingAddress: v.optional(addressSchema),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, any> = {};

    if (args.email) {
      updates.email = args.email;
    }

    if (args.firstName) {
      updates.firstName = args.firstName;
    }

    if (args.lastName) {
      updates.lastName = args.lastName;
    }

    if (args.phoneNumber) {
      updates.phoneNumber = args.phoneNumber;
    }

    if (args.billingAddress) {
      updates.billingAddress = args.billingAddress;
    }

    if (args.shippingAddress) {
      updates.shippingAddress = args.shippingAddress;
    }

    await ctx.db.patch(args.id, updates);
    return await ctx.db.get(args.id);
  },
});
