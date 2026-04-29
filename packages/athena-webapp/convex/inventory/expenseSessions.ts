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
import { calculateExpenseSessionExpiration } from "./helpers/expenseSessionExpiration";
import { commandResultValidator } from "../lib/commandResultValidators";
import { ok, userError } from "../../shared/commandResult";
import { createExpenseTransactionFromSessionHandler } from "./expenseTransactions";

const MAX_EXPENSE_SESSION_ITEMS = 200;
const EXPENSE_SESSION_QUERY_CANDIDATE_LIMIT = 200;
const ACTIVE_EXPENSE_SESSION_CANDIDATE_LIMIT = 100;
const EXPENSE_SESSION_CLEANUP_BATCH_SIZE = 100;
const EXPENSE_SESSION_RELEASE_STATUSES = new Set(["active", "void"]);

const expenseSessionOperationValidator = v.object({
  sessionId: v.id("expenseSession"),
  expiresAt: v.number(),
});

const expenseSessionIdValidator = v.object({
  sessionId: v.id("expenseSession"),
});

const completedExpenseSessionValidator = v.object({
  sessionId: v.id("expenseSession"),
  transactionNumber: v.string(),
});

function expenseSessionError(
  message: string,
  code:
    | "authorization_failed"
    | "conflict"
    | "not_found"
    | "precondition_failed" = "precondition_failed",
) {
  return userError({
    code,
    message,
  });
}

function mapExpenseSessionValidationError(message: string) {
  if (message === "Session not found") {
    return expenseSessionError(message, "not_found");
  }

  if (
    message.includes("different terminal") ||
    message.includes("active session")
  ) {
    return expenseSessionError(message, "conflict");
  }

  if (message.includes("not associated")) {
    return expenseSessionError(message, "authorization_failed");
  }

  return expenseSessionError(message, "precondition_failed");
}

function buildNextExpenseSessionNumber(
  latestSessionNumber: string | undefined,
) {
  const lastSequence = latestSessionNumber
    ? Number.parseInt(latestSessionNumber.split("-").at(-1) ?? "0", 10)
    : 0;
  const nextSequence = Number.isFinite(lastSequence) ? lastSequence + 1 : 1;
  return `EXP-${String(nextSequence).padStart(3, "0")}`;
}

function normalizeOptionalRegisterNumber(value?: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

async function loadExpenseSessionItems(
  ctx: QueryCtx,
  sessionId: Id<"expenseSession">,
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
    }),
  );
}

