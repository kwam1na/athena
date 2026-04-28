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
import { calculateSessionExpiration } from "./helpers/sessionExpiration";
import {
  runBindSessionToRegisterSessionCommand,
  runHoldSessionCommand,
  runResumeSessionCommand,
  runStartSessionCommand,
} from "../pos/application/commands/sessionCommands";
import {
  createTransactionFromSessionHandler,
  recordRegisterSessionSale,
} from "./pos";
import { commandResultValidator } from "../lib/commandResultValidators";
import { ok, userError } from "../../shared/commandResult";
import { isPosUsableRegisterSessionStatus } from "../../shared/registerSessionStatus";
import {
  createPosSessionTraceRecorder,
  type PosSessionTraceStage,
  type PosSessionTraceableSession,
} from "../pos/application/commands/posSessionTracing";

const MAX_SESSION_ITEMS = 200;
const SESSION_QUERY_CANDIDATE_LIMIT = 200;
const ACTIVE_SESSION_CANDIDATE_LIMIT = 100;
const SESSION_CLEANUP_BATCH_SIZE = 100;
const POS_SESSION_RELEASE_STATUSES = new Set(["active", "void", "held"]);

const sessionOperationDataValidator = v.object({
  sessionId: v.id("posSession"),
  expiresAt: v.number(),
});

const sessionIdOnlyValidator = v.object({
  sessionId: v.id("posSession"),
});

const completeSessionDataValidator = v.object({
  sessionId: v.id("posSession"),
  transactionNumber: v.string(),
});

function userErrorFromSessionCommandFailure(result: {
  status: string;
  message: string;
}) {
  switch (result.status) {
    case "notFound":
      return userError({
        code: "not_found",
        message: result.message,
      });
    case "inventoryUnavailable":
      return userError({
        code: "conflict",
        message: result.message,
      });
    case "validationFailed":
      return userError({
        code: "validation_failed",
        message: result.message,
      });
    default:
      return userError({
        code: "precondition_failed",
        message: result.message,
      });
  }
}

function userErrorFromValidationMessage(message: string) {
  if (message.toLowerCase().includes("not found")) {
    return userError({
      code: "not_found",
      message,
    });
  }

  return userError({
    code: "precondition_failed",
    message,
  });
}

function isUsableRegisterSession(registerSession: { status: string }) {
  return isPosUsableRegisterSessionStatus(registerSession.status);
}

function registerSessionMatchesIdentity(
  registerSession: { registerNumber?: string; terminalId?: Id<"posTerminal"> },
  identity: {
    terminalId?: Id<"posTerminal">;
    registerNumber?: string;
  },
) {
  if (!identity.terminalId || !registerSession.terminalId) {
    return false;
  }

  if (identity.terminalId !== registerSession.terminalId) {
    return false;
  }

  if (identity.registerNumber) {
    if (!registerSession.registerNumber) {
      return false;
    }

    return identity.registerNumber === registerSession.registerNumber;
  }

  return true;
}

async function validateSessionDrawerBinding(
  ctx: MutationCtx,
  session: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    registerNumber?: string;
    registerSessionId?: Id<"registerSession">;
  },
) {
  if (!session.registerSessionId) {
    return userError({
      code: "validation_failed",
      message: "Open the cash drawer before modifying this sale.",
    });
  }

  const registerSession = await ctx.db.get(
    "registerSession",
    session.registerSessionId,
  );

  if (
    !registerSession ||
    registerSession.storeId !== session.storeId ||
    !isUsableRegisterSession(registerSession) ||
    !registerSessionMatchesIdentity(registerSession, session)
  ) {
    return userError({
      code: "validation_failed",
      message: "Open the cash drawer before modifying this sale.",
    });
  }

  return null;
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
    }),
  );
}

