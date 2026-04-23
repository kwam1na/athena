import { v } from "convex/values";

import { mutation, query } from "../../_generated/server";
import { commandResultValidator } from "../../lib/commandResultValidators";
import {
  createCustomer as createCustomerCommand,
  linkToGuest as linkToGuestCommand,
  linkToStoreFrontUser as linkToStoreFrontUserCommand,
  updateCustomer as updateCustomerCommand,
  updateCustomerStats as updateCustomerStatsCommand,
} from "../application/commands/assignCustomer";
import {
  findByStoreFrontUser as findByStoreFrontUserQuery,
  findPotentialMatches as findPotentialMatchesQuery,
  getCustomerById as getCustomerByIdQuery,
  getCustomerTransactions as getCustomerTransactionsQuery,
  searchCustomers as searchCustomersQuery,
} from "../application/queries/searchCustomers";

const customerAddressValidator = v.object({
  street: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zipCode: v.optional(v.string()),
  country: v.optional(v.string()),
});

const customerSummaryValidator = v.object({
  _id: v.id("posCustomer"),
  _creationTime: v.number(),
  name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  totalSpent: v.optional(v.number()),
  transactionCount: v.optional(v.number()),
  lastTransactionAt: v.optional(v.number()),
});

export const searchCustomers = query({
  args: {
    storeId: v.id("store"),
    searchQuery: v.string(),
  },
  returns: v.array(customerSummaryValidator),
  handler: async (ctx, args) => searchCustomersQuery(ctx, args),
});

export const getCustomerById = query({
  args: {
    customerId: v.id("posCustomer"),
  },
  returns: v.union(
    v.object({
      _id: v.id("posCustomer"),
      _creationTime: v.number(),
      storeId: v.id("store"),
      name: v.string(),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      address: v.optional(customerAddressValidator),
      notes: v.optional(v.string()),
      totalSpent: v.optional(v.number()),
      transactionCount: v.optional(v.number()),
      lastTransactionAt: v.optional(v.number()),
      loyaltyPoints: v.optional(v.number()),
      preferredPaymentMethod: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => getCustomerByIdQuery(ctx, args),
});

export const createCustomer = mutation({
  args: {
    storeId: v.id("store"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(customerAddressValidator),
    notes: v.optional(v.string()),
  },
  returns: commandResultValidator(
    v.object({
      _id: v.id("posCustomer"),
      name: v.string(),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => createCustomerCommand(ctx, args),
});

export const updateCustomer = mutation({
  args: {
    customerId: v.id("posCustomer"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(customerAddressValidator),
    notes: v.optional(v.string()),
  },
  returns: commandResultValidator(v.null()),
  handler: async (ctx, args) => updateCustomerCommand(ctx, args),
});

export const updateCustomerStats = mutation({
  args: {
    customerId: v.id("posCustomer"),
    transactionAmount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => updateCustomerStatsCommand(ctx, args),
});

export const getCustomerTransactions = query({
  args: {
    customerId: v.id("posCustomer"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("posTransaction"),
      _creationTime: v.number(),
      transactionNumber: v.string(),
      total: v.number(),
      paymentMethod: v.optional(v.string()),
      status: v.string(),
      completedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => getCustomerTransactionsQuery(ctx, args),
});

export const linkToStoreFrontUser = mutation({
  args: {
    posCustomerId: v.id("posCustomer"),
    storeFrontUserId: v.id("storeFrontUser"),
  },
  returns: commandResultValidator(v.null()),
  handler: async (ctx, args) => linkToStoreFrontUserCommand(ctx, args),
});

export const linkToGuest = mutation({
  args: {
    posCustomerId: v.id("posCustomer"),
    guestId: v.id("guest"),
  },
  returns: commandResultValidator(v.null()),
  handler: async (ctx, args) => linkToGuestCommand(ctx, args),
});

export const findByStoreFrontUser = query({
  args: {
    storeFrontUserId: v.id("storeFrontUser"),
  },
  returns: v.union(
    v.object({
      _id: v.id("posCustomer"),
      _creationTime: v.number(),
      name: v.string(),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      totalSpent: v.optional(v.number()),
      transactionCount: v.optional(v.number()),
      linkedStoreFrontUserId: v.optional(v.id("storeFrontUser")),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => findByStoreFrontUserQuery(ctx, args),
});

export const findPotentialMatches = query({
  args: {
    storeId: v.id("store"),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  returns: v.object({
    storeFrontUsers: v.array(
      v.object({
        _id: v.id("storeFrontUser"),
        email: v.string(),
        firstName: v.optional(v.string()),
        lastName: v.optional(v.string()),
        phoneNumber: v.optional(v.string()),
      }),
    ),
    guests: v.array(
      v.object({
        _id: v.id("guest"),
        email: v.optional(v.string()),
        firstName: v.optional(v.string()),
        lastName: v.optional(v.string()),
        phoneNumber: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => findPotentialMatchesQuery(ctx, args),
});
