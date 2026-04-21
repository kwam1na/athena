import { internalMutation, internalQuery, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";

const REGISTER_SESSION_TRANSITIONS = {
  active: new Set(["closing"]),
  closed: new Set<string>(),
  closing: new Set(["closed"]),
  open: new Set(["active", "closing"]),
} as const;

type RegisterSessionStatus = keyof typeof REGISTER_SESSION_TRANSITIONS;
type RegisterSessionIdentity = {
  registerNumber?: string | null;
  terminalId?: Id<"posTerminal">;
};
type RegisterSessionCashAdjustmentKind = "sale" | "void";

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function normalizeRegisterSessionIdentity<T extends RegisterSessionIdentity>(args: T) {
  return {
    ...args,
    registerNumber: trimOptional(args.registerNumber),
  };
}

export function assertRegisterSessionIdentity<T extends RegisterSessionIdentity>(args: T) {
  const normalizedArgs = normalizeRegisterSessionIdentity(args);

  if (!normalizedArgs.registerNumber && !normalizedArgs.terminalId) {
    throw new Error("Register sessions require a register number or terminal.");
  }

  return normalizedArgs;
}

export function assertRegisterSessionMatchesTransaction(
  session: RegisterSessionIdentity,
  transactionIdentity: RegisterSessionIdentity
) {
  const normalizedSession = normalizeRegisterSessionIdentity(session);
  const normalizedTransaction = normalizeRegisterSessionIdentity(transactionIdentity);

  if (!normalizedTransaction.registerNumber && !normalizedTransaction.terminalId) {
    throw new Error(
      "Register session transactions must include a register number or terminal."
    );
  }

  let hasSharedIdentity = false;

  if (normalizedSession.registerNumber && normalizedTransaction.registerNumber) {
    hasSharedIdentity = true;

    if (normalizedSession.registerNumber !== normalizedTransaction.registerNumber) {
      throw new Error("Register session does not match the transaction identity.");
    }
  }

  if (normalizedSession.terminalId && normalizedTransaction.terminalId) {
    hasSharedIdentity = true;

    if (normalizedSession.terminalId !== normalizedTransaction.terminalId) {
      throw new Error("Register session does not match the transaction identity.");
    }
  }

  if (!hasSharedIdentity) {
    throw new Error("Register session does not match the transaction identity.");
  }
}

export function buildRegisterSession(args: {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  terminalId?: Id<"posTerminal">;
  registerNumber?: string;
  openedByUserId?: Id<"athenaUser">;
  openedByStaffProfileId?: Id<"staffProfile">;
  openingFloat: number;
  expectedCash?: number;
  notes?: string;
}) {
  const identity = normalizeRegisterSessionIdentity(args);

  return {
    ...args,
    ...identity,
    status: "open" as const,
    openedAt: Date.now(),
    expectedCash: args.expectedCash ?? args.openingFloat,
  };
}

export function calculateRegisterSessionCashDelta(args: {
  payments: Array<{ method: string; amount: number; timestamp: number }>;
  changeGiven?: number;
}) {
  const cashTendered = args.payments.reduce(
    (sum, payment) =>
      payment.method === "cash" ? sum + payment.amount : sum,
    0
  );

  return Math.max(0, cashTendered - (args.changeGiven ?? 0));
}

export function assertValidRegisterSessionTransition(
  currentStatus: RegisterSessionStatus,
  nextStatus: RegisterSessionStatus
) {
  if (currentStatus === nextStatus) {
    if (currentStatus === "closed") {
      throw new Error("Register session is already closed.");
    }

    return;
  }

  if (!REGISTER_SESSION_TRANSITIONS[currentStatus].has(nextStatus)) {
    throw new Error(
      `Cannot change register session from ${currentStatus} to ${nextStatus}.`
    );
  }
}

export function buildRegisterSessionTransactionPatch(
  session: {
    countedCash?: number;
    expectedCash: number;
    status: RegisterSessionStatus;
  },
  args: {
    adjustmentKind: RegisterSessionCashAdjustmentKind;
    payments: Array<{ method: string; amount: number; timestamp: number }>;
    changeGiven?: number;
  }
) {
  const expectedCashDelta = calculateRegisterSessionCashDelta({
    changeGiven: args.changeGiven,
    payments: args.payments,
  });
  const updates: Record<string, number | RegisterSessionStatus> = {};

  if (expectedCashDelta > 0) {
    const nextExpectedCash =
      session.expectedCash +
      (args.adjustmentKind === "void" ? -expectedCashDelta : expectedCashDelta);

    if (nextExpectedCash < 0) {
      throw new Error("Register session expected cash cannot be negative.");
    }

    updates.expectedCash = nextExpectedCash;

    if (session.countedCash !== undefined) {
      updates.variance = session.countedCash - nextExpectedCash;
    }
  }

  if (args.adjustmentKind === "sale" && session.status === "open") {
    updates.status = "active";
  }

  return updates;
}

async function findConflictingRegisterSession(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    registerNumber?: string;
    terminalId?: Id<"posTerminal">;
  }
) {
  if (args.registerNumber) {
    const latestByRegister = await ctx.db
      .query("registerSession")
      .withIndex("by_storeId_registerNumber", (q) =>
        q.eq("storeId", args.storeId).eq("registerNumber", args.registerNumber!)
      )
      .order("desc")
      .first();

    if (latestByRegister && latestByRegister.status !== "closed") {
      throw new Error("A register session is already open for this register.");
    }
  }

  if (!args.terminalId) {
    return;
  }

  const latestByTerminal = await ctx.db
    .query("registerSession")
    .withIndex("by_terminalId", (q) => q.eq("terminalId", args.terminalId!))
    .order("desc")
    .first();

  if (latestByTerminal && latestByTerminal.status !== "closed") {
    throw new Error("A register session is already open for this terminal.");
  }
}