async function listPosSessionsByStatusBefore(
  ctx: MutationCtx,
  expiresBefore: number,
) {
  const sessions = [];
  let cursor: string | null = null;

  while (true) {
    const page = await ctx.db
      .query("posSession")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", expiresBefore))
      .paginate({ cursor, numItems: SESSION_CLEANUP_BATCH_SIZE });

    sessions.push(
      ...page.page.filter((session) =>
        POS_SESSION_RELEASE_STATUSES.has(session.status),
      ),
    );
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
  status: "completed" | "void" | "expired",
) {
  const sessions = [];
  let cursor: string | null = null;

  while (true) {
    const page = await ctx.db
      .query("posSession")
      .withIndex("by_storeId_and_status", (q) =>
        q.eq("storeId", storeId).eq("status", status),
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

async function persistSessionWorkflowTraceIdBestEffort(
  ctx: MutationCtx,
  args: {
    session: PosSessionTraceableSession;
    traceCreated: boolean;
    traceId: string;
  },
) {
  if (args.session.workflowTraceId || !args.traceCreated) {
    return;
  }

  try {
    await ctx.db.patch("posSession", args.session._id, {
      workflowTraceId: args.traceId,
    });
  } catch (error) {
    console.error("[workflow-trace] pos.session.trace.session-link", error);
  }
}

async function recordSessionLifecycleTraceBestEffort(
  ctx: MutationCtx,
  args: {
    stage: PosSessionTraceStage;
    session: PosSessionTraceableSession;
    occurredAt?: number;
    transactionId?: Id<"posTransaction">;
    holdReason?: string;
    voidReason?: string;
    customerName?: string;
    itemName?: string;
    quantity?: number;
    previousQuantity?: number;
    itemCount?: number;
    paymentMethod?: string;
    amount?: number;
    previousAmount?: number;
    paymentCount?: number;
  },
) {
  try {
    const traceResult = await createPosSessionTraceRecorder(ctx).record(args);
    await persistSessionWorkflowTraceIdBestEffort(ctx, {
      session: args.session,
      ...traceResult,
    });
  } catch (error) {
    console.error(
      `[workflow-trace] pos.session.lifecycle.${args.stage}`,
      error,
    );
  }
}

type CustomerSnapshot = {
  customerProfileId?: Id<"customerProfile">;
  customerInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
};

function normalizeCustomerSnapshot(session: CustomerSnapshot) {
  const customerInfo = session.customerInfo
    ? {
        name: session.customerInfo.name?.trim() || undefined,
        email: session.customerInfo.email?.trim() || undefined,
        phone: session.customerInfo.phone?.trim() || undefined,
      }
    : undefined;

  return {
    customerProfileId: session.customerProfileId,
    customerInfo,
  };
}

function hasCustomerSnapshotValue(
  snapshot: ReturnType<typeof normalizeCustomerSnapshot>,
) {
  return Boolean(
    snapshot.customerProfileId ||
    snapshot.customerInfo?.name ||
    snapshot.customerInfo?.email ||
    snapshot.customerInfo?.phone,
  );
}

function resolveCustomerTraceStage(
  previousSession: CustomerSnapshot,
  nextSession: CustomerSnapshot,
): {
  stage: "customerLinked" | "customerUpdated" | "customerCleared";
  customerName?: string;
} | null {
  const previous = normalizeCustomerSnapshot(previousSession);
  const next = normalizeCustomerSnapshot(nextSession);

  const customerUnchanged =
    previous.customerProfileId === next.customerProfileId &&
    previous.customerInfo?.name === next.customerInfo?.name &&
    previous.customerInfo?.email === next.customerInfo?.email &&
    previous.customerInfo?.phone === next.customerInfo?.phone;

  if (customerUnchanged) {
    return null;
  }

  if (!hasCustomerSnapshotValue(next)) {
    return {
      stage: "customerCleared",
      customerName: previous.customerInfo?.name,
    };
  }

  if (
    !hasCustomerSnapshotValue(previous) ||
    previous.customerProfileId !== next.customerProfileId
  ) {
    return {
      stage: "customerLinked",
      customerName: next.customerInfo?.name,
    };
  }

  return {
    stage: "customerUpdated",
    customerName: next.customerInfo?.name,
  };
}

async function loadSessionCustomer(ctx: QueryCtx, session: CustomerSnapshot) {
  if (session.customerProfileId) {
    const customerProfile = await ctx.db.get(
      "customerProfile",
      session.customerProfileId,
    );

    return {
      customerProfileId: session.customerProfileId,
      name:
        customerProfile?.fullName ?? session.customerInfo?.name ?? "Customer",
      email: customerProfile?.email ?? session.customerInfo?.email,
      phone: customerProfile?.phoneNumber ?? session.customerInfo?.phone,
    };
  }

  if (
    session.customerInfo?.name ||
    session.customerInfo?.email ||
    session.customerInfo?.phone
  ) {
    return {
      customerProfileId: undefined,
      name: session.customerInfo.name ?? "Walk-in customer",
      email: session.customerInfo.email,
      phone: session.customerInfo.phone,
    };
  }

  return null;
}

// Get sessions for a store (with filtering)
export const getStoreSessions = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
    staffProfileId: v.optional(v.id("staffProfile")),
    status: v.optional(v.string()), // "active", "held", "completed", "void"
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { storeId, status, limit = 50 } = args;
    const boundedLimit = Math.min(limit, SESSION_QUERY_CANDIDATE_LIMIT);

    let sessionsQuery;
    let indexedTerminalFilter = false;
    let indexedStaffFilter = false;

    if (status && args.terminalId) {
      indexedTerminalFilter = true;
      sessionsQuery = ctx.db
        .query("posSession")
        .withIndex("by_storeId_status_terminalId", (q) =>
          q
            .eq("storeId", storeId)
            .eq("status", status)
            .eq("terminalId", args.terminalId!),
        );
    } else if (status && args.staffProfileId) {
      indexedStaffFilter = true;
      sessionsQuery = ctx.db
        .query("posSession")
        .withIndex("by_storeId_status_staffProfileId", (q) =>
          q
            .eq("storeId", storeId)
            .eq("status", status)
            .eq("staffProfileId", args.staffProfileId!),
        );
    } else if (args.terminalId) {
      indexedTerminalFilter = true;
      sessionsQuery = ctx.db
        .query("posSession")
        .withIndex("by_storeId_terminalId", (q) =>
          q.eq("storeId", storeId).eq("terminalId", args.terminalId!),
        );
    } else if (args.staffProfileId) {
      indexedStaffFilter = true;
      sessionsQuery = ctx.db
        .query("posSession")
        .withIndex("by_storeId_staffProfileId", (q) =>
          q.eq("storeId", storeId).eq("staffProfileId", args.staffProfileId!),
        );
    } else if (status) {
      sessionsQuery = ctx.db
        .query("posSession")
        .withIndex("by_storeId_and_status", (q) =>
          q.eq("storeId", storeId).eq("status", status),
        );
    } else {
      sessionsQuery = ctx.db
        .query("posSession")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId));
    }

    let sessions = await sessionsQuery.order("desc").take(boundedLimit);

    if (args.terminalId && !indexedTerminalFilter) {
      sessions = sessions.filter(
        (session) => session.terminalId === args.terminalId,
      );
    }

    if (args.staffProfileId && !indexedStaffFilter) {
      sessions = sessions.filter(
        (session) => session.staffProfileId === args.staffProfileId,
      );
    }

    sessions = sessions.slice(0, limit);

    // Enrich with customer info and cart items if available
    const enrichedSessions = await Promise.all(
      sessions.map(async (session) => {
        const customer = await loadSessionCustomer(ctx, session);

        const cartItems = await loadPosSessionItems(ctx, session._id);

        return {
          ...session,
          cartItems,
          customer,
        };
      }),
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

    const customer = await loadSessionCustomer(ctx, session);

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
    staffProfileId: v.optional(v.id("staffProfile")),
    registerNumber: v.optional(v.string()),
    registerSessionId: v.optional(v.id("registerSession")),
  },
  returns: commandResultValidator(sessionOperationDataValidator),
  handler: async (ctx, args) => {
    const result = await runStartSessionCommand(ctx, args);

    if (result.status === "ok") {
      return ok(result.data);
    }

    return userErrorFromSessionCommandFailure(result);
  },
});

