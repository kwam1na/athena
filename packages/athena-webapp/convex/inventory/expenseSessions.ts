import { v } from "convex/values";
import { mutation, query, internalMutation } from "../_generated/server";
import { api } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  acquireInventoryHoldsBatch,
  releaseInventoryHoldsBatch,
} from "./helpers/inventoryHolds";
import {
  validateExpenseSessionActive,
  validateExpenseSessionModifiable,
} from "./helpers/expenseSessionValidation";
import {
  expenseSessionOperationResultValidator,
  expenseSessionResultValidator,
  expenseSessionSuccess,
  error,
  createExpenseSessionResultValidator,
} from "./helpers/resultTypes";
import { calculateExpenseSessionExpiration } from "./helpers/expenseSessionExpiration";
import { internal } from "../_generated/api";

// Get expense sessions for a store (with filtering)
export const getStoreExpenseSessions = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
    cashierId: v.optional(v.id("cashier")),
    status: v.optional(v.string()), // "active", "held", "completed", "void"
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("expenseSession"),
      _creationTime: v.number(),
      sessionNumber: v.string(),
      storeId: v.id("store"),
      cashierId: v.id("cashier"),
      terminalId: v.id("posTerminal"),
      registerNumber: v.optional(v.string()),
      status: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
      expiresAt: v.number(),
      heldAt: v.optional(v.number()),
      resumedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      notes: v.optional(v.string()),
      cartItems: v.array(v.any()),
    })
  ),
  handler: async (ctx, args) => {
    const { storeId, status, limit = 50 } = args;

    let sessionsQuery = ctx.db
      .query("expenseSession")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId));

    if (status) {
      sessionsQuery = ctx.db
        .query("expenseSession")
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

    if (args.cashierId) {
      sessions = sessions.filter(
        (session) => session.cashierId === args.cashierId
      );
    }

    // Enrich with cart items
    const enrichedSessions = await Promise.all(
      sessions.map(async (session) => {
        // Get cart items from expenseSessionItem table and enrich with color from SKU
        const cartItemsRaw = await ctx.db
          .query("expenseSessionItem")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
          .collect();

        const cartItems = await Promise.all(
          cartItemsRaw.map(async (item) => {
            // Fetch SKU to get color
            const sku = await ctx.db.get(item.productSkuId);
            let colorName: string | undefined;
            if (sku?.color) {
              const color = await ctx.db.get(sku.color);
              colorName = color?.name;
            }
            return {
              ...item,
              color: colorName,
            };
          })
        );

        return {
          ...session,
          cartItems,
        };
      })
    );

    return enrichedSessions;
  },
});

// Get a specific expense session by ID
export const getExpenseSessionById = query({
  args: { sessionId: v.id("expenseSession") },
  returns: v.union(
    v.object({
      _id: v.id("expenseSession"),
      _creationTime: v.number(),
      sessionNumber: v.string(),
      storeId: v.id("store"),
      cashierId: v.id("cashier"),
      terminalId: v.id("posTerminal"),
      registerNumber: v.optional(v.string()),
      status: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
      expiresAt: v.number(),
      heldAt: v.optional(v.number()),
      resumedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      notes: v.optional(v.string()),
      cartItems: v.array(v.any()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;

    // Get cart items from expenseSessionItem table
    const cartItems = await ctx.db
      .query("expenseSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
      .collect();

    return {
      ...session,
      cartItems,
    };
  },
});

// Create a new expense session
export const createExpenseSession = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    cashierId: v.id("cashier"),
    registerNumber: v.optional(v.string()),
  },
  returns: createExpenseSessionResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const registerNumber = args.registerNumber || "1";

    // Check for existing active session on this register
    const existingActiveSessions = await ctx.db
      .query("expenseSession")
      .withIndex("by_storeId_and_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "active")
      )
      .collect();

    // Filter out expired sessions
    const nonExpiredActiveSessions = existingActiveSessions.filter(
      (session) => !session.expiresAt || session.expiresAt >= now
    );

    // Filter by terminal id and cashier
    const existingSession = nonExpiredActiveSessions.find(
      (s) => s.terminalId === args.terminalId && s.cashierId === args.cashierId
    );

    const existingSessionOnDifferentTerminal = nonExpiredActiveSessions.find(
      (s) => s.terminalId !== args.terminalId && s.cashierId === args.cashierId
    );

    if (existingSessionOnDifferentTerminal) {
      return {
        success: false as const,
        message: "A session is active for this cashier on a different terminal",
      };
    }

    if (existingSession) {
      // Check if existing session has items
      const existingItems = await ctx.db
        .query("expenseSessionItem")
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
        });
      }

      return {
        success: true as const,
        data: {
          sessionId: existingSession._id,
          expiresAt: existingSession.expiresAt,
        },
      };
    }

    // Generate session number
    const sessionCount = await ctx.db
      .query("expenseSession")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    const sessionNumber = `EXP-${String(sessionCount.length + 1).padStart(3, "0")}`;

    // Calculate session expiration time (5 minutes)
    const expiresAt = calculateExpenseSessionExpiration(now);

    const sessionId = await ctx.db.insert("expenseSession", {
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

    return { success: true as const, data: { sessionId, expiresAt } };
  },
});