export const openRegisterSession = internalMutation({
  args: {
    storeId: v.id("store"),
    organizationId: v.optional(v.id("organization")),
    terminalId: v.optional(v.id("posTerminal")),
    registerNumber: v.optional(v.string()),
    openedByUserId: v.optional(v.id("athenaUser")),
    openedByStaffProfileId: v.optional(v.id("staffProfile")),
    openingFloat: v.number(),
    expectedCash: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = assertRegisterSessionIdentity(args);

    await findConflictingRegisterSession(ctx, {
      ...args,
      ...identity,
    });
    const sessionId = await ctx.db.insert(
      "registerSession",
      buildRegisterSession({
        ...args,
        ...identity,
      })
    );
    return ctx.db.get("registerSession", sessionId);
  },
});

export const getOpenRegisterSession = internalQuery({
  args: {
    storeId: v.id("store"),
    registerNumber: v.optional(v.string()),
    terminalId: v.optional(v.id("posTerminal")),
  },
  handler: async (ctx, args) => {
    if (args.registerNumber) {
      const latestByRegister = await ctx.db
        .query("registerSession")
        .withIndex("by_storeId_registerNumber", (q) =>
          q.eq("storeId", args.storeId).eq("registerNumber", args.registerNumber!)
        )
        .order("desc")
        .first();

      return latestByRegister && latestByRegister.status !== "closed"
        ? latestByRegister
        : null;
    }

    if (!args.terminalId) {
      return null;
    }

    const latestByTerminal = await ctx.db
      .query("registerSession")
      .withIndex("by_terminalId", (q) => q.eq("terminalId", args.terminalId!))
      .order("desc")
      .first();

    return latestByTerminal && latestByTerminal.status !== "closed"
      ? latestByTerminal
      : null;
  },
});

export const recordRegisterSessionTransaction = internalMutation({
  args: {
    registerSessionId: v.id("registerSession"),
    storeId: v.id("store"),
    adjustmentKind: v.union(v.literal("sale"), v.literal("void")),
    payments: v.array(
      v.object({
        method: v.string(),
        amount: v.number(),
        timestamp: v.number(),
      })
    ),
    changeGiven: v.optional(v.number()),
    registerNumber: v.optional(v.string()),
    terminalId: v.optional(v.id("posTerminal")),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("registerSession", args.registerSessionId);
    if (!session || session.storeId !== args.storeId) {
      throw new Error("Register session not found for this store.");
    }

    assertRegisterSessionMatchesTransaction(session, args);

    if (
      args.adjustmentKind === "sale" &&
      (session.status === "closing" || session.status === "closed")
    ) {
      throw new Error("Register session is not accepting new transactions.");
    }

    const updates = buildRegisterSessionTransactionPatch(session, args);

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch("registerSession", args.registerSessionId, updates);
    }

    return ctx.db.get("registerSession", args.registerSessionId);
  },
});

export const beginRegisterSessionCloseout = internalMutation({
  args: {
    registerSessionId: v.id("registerSession"),
    countedCash: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("registerSession", args.registerSessionId);
    if (!session) {
      throw new Error("Register session not found.");
    }

    assertValidRegisterSessionTransition(session.status, "closing");

    await ctx.db.patch("registerSession", args.registerSessionId, {
      countedCash: args.countedCash,
      notes: trimOptional(args.notes) ?? session.notes,
      status: "closing",
    });

    return ctx.db.get("registerSession", args.registerSessionId);
  },
});

export const closeRegisterSession = internalMutation({
  args: {
    registerSessionId: v.id("registerSession"),
    countedCash: v.number(),
    closedByUserId: v.optional(v.id("athenaUser")),
    closedByStaffProfileId: v.optional(v.id("staffProfile")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("registerSession", args.registerSessionId);
    if (!session) {
      throw new Error("Register session not found.");
    }

    assertValidRegisterSessionTransition(session.status, "closed");

    await ctx.db.patch("registerSession", args.registerSessionId, {
      closedAt: Date.now(),
      closedByStaffProfileId: args.closedByStaffProfileId,
      closedByUserId: args.closedByUserId,
      countedCash: args.countedCash,
      notes: trimOptional(args.notes) ?? session.notes,
      status: "closed",
      variance: args.countedCash - session.expectedCash,
    });

    return ctx.db.get("registerSession", args.registerSessionId);
  },
});