export const bindSessionToRegisterSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    staffProfileId: v.id("staffProfile"),
    registerSessionId: v.id("registerSession"),
  },
  returns: commandResultValidator(sessionOperationDataValidator),
  handler: async (ctx, args) => {
    const result = await runBindSessionToRegisterSessionCommand(ctx, args);

    if (result.status === "ok") {
      return ok(result.data);
    }

    return userErrorFromSessionCommandFailure(result);
  },
});

// Update session metadata (customer info, totals)
// Note: Cart items are now managed via posSessionItems mutations
export const updateSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    staffProfileId: v.id("staffProfile"),
    customerProfileId: v.optional(v.id("customerProfile")),
    customerInfo: v.optional(
      v.object({
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
      }),
    ),
    subtotal: v.optional(v.number()),
    tax: v.optional(v.number()),
    total: v.optional(v.number()),
  },
  returns: commandResultValidator(sessionOperationDataValidator),
  handler: async (ctx, args) => {
    const { sessionId, ...updates } = args;
    const now = Date.now();
    const currentSession = await ctx.db.get("posSession", sessionId);
    const previousSession = currentSession
      ? {
          ...currentSession,
          customerInfo: currentSession.customerInfo
            ? { ...currentSession.customerInfo }
            : undefined,
        }
      : null;

    const isStaleCompletedSession =
      currentSession?.status === "completed" ||
      currentSession?.status === "void";
    const isExpiredSession = Boolean(
      currentSession?.expiresAt && currentSession.expiresAt < now,
    );

    // Metadata persistence is best-effort in the register UI, so treat stale
    // completed/voided/expired sessions as an idempotent no-op instead of
    // surfacing a new hard failure during sign-out or navigation races.
    if (
      currentSession?.staffProfileId === args.staffProfileId &&
      (isStaleCompletedSession || isExpiredSession)
    ) {
      return ok({
        sessionId,
        expiresAt: currentSession.expiresAt,
      });
    }

    // Validate session can be modified (not completed or void)
    const validation = await validateSessionModifiable(
      ctx.db,
      sessionId,
      args.staffProfileId,
    );
    if (!validation.success) {
      return userErrorFromValidationMessage(
        validation.message || "Cannot update this session.",
      );
    }

    // Extend session expiration time
    const expiresAt = calculateSessionExpiration(now);

    // Update session with new data
    await ctx.db.patch("posSession", sessionId, {
      ...updates,
      updatedAt: now,
      expiresAt,
    });

    if (previousSession) {
      const nextSession = {
        ...previousSession,
        ...updates,
        updatedAt: now,
        expiresAt,
      };
      const customerTrace = resolveCustomerTraceStage(
        previousSession,
        nextSession,
      );

      if (customerTrace) {
        await recordSessionLifecycleTraceBestEffort(ctx, {
          stage: customerTrace.stage,
          session: nextSession,
          occurredAt: now,
          customerName: customerTrace.customerName,
        });
      }
    }

    return ok({ sessionId, expiresAt });
  },
});