async function listExpenseSessionsByStatusBefore(
  ctx: MutationCtx,
  expiresBefore: number,
) {
  const sessions = [];
  let cursor: string | null = null;

  while (true) {
    const page = await ctx.db
      .query("expenseSession")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", expiresBefore))
      .paginate({ cursor, numItems: EXPENSE_SESSION_CLEANUP_BATCH_SIZE });

    sessions.push(
      ...page.page.filter((session) =>
        EXPENSE_SESSION_RELEASE_STATUSES.has(session.status),
      ),
    );
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
    }),
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
            .eq("terminalId", args.terminalId!),
        );
    } else if (status && args.staffProfileId) {
      indexedStaffProfileFilter = true;
      sessionsQuery = ctx.db
        .query("expenseSession")
        .withIndex("by_storeId_status_staffProfileId", (q) =>
          q
            .eq("storeId", storeId)
            .eq("status", status)
            .eq("staffProfileId", args.staffProfileId!),
        );
    } else if (args.terminalId) {
      indexedTerminalFilter = true;
      sessionsQuery = ctx.db
        .query("expenseSession")
        .withIndex("by_storeId_terminalId", (q) =>
          q.eq("storeId", storeId).eq("terminalId", args.terminalId!),
        );
    } else if (args.staffProfileId) {
      indexedStaffProfileFilter = true;
      sessionsQuery = ctx.db
        .query("expenseSession")
        .withIndex("by_storeId_staffProfileId", (q) =>
          q.eq("storeId", storeId).eq("staffProfileId", args.staffProfileId!),
        );
    } else if (status) {
      sessionsQuery = ctx.db
        .query("expenseSession")
        .withIndex("by_storeId_and_status", (q) =>
          q.eq("storeId", storeId).eq("status", status),
        );
    } else {
      sessionsQuery = ctx.db
        .query("expenseSession")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId));
    }

    let sessions = await sessionsQuery.order("desc").take(boundedLimit);

    if (args.terminalId && !indexedTerminalFilter) {
      sessions = sessions.filter(
        (session) => session.terminalId === args.terminalId,
      );
    }

    if (args.staffProfileId && !indexedStaffProfileFilter) {
      sessions = sessions.filter(
        (session) => session.staffProfileId === args.staffProfileId,
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
      }),
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
    v.null(),
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
  returns: commandResultValidator(expenseSessionOperationValidator),
  handler: async (ctx, args) => {
    const now = Date.now();
    let registerNumber = normalizeOptionalRegisterNumber(args.registerNumber);
    if (!registerNumber) {
      const terminal = await ctx.db.get("posTerminal", args.terminalId);
      registerNumber = normalizeOptionalRegisterNumber(
        terminal?.registerNumber,
      );
    }

    const existingTerminalSessions = await ctx.db
      .query("expenseSession")
      .withIndex("by_storeId_status_terminalId", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", "active")
          .eq("terminalId", args.terminalId),
      )
      .take(ACTIVE_EXPENSE_SESSION_CANDIDATE_LIMIT);

    const nonExpiredTerminalSessions = existingTerminalSessions.filter(
      (session) => !session.expiresAt || session.expiresAt >= now,
    );

    const existingSession = nonExpiredTerminalSessions.find(
      (session) => session.staffProfileId === args.staffProfileId,
    );

    const staffProfileSessions = await ctx.db
      .query("expenseSession")
      .withIndex("by_staffProfileId_and_status", (q) =>
        q.eq("staffProfileId", args.staffProfileId).eq("status", "active"),
      )
      .take(ACTIVE_EXPENSE_SESSION_CANDIDATE_LIMIT);

    const existingSessionOnDifferentTerminal = staffProfileSessions.find(
      (session) =>
        session.storeId === args.storeId &&
        session.terminalId !== args.terminalId &&
        (!session.expiresAt || session.expiresAt >= now),
    );

    if (existingSessionOnDifferentTerminal) {
      return expenseSessionError(
        "A session is active for this staff profile on a different terminal",
        "conflict",
      );
    }

    if (existingSession) {
      // Check if existing session has items
      const existingItems = await ctx.db
        .query("expenseSessionItem")
        .withIndex("by_sessionId", (q) =>
          q.eq("sessionId", existingSession._id),
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

      return ok({
        sessionId: existingSession._id,
        expiresAt: existingSession.expiresAt,
      });
    }

    const latestSession = await ctx.db
      .query("expenseSession")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .first();

    const sessionNumber = buildNextExpenseSessionNumber(
      latestSession?.sessionNumber,
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

    return ok({ sessionId, expiresAt });
  },
});

// Update expense session metadata (notes)
export const updateExpenseSession = mutation({
  args: {
    sessionId: v.id("expenseSession"),
    staffProfileId: v.id("staffProfile"),
    notes: v.optional(v.string()),
  },
  returns: commandResultValidator(expenseSessionOperationValidator),
  handler: async (ctx, args) => {
    const { sessionId, ...updates } = args;
    const now = Date.now();

    // Validate session can be modified
    const validation = await validateExpenseSessionModifiable(
      ctx.db,
      sessionId,
      args.staffProfileId,
    );
    if (!validation.success) {
      const currentSession = await ctx.db.get("expenseSession", sessionId);
      if (
        currentSession &&
        currentSession.staffProfileId === args.staffProfileId &&
        (currentSession.status === "completed" ||
          currentSession.status === "void")
      ) {
        console.warn(
          `Attempted to update ${currentSession.status} expense session ${sessionId}. Ignoring update.`,
        );
        return ok({
          sessionId,
          expiresAt: currentSession.expiresAt || now,
        });
      }

      return mapExpenseSessionValidationError(
        validation.message ?? "Expense session cannot be updated.",
      );
    }

    // Extend session expiration time
    const expiresAt = calculateExpenseSessionExpiration(now);

    // Update session with new data
    await ctx.db.patch("expenseSession", sessionId, {
      ...updates,
      updatedAt: now,
      expiresAt,
    });

    return ok({ sessionId, expiresAt });
  },
});