// Update expense session metadata (notes)
export const updateExpenseSession = mutation({
  args: {
    sessionId: v.id("expenseSession"),
    cashierId: v.id("cashier"),
    notes: v.optional(v.string()),
  },
  returns: expenseSessionOperationResultValidator,
  handler: async (ctx, args) => {
    const { sessionId, ...updates } = args;
    const now = Date.now();

    // Validate session can be modified
    const validation = await validateExpenseSessionModifiable(
      ctx.db,
      sessionId,
      args.cashierId
    );
    if (!validation.success) {
      const currentSession = await ctx.db.get(sessionId);
      console.warn(
        `Attempted to update ${currentSession?.status} expense session ${sessionId}. Ignoring update.`
      );
      return {
        sessionId,
        expiresAt: currentSession?.expiresAt || now,
      };
    }

    // Extend session expiration time
    const expiresAt = calculateExpenseSessionExpiration(now);

    // Update session with new data
    await ctx.db.patch(sessionId, {
      ...updates,
      updatedAt: now,
      expiresAt,
    });

    return { sessionId, expiresAt };
  },
});

// Hold/suspend an expense session
export const holdExpenseSession = mutation({
  args: {
    sessionId: v.id("expenseSession"),
    cashierId: v.id("cashier"),
  },
  returns: expenseSessionResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();

    // Validate session can be modified
    const validation = await validateExpenseSessionModifiable(
      ctx.db,
      args.sessionId,
      args.cashierId
    );
    if (!validation.success) {
      return error(validation.message!);
    }

    // Get current session to access expiresAt
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return error("Session not found");
    }

    // Keep inventory holds in place when suspending
    await ctx.db.patch(args.sessionId, {
      status: "held",
      heldAt: now,
      updatedAt: now,
    });

    return expenseSessionSuccess(args.sessionId, session.expiresAt);
  },
});

// Resume a held expense session
export const resumeExpenseSession = mutation({
  args: {
    sessionId: v.id("expenseSession"),
    cashierId: v.id("cashier"),
    terminalId: v.id("posTerminal"),
  },
  returns: expenseSessionResultValidator,
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

    // Check that this cashier does not have an active session on a different terminal
    const cashierSessions = await ctx.db
      .query("expenseSession")
      .withIndex("by_cashierId", (q) => q.eq("cashierId", args.cashierId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    const activeSessionsOnOtherTerminals = cashierSessions.filter(
      (s) => s.expiresAt > now && s.terminalId !== args.terminalId
    );

    if (activeSessionsOnOtherTerminals.length > 0) {
      return error("This cashier has an active session on another terminal");
    }

    // Reset expiration to new window
    const expiresAt = calculateExpenseSessionExpiration(now);

    // Update session status to active
    await ctx.db.patch(args.sessionId, {
      status: "active",
      resumedAt: now,
      updatedAt: now,
      expiresAt,
    });

    return expenseSessionSuccess(args.sessionId, expiresAt);
  },
});

// Complete an expense session (convert to transaction)
export const completeExpenseSession = mutation({
  args: {
    sessionId: v.id("expenseSession"),
    notes: v.optional(v.string()),
    totalValue: v.number(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      data: v.object({
        sessionId: v.id("expenseSession"),
        transactionNumber: v.string(),
      }),
    }),
    v.object({
      success: v.literal(false),
      message: v.string(),
    })
  ),
  handler: async (
    ctx,
    args
  ): Promise<
    | {
        success: true;
        data: { sessionId: Id<"expenseSession">; transactionNumber: string };
      }
    | { success: false; message: string }
  > => {
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

    // Mark session as completed
    await ctx.db.patch(args.sessionId, {
      status: "completed",
      completedAt: now,
      updatedAt: now,
      notes: args.notes,
    });

    // Create transaction from session
    const transactionResult: { transactionNumber: string } =
      await ctx.runMutation(
        internal.inventory.expenseTransactions.createTransactionFromSession,
        {
          sessionId: args.sessionId,
          notes: args.notes,
        }
      );

    return {
      success: true as const,
      data: {
        sessionId: args.sessionId,
        transactionNumber: transactionResult.transactionNumber,
      },
    };
  },
});