// Hold/suspend a session
export const holdSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    staffProfileId: v.id("staffProfile"),
    holdReason: v.optional(v.string()),
  },
  returns: commandResultValidator(sessionOperationDataValidator),
  handler: async (ctx, args) => {
    const result = await runHoldSessionCommand(ctx, args);

    if (result.status === "ok") {
      return ok(result.data);
    }

    return userErrorFromSessionCommandFailure(result);
  },
});

// Resume a held session
export const resumeSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    staffProfileId: v.id("staffProfile"),
    terminalId: v.id("posTerminal"),
  },
  returns: commandResultValidator(sessionOperationDataValidator),
  handler: async (ctx, args) => {
    const result = await runResumeSessionCommand(ctx, args);

    if (result.status === "ok") {
      return ok(result.data);
    }

    return userErrorFromSessionCommandFailure(result);
  },
});

// Complete a session (convert to transaction)
export const completeSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    staffProfileId: v.id("staffProfile"),
    payments: v.array(
      v.object({
        method: v.string(), // "cash", "card", "mobile_money"
        amount: v.number(),
        timestamp: v.number(),
      }),
    ),
    notes: v.optional(v.string()),
    // Explicitly save final transaction totals for audit integrity
    subtotal: v.number(),
    tax: v.number(),
    total: v.number(),
  },
  returns: commandResultValidator(completeSessionDataValidator),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("posSession", args.sessionId);
    if (!session) {
      return userError({
        code: "not_found",
        message: "Session not found.",
      });
    }

    // Check if session has expired before completing
    const now = Date.now();
    if (session.expiresAt && session.expiresAt < now) {
      return userError({
        code: "precondition_failed",
        message: "This session has expired. Start a new one to proceed.",
      });
    }

    if (session.status !== "active") {
      return userError({
        code: "precondition_failed",
        message: "Can only complete active sessions.",
      });
    }

    if (session.staffProfileId !== args.staffProfileId) {
      return userError({
        code: "precondition_failed",
        message: "This session is not associated with your cashier.",
      });
    }

    const transactionResult = await createTransactionFromSessionHandler(ctx, {
      sessionId: args.sessionId,
      staffProfileId: args.staffProfileId,
      payments: args.payments,
      recordRegisterSale: false,
      notes: args.notes,
    });

    if (transactionResult.kind === "user_error") {
      return transactionResult;
    }

    const { transactionId, transactionNumber } = transactionResult.data;
    const sessionTransactionId = transactionId as Id<"posTransaction">;
    const registerSessionId = session.registerSessionId;
    const totalPaid = args.payments.reduce(
      (sum, payment) => sum + payment.amount,
      0,
    );

    if (!registerSessionId) {
      throw new Error("Session lost its drawer binding during completion.");
    }

    await recordSessionLifecycleTraceBestEffort(ctx, {
      stage: "checkoutSubmitted",
      session: {
        ...session,
        updatedAt: now,
        payments: args.payments,
        subtotal: args.subtotal,
        tax: args.tax,
        total: args.total,
      },
      occurredAt: now,
      paymentMethod: args.payments[0]?.method,
      paymentCount: args.payments.length,
    });

    await ctx.db.patch("posSession", args.sessionId, {
      status: "completed",
      completedAt: now,
      updatedAt: now,
      notes: args.notes,
      payments: args.payments,
      subtotal: args.subtotal,
      tax: args.tax,
      total: args.total,
    });

    await recordRegisterSessionSale(ctx, {
      payments: args.payments,
      changeGiven: totalPaid > args.total ? totalPaid - args.total : undefined,
      registerSessionId,
      registerNumber: session.registerNumber,
      storeId: session.storeId,
      terminalId: session.terminalId,
    });

    await recordSessionLifecycleTraceBestEffort(ctx, {
      stage: "completed",
      session: {
        ...session,
        status: "completed",
        completedAt: now,
        updatedAt: now,
        notes: args.notes,
        payments: args.payments,
        subtotal: args.subtotal,
        tax: args.tax,
        total: args.total,
        transactionId: sessionTransactionId,
      },
      occurredAt: now,
      transactionId: sessionTransactionId,
    });

    // Return the session ID since the transaction will be created asynchronously
    return ok({
      sessionId: args.sessionId,
      transactionNumber,
    });
  },
});

