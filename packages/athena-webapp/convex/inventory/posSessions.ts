import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";
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
  createSessionResultValidator,
} from "./helpers/resultTypes";
import { calculateSessionExpiration } from "./helpers/sessionExpiration";
import { createTransactionFromSessionHandler } from "./pos";

const MAX_SESSION_ITEMS = 200;
const SESSION_QUERY_CANDIDATE_LIMIT = 200;
const ACTIVE_SESSION_CANDIDATE_LIMIT = 100;
const SESSION_CLEANUP_BATCH_SIZE = 100;

function buildNextSessionNumber(
  latestSessionNumber: string | undefined,
  prefix: string
) {
  const lastSequence = latestSessionNumber
    ? Number.parseInt(latestSessionNumber.split("-").at(-1) ?? "0", 10)
    : 0;
  const nextSequence = Number.isFinite(lastSequence) ? lastSequence + 1 : 1;
  return `${prefix}-${String(nextSequence).padStart(3, "0")}`;
}

async function loadPosSessionItems(ctx: QueryCtx, sessionId: Id<"posSession">) {
  const cartItemsRaw = await ctx.db
    .query("posSessionItem")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .take(MAX_SESSION_ITEMS);

  return Promise.all(
    cartItemsRaw.map(async (item) => {
      const sku = await ctx.db.get("productSku", item.productSkuId);
      let colorName: string | undefined;
      if (sku?.color) {
        const color = await ctx.db.get("color", sku.color);
        colorName = color?.name;
      }
      return {
        ...item,
        color: colorName,
      };
    })
  );
}

async function listPosSessionsByStatusBefore(
  ctx: MutationCtx,
  status: "active" | "void" | "held",
  expiresBefore: number
) {
  const sessions = [];
  let cursor: string | null = null;

  while (true) {
    const page = await ctx.db
      .query("posSession")
      .withIndex("by_status_and_expiresAt", (q) =>
        q.eq("status", status).lt("expiresAt", expiresBefore)
      )
      .paginate({ cursor, numItems: SESSION_CLEANUP_BATCH_SIZE });

    sessions.push(...page.page);
    if (page.isDone) {
      break;
    }
    cursor = page.continueCursor;
  }

  return sessions;
}

async function listPosSessionsForStoreStatus(
  ctx: MutationCtx,
  storeId: Id<"store">,
  status: "completed" | "void" | "expired"
) {
  const sessions = [];
  let cursor: string | null = null;

  while (true) {
    const page = await ctx.db
      .query("posSession")
      .withIndex("by_storeId_and_status", (q) =>
        q.eq("storeId", storeId).eq("status", status)
      )
      .paginate({ cursor, numItems: SESSION_CLEANUP_BATCH_SIZE });

    sessions.push(...page.page);
    if (page.isDone) {
      break;
    }
    cursor = page.continueCursor;
  }

  return sessions;
}

