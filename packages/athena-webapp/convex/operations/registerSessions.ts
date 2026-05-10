import { internalMutation, internalQuery, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  isPosUsableRegisterSessionStatus,
  isRegisterSessionConflictBlockingStatus,
  type RegisterSessionStatus,
} from "../../shared/registerSessionStatus";
import { recordRegisterSessionTraceBestEffort } from "./registerSessionTracing";

const registerSessionStatusSet = (
  ...statuses: RegisterSessionStatus[]
): ReadonlySet<RegisterSessionStatus> => new Set(statuses);

const REGISTER_SESSION_TRANSITIONS = {
  active: registerSessionStatusSet("closing"),
  closed: registerSessionStatusSet(),
  closing: registerSessionStatusSet("active", "closed"),
  open: registerSessionStatusSet("active", "closing"),
} satisfies Record<RegisterSessionStatus, ReadonlySet<RegisterSessionStatus>>;
type RegisterSessionIdentity = {
  registerNumber?: string | null;
  terminalId?: Id<"posTerminal"> | null;
};
type RegisterSessionCashAdjustmentKind = "sale" | "void";
type RegisterSessionCloseoutRecord = {
  actorStaffProfileId?: Id<"staffProfile">;
  actorUserId?: Id<"athenaUser">;
  countedCash?: number;
  expectedCash: number;
  notes?: string;
  occurredAt: number;
  previousClosedAt?: number;
  previousClosedByStaffProfileId?: Id<"staffProfile">;
  previousClosedByUserId?: Id<"athenaUser">;
  reason?: string;
  type: "closed" | "reopened";
  variance?: number;
};

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}

async function persistRegisterSessionWorkflowTraceIdBestEffort(
  ctx: MutationCtx,
  args: {
    registerSessionId: Id<"registerSession">;
    traceCreated: boolean;
    traceId?: string;
    workflowTraceId?: string;
  }
) {
  if (!args.traceId || args.workflowTraceId || !args.traceCreated) {
    return;
  }

  try {
    await ctx.db.patch("registerSession", args.registerSessionId, {
      workflowTraceId: args.traceId,
    });
  } catch (error) {
    console.error("[workflow-trace] register.session.trace.link", error);
  }
}

function normalizeRegisterSessionIdentity<T extends RegisterSessionIdentity>(args: T) {
  return {
    ...args,
    registerNumber: trimOptional(args.registerNumber),
  };
}

export function assertRegisterSessionIdentity<T extends RegisterSessionIdentity>(args: T) {
  const normalizedArgs = normalizeRegisterSessionIdentity(args);

  if (!normalizedArgs.terminalId) {
    throw new Error("Register sessions require a terminal.");
  }

  return normalizedArgs;
}

