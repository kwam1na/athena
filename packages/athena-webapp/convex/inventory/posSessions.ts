import { v } from "convex/values";
import { mutation, query, internalMutation } from "../_generated/server";
import { api } from "../_generated/api";
import { Id } from "../_generated/dataModel";

// Get sessions for a store (with filtering)
export const getStoreSessions = query({
  args: {
    storeId: v.id("store"),
    status: v.optional(v.string()), // "active", "held", "completed", "void"
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { storeId, status, limit = 50 } = args;

    let sessionsQuery = ctx.db
      .query("posSession")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId));

    if (status) {
      sessionsQuery = ctx.db
        .query("posSession")
        .withIndex("by_storeId_and_status", (q) =>
          q.eq("storeId", storeId).eq("status", status)
        );
    }

    const sessions = await sessionsQuery.order("desc").take(limit);

    // Enrich with customer info and cart items if available
    const enrichedSessions = await Promise.all(
      sessions.map(async (session) => {
        let customer = null;
        if (session.customerId) {
          customer = await ctx.db.get(session.customerId);
        }

        // Get cart items from posSessionItem table
        const cartItems = await ctx.db
          .query("posSessionItem")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
          .collect();

        return {
          ...session,
          cartItems,
          customer,
        };
      })
    );

    return enrichedSessions;
  },
});

// Get a specific session by ID
export const getSessionById = query({
  args: { sessionId: v.id("posSession") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;

    // Get customer info if linked
    let customer = null;
    if (session.customerId) {
      customer = await ctx.db.get(session.customerId);
    }

    // Get cart items from posSessionItem table
    const cartItems = await ctx.db
      .query("posSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
      .collect();

    return {
      ...session,
      cartItems,
      customer,
    };
  },
});

// Create a new session
export const createSession = mutation({
  args: {
    storeId: v.id("store"),
    cashierId: v.optional(v.id("athenaUser")),
    registerNumber: v.optional(v.string()),
  },
  returns: v.object({
    sessionId: v.id("posSession"),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const registerNumber = args.registerNumber || "1";

    // Check for existing active session on this register and complete it
    const existingActiveSessions = await ctx.db
      .query("posSession")
      .withIndex("by_storeId_and_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "active")
      )
      .collect();

    // Filter by register number and close any existing active session
    const existingSession = existingActiveSessions.find(
      (s) => s.registerNumber === registerNumber
    );

    if (existingSession) {
      // Check if existing session has items by querying posSessionItem table
      const existingItems = await ctx.db
        .query("posSessionItem")
        .withIndex("by_sessionId", (q) =>
          q.eq("sessionId", existingSession._id)
        )
        .collect();

      // Auto-complete the existing session if it has no items, otherwise hold it
      if (existingItems.length === 0) {
        await ctx.db.patch(existingSession._id, {
          status: "completed",
          completedAt: now,
          updatedAt: now,
        });
      } else {
        await ctx.db.patch(existingSession._id, {
          status: "held",
          heldAt: now,
          updatedAt: now,
          holdReason: "Auto-held when new session started",
        });
      }
    }

    // Generate session number
    const sessionCount = await ctx.db
      .query("posSession")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    const sessionNumber = `SES-${String(sessionCount.length + 1).padStart(3, "0")}`;

    // Session expires in 20 minutes
    const sessionExpiry = 20 * 60 * 1000;
    const expiresAt = now + sessionExpiry;

    const sessionId = await ctx.db.insert("posSession", {
      sessionNumber,
      storeId: args.storeId,
      cashierId: args.cashierId,
      registerNumber,
      status: "active",
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });

    return { sessionId, expiresAt };
  },
});

// Update session metadata (customer info, totals)
// Note: Cart items are now managed via posSessionItems mutations
export const updateSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    customerId: v.optional(v.id("posCustomer")),
    customerInfo: v.optional(
      v.object({
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
      })
    ),
    subtotal: v.optional(v.number()),
    tax: v.optional(v.number()),
    total: v.optional(v.number()),
  },
  returns: v.object({
    sessionId: v.id("posSession"),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const { sessionId, ...updates } = args;
    const now = Date.now();

    // Get current session
    const currentSession = await ctx.db.get(sessionId);
    if (!currentSession) {
      throw new Error("Session not found");
    }

    // Prevent updating completed or void sessions (for audit integrity)
    if (
      currentSession.status === "completed" ||
      currentSession.status === "void"
    ) {
      console.warn(
        `Attempted to update ${currentSession.status} session ${sessionId}. Ignoring update.`
      );
      return { sessionId, expiresAt: currentSession.expiresAt };
    }

    // Extend session expiration time
    const sessionExpiry = 20 * 60 * 1000;
    const expiresAt = now + sessionExpiry;

    // Update session with new data
    await ctx.db.patch(sessionId, {
      ...updates,
      updatedAt: now,
      expiresAt,
    });

    return { sessionId, expiresAt };
  },
});

