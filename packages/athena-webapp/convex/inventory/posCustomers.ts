import { query, mutation } from "../_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";

// Search customers by name, email, or phone
export const searchCustomers = query({
  args: {
    storeId: v.id("store"),
    searchQuery: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("posCustomer"),
      _creationTime: v.number(),
      name: v.string(),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      totalSpent: v.optional(v.number()),
      transactionCount: v.optional(v.number()),
      lastTransactionAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    if (!args.searchQuery.trim()) {
      return [];
    }

    const searchTerm = args.searchQuery.toLowerCase().trim();

    // Get all customers for the store and filter by search term
    const customers = await ctx.db
      .query("posCustomer")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    // Filter customers by search term (name, email, or phone)
    const filteredCustomers = customers.filter((customer) => {
      const nameMatch = customer.name.toLowerCase().includes(searchTerm);
      const emailMatch =
        customer.email?.toLowerCase().includes(searchTerm) || false;
      const phoneMatch = customer.phone?.includes(searchTerm) || false;

      return nameMatch || emailMatch || phoneMatch;
    });

    // Return limited results with necessary fields
    return filteredCustomers.slice(0, 10).map((customer) => ({
      _id: customer._id,
      _creationTime: customer._creationTime,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      totalSpent: customer.totalSpent || 0,
      transactionCount: customer.transactionCount || 0,
      lastTransactionAt: customer.lastTransactionAt,
    }));
  },
});

// Get customer by ID
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
      address: v.optional(
        v.object({
          street: v.optional(v.string()),
          city: v.optional(v.string()),
          state: v.optional(v.string()),
          zipCode: v.optional(v.string()),
          country: v.optional(v.string()),
        })
      ),
      notes: v.optional(v.string()),
      totalSpent: v.optional(v.number()),
      transactionCount: v.optional(v.number()),
      lastTransactionAt: v.optional(v.number()),
      loyaltyPoints: v.optional(v.number()),
      preferredPaymentMethod: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.customerId);
  },
});

// Create new customer
export const createCustomer = mutation({
  args: {
    storeId: v.id("store"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(
      v.object({
        street: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        zipCode: v.optional(v.string()),
        country: v.optional(v.string()),
      })
    ),
    notes: v.optional(v.string()),
  },
  returns: v.object({
    _id: v.id("posCustomer"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Check if customer already exists with same email or phone
    if (args.email) {
      const existingByEmail = await ctx.db
        .query("posCustomer")
        .withIndex("by_storeId_and_email", (q) =>
          q.eq("storeId", args.storeId).eq("email", args.email)
        )
        .first();

      if (existingByEmail) {
        throw new Error("Customer with this email already exists");
      }
    }

    if (args.phone) {
      const existingByPhone = await ctx.db
        .query("posCustomer")
        .withIndex("by_storeId_and_phone", (q) =>
          q.eq("storeId", args.storeId).eq("phone", args.phone)
        )
        .first();

      if (existingByPhone) {
        throw new Error("Customer with this phone number already exists");
      }
    }

    const customerId = await ctx.db.insert("posCustomer", {
      storeId: args.storeId,
      name: args.name,
      email: args.email,
      phone: args.phone,
      address: args.address,
      notes: args.notes,
      totalSpent: 0,
      transactionCount: 0,
      loyaltyPoints: 0,
      isActive: true,
    });

    const customer = await ctx.db.get(customerId);

    return {
      _id: customer!._id,
      name: customer!.name,
      email: customer!.email,
      phone: customer!.phone,
    };
  },
});

// Update customer information
export const updateCustomer = mutation({
  args: {
    customerId: v.id("posCustomer"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(
      v.object({
        street: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        zipCode: v.optional(v.string()),
        country: v.optional(v.string()),
      })
    ),
    notes: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const updates: Partial<Doc<"posCustomer">> = {};

    if (args.name) updates.name = args.name;
    if (args.email) updates.email = args.email;
    if (args.phone) updates.phone = args.phone;
    if (args.address) updates.address = args.address;
    if (args.notes) updates.notes = args.notes;

    await ctx.db.patch(args.customerId, updates);
    return null;
  },
});

// Update customer transaction stats (called after completing a transaction)
export const updateCustomerStats = mutation({
  args: {
    customerId: v.id("posCustomer"),
    transactionAmount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;

    await ctx.db.patch(args.customerId, {
      totalSpent: (customer.totalSpent || 0) + args.transactionAmount,
      transactionCount: (customer.transactionCount || 0) + 1,
      lastTransactionAt: Date.now(),
    });

    return null;
  },
});

// Get customer transaction history
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
      paymentMethod: v.string(),
      status: v.string(),
      completedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return [];

    const transactions = await ctx.db
      .query("posTransaction")
      .withIndex("by_storeId", (q) => q.eq("storeId", customer.storeId))
      .filter((q) =>
        q.and(
          q.eq(q.field("customerId"), args.customerId),
          q.eq(q.field("status"), "completed")
        )
      )
      .order("desc")
      .take(args.limit || 10);

    return transactions.map((transaction) => ({
      _id: transaction._id,
      _creationTime: transaction._creationTime,
      transactionNumber: transaction.transactionNumber,
      total: transaction.total,
      paymentMethod: transaction.paymentMethod,
      status: transaction.status,
      completedAt: transaction.completedAt,
    }));
  },
});

// Link POS customer to existing storefront user
export const linkToStoreFrontUser = mutation({
  args: {
    posCustomerId: v.id("posCustomer"),
    storeFrontUserId: v.id("storeFrontUser"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const posCustomer = await ctx.db.get(args.posCustomerId);
    const storeFrontUser = await ctx.db.get(args.storeFrontUserId);

    if (!posCustomer || !storeFrontUser) {
      throw new Error("Customer or storefront user not found");
    }

    // Check if storefront user is already linked to another POS customer
    const existingLink = await ctx.db
      .query("posCustomer")
      .withIndex("by_linkedStoreFrontUserId", (q) =>
        q.eq("linkedStoreFrontUserId", args.storeFrontUserId)
      )
      .first();

    if (existingLink && existingLink._id !== args.posCustomerId) {
      throw new Error(
        "This storefront user is already linked to another POS customer"
      );
    }

    await ctx.db.patch(args.posCustomerId, {
      linkedStoreFrontUserId: args.storeFrontUserId,
      // Optionally update contact info from storefront user
      email: storeFrontUser.email,
      phone: storeFrontUser.phoneNumber || posCustomer.phone,
    });

    return null;
  },
});

// Link POS customer to existing guest
export const linkToGuest = mutation({
  args: {
    posCustomerId: v.id("posCustomer"),
    guestId: v.id("guest"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const posCustomer = await ctx.db.get(args.posCustomerId);
    const guest = await ctx.db.get(args.guestId);

    if (!posCustomer || !guest) {
      throw new Error("Customer or guest not found");
    }

    await ctx.db.patch(args.posCustomerId, {
      linkedGuestId: args.guestId,
      // Optionally update contact info from guest
      email: guest.email || posCustomer.email,
      phone: guest.phoneNumber || posCustomer.phone,
    });

    return null;
  },
});

// Find POS customer by storefront user
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
    v.null()
  ),
  handler: async (ctx, args) => {
    const posCustomer = await ctx.db
      .query("posCustomer")
      .withIndex("by_linkedStoreFrontUserId", (q) =>
        q.eq("linkedStoreFrontUserId", args.storeFrontUserId)
      )
      .first();

    if (!posCustomer) return null;

    return {
      _id: posCustomer._id,
      _creationTime: posCustomer._creationTime,
      name: posCustomer.name,
      email: posCustomer.email,
      phone: posCustomer.phone,
      totalSpent: posCustomer.totalSpent,
      transactionCount: posCustomer.transactionCount,
      linkedStoreFrontUserId: posCustomer.linkedStoreFrontUserId,
    };
  },
});

