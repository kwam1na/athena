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

const MAX_EXPENSE_SESSION_ITEMS = 200;
const EXPENSE_SESSION_QUERY_CANDIDATE_LIMIT = 200;
const ACTIVE_EXPENSE_SESSION_CANDIDATE_LIMIT = 100;
const EXPENSE_SESSION_CLEANUP_BATCH_SIZE = 100;

function buildNextExpenseSessionNumber(latestSessionNumber: string | undefined) {
  const lastSequence = latestSessionNumber
    ? Number.parseInt(latestSessionNumber.split("-").at(-1) ?? "0", 10)
    : 0;
  const nextSequence = Number.isFinite(lastSequence) ? lastSequence + 1 : 1;
  return `EXP-${String(nextSequence).padStart(3, "0")}`;
}

async function loadExpenseSessionItems(
  ctx: QueryCtx,
  sessionId: Id<"expenseSession">
) {
  const cartItemsRaw = await ctx.db
    .query("expenseSessionItem")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .take(MAX_EXPENSE_SESSION_ITEMS);

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

async function listExpenseSessionsByStatusBefore(
  ctx: MutationCtx,
  status: "active" | "void",
  expiresBefore: number
) {
  const sessions = [];
  let cursor: string | null = null;

  while (true) {
    const page = await ctx.db
      .query("expenseSession")
      .withIndex("by_status_and_expiresAt", (q) =>
        q.eq("status", status).lt("expiresAt", expiresBefore)
      )
      .paginate({ cursor, numItems: EXPENSE_SESSION_CLEANUP_BATCH_SIZE });

    sessions.push(...page.page);
    if (page.isDone) {
      break;
    }
    cursor = page.continueCursor;
  }

  return sessions;
}

// Get expense sessions for a store (with filtering)
export const getStoreExpenseSessions = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
    staffProfileId: v.optional(v.id("staffProfile")),
    status: v.optional(v.string()), // "active", "held", "completed", "void"
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("expenseSession"),
      _creationTime: v.number(),
      sessionNumber: v.string(),
      storeId: v.id("store"),
      staffProfileId: v.id("staffProfile"),
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
    const boundedLimit = Math.min(limit, EXPENSE_SESSION_QUERY_CANDIDATE_LIMIT);

    let sessionsQuery;
    let indexedTerminalFilter = false;
    let indexedStaffProfileFilter = false;

    if (status && args.terminalId) {
      indexedTerminalFilter = true;
      sessionsQuery = ctx.db
        .query("expenseSession")
        .withIndex("by_storeId_status_terminalId", (q) =>
          q
            .eq("storeId", storeId)
            .eq("status", status)
            .eq("terminalId", args.terminalId!)
        );
    } else if (status && args.staffProfileId) {
      indexedStaffProfileFilter = true;
      sessionsQuery = ctx.db
        .query("expenseSession")
        .withIndex("by_storeId_status_staffProfileId", (q) =>
          q
            .eq("storeId", storeId)
            .eq("status", status)
            .eq("staffProfileId", args.staffProfileId!)
        );
    } else if (args.terminalId) {
      indexedTerminalFilter = true;
      sessionsQuery = ctx.db
        .query("expenseSession")
        .withIndex("by_storeId_terminalId", (q) =>
          q.eq("storeId", storeId).eq("terminalId", args.terminalId!)
        );
    } else if (args.staffProfileId) {
      indexedStaffProfileFilter = true;
      sessionsQuery = ctx.db
        .query("expenseSession")
        .withIndex("by_storeId_staffProfileId", (q) =>
          q.eq("storeId", storeId).eq("staffProfileId", args.staffProfileId!)
        );
    } else if (status) {
      sessionsQuery = ctx.db
        .query("expenseSession")
        .withIndex("by_storeId_and_status", (q) =>
          q.eq("storeId", storeId).eq("status", status)
        );
    } else {
      sessionsQuery = ctx.db
        .query("expenseSession")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId));
    }

    let sessions = await sessionsQuery.order("desc").take(boundedLimit);

    if (args.terminalId && !indexedTerminalFilter) {
      sessions = sessions.filter(
        (session) => session.terminalId === args.terminalId
      );
    }

    if (args.staffProfileId && !indexedStaffProfileFilter) {
      sessions = sessions.filter(
        (session) => session.staffProfileId === args.staffProfileId
      );
    }

    sessions = sessions.slice(0, limit);

    // Enrich with cart items
    const enrichedSessions = await Promise.all(
      sessions.map(async (session) => {
        const cartItems = await loadExpenseSessionItems(ctx, session._id);

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
      staffProfileId: v.id("staffProfile"),
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
    const session = await ctx.db.get("expenseSession", args.sessionId);
    if (!session) return null;

    const cartItems = await loadExpenseSessionItems(ctx, session._id);

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
    staffProfileId: v.id("staffProfile"),
    registerNumber: v.optional(v.string()),
  },
  returns: createExpenseSessionResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const registerNumber = args.registerNumber || "1";

    const existingTerminalSessions = await ctx.db
      .query("expenseSession")
      .withIndex("by_storeId_status_terminalId", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", "active")
          .eq("terminalId", args.terminalId)
      )
      .take(ACTIVE_EXPENSE_SESSION_CANDIDATE_LIMIT);

    const nonExpiredTerminalSessions = existingTerminalSessions.filter(
      (session) => !session.expiresAt || session.expiresAt >= now
    );

    const existingSession = nonExpiredTerminalSessions.find(
      (session) => session.staffProfileId === args.staffProfileId
    );

    const staffProfileSessions = await ctx.db
      .query("expenseSession")
      .withIndex("by_staffProfileId_and_status", (q) =>
        q.eq("staffProfileId", args.staffProfileId).eq("status", "active")
      )
      .take(ACTIVE_EXPENSE_SESSION_CANDIDATE_LIMIT);

    const existingSessionOnDifferentTerminal = staffProfileSessions.find(
      (session) =>
        session.storeId === args.storeId &&
        session.terminalId !== args.terminalId &&
        (!session.expiresAt || session.expiresAt >= now)
    );

    if (existingSessionOnDifferentTerminal) {
      return {
        success: false as const,
        message:
          "A session is active for this staff profile on a different terminal",
      };
    }

    if (existingSession) {
      // Check if existing session has items
      const existingItems = await ctx.db
        .query("expenseSessionItem")
        .withIndex("by_sessionId", (q) =>
          q.eq("sessionId", existingSession._id)
        )
        .take(MAX_EXPENSE_SESSION_ITEMS);

      // Auto-hold the existing session if it has items
      if (existingItems.length) {
        await ctx.db.patch("expenseSession", existingSession._id, {
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

    const latestSession = await ctx.db
      .query("expenseSession")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .first();

    const sessionNumber = buildNextExpenseSessionNumber(
      latestSession?.sessionNumber
    );

    // Calculate session expiration time (5 minutes)
    const expiresAt = calculateExpenseSessionExpiration(now);

    const sessionId = await ctx.db.insert("expenseSession", {
      sessionNumber,
      storeId: args.storeId,
      staffProfileId: args.staffProfileId,
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
    staffProfileId: v.id("staffProfile"),
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
      args.staffProfileId
    );
    if (!validation.success) {
      const currentSession = await ctx.db.get("expenseSession", sessionId);
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
    await ctx.db.patch("expenseSession", sessionId, {
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
    staffProfileId: v.id("staffProfile"),
  },
  returns: expenseSessionResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();

    // Validate session can be modified
    const validation = await validateExpenseSessionModifiable(
      ctx.db,
      args.sessionId,
      args.staffProfileId
    );
    if (!validation.success) {
      return error(validation.message!);
    }

    // Get current session to access expiresAt
    const session = await ctx.db.get("expenseSession", args.sessionId);
    if (!session) {
      return error("Session not found");
    }

    // Keep inventory holds in place when suspending
    await ctx.db.patch("expenseSession", args.sessionId, {
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
    staffProfileId: v.id("staffProfile"),
    terminalId: v.id("posTerminal"),
  },
  returns: expenseSessionResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get the session
    const session = await ctx.db.get("expenseSession", args.sessionId);
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

    // Check that this staff profile does not have an active session on a different terminal
    const staffProfileSessions = await ctx.db
      .query("expenseSession")
      .withIndex("by_staffProfileId_and_status", (q) =>
        q.eq("staffProfileId", args.staffProfileId).eq("status", "active")
      )
      .take(ACTIVE_EXPENSE_SESSION_CANDIDATE_LIMIT);

    const activeSessionsOnOtherTerminals = staffProfileSessions.filter(
      (s) => s.expiresAt > now && s.terminalId !== args.terminalId
    );

    if (activeSessionsOnOtherTerminals.length > 0) {
      return error(
        "This staff profile has an active session on another terminal"
      );
    }

    // Reset expiration to new window
    const expiresAt = calculateExpenseSessionExpiration(now);

    // Update session status to active
    await ctx.db.patch("expenseSession", args.sessionId, {
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
    const session = await ctx.db.get("expenseSession", args.sessionId);
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
    await ctx.db.patch("expenseSession", args.sessionId, {
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
    const session = await ctx.db.get("expenseSession", args.sessionId);
    if (!session) {
      return error("Session not found");
    }

    // Query all items for this session
    const items = await ctx.db
      .query("expenseSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .take(MAX_EXPENSE_SESSION_ITEMS);

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
    await ctx.db.patch("expenseSession", args.sessionId, {
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
    const session = await ctx.db.get("expenseSession", args.sessionId);
    if (!session) {
      return error("Session not found");
    }

    // Query all items for this session
    const items = await ctx.db
      .query("expenseSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .take(MAX_EXPENSE_SESSION_ITEMS);

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
      itemIds.map((itemId) => ctx.db.delete("expenseSessionItem", itemId))
    );

    return { success: true as const, data: { sessionId: args.sessionId } };
  },
});

// Get active expense session for a register/staff profile
export const getActiveExpenseSession = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    staffProfileId: v.id("staffProfile"),
    registerNumber: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      _id: v.id("expenseSession"),
      _creationTime: v.number(),
      sessionNumber: v.string(),
      storeId: v.id("store"),
      staffProfileId: v.id("staffProfile"),
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
    const activeSessions = await ctx.db
      .query("expenseSession")
      .withIndex("by_storeId_status_staffProfileId", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", "active")
          .eq("staffProfileId", args.staffProfileId)
      )
      .order("desc")
      .take(ACTIVE_EXPENSE_SESSION_CANDIDATE_LIMIT);

    // Filter out expired sessions
    const nonExpiredSessions = activeSessions.filter(
      (session) => !session.expiresAt || session.expiresAt >= now
    );

    // Filter by staff profile and/or register if provided
    let filteredSessions = nonExpiredSessions;

    if (args.staffProfileId) {
      filteredSessions = filteredSessions.filter(
        (s) => s.staffProfileId === args.staffProfileId
      );
    }

    filteredSessions = filteredSessions.filter(
      (s) => s.terminalId === args.terminalId
    );

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

    const cartItems = await loadExpenseSessionItems(ctx, activeSession._id);

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
    const [expiredActiveSessions, expiredVoidSessions] = await Promise.all([
      listExpenseSessionsByStatusBefore(ctx, "active", now),
      listExpenseSessionsByStatusBefore(ctx, "void", now),
    ]);

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
          .take(MAX_EXPENSE_SESSION_ITEMS);

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
        await ctx.db.patch("expenseSession", session._id, {
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