// Hold/suspend a session
export const holdSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    holdReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Keep inventory holds in place when suspending
    // DO NOT update expiresAt - let holds expire naturally if not resumed
    await ctx.db.patch(args.sessionId, {
      status: "held",
      heldAt: now,
      updatedAt: now,
      holdReason: args.holdReason,
    });

    return args.sessionId;
  },
});

// Resume a held session
export const resumeSession = mutation({
  args: {
    sessionId: v.id("posSession"),
  },
  returns: v.object({
    sessionId: v.id("posSession"),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get the session
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    // Query all items for this session
    const items = await ctx.db
      .query("posSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    // Validate all items still have available inventory
    // Calculate total quantities needed per SKU
    const requiredQuantities = new Map<string, number>();
    for (const item of items) {
      const currentQty = requiredQuantities.get(item.productSkuId) || 0;
      requiredQuantities.set(item.productSkuId, currentQty + item.quantity);
    }

    // Check availability and re-acquire holds if needed
    const unavailableItems: string[] = [];

    // Fetch all SKUs in parallel
    const skuEntries = Array.from(requiredQuantities.entries());
    const skuFetches = await Promise.all(
      skuEntries.map(([skuId]) => ctx.db.get(skuId as Id<"productSku">))
    );

    // Validate availability
    for (let i = 0; i < skuEntries.length; i++) {
      const [skuId, requiredQty] = skuEntries[i];
      const sku = skuFetches[i];

      if (!sku) {
        unavailableItems.push(`Product SKU ${skuId} not found`);
        continue;
      }

      // Type guard
      if (!("quantityAvailable" in sku) || !("sku" in sku)) {
        unavailableItems.push(`Invalid product SKU data for ${skuId}`);
        continue;
      }

      // Check if enough inventory is available
      if (sku.quantityAvailable < requiredQty) {
        const item = items.find(
          (item) => item.productSkuId === (skuId as Id<"productSku">)
        );
        const itemName = item?.productName || "Unknown Product";
        unavailableItems.push(
          `${itemName}: Available ${sku.quantityAvailable}, Need ${requiredQty}`
        );
      }
    }

    if (unavailableItems.length > 0) {
      throw new Error(
        `Cannot resume session - some items no longer available:\n${unavailableItems.join("\n")}`
      );
    }

    // Re-acquire holds in parallel (decrease quantityAvailable)
    await Promise.all(
      skuEntries.map(async ([skuId, requiredQty], i) => {
        const sku = skuFetches[i];
        if (
          sku &&
          "quantityAvailable" in sku &&
          typeof sku.quantityAvailable === "number"
        ) {
          await ctx.db.patch(skuId as Id<"productSku">, {
            quantityAvailable: sku.quantityAvailable - requiredQty,
          });
        }
      })
    );

    // Reset expiration to new 20-minute window
    const sessionExpiry = 20 * 60 * 1000;
    const expiresAt = now + sessionExpiry;

    await ctx.db.patch(args.sessionId, {
      status: "active",
      resumedAt: now,
      updatedAt: now,
      expiresAt,
    });

    return { sessionId: args.sessionId, expiresAt };
  },
});

// Complete a session (convert to transaction)
export const completeSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    paymentMethod: v.string(),
    amountPaid: v.number(),
    changeGiven: v.optional(v.number()),
    notes: v.optional(v.string()),
    // Explicitly save final transaction totals for audit integrity
    subtotal: v.number(),
    tax: v.number(),
    total: v.number(),
  },
  handler: async (ctx, args): Promise<string> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.status !== "active") {
      throw new Error("Can only complete active sessions");
    }

    // Mark session as completed and lock in final transaction totals
    // This ensures audit integrity by capturing exact values at completion time
    const now = Date.now();
    await ctx.db.patch(args.sessionId, {
      status: "completed",
      completedAt: now,
      updatedAt: now,
      notes: args.notes,
      // Save final transaction totals for audit trail
      subtotal: args.subtotal,
      tax: args.tax,
      total: args.total,
    });

    // Schedule the transaction creation to avoid circular dependencies
    await ctx.scheduler.runAfter(
      0,
      api.inventory.pos.createTransactionFromSession,
      {
        sessionId: args.sessionId,
        paymentMethod: args.paymentMethod,
        amountPaid: args.amountPaid,
        changeGiven: args.changeGiven,
        notes: args.notes,
      }
    );

    // Return the session ID since the transaction will be created asynchronously
    return args.sessionId;
  },
});