// Void an expense session
export const voidExpenseSession = mutation({
  args: {
    sessionId: v.id("expenseSession"),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      data: v.object({
        sessionId: v.id("expenseSession"),
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
      .query("expenseSessionItem")
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

    // Mark session as void
    await ctx.db.patch(args.sessionId, {
      status: "void",
      updatedAt: now,
    });

    return { success: true as const, data: { sessionId: args.sessionId } };
  },
});

export const releaseExpenseSessionInventoryHoldsAndDeleteItems = mutation({
  args: {
    sessionId: v.id("expenseSession"),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      data: v.object({
        sessionId: v.id("expenseSession"),
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
      .query("expenseSessionItem")
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

// Get active expense session for a register/cashier
export const getActiveExpenseSession = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    cashierId: v.id("cashier"),
    registerNumber: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      _id: v.id("expenseSession"),
      _creationTime: v.number(),
      sessionNumber: v.string(),
      storeId: v.id("store"),
      cashierId: v.id("cashier"),
      terminalId: v.id("posTerminal"),
      registerNumber: v.optional(v.string()),
      status: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
      expiresAt: v.number(),
      heldAt: v.optional(v.number()),
      resumedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      notes: v.optional(v.string()),
      cartItems: v.array(v.any()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    let query = ctx.db
      .query("expenseSession")
      .withIndex("by_storeId_and_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "active")
      );

    const activeSessions = await query.collect();

    // Filter out expired sessions
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

    // Get cart items from expenseSessionItem table
    const cartItems = await ctx.db
      .query("expenseSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", activeSession._id))
      .collect();

    return {
      ...activeSession,
      cartItems,
    };
  },
});

// Release inventory holds from expired expense sessions (called by cron job)
export const releaseExpenseSessionItems = internalMutation({
  args: {},
  returns: v.object({
    releasedCount: v.number(),
    sessionIds: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const now = Date.now();

    // Find all active and void sessions that have expired
    const expiredActiveSessions = await ctx.db
      .query("expenseSession")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    const expiredVoidSessions = await ctx.db
      .query("expenseSession")
      .withIndex("by_status", (q) => q.eq("status", "void"))
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    const expiredSessions = [...expiredActiveSessions, ...expiredVoidSessions];

    if (expiredSessions.length === 0) {
      console.log("[Expense] No expired sessions found");
      return { releasedCount: 0, sessionIds: [] };
    }

    console.log(
      `[Expense] Found ${expiredSessions.length} expired sessions to process`
    );

    const releasedSessionIds: string[] = [];

    // Process each expired session
    for (const session of expiredSessions) {
      try {
        // Query all items for this session
        const items = await ctx.db
          .query("expenseSessionItem")
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
          `[Expense] Released inventory holds for ${releaseItems.length} SKUs`
        );

        // Mark session as expired
        await ctx.db.patch(session._id, {
          status: "expired",
          updatedAt: now,
        });

        releasedSessionIds.push(session._id);
        console.log(
          `[Expense] Released inventory holds for session ${session.sessionNumber}`
        );
      } catch (error) {
        console.error(
          `[Expense] Error releasing session ${session._id}:`,
          error
        );
        // Continue processing other sessions even if one fails
      }
    }

    console.log(
      `[Expense] Successfully released ${releasedSessionIds.length} sessions`
    );
    return {
      releasedCount: releasedSessionIds.length,
      sessionIds: releasedSessionIds,
    };
  },
});