// Void a session
export const voidSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    voidReason: v.optional(v.string()),
  },
  returns: commandResultValidator(sessionIdOnlyValidator),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get the session
    const session = await ctx.db.get("posSession", args.sessionId);
    if (!session) {
      return userError({
        code: "not_found",
        message: "Session not found.",
      });
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
      }),
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

    await recordSessionLifecycleTraceBestEffort(ctx, {
      stage: "voided",
      session: {
        ...session,
        status: "void",
        updatedAt: now,
        notes: args.voidReason,
      },
      occurredAt: now,
      voidReason: args.voidReason,
    });

    return ok({ sessionId: args.sessionId });
  },
});

export const releaseSessionInventoryHoldsAndDeleteItems = mutation({
  args: {
    sessionId: v.id("posSession"),
    staffProfileId: v.id("staffProfile"),
    checkoutStateVersion: v.number(),
  },
  returns: commandResultValidator(sessionIdOnlyValidator),
  handler: async (ctx, args) => {
    const now = Date.now();
    // Get the session
    const session = await ctx.db.get("posSession", args.sessionId);
    if (!session) {
      return userError({
        code: "not_found",
        message: "Session not found.",
      });
    }

    if (args.checkoutStateVersion <= (session.checkoutStateVersion ?? 0)) {
      return ok({ sessionId: args.sessionId });
    }

    const validation = await validateSessionActive(
      ctx.db,
      args.sessionId,
      args.staffProfileId,
    );

    if (!validation.success) {
      return userErrorFromValidationMessage(
        validation.message || "Session is not active.",
      );
    }

    const drawerValidation = await validateSessionDrawerBinding(ctx, session);
    if (drawerValidation) {
      return drawerValidation;
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
      }),
    );

    await releaseInventoryHoldsBatch(ctx.db, releaseItems);

    // Delete all items for this session
    const itemIds = items.map((item) => item._id);
    await Promise.all(
      itemIds.map((itemId) => ctx.db.delete("posSessionItem", itemId)),
    );

    const expiresAt = calculateSessionExpiration(now);
    await ctx.db.patch("posSession", args.sessionId, {
      updatedAt: now,
      expiresAt,
      checkoutStateVersion: args.checkoutStateVersion,
      payments: [],
    });

    if (itemIds.length > 0) {
      await recordSessionLifecycleTraceBestEffort(ctx, {
        stage: "cartCleared",
        session: {
          ...session,
          checkoutStateVersion: args.checkoutStateVersion,
          updatedAt: now,
          expiresAt,
          payments: [],
        },
        occurredAt: now,
        itemCount: itemIds.length,
      });
    }

    return ok({ sessionId: args.sessionId });
  },
});