export function assertRegisterSessionMatchesTransaction(
  session: RegisterSessionIdentity,
  transactionIdentity: RegisterSessionIdentity
) {
  const normalizedSession = normalizeRegisterSessionIdentity(session);
  const normalizedTransaction = normalizeRegisterSessionIdentity(transactionIdentity);

  if (!normalizedTransaction.terminalId) {
    throw new Error(
      "Register session transactions must include a terminal."
    );
  }

  if (!normalizedSession.terminalId) {
    throw new Error("Register session does not match the transaction identity.");
  }

  if (normalizedSession.terminalId !== normalizedTransaction.terminalId) {
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

export function buildRegisterSessionCloseoutPatch(
  session: {
    countedCash?: number;
    expectedCash: number;
    notes?: string;
    status: RegisterSessionStatus;
    variance?: number;
  },
  args: {
    countedCash?: number;
    notes?: string;
  }
) {
  assertValidRegisterSessionTransition(session.status, "closing");

  return {
    countedCash: args.countedCash,
    notes: trimOptional(args.notes) ?? session.notes,
    status: "closing" as const,
    variance:
      args.countedCash !== undefined
        ? args.countedCash - session.expectedCash
        : session.variance,
  };
}

export function buildReopenedRegisterSessionPatch(session: {
  status: RegisterSessionStatus;
}) {
  assertValidRegisterSessionTransition(session.status, "active");

  return {
    countedCash: undefined,
    managerApprovalRequestId: undefined,
    status: "active" as const,
    variance: undefined,
  };
}

export function buildReopenedClosedRegisterSessionPatch(
  session: {
    closedAt?: number;
    closedByStaffProfileId?: Id<"staffProfile">;
    closedByUserId?: Id<"athenaUser">;
    closeoutRecords?: RegisterSessionCloseoutRecord[];
    countedCash?: number;
    expectedCash: number;
    notes?: string;
    status: RegisterSessionStatus;
    variance?: number;
  },
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    reason?: string;
  }
) {
  if (session.status !== "closed") {
    throw new Error("Only closed register sessions can be reopened for correction.");
  }

  const occurredAt = Date.now();
  const reason =
    trimOptional(args.reason) ??
    "Closed register closeout reopened for correction.";

  return {
    closedAt: undefined,
    closedByStaffProfileId: undefined,
    closedByUserId: undefined,
    closeoutRecords: [
      ...(session.closeoutRecords ?? []),
      omitUndefined({
        actorStaffProfileId: args.actorStaffProfileId,
        actorUserId: args.actorUserId,
        countedCash: session.countedCash,
        expectedCash: session.expectedCash,
        notes: session.notes,
        occurredAt,
        previousClosedAt: session.closedAt,
        previousClosedByStaffProfileId: session.closedByStaffProfileId,
        previousClosedByUserId: session.closedByUserId,
        reason,
        type: "reopened" as const,
        variance: session.variance,
      }),
    ],
    managerApprovalRequestId: undefined,
    status: "closing" as const,
  };
}

export function buildRegisterSessionDepositPatch(
  session: {
    countedCash?: number;
    expectedCash: number;
    variance?: number;
  },
  args: {
    amount: number;
  }
) {
  if (args.amount <= 0) {
    throw new Error("Register session deposits must be positive.");
  }

  const nextExpectedCash = session.expectedCash - args.amount;

  if (nextExpectedCash < 0) {
    throw new Error("Register session expected cash cannot be negative.");
  }

  return {
    expectedCash: nextExpectedCash,
    variance:
      session.countedCash !== undefined
        ? session.countedCash - nextExpectedCash
        : session.variance,
  };
}

export function buildRegisterSessionOpeningFloatCorrectionPatch(
  session: {
    countedCash?: number;
    expectedCash: number;
    openingFloat: number;
    status: RegisterSessionStatus;
    variance?: number;
  },
  args: {
    correctedOpeningFloat: number;
  }
) {
  if (!Number.isFinite(args.correctedOpeningFloat) || args.correctedOpeningFloat < 0) {
    throw new Error("Corrected opening float must be a non-negative amount.");
  }

  if (session.status !== "open" && session.status !== "active") {
    throw new Error("Opening float can only be corrected while the register session is open.");
  }

  if (args.correctedOpeningFloat === session.openingFloat) {
    return {};
  }

  const floatDelta = args.correctedOpeningFloat - session.openingFloat;
  const nextExpectedCash = session.expectedCash + floatDelta;

  if (nextExpectedCash < 0) {
    throw new Error("Register session expected cash cannot be negative.");
  }

  return {
    expectedCash: nextExpectedCash,
    openingFloat: args.correctedOpeningFloat,
    variance:
      session.countedCash !== undefined
        ? session.countedCash - nextExpectedCash
        : session.variance,
  };
}

export function buildClosedRegisterSessionPatch(
  session: {
    closeoutRecords?: RegisterSessionCloseoutRecord[];
    expectedCash: number;
    notes?: string;
    status: RegisterSessionStatus;
  },
  args: {
    countedCash: number;
    closedByUserId?: Id<"athenaUser">;
    closedByStaffProfileId?: Id<"staffProfile">;
    notes?: string;
  }
) {
  assertValidRegisterSessionTransition(session.status, "closed");
  const closedAt = Date.now();
  const notes = trimOptional(args.notes) ?? session.notes;
  const variance = args.countedCash - session.expectedCash;

  return {
    closedAt,
    closedByStaffProfileId: args.closedByStaffProfileId,
    closedByUserId: args.closedByUserId,
    closeoutRecords: [
      ...(session.closeoutRecords ?? []),
      omitUndefined({
        actorStaffProfileId: args.closedByStaffProfileId,
        actorUserId: args.closedByUserId,
        countedCash: args.countedCash,
        expectedCash: session.expectedCash,
        notes,
        occurredAt: closedAt,
        type: "closed" as const,
        variance,
      }),
    ],
    countedCash: args.countedCash,
    notes,
    status: "closed" as const,
    variance,
  };
}

async function findConflictingRegisterSession(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    registerNumber?: string;
  }
) {
  const latestByTerminal = await ctx.db
    .query("registerSession")
    .withIndex("by_terminalId", (q) => q.eq("terminalId", args.terminalId))
    .order("desc")
    .first();

  if (
    latestByTerminal &&
    isRegisterSessionConflictBlockingStatus(latestByTerminal.status)
  ) {
    throw new Error("A register session is already open for this terminal.");
  }

  if (!args.registerNumber) {
    return;
  }

  const latestByRegisterNumber = await ctx.db
    .query("registerSession")
    .withIndex("by_storeId_registerNumber", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("registerNumber", args.registerNumber as string)
    )
    .order("desc")
    .first();

  if (
    latestByRegisterNumber &&
    isRegisterSessionConflictBlockingStatus(latestByRegisterNumber.status)
  ) {
    throw new Error("A register session is already open for this register number.");
  }
}