// Search for potential matches when creating POS customer
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
      })
    ),
    guests: v.array(
      v.object({
        _id: v.id("guest"),
        email: v.optional(v.string()),
        firstName: v.optional(v.string()),
        lastName: v.optional(v.string()),
        phoneNumber: v.optional(v.string()),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const results = {
      storeFrontUsers: [] as any[],
      guests: [] as any[],
    };

    // Search storefront users by email
    if (args.email) {
      const storeFrontUser = await ctx.db
        .query("storeFrontUser")
        .filter((q) =>
          q.and(
            q.eq(q.field("storeId"), args.storeId),
            q.eq(q.field("email"), args.email)
          )
        )
        .first();

      if (storeFrontUser) {
        results.storeFrontUsers.push({
          _id: storeFrontUser._id,
          email: storeFrontUser.email,
          firstName: storeFrontUser.firstName,
          lastName: storeFrontUser.lastName,
          phoneNumber: storeFrontUser.phoneNumber,
        });
      }

      // Search guests by email
      const guest = await ctx.db
        .query("guest")
        .filter((q) =>
          q.and(
            q.eq(q.field("storeId"), args.storeId),
            q.eq(q.field("email"), args.email)
          )
        )
        .first();

      if (guest) {
        results.guests.push({
          _id: guest._id,
          email: guest.email,
          firstName: guest.firstName,
          lastName: guest.lastName,
          phoneNumber: guest.phoneNumber,
        });
      }
    }

    // Search by phone if no email matches found
    if (
      args.phone &&
      results.storeFrontUsers.length === 0 &&
      results.guests.length === 0
    ) {
      const storeFrontUserByPhone = await ctx.db
        .query("storeFrontUser")
        .filter((q) =>
          q.and(
            q.eq(q.field("storeId"), args.storeId),
            q.eq(q.field("phoneNumber"), args.phone)
          )
        )
        .first();

      if (storeFrontUserByPhone) {
        results.storeFrontUsers.push({
          _id: storeFrontUserByPhone._id,
          email: storeFrontUserByPhone.email,
          firstName: storeFrontUserByPhone.firstName,
          lastName: storeFrontUserByPhone.lastName,
          phoneNumber: storeFrontUserByPhone.phoneNumber,
        });
      }

      const guestByPhone = await ctx.db
        .query("guest")
        .filter((q) =>
          q.and(
            q.eq(q.field("storeId"), args.storeId),
            q.eq(q.field("phoneNumber"), args.phone)
          )
        )
        .first();

      if (guestByPhone) {
        results.guests.push({
          _id: guestByPhone._id,
          email: guestByPhone.email,
          firstName: guestByPhone.firstName,
          lastName: guestByPhone.lastName,
          phoneNumber: guestByPhone.phoneNumber,
        });
      }
    }

    return results;
  },
});