// Get sessions for a store (with filtering)
export const getStoreSessions = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
    cashierId: v.optional(v.id("cashier")),
    status: v.optional(v.string()), // "active", "held", "completed", "void"
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { storeId, status, limit = 50 } = args;
    const boundedLimit = Math.min(limit, SESSION_QUERY_CANDIDATE_LIMIT);

    let sessionsQuery;
    let indexedTerminalFilter = false;
    let indexedCashierFilter = false;

    if (status && args.terminalId) {
      indexedTerminalFilter = true;
      sessionsQuery = ctx.db
        .query("posSession")
        .withIndex("by_storeId_status_terminalId", (q) =>
          q
            .eq("storeId", storeId)
            .eq("status", status)
            .eq("terminalId", args.terminalId!)
        );
    } else if (status && args.cashierId) {
      indexedCashierFilter = true;
      sessionsQuery = ctx.db
        .query("posSession")
        .withIndex("by_storeId_status_cashierId", (q) =>
          q
            .eq("storeId", storeId)
            .eq("status", status)
            .eq("cashierId", args.cashierId!)
        );
    } else if (args.terminalId) {
      indexedTerminalFilter = true;
      sessionsQuery = ctx.db
        .query("posSession")
        .withIndex("by_storeId_terminalId", (q) =>
          q.eq("storeId", storeId).eq("terminalId", args.terminalId!)
        );
    } else if (args.cashierId) {
      indexedCashierFilter = true;
      sessionsQuery = ctx.db
        .query("posSession")
        .withIndex("by_storeId_cashierId", (q) =>
          q.eq("storeId", storeId).eq("cashierId", args.cashierId!)
        );
    } else if (status) {
      sessionsQuery = ctx.db
        .query("posSession")
        .withIndex("by_storeId_and_status", (q) =>
          q.eq("storeId", storeId).eq("status", status)
        );
    } else {
      sessionsQuery = ctx.db
        .query("posSession")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId));
    }

    let sessions = await sessionsQuery.order("desc").take(boundedLimit);

    if (args.terminalId && !indexedTerminalFilter) {
      sessions = sessions.filter(
        (session) => session.terminalId === args.terminalId
      );
    }

    if (args.cashierId && !indexedCashierFilter) {
      sessions = sessions.filter(
        (session) => session.cashierId === args.cashierId
      );
    }

    sessions = sessions.slice(0, limit);

    // Enrich with customer info and cart items if available
    const enrichedSessions = await Promise.all(
      sessions.map(async (session) => {
        let customer = null;
        if (session.customerId) {
          customer = await ctx.db.get("posCustomer", session.customerId);
        }

        const cartItems = await loadPosSessionItems(ctx, session._id);

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
    const session = await ctx.db.get("posSession", args.sessionId);
    if (!session) return null;

    // Get customer info if linked
    let customer = null;
    if (session.customerId) {
      customer = await ctx.db.get("posCustomer", session.customerId);
    }

    const cartItems = await loadPosSessionItems(ctx, session._id);

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
    cashierId: v.optional(v.id("cashier")),
    registerNumber: v.optional(v.string()),
  },
  returns: createSessionResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const registerNumber = args.registerNumber || "1";

    const existingTerminalSessions = await ctx.db
      .query("posSession")
      .withIndex("by_storeId_status_terminalId", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", "active")
          .eq("terminalId", args.terminalId)
      )
      .take(ACTIVE_SESSION_CANDIDATE_LIMIT);

    const nonExpiredTerminalSessions = existingTerminalSessions.filter(
      (session) => !session.expiresAt || session.expiresAt >= now
    );

    const existingSession = nonExpiredTerminalSessions.find(
      (session) => session.cashierId === args.cashierId
    );

    const cashierSessions = args.cashierId
      ? await ctx.db
          .query("posSession")
          .withIndex("by_cashierId_and_status", (q) =>
            q.eq("cashierId", args.cashierId!).eq("status", "active")
          )
          .take(ACTIVE_SESSION_CANDIDATE_LIMIT)
      : [];

    const existingSessionOnDifferentTerminal = cashierSessions.find(
      (session) =>
        session.storeId === args.storeId &&
        session.terminalId !== args.terminalId &&
        (!session.expiresAt || session.expiresAt >= now)
    );

    if (existingSessionOnDifferentTerminal) {
      return {
        success: false as const,
        message: "A session is active for this cashier on a different terminal",
      };
    }

    if (existingSession) {
      // Check if existing session has items by querying posSessionItem table
      const existingItems = await ctx.db
        .query("posSessionItem")
        .withIndex("by_sessionId", (q) =>
          q.eq("sessionId", existingSession._id)
        )
        .take(MAX_SESSION_ITEMS);

      // Auto-hold the existing session if it has items
      if (existingItems.length) {
        await ctx.db.patch("posSession", existingSession._id, {
          status: "held",
          heldAt: now,
          updatedAt: now,
          holdReason: "Auto-held when new session started",
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

    const latestSession = await ctx.db
      .query("posSession")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .first();

    const sessionNumber = buildNextSessionNumber(
      latestSession?.sessionNumber,
      "SES"
    );

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

    return { success: true as const, data: { sessionId, expiresAt } };
  },
});

// Update session metadata (customer info, totals)
// Note: Cart items are now managed via posSessionItems mutations
export const updateSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    cashierId: v.id("cashier"),
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
    const validation = await validateSessionModifiable(
      ctx.db,
      sessionId,
      args.cashierId
    );
    if (!validation.success) {
      // For completed/void sessions, return current state without update
      const currentSession = await ctx.db.get("posSession", sessionId);
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
    await ctx.db.patch("posSession", sessionId, {
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
    cashierId: v.id("cashier"),
    holdReason: v.optional(v.string()),
  },
  returns: sessionResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();

    // Validate session can be modified (checks expiration)
    const validation = await validateSessionModifiable(
      ctx.db,
      args.sessionId,
      args.cashierId
    );
    if (!validation.success) {
      return error(validation.message!);
    }

    // Get current session to access expiresAt
    const session = await ctx.db.get("posSession", args.sessionId);
    if (!session) {
      return error("Session not found");
    }

    // Keep inventory holds in place when suspending
    // DO NOT update expiresAt - let holds expire naturally if not resumed
    await ctx.db.patch("posSession", args.sessionId, {
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
    cashierId: v.id("cashier"),
    terminalId: v.id("posTerminal"),
  },
  returns: sessionResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get the session
    const session = await ctx.db.get("posSession", args.sessionId);
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
      .query("posSession")
      .withIndex("by_cashierId_and_status", (q) =>
        q.eq("cashierId", args.cashierId).eq("status", "active")
      )
      .take(ACTIVE_SESSION_CANDIDATE_LIMIT);

    const activeSessionsOnOtherTerminals = cashierSessions.filter(
      (s) => s.expiresAt > now && s.terminalId !== args.terminalId
    );

    if (activeSessionsOnOtherTerminals.length > 0) {
      return error("This cashier has an active session on another terminal");
    }

    // Reset expiration to new window
    const expiresAt = calculateSessionExpiration(now);

    // Update session status to active
    await ctx.db.patch("posSession", args.sessionId, {
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
    payments: v.array(
      v.object({
        method: v.string(), // "cash", "card", "mobile_money"
        amount: v.number(),
        timestamp: v.number(),
      })
    ),
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
        transactionNumber: v.string(),
      }),
    }),
    v.object({
      success: v.literal(false),
      message: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("posSession", args.sessionId);
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
    await ctx.db.patch("posSession", args.sessionId, {
      status: "completed",
      completedAt: now,
      updatedAt: now,
      notes: args.notes,
      // Save final transaction totals for audit trail
      subtotal: args.subtotal,
      tax: args.tax,
      total: args.total,
    });

    const { transactionNumber } = await createTransactionFromSessionHandler(ctx, {
      sessionId: args.sessionId,
      payments: args.payments,
      notes: args.notes,
    });

    // Return the session ID since the transaction will be created asynchronously
    return {
      success: true as const,
      data: {
        sessionId: args.sessionId,
        transactionNumber,
      },
    };
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
    const session = await ctx.db.get("posSession", args.sessionId);
    if (!session) {
      return error("Session not found");
    }

    // Query all items for this session
    const items = await ctx.db
      .query("posSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .take(MAX_SESSION_ITEMS);

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
    await ctx.db.patch("posSession", args.sessionId, {
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
    const session = await ctx.db.get("posSession", args.sessionId);
    if (!session) {
      return error("Session not found");
    }

    // Query all items for this session
    const items = await ctx.db
      .query("posSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .take(MAX_SESSION_ITEMS);

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
    await Promise.all(
      itemIds.map((itemId) => ctx.db.delete("posSessionItem", itemId))
    );

    return { success: true as const, data: { sessionId: args.sessionId } };
  },
});

// Get active session for a register/cashier
export const getActiveSession = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    cashierId: v.optional(v.id("cashier")),
    registerNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const activeSessions = args.cashierId
      ? await ctx.db
          .query("posSession")
          .withIndex("by_storeId_status_cashierId", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("status", "active")
              .eq("cashierId", args.cashierId!)
          )
          .order("desc")
          .take(ACTIVE_SESSION_CANDIDATE_LIMIT)
      : await ctx.db
          .query("posSession")
          .withIndex("by_storeId_status_terminalId", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("status", "active")
              .eq("terminalId", args.terminalId)
          )
          .order("desc")
          .take(ACTIVE_SESSION_CANDIDATE_LIMIT);

    // Filter out expired sessions (even if status is still "active")
    // This prevents returning sessions that expired but haven't been marked by cron yet
    const nonExpiredSessions = activeSessions.filter(
      (session) => !session.expiresAt || session.expiresAt >= now
    );

    // Filter by cashier and/or register if provided
    let filteredSessions = nonExpiredSessions;

    if (args.cashierId) {
      filteredSessions = filteredSessions.filter(
        (s) => s.terminalId === args.terminalId
      );
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
      customer = await ctx.db.get("posCustomer", activeSession.customerId);
    }

    const cartItems = await loadPosSessionItems(ctx, activeSession._id);

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
    const [expiredActiveSessions, expiredVoidSessions, expiredHeldSessions] =
      await Promise.all([
        listPosSessionsByStatusBefore(ctx, "active", now),
        listPosSessionsByStatusBefore(ctx, "void", now),
        listPosSessionsByStatusBefore(ctx, "held", now),
      ]);

    const expiredSessions = [
      ...expiredActiveSessions,
      ...expiredVoidSessions,
      ...expiredHeldSessions,
    ];

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
          .take(MAX_SESSION_ITEMS);

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
        await ctx.db.patch("posSession", session._id, {
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

    const oldSessions = (
      await Promise.all(
        ["completed", "void", "expired"].map((status) =>
          listPosSessionsForStoreStatus(
            ctx,
            args.storeId,
            status as "completed" | "void" | "expired"
          )
        )
      )
    )
      .flat()
      .filter((session) => session.updatedAt < cutoffTime);

    // Delete old sessions
    await Promise.all(
      oldSessions.map((session) => ctx.db.delete("posSession", session._id))
    );

    return oldSessions.length;
  },
});

export const expireAllSessionsForCashier = mutation({
  args: {
    cashierId: v.id("cashier"),
    terminalId: v.id("posTerminal"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [activeSessions, heldSessions] = await Promise.all([
      ctx.db
        .query("posSession")
        .withIndex("by_cashierId_and_status", (q) =>
          q.eq("cashierId", args.cashierId).eq("status", "active")
        )
        .take(ACTIVE_SESSION_CANDIDATE_LIMIT),
      ctx.db
        .query("posSession")
        .withIndex("by_cashierId_and_status", (q) =>
          q.eq("cashierId", args.cashierId).eq("status", "held")
        )
        .take(ACTIVE_SESSION_CANDIDATE_LIMIT),
    ]);
    const sessions = [...activeSessions, ...heldSessions];

    await Promise.all(
      sessions
        .filter((session) => session.terminalId !== args.terminalId)
        .map((session) =>
          ctx.db.patch("posSession", session._id, { expiresAt: now })
        )
    );

    return { success: true as const, data: { cashierId: args.cashierId } };
  },
});