// Void a session
export const voidSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    voidReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get the session
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    // Query all items for this session
    const items = await ctx.db
      .query("posSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    // Release ALL inventory holds by restoring quantityAvailable
    // Calculate total quantities held per SKU
    const heldQuantities = new Map<Id<"productSku">, number>();
    for (const item of items) {
      const currentQty = heldQuantities.get(item.productSkuId) || 0;
      heldQuantities.set(item.productSkuId, currentQty + item.quantity);
    }

    // Restore quantityAvailable for each SKU in parallel
    await Promise.all(
      Array.from(heldQuantities.entries()).map(async ([skuId, quantity]) => {
        const sku = await ctx.db.get(skuId);
        if (
          sku &&
          "quantityAvailable" in sku &&
          typeof sku.quantityAvailable === "number"
        ) {
          await ctx.db.patch(skuId, {
            quantityAvailable: sku.quantityAvailable + quantity,
          });
        }
      })
    );

    // Delete all items for this session
    await Promise.all(items.map((item) => ctx.db.delete(item._id)));

    await ctx.db.patch(args.sessionId, {
      status: "void",
      updatedAt: now,
      notes: args.voidReason,
    });

    return args.sessionId;
  },
});

// Get active session for a register/cashier
export const getActiveSession = query({
  args: {
    storeId: v.id("store"),
    cashierId: v.optional(v.id("athenaUser")),
    registerNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("posSession")
      .withIndex("by_storeId_and_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "active")
      );

    const activeSessions = await query.collect();

    // Filter by cashier and/or register if provided
    let filteredSessions = activeSessions;

    if (args.cashierId) {
      filteredSessions = filteredSessions.filter(
        (s) => s.cashierId === args.cashierId
      );
    }

    if (args.registerNumber) {
      filteredSessions = filteredSessions.filter(
        (s) => s.registerNumber === args.registerNumber
      );
    }

    // Return the most recent active session
    const activeSession = filteredSessions.sort(
      (a, b) => b.updatedAt - a.updatedAt
    )[0];

    if (!activeSession) return null;

    // Get customer info if linked
    let customer = null;
    if (activeSession.customerId) {
      customer = await ctx.db.get(activeSession.customerId);
    }

    // Get cart items from posSessionItem table
    const cartItems = await ctx.db
      .query("posSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", activeSession._id))
      .collect();

    return {
      ...activeSession,
      cartItems,
      customer,
    };
  },
});

// Release inventory holds from expired sessions (called by cron job)
export const releasePosSessionItems = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find all active sessions that have expired
    const expiredSessions = await ctx.db
      .query("posSession")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    if (expiredSessions.length === 0) {
      console.log("[POS] No expired sessions found");
      return { releasedCount: 0, sessionIds: [] };
    }

    console.log(
      `[POS] Found ${expiredSessions.length} expired sessions to process`
    );

    const releasedSessionIds: string[] = [];

    // Process each expired session
    for (const session of expiredSessions) {
      try {
        // Query all items for this session from posSessionItem table
        const items = await ctx.db
          .query("posSessionItem")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
          .collect();

        // Calculate total quantities held per SKU
        const heldQuantities = new Map<Id<"productSku">, number>();
        for (const item of items) {
          const currentQty = heldQuantities.get(item.productSkuId) || 0;
          heldQuantities.set(item.productSkuId, currentQty + item.quantity);
        }

        // Restore quantityAvailable for each SKU
        const releasePromises = Array.from(heldQuantities.entries()).map(
          async ([skuId, quantity]) => {
            const sku = await ctx.db.get(skuId);
            if (sku && "quantityAvailable" in sku) {
              await ctx.db.patch(skuId, {
                quantityAvailable: sku.quantityAvailable + quantity,
              });
              console.log(`[POS] Released ${quantity} units for SKU ${skuId}`);
            }
          }
        );

        await Promise.all(releasePromises);

        // Delete all session items
        await Promise.all(items.map((item) => ctx.db.delete(item._id)));

        // Mark session as expired by changing status
        await ctx.db.patch(session._id, {
          status: "expired",
          updatedAt: now,
          notes: "Session expired - inventory holds released",
        });

        releasedSessionIds.push(session._id);
        console.log(
          `[POS] Released inventory holds for session ${session.sessionNumber}`
        );
      } catch (error) {
        console.error(`[POS] Error releasing session ${session._id}:`, error);
        // Continue processing other sessions even if one fails
      }
    }

    console.log(
      `[POS] Successfully released ${releasedSessionIds.length} sessions`
    );
    return {
      releasedCount: releasedSessionIds.length,
      sessionIds: releasedSessionIds,
    };
  },
});

// Clear old completed/void sessions (cleanup utility)
export const cleanupOldSessions = mutation({
  args: {
    storeId: v.id("store"),
    olderThanDays: v.optional(v.number()), // Default 30 days
  },
  handler: async (ctx, args) => {
    const cutoffTime =
      Date.now() - (args.olderThanDays || 30) * 24 * 60 * 60 * 1000;

    const oldSessions = await ctx.db
      .query("posSession")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) =>
        q.and(
          q.or(
            q.eq(q.field("status"), "completed"),
            q.eq(q.field("status"), "void"),
            q.eq(q.field("status"), "expired")
          ),
          q.lt(q.field("updatedAt"), cutoffTime)
        )
      )
      .collect();

    // Delete old sessions
    await Promise.all(oldSessions.map((session) => ctx.db.delete(session._id)));

    return oldSessions.length;
  },
});