// Hold/suspend an expense session
export const holdExpenseSession = mutation({
  args: {
    sessionId: v.id("expenseSession"),
    staffProfileId: v.id("staffProfile"),
  },
  returns: commandResultValidator(expenseSessionOperationValidator),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Validate session can be modified
    const validation = await validateExpenseSessionModifiable(
      ctx.db,
      args.sessionId,
      args.staffProfileId,
    );
    if (!validation.success) {
      return mapExpenseSessionValidationError(validation.message!);
    }

    // Get current session to access expiresAt
    const session = await ctx.db.get("expenseSession", args.sessionId);
    if (!session) {
      return expenseSessionError("Session not found", "not_found");
    }

    // Keep inventory holds in place when suspending
    await ctx.db.patch("expenseSession", args.sessionId, {
      status: "held",
      heldAt: now,
      updatedAt: now,
    });

    return ok({ sessionId: args.sessionId, expiresAt: session.expiresAt });
  },
});

// Resume a held expense session
export const resumeExpenseSession = mutation({
  args: {
    sessionId: v.id("expenseSession"),
    staffProfileId: v.id("staffProfile"),
    terminalId: v.id("posTerminal"),
  },
  returns: commandResultValidator(expenseSessionOperationValidator),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get the session
    const session = await ctx.db.get("expenseSession", args.sessionId);
    if (!session) {
      return expenseSessionError("Session not found", "not_found");
    }

    // Check if session has expired before resuming
    if (
      (session.expiresAt && session.expiresAt < now) ||
      session.status === "expired"
    ) {
      return expenseSessionError(
        "This session has expired. Start a new one to proceed.",
        "precondition_failed",
      );
    }

    // Check that this staff profile does not have an active session on a different terminal
    const staffProfileSessions = await ctx.db
      .query("expenseSession")
      .withIndex("by_staffProfileId_and_status", (q) =>
        q.eq("staffProfileId", args.staffProfileId).eq("status", "active"),
      )
      .take(ACTIVE_EXPENSE_SESSION_CANDIDATE_LIMIT);

    const activeSessionsOnOtherTerminals = staffProfileSessions.filter(
      (s) => s.expiresAt > now && s.terminalId !== args.terminalId,
    );

    if (activeSessionsOnOtherTerminals.length > 0) {
      return expenseSessionError(
        "This staff profile has an active session on another terminal",
        "conflict",
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

    return ok({ sessionId: args.sessionId, expiresAt });
  },
});

// Complete an expense session (convert to transaction)
export const completeExpenseSession = mutation({
  args: {
    sessionId: v.id("expenseSession"),
    notes: v.optional(v.string()),
    totalValue: v.number(),
  },
  returns: commandResultValidator(completedExpenseSessionValidator),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("expenseSession", args.sessionId);
    if (!session) {
      return expenseSessionError("Session not found", "not_found");
    }

    // Check if session has expired before completing
    const now = Date.now();
    if (session.expiresAt && session.expiresAt < now) {
      return expenseSessionError(
        "This session has expired. Start a new one to proceed.",
        "precondition_failed",
      );
    }

    if (session.status !== "active") {
      return expenseSessionError(
        "Can only complete active sessions",
        "precondition_failed",
      );
    }

    const transactionResult = await createExpenseTransactionFromSessionHandler(
      ctx,
      {
        sessionId: args.sessionId,
        notes: args.notes,
      },
    );
    if (transactionResult.kind !== "ok") {
      return transactionResult;
    }

    // Mark session as completed after the transaction write succeeds so the
    // session and transaction stay atomic within the same mutation.
    await ctx.db.patch("expenseSession", args.sessionId, {
      status: "completed",
      completedAt: now,
      updatedAt: now,
      notes: args.notes,
    });

    return ok({
      sessionId: args.sessionId,
      transactionNumber: transactionResult.data.transactionNumber,
    });
  },
});