export const openRegisterSession = internalMutation({
  args: {
    storeId: v.id("store"),
    organizationId: v.optional(v.id("organization")),
    terminalId: v.id("posTerminal"),
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
    const session = await ctx.db.get("registerSession", sessionId);

    if (!session) {
      return null;
    }

    const traceResult = await recordRegisterSessionTraceBestEffort(ctx, {
      stage: "opened",
      session,
    });

    await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
      registerSessionId: sessionId,
      traceCreated: traceResult.traceCreated,
      traceId: traceResult.traceId,
      workflowTraceId: session.workflowTraceId,
    });

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
    const registerNumber = trimOptional(args.registerNumber);
    if (!args.terminalId) {
      return null;
    }

    const latestByTerminal = await ctx.db
      .query("registerSession")
      .withIndex("by_terminalId", (q) => q.eq("terminalId", args.terminalId))
      .order("desc")
      .first();

    if (!latestByTerminal || !isPosUsableRegisterSessionStatus(latestByTerminal.status)) {
      if (!registerNumber) {
        return null;
      }
    } else {
      return latestByTerminal;
    }

    const latestByRegisterNumber = await ctx.db
      .query("registerSession")
      .withIndex("by_storeId_registerNumber", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("registerNumber", registerNumber),
      )
      .order("desc")
      .first();

    if (
      latestByRegisterNumber &&
      latestByRegisterNumber.terminalId === args.terminalId &&
      isPosUsableRegisterSessionStatus(latestByRegisterNumber.status)
    ) {
      return latestByRegisterNumber;
    }

    return null;
  },
});

export const getRegisterSessionForRegisterState = internalQuery({
  args: {
    storeId: v.id("store"),
    registerNumber: v.optional(v.string()),
    terminalId: v.optional(v.id("posTerminal")),
  },
  handler: async (ctx, args) => {
    const registerNumber = trimOptional(args.registerNumber);
    if (!args.terminalId) {
      return null;
    }

    if (registerNumber) {
      const latestByRegisterNumber = await ctx.db
        .query("registerSession")
        .withIndex("by_storeId_registerNumber", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("registerNumber", registerNumber),
        )
        .order("desc")
        .first();

      if (
        latestByRegisterNumber &&
        isPosUsableRegisterSessionStatus(latestByRegisterNumber.status) &&
        latestByRegisterNumber.terminalId === args.terminalId
      ) {
        return latestByRegisterNumber;
      }
    }

    const latestByTerminal = await ctx.db
      .query("registerSession")
      .withIndex("by_terminalId", (q) => q.eq("terminalId", args.terminalId))
      .order("desc")
      .first();

    if (!latestByTerminal || !isRegisterSessionConflictBlockingStatus(latestByTerminal.status)) {
      return null;
    }

    return latestByTerminal;
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
    terminalId: v.id("posTerminal"),
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

    const updatedSession = await ctx.db.get("registerSession", args.registerSessionId);

    if (!updatedSession) {
      return null;
    }

    const amount = calculateRegisterSessionCashDelta({
      changeGiven: args.changeGiven,
      payments: args.payments,
    });

    if (amount > 0) {
      const occurredAt = Date.now();
      const traceResult = await recordRegisterSessionTraceBestEffort(ctx, {
        stage:
          args.adjustmentKind === "sale" ? "sale_recorded" : "void_recorded",
        session: updatedSession,
        occurredAt,
        amount,
      });

      await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
        registerSessionId: updatedSession._id,
        traceCreated: traceResult.traceCreated,
        traceId: traceResult.traceId,
        workflowTraceId: updatedSession.workflowTraceId,
      });
    }

    return updatedSession;
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

    await ctx.db.patch(
      "registerSession",
      args.registerSessionId,
      buildRegisterSessionCloseoutPatch(session, args)
    );

    return ctx.db.get("registerSession", args.registerSessionId);
  },
});

