import { v } from "convex/values";
import { mutation, query, internalMutation } from "../_generated/server";
import { api } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  acquireInventoryHoldsBatch,
  releaseInventoryHoldsBatch,
  validateInventoryAvailability,
} from "./helpers/inventoryHolds";
import {
  validateSessionActive,
  validateSessionModifiable,
} from "./helpers/sessionValidation";
import {
  sessionOperationResultValidator,
  sessionResultValidator,
  sessionSuccess,
  error,
} from "./helpers/resultTypes";
import { calculateSessionExpiration } from "./helpers/sessionExpiration";

// Get sessions for a store (with filtering)
export const getStoreSessions = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
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

    let sessions = await sessionsQuery.order("desc").take(limit);

    if (args.terminalId) {
      sessions = sessions.filter(
        (session) => session.terminalId === args.terminalId
      );
    }

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
    terminalId: v.id("posTerminal"),
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

    // Filter out expired sessions (even if status is still "active")
    // Only consider truly active (non-expired) sessions for auto-hold/completion
    const nonExpiredActiveSessions = existingActiveSessions.filter(
      (session) => !session.expiresAt || session.expiresAt >= now
    );

    // Filter by terminal id and close any existing active session
    const existingSession = nonExpiredActiveSessions.find(
      (s) => s.terminalId === args.terminalId
    );

    if (existingSession) {
      // Check if existing session has items by querying posSessionItem table
      const existingItems = await ctx.db
        .query("posSessionItem")
        .withIndex("by_sessionId", (q) =>
          q.eq("sessionId", existingSession._id)
        )
        .collect();

      // Auto-hold the existing session if it has items
      if (existingItems.length) {
        await ctx.db.patch(existingSession._id, {
          status: "held",
          heldAt: now,
          updatedAt: now,
          holdReason: "Auto-held when new session started",
        });
      }

      return {
        sessionId: existingSession._id,
        expiresAt: existingSession.expiresAt,
      };
    }

    // Generate session number
    const sessionCount = await ctx.db
      .query("posSession")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    const sessionNumber = `SES-${String(sessionCount.length + 1).padStart(3, "0")}`;

    // Calculate session expiration time
    const expiresAt = calculateSessionExpiration(now);

    const sessionId = await ctx.db.insert("posSession", {
      sessionNumber,
      storeId: args.storeId,
      cashierId: args.cashierId,
      terminalId: args.terminalId,
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
  returns: sessionOperationResultValidator,
  handler: async (ctx, args) => {
    const { sessionId, ...updates } = args;
    const now = Date.now();

    // Validate session can be modified (not completed or void)
    const validation = await validateSessionModifiable(ctx.db, sessionId);
    if (!validation.success) {
      // For completed/void sessions, return current state without update
      const currentSession = await ctx.db.get(sessionId);
      console.warn(
        `Attempted to update ${currentSession?.status} session ${sessionId}. Ignoring update.`
      );
      return {
        sessionId,
        expiresAt: currentSession?.expiresAt || now,
      };
    }

    // Extend session expiration time
    const expiresAt = calculateSessionExpiration(now);

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
  returns: sessionResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();

    // Validate session can be modified (checks expiration)
    const validation = await validateSessionModifiable(ctx.db, args.sessionId);
    if (!validation.success) {
      return error(validation.message!);
    }

    // Get current session to access expiresAt
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return error("Session not found");
    }

    // Keep inventory holds in place when suspending
    // DO NOT update expiresAt - let holds expire naturally if not resumed
    await ctx.db.patch(args.sessionId, {
      status: "held",
      heldAt: now,
      updatedAt: now,
      holdReason: args.holdReason,
    });

    return sessionSuccess(args.sessionId, session.expiresAt);
  },
});

// Resume a held session
export const resumeSession = mutation({
  args: {
    sessionId: v.id("posSession"),
  },
  returns: sessionResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get the session
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return error("Session not found");
    }

    // Check if session has expired before resuming
    if (
      (session.expiresAt && session.expiresAt < now) ||
      session.status === "expired"
    ) {
      return error("This session has expired. Start a new one to proceed.");
    }

    // Query all items for this session
    // const items = await ctx.db
    //   .query("posSessionItem")
    //   .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
    //   .collect();

    // Calculate total quantities needed per SKU
    // const skuQuantities = new Map<
    //   Id<"productSku">,
    //   { quantity: number; name: string }
    // >();
    // for (const item of items) {
    //   const existing = skuQuantities.get(item.productSkuId);
    //   if (existing) {
    //     existing.quantity += item.quantity;
    //   } else {
    //     skuQuantities.set(item.productSkuId, {
    //       quantity: item.quantity,
    //       name: item.productName,
    //     });
    //   }
    // }

    // ONLY validate that inventory is still available
    // DO NOT acquire new holds - the holds are already in place from when session was held
    // Acquiring new holds would double-count the inventory (held once when session was suspended,
    // then held again on resume, causing incorrect stock levels)
    // const unavailableItems: string[] = [];
    // for (const [skuId, data] of skuQuantities.entries()) {
    //   const validation = await validateInventoryAvailability(
    //     ctx.db,
    //     skuId,
    //     data.quantity
    //   );
    //   if (!validation.success) {
    //     unavailableItems.push(
    //       `${data.name}: ${validation.message} (Available: ${validation.available || 0}, Need: ${data.quantity})`
    //     );
    //   }
    // }

    // if (unavailableItems.length > 0) {
    //   return error(
    //     `Cannot resume session - some items no longer available:\n${unavailableItems.join("\n")}`
    //   );
    // }

    // Reset expiration to new window
    const expiresAt = calculateSessionExpiration(now);

    // Update session status to active
    await ctx.db.patch(args.sessionId, {
      status: "active",
      resumedAt: now,
      updatedAt: now,
      expiresAt,
    });

    return sessionSuccess(args.sessionId, expiresAt);
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
  returns: v.union(
    v.object({
      success: v.literal(true),
      data: v.object({
        sessionId: v.id("posSession"),
      }),
    }),
    v.object({
      success: v.literal(false),
      message: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return error("Session not found");
    }

    // Check if session has expired before completing
    const now = Date.now();
    if (session.expiresAt && session.expiresAt < now) {
      return error("This session has expired. Start a new one to proceed.");
    }

    if (session.status !== "active") {
      return error("Can only complete active sessions");
    }

    // Mark session as completed and lock in final transaction totals
    // This ensures audit integrity by capturing exact values at completion time
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
    return { success: true as const, data: { sessionId: args.sessionId } };
  },
});