// Void an expense session
export const voidExpenseSession = mutation({
  args: {
    sessionId: v.id("expenseSession"),
  },
  returns: commandResultValidator(expenseSessionIdValidator),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get the session
    const session = await ctx.db.get("expenseSession", args.sessionId);
    if (!session) {
      return expenseSessionError("Session not found", "not_found");
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
      }),
    );

    await releaseInventoryHoldsBatch(ctx.db, releaseItems);

    // Mark session as void
    await ctx.db.patch("expenseSession", args.sessionId, {
      status: "void",
      updatedAt: now,
    });

    return ok({ sessionId: args.sessionId });
  },
});

export const releaseExpenseSessionInventoryHoldsAndDeleteItems = mutation({
  args: {
    sessionId: v.id("expenseSession"),
  },
  returns: commandResultValidator(expenseSessionIdValidator),
  handler: async (ctx, args) => {
    // Get the session
    const session = await ctx.db.get("expenseSession", args.sessionId);
    if (!session) {
      return expenseSessionError("Session not found", "not_found");
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
      }),
    );

    await releaseInventoryHoldsBatch(ctx.db, releaseItems);

    // Delete all items for this session
    const itemIds = items.map((item) => item._id);
    await Promise.all(
      itemIds.map((itemId) => ctx.db.delete("expenseSessionItem", itemId)),
    );

    return ok({ sessionId: args.sessionId });
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
    v.null(),
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const activeSessions = await ctx.db
      .query("expenseSession")
      .withIndex("by_storeId_status_staffProfileId", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", "active")
          .eq("staffProfileId", args.staffProfileId),
      )
      .order("desc")
      .take(ACTIVE_EXPENSE_SESSION_CANDIDATE_LIMIT);

    // Filter out expired sessions
    const nonExpiredSessions = activeSessions.filter(
      (session) => !session.expiresAt || session.expiresAt >= now,
    );

    // Filter by staff profile and/or register if provided
    let filteredSessions = nonExpiredSessions;

    if (args.staffProfileId) {
      filteredSessions = filteredSessions.filter(
        (s) => s.staffProfileId === args.staffProfileId,
      );
    }

    filteredSessions = filteredSessions.filter(
      (s) => s.terminalId === args.terminalId,
    );

    if (args.registerNumber) {
      filteredSessions = filteredSessions.filter(
        (s) => s.terminalId === args.terminalId,
      );
    }

    // Return the most recent active session
    const activeSession = filteredSessions.sort(
      (a, b) => b.updatedAt - a.updatedAt,
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
    const expiredSessions = await listExpenseSessionsByStatusBefore(ctx, now);

    if (expiredSessions.length === 0) {
      console.log("[Expense] No expired sessions found");
      return { releasedCount: 0, sessionIds: [] };
    }

    console.log(
      `[Expense] Found ${expiredSessions.length} expired sessions to process`,
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
          }),
        );

        await releaseInventoryHoldsBatch(ctx.db, releaseItems);
        console.log(
          `[Expense] Released inventory holds for ${releaseItems.length} SKUs`,
        );

        // Mark session as expired
        await ctx.db.patch("expenseSession", session._id, {
          status: "expired",
          updatedAt: now,
        });

        releasedSessionIds.push(session._id);
        console.log(
          `[Expense] Released inventory holds for session ${session.sessionNumber}`,
        );
      } catch (error) {
        console.error(
          `[Expense] Error releasing session ${session._id}:`,
          error,
        );
        // Continue processing other sessions even if one fails
      }
    }

    console.log(
      `[Expense] Successfully released ${releasedSessionIds.length} sessions`,
    );
    return {
      releasedCount: releasedSessionIds.length,
      sessionIds: releasedSessionIds,
    };
  },
});
