import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { api } from "../_generated/api";

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

    // Enrich with customer info if available
    const enrichedSessions = await Promise.all(
      sessions.map(async (session) => {
        let customer = null;
        if (session.customerId) {
          customer = await ctx.db.get(session.customerId);
        }
        return {
          ...session,
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

    return {
      ...session,
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
      // Auto-complete the existing session if it has no items, otherwise hold it
      if (existingSession.cartItems.length === 0) {
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

    const sessionId = await ctx.db.insert("posSession", {
      sessionNumber,
      storeId: args.storeId,
      cashierId: args.cashierId,
      registerNumber,
      status: "active",
      cartItems: [],
      createdAt: now,
      updatedAt: now,
    });

    return sessionId;
  },
});

// Update session cart and customer info
export const updateSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    cartItems: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          barcode: v.string(),
          price: v.number(),
          quantity: v.number(),
          image: v.optional(v.string()),
          size: v.optional(v.string()),
          length: v.optional(v.number()),
          skuId: v.optional(v.id("productSku")),
          areProcessingFeesAbsorbed: v.optional(v.boolean()),
        })
      )
    ),
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
  handler: async (ctx, args) => {
    const { sessionId, ...updates } = args;

    await ctx.db.patch(sessionId, {
      ...updates,
      updatedAt: Date.now(),
    });

    return sessionId;
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
  handler: async (ctx, args) => {
    const now = Date.now();

    await ctx.db.patch(args.sessionId, {
      status: "active",
      resumedAt: now,
      updatedAt: now,
    });

    return args.sessionId;
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
  },
  handler: async (ctx, args): Promise<string> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.status !== "active") {
      throw new Error("Can only complete active sessions");
    }

    // Mark session as completed first
    const now = Date.now();
    await ctx.db.patch(args.sessionId, {
      status: "completed",
      completedAt: now,
      updatedAt: now,
      notes: args.notes,
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

    return {
      ...activeSession,
      customer,
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
            q.eq(q.field("status"), "void")
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