export const syncSessionCheckoutState = mutation({
  args: {
    sessionId: v.id("posSession"),
    staffProfileId: v.id("staffProfile"),
    checkoutStateVersion: v.number(),
    payments: v.array(
      v.object({
        method: v.string(),
        amount: v.number(),
        timestamp: v.number(),
      }),
    ),
    stage: v.union(
      v.literal("paymentAdded"),
      v.literal("paymentUpdated"),
      v.literal("paymentRemoved"),
      v.literal("paymentsCleared"),
    ),
    paymentMethod: v.optional(v.string()),
    amount: v.optional(v.number()),
    previousAmount: v.optional(v.number()),
  },
  returns: commandResultValidator(sessionOperationDataValidator),
  handler: async (ctx, args) => {
    const validation = await validateSessionActive(
      ctx.db,
      args.sessionId,
      args.staffProfileId,
    );

    if (!validation.success) {
      return userErrorFromValidationMessage(
        validation.message || "Session is not active.",
      );
    }

    const session = await ctx.db.get("posSession", args.sessionId);
    if (!session) {
      return userError({
        code: "not_found",
        message: "Session not found.",
      });
    }

    const currentCheckoutStateVersion = session.checkoutStateVersion ?? 0;
    if (args.checkoutStateVersion <= currentCheckoutStateVersion) {
      return ok({
        sessionId: args.sessionId,
        expiresAt: session.expiresAt,
      });
    }

    const drawerValidation = await validateSessionDrawerBinding(ctx, session);
    if (drawerValidation) {
      return drawerValidation;
    }

    const now = Date.now();
    const expiresAt = calculateSessionExpiration(now);
    await ctx.db.patch("posSession", args.sessionId, {
      payments: args.payments,
      checkoutStateVersion: args.checkoutStateVersion,
      updatedAt: now,
      expiresAt,
    });

    await recordSessionLifecycleTraceBestEffort(ctx, {
      stage: args.stage,
      session: {
        ...session,
        payments: args.payments,
        checkoutStateVersion: args.checkoutStateVersion,
        updatedAt: now,
        expiresAt,
      },
      occurredAt: now,
      paymentMethod: args.paymentMethod,
      amount: args.amount,
      previousAmount: args.previousAmount,
      paymentCount: args.payments.length,
    });

    return ok({
      sessionId: args.sessionId,
      expiresAt,
    });
  },
});