// Void a session
export const voidSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    voidReason: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      data: v.object({
        sessionId: v.id("posSession"),
      }),
    }),
    v.object({
      success: v.literal(false),
      message: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get the session
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return error("Session not found");
    }

    // Query all items for this session
    const items = await ctx.db
      .query("posSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    // Calculate total quantities held per SKU
    const heldQuantities = new Map<Id<"productSku">, number>();
    for (const item of items) {
      const currentQty = heldQuantities.get(item.productSkuId) || 0;
      heldQuantities.set(item.productSkuId, currentQty + item.quantity);
    }

    // Use batch helper to release all inventory holds
    const releaseItems = Array.from(heldQuantities.entries()).map(
      ([skuId, quantity]) => ({
        skuId,
        quantity,
      })
    );

    await releaseInventoryHoldsBatch(ctx.db, releaseItems);

    // Keep items for record-keeping - don't delete them
    // Items remain associated with voided session for audit trail

    // Mark session as void
    await ctx.db.patch(args.sessionId, {
      status: "void",
      updatedAt: now,
      notes: args.voidReason,
    });

    return { success: true as const, data: { sessionId: args.sessionId } };
  },
});

export const releaseSessionInventoryHoldsAndDeleteItems = mutation({
  args: {
    sessionId: v.id("posSession"),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      data: v.object({
        sessionId: v.id("posSession"),
      }),
    }),
    v.object({
      success: v.literal(false),
      message: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    // Get the session
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return error("Session not found");
    }

    // Query all items for this session
    const items = await ctx.db
      .query("posSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    // Calculate total quantities held per SKU
    const heldQuantities = new Map<Id<"productSku">, number>();
    for (const item of items) {
      const currentQty = heldQuantities.get(item.productSkuId) || 0;
      heldQuantities.set(item.productSkuId, currentQty + item.quantity);
    }

    // Use batch helper to release all inventory holds
    const releaseItems = Array.from(heldQuantities.entries()).map(
      ([skuId, quantity]) => ({
        skuId,
        quantity,
      })
    );

    await releaseInventoryHoldsBatch(ctx.db, releaseItems);

    // Delete all items for this session
    const itemIds = items.map((item) => item._id);
    await Promise.all(itemIds.map((itemId) => ctx.db.delete(itemId)));

    return { success: true as const, data: { sessionId: args.sessionId } };
  },
});

// Get active session for a register/cashier
export const getActiveSession = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    cashierId: v.optional(v.id("athenaUser")),
    registerNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let query = ctx.db
      .query("posSession")
      .withIndex("by_storeId_and_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "active")
      );

    const activeSessions = await query.collect();

    // Filter out expired sessions (even if status is still "active")
    // This prevents returning sessions that expired but haven't been marked by cron yet
    const nonExpiredSessions = activeSessions.filter(
      (session) => !session.expiresAt || session.expiresAt >= now
    );

    // Filter by cashier and/or register if provided
    let filteredSessions = nonExpiredSessions;

    if (args.cashierId) {
      filteredSessions = filteredSessions.filter(
        (s) => s.cashierId === args.cashierId
      );
    }

    if (args.registerNumber) {
      filteredSessions = filteredSessions.filter(
        (s) => s.terminalId === args.terminalId
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

    // Find all active and void sessions that have expired
    const expiredActiveSessions = await ctx.db
      .query("posSession")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    const expiredVoidSessions = await ctx.db
      .query("posSession")
      .withIndex("by_status", (q) => q.eq("status", "void"))
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    const expiredSessions = [...expiredActiveSessions, ...expiredVoidSessions];

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

        // Use batch helper to release all inventory holds
        const releaseItems = Array.from(heldQuantities.entries()).map(
          ([skuId, quantity]) => ({
            skuId,
            quantity,
          })
        );

        await releaseInventoryHoldsBatch(ctx.db, releaseItems);
        console.log(
          `[POS] Released inventory holds for ${releaseItems.length} SKUs`
        );

        // Keep items for record-keeping - don't delete them
        // Items remain associated with expired session for audit trail

        // Mark session as expired
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