export const reopenRegisterSession = internalMutation({
  args: {
    registerSessionId: v.id("registerSession"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("registerSession", args.registerSessionId);
    if (!session) {
      throw new Error("Register session not found.");
    }

    await ctx.db.patch(
      "registerSession",
      args.registerSessionId,
      buildReopenedRegisterSessionPatch(session)
    );

    return ctx.db.get("registerSession", args.registerSessionId);
  },
});

export const reopenClosedRegisterSessionCloseout = internalMutation({
  args: {
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    actorUserId: v.optional(v.id("athenaUser")),
    reason: v.optional(v.string()),
    registerSessionId: v.id("registerSession"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("registerSession", args.registerSessionId);
    if (!session) {
      throw new Error("Register session not found.");
    }

    if (session.status !== "closed") {
      throw new Error("Only closed register sessions can be reopened for correction.");
    }

    if (session.terminalId) {
      await findConflictingRegisterSession(ctx, {
        storeId: session.storeId,
        terminalId: session.terminalId,
        registerNumber: session.registerNumber,
      });
    }

    await ctx.db.patch(
      "registerSession",
      args.registerSessionId,
      buildReopenedClosedRegisterSessionPatch(session, args)
    );

    return ctx.db.get("registerSession", args.registerSessionId);
  },
});

export async function recordRegisterSessionDepositWithCtx(
  ctx: MutationCtx,
  args: {
    amount: number;
    registerSessionId: Id<"registerSession">;
  }
) {
  const session = await ctx.db.get("registerSession", args.registerSessionId);

  if (!session) {
    throw new Error("Register session not found.");
  }

  if (session.status === "closed") {
    throw new Error("Cannot record a deposit for a closed register session.");
  }

  await ctx.db.patch(
    "registerSession",
    args.registerSessionId,
    buildRegisterSessionDepositPatch(session, args)
  );

  return ctx.db.get("registerSession", args.registerSessionId);
}

export const recordRegisterSessionDeposit = internalMutation({
  args: {
    amount: v.number(),
    registerSessionId: v.id("registerSession"),
  },
  handler: (ctx, args) => recordRegisterSessionDepositWithCtx(ctx, args),
});

export async function correctRegisterSessionOpeningFloatWithCtx(
  ctx: MutationCtx,
  args: {
    correctedOpeningFloat: number;
    registerSessionId: Id<"registerSession">;
  }
) {
  const session = await ctx.db.get("registerSession", args.registerSessionId);

  if (!session) {
    throw new Error("Register session not found.");
  }

  const updates = buildRegisterSessionOpeningFloatCorrectionPatch(session, args);

  if (Object.keys(updates).length > 0) {
    await ctx.db.patch("registerSession", args.registerSessionId, updates);
  }

  return ctx.db.get("registerSession", args.registerSessionId);
}

export const correctRegisterSessionOpeningFloat = internalMutation({
  args: {
    correctedOpeningFloat: v.number(),
    registerSessionId: v.id("registerSession"),
  },
  handler: (ctx, args) => correctRegisterSessionOpeningFloatWithCtx(ctx, args),
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

    await ctx.db.patch(
      "registerSession",
      args.registerSessionId,
      buildClosedRegisterSessionPatch(session, args)
    );

    return ctx.db.get("registerSession", args.registerSessionId);
  },
});