// Get active session for a register/staff member
export const getActiveSession = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    staffProfileId: v.optional(v.id("staffProfile")),
    registerNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const activeSessions = args.staffProfileId
      ? await ctx.db
          .query("posSession")
          .withIndex("by_storeId_status_staffProfileId", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("status", "active")
              .eq("staffProfileId", args.staffProfileId!),
          )
          .order("desc")
          .take(ACTIVE_SESSION_CANDIDATE_LIMIT)
      : await ctx.db
          .query("posSession")
          .withIndex("by_storeId_status_terminalId", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("status", "active")
              .eq("terminalId", args.terminalId),
          )
          .order("desc")
          .take(ACTIVE_SESSION_CANDIDATE_LIMIT);

    // Filter out expired sessions (even if status is still "active")
    // This prevents returning sessions that expired but haven't been marked by cron yet
    const nonExpiredSessions = activeSessions.filter(
      (session) => !session.expiresAt || session.expiresAt >= now,
    );

    // Filter by staff member and/or register if provided
    let filteredSessions = nonExpiredSessions;

    if (args.staffProfileId) {
      filteredSessions = filteredSessions.filter(
        (s) => s.terminalId === args.terminalId,
      );
      filteredSessions = filteredSessions.filter(
        (s) => s.staffProfileId === args.staffProfileId,
      );
    }

    if (args.registerNumber) {
      filteredSessions = filteredSessions.filter(
        (s) => s.registerNumber === args.registerNumber,
      );
    }

    // Return the most recent active session
    const activeSession = filteredSessions.sort(
      (a, b) => b.updatedAt - a.updatedAt,
    )[0];

    if (!activeSession) return null;

    const customer = await loadSessionCustomer(ctx, activeSession);

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

    // Find expired active/void/held sessions
    const expiredSessions = await listPosSessionsByStatusBefore(ctx, now);

    if (expiredSessions.length === 0) {
      console.log("[POS] No expired sessions found");
      return { releasedCount: 0, sessionIds: [] };
    }

    console.log(
      `[POS] Found ${expiredSessions.length} expired sessions to process`,
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
          }),
        );

        await releaseInventoryHoldsBatch(ctx.db, releaseItems);
        console.log(
          `[POS] Released inventory holds for ${releaseItems.length} SKUs`,
        );

        // Keep items for record-keeping - don't delete them
        // Items remain associated with expired session for audit trail
        const wasVoided = session.status === "void";
        const expirationNote = wasVoided
          ? session.notes
          : "Session expired - inventory holds released";

        // Mark session as expired
        await ctx.db.patch("posSession", session._id, {
          status: "expired",
          updatedAt: now,
          notes: expirationNote,
        });

        if (!wasVoided) {
          await recordSessionLifecycleTraceBestEffort(ctx, {
            stage: "expired",
            session: {
              ...session,
              status: "expired",
              updatedAt: now,
              notes: expirationNote,
            },
            occurredAt: now,
          });
        }

        releasedSessionIds.push(session._id);
        console.log(
          `[POS] Released inventory holds for session ${session.sessionNumber}`,
        );
      } catch (error) {
        console.error(`[POS] Error releasing session ${session._id}:`, error);
        // Continue processing other sessions even if one fails
      }
    }

    console.log(
      `[POS] Successfully released ${releasedSessionIds.length} sessions`,
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
            status as "completed" | "void" | "expired",
          ),
        ),
      )
    )
      .flat()
      .filter((session) => session.updatedAt < cutoffTime);

    // Delete old sessions
    await Promise.all(
      oldSessions.map((session) => ctx.db.delete("posSession", session._id)),
    );

    return oldSessions.length;
  },
});

export const expireAllSessionsForStaff = mutation({
  args: {
    staffProfileId: v.id("staffProfile"),
    terminalId: v.id("posTerminal"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [activeSessions, heldSessions] = await Promise.all([
      ctx.db
        .query("posSession")
        .withIndex("by_staffProfileId_and_status", (q) =>
          q.eq("staffProfileId", args.staffProfileId).eq("status", "active"),
        )
        .take(ACTIVE_SESSION_CANDIDATE_LIMIT),
      ctx.db
        .query("posSession")
        .withIndex("by_staffProfileId_and_status", (q) =>
          q.eq("staffProfileId", args.staffProfileId).eq("status", "held"),
        )
        .take(ACTIVE_SESSION_CANDIDATE_LIMIT),
    ]);
    const sessions = [...activeSessions, ...heldSessions];

    await Promise.all(
      sessions
        .filter((session) => session.terminalId !== args.terminalId)
        .map((session) =>
          ctx.db.patch("posSession", session._id, { expiresAt: now }),
        ),
    );

    return {
      success: true as const,
      data: { staffProfileId: args.staffProfileId },
    };
  },
});
