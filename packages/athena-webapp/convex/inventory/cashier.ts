import { query, mutation } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

const entity = "cashier";

export const getByStoreId = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.array(
    v.object({
      _id: v.id("cashier"),
      _creationTime: v.number(),
      firstName: v.string(),
      lastName: v.string(),
      pin: v.string(),
      username: v.string(),
      storeId: v.id("store"),
      organizationId: v.id("organization"),
      active: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    const cashiers = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    return cashiers;
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("cashier"),
      _creationTime: v.number(),
      firstName: v.string(),
      lastName: v.string(),
      username: v.string(),
      pin: v.string(),
      storeId: v.id("store"),
      organizationId: v.id("organization"),
      active: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Note: PIN validation is handled client-side using bcrypt.compare()
// The client fetches the cashier (including hashed PIN) and compares locally
// This ensures the plaintext PIN is never transmitted to the server

export const create = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    username: v.string(),
    pin: v.string(), // Hashed PIN from client
    storeId: v.id("store"),
    organizationId: v.id("organization"),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    cashier: v.optional(
      v.object({
        _id: v.id("cashier"),
        _creationTime: v.number(),
        firstName: v.string(),
        lastName: v.string(),
        username: v.string(),
        pin: v.string(),
        storeId: v.id("store"),
        organizationId: v.id("organization"),
        active: v.boolean(),
      })
    ),
  }),
  handler: async (ctx, args) => {
    // Validate required fields
    if (!args.firstName.trim() || !args.lastName.trim()) {
      return {
        success: false,
        error: "First name and last name are required",
      };
    }

    // PIN is already hashed client-side, just store it
    const cashierId = await ctx.db.insert(entity, {
      firstName: args.firstName.trim(),
      lastName: args.lastName.trim(),
      username: args.username.trim(),
      pin: args.pin, // Store hashed PIN
      storeId: args.storeId,
      organizationId: args.organizationId,
      active: true,
    });

    const cashier = await ctx.db.get(cashierId);

    return {
      success: true,
      cashier: cashier || undefined,
    };
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    username: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    pin: v.optional(v.string()), // Hashed PIN from client if provided
    active: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    cashier: v.optional(
      v.object({
        _id: v.id("cashier"),
        _creationTime: v.number(),
        firstName: v.string(),
        lastName: v.string(),
        username: v.string(),
        pin: v.string(),
        storeId: v.id("store"),
        organizationId: v.id("organization"),
        active: v.boolean(),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const cashier = await ctx.db.get(args.id);

    if (!cashier) {
      return {
        success: false,
        error: "Cashier not found",
      };
    }

    // Build update object
    const updates: Partial<{
      firstName: string;
      lastName: string;
      pin: string;
      username: string;
      active: boolean;
    }> = {};

    if (args.firstName !== undefined) {
      if (!args.firstName.trim()) {
        return {
          success: false,
          error: "First name cannot be empty",
        };
      }
      updates.firstName = args.firstName.trim();
    }

    if (args.lastName !== undefined) {
      if (!args.lastName.trim()) {
        return {
          success: false,
          error: "Last name cannot be empty",
        };
      }
      updates.lastName = args.lastName.trim();
    }

    if (args.username !== undefined) {
      if (!args.username.trim()) {
        return {
          success: false,
          error: "Username cannot be empty",
        };
      }
      updates.username = args.username.trim();
    }

    // PIN is already hashed client-side if provided
    if (args.pin !== undefined) {
      // PIN is already hashed by client before being sent
      updates.pin = args.pin;
    }

    if (args.active !== undefined) {
      updates.active = args.active;
    }

    await ctx.db.patch(args.id, updates);

    const updatedCashier = await ctx.db.get(args.id);

    return {
      success: true,
      cashier: updatedCashier || undefined,
    };
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const cashier = await ctx.db.get(args.id);

    if (!cashier) {
      return {
        success: false,
        error: "Cashier not found",
      };
    }

    // Soft delete by setting active to false
    await ctx.db.patch(args.id, { active: false });

    return {
      success: true,
    };
  },
});

export const authenticate = mutation({
  args: {
    username: v.string(),
    pin: v.string(), // Hashed PIN from client
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    cashier: v.optional(
      v.object({
        _id: v.id("cashier"),
        firstName: v.string(),
        lastName: v.string(),
        username: v.string(),
      })
    ),
  }),
  handler: async (ctx, args) => {
    console.log("Authenticating cashier", args);
    // Validate required fields
    if (!args.username.trim()) {
      return {
        success: false,
        error: "Username is required",
      };
    }

    if (!args.pin) {
      return {
        success: false,
        error: "PIN is required",
      };
    }

    // Find cashier by username and storeId using the index
    const cashiers = await ctx.db
      .query(entity)
      .withIndex("by_store_and_username", (q) =>
        q.eq("storeId", args.storeId).eq("username", args.username.trim())
      )
      .collect();

    if (cashiers.length === 0) {
      return {
        success: false,
        error: "Invalid username or PIN",
      };
    }

    const cashier = cashiers[0];

    // Verify the cashier is active
    if (!cashier.active) {
      return {
        success: false,
        error: "This cashier account is inactive",
      };
    }

    // Compare the hashed PIN with stored PIN
    // Both PINs are hashed, so we do a direct comparison
    if (cashier.pin !== args.pin) {
      return {
        success: false,
        error: "Invalid username or PIN",
      };
    }

    // Return cashier data without PIN
    return {
      success: true,
      cashier: {
        _id: cashier._id,
        firstName: cashier.firstName,
        lastName: cashier.lastName,
        username: cashier.username,
      },
    };
  },
});

export const checkUsernameAvailable = query({
  args: {
    storeId: v.id("store"),
    username: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existingCashiers = await ctx.db
      .query(entity)
      .withIndex("by_store_and_username", (q) =>
        q.eq("storeId", args.storeId).eq("username", args.username.trim())
      )
      .filter((q) => q.eq(q.field("active"), true))
      .collect();

    return existingCashiers.length === 0;
  },
});

export const signIn = mutation({
  args: {
    username: v.string(),
    pin: v.string(), // Hashed PIN from client
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    cashier: v.optional(
      v.object({
        _id: v.id("cashier"),
        firstName: v.string(),
        lastName: v.string(),
        username: v.string(),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const result = await authenticate(ctx, args);

    if (!result.success) {
      return result;
    }

    const now = Date.now();

    // Check for active sessions on OTHER terminals
    const loggedInSessions = await ctx.db
      .query("posSession")
      .withIndex("by_cashierId", (q) => q.eq("cashierId", result.cashier?._id))
      .filter((q) => q.gt(q.field("expiresAt"), now))
      .collect();

    // Filter for sessions on different terminals that have "active" status
    const activeSessionsOnOtherTerminals = loggedInSessions.filter(
      (session) =>
        session.terminalId !== args.terminalId && session.status === "active"
    );

    if (activeSessionsOnOtherTerminals.length > 0) {
      return {
        success: false as const,
        error: "This cashier has an active session on another terminal",
      };
    }

    return {
      success: true as const,
      cashier: result.cashier,
    };
  },
});
