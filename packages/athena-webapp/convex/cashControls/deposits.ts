import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { buildRegisterSessionCloseoutReview, getCashControlsConfig } from "./closeouts";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { recordPaymentAllocationWithCtx } from "../operations/paymentAllocations";
import { recordRegisterSessionDepositWithCtx } from "../operations/registerSessions";
import { recordRegisterSessionTraceBestEffort } from "../operations/registerSessionTracing";

const CASH_DEPOSIT_ALLOCATION_TYPE = "cash_deposit";
const CASH_DEPOSIT_SUBJECT_TYPE = "register_cash_deposit";
const RECENT_DEPOSIT_LIMIT = 10;
const SESSION_LIMIT = 100;
const TIMELINE_LIMIT = 200;

type StaffNameMap = Map<Id<"staffProfile">, string>;

type CashControlApprovalRequest = Pick<
  Doc<"approvalRequest">,
  "_id" | "reason" | "requestedByStaffProfileId" | "status"
>;

type CashControlDepositAllocation = Pick<
  Doc<"paymentAllocation">,
  | "_id"
  | "actorStaffProfileId"
  | "amount"
  | "externalReference"
  | "notes"
  | "recordedAt"
  | "registerSessionId"
>;

type CashControlRegisterSession = Pick<
  Doc<"registerSession">,
  | "_id"
  | "closedAt"
  | "closedByStaffProfileId"
  | "countedCash"
  | "expectedCash"
  | "managerApprovalRequestId"
  | "notes"
  | "openedAt"
  | "openedByStaffProfileId"
  | "openingFloat"
  | "registerNumber"
  | "status"
  | "variance"
  | "workflowTraceId"
>;

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

async function persistRegisterSessionWorkflowTraceIdBestEffort(
  ctx: MutationCtx,
  args: {
    registerSessionId: Id<"registerSession">;
    traceId?: string;
    workflowTraceId?: string;
  }
) {
  if (!args.traceId || args.workflowTraceId) {
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

function isCashControlDepositAllocation(
  allocation: Pick<Doc<"paymentAllocation">, "allocationType" | "direction" | "registerSessionId">
) {
  return (
    allocation.allocationType === CASH_DEPOSIT_ALLOCATION_TYPE &&
    allocation.direction === "out" &&
    Boolean(allocation.registerSessionId)
  );
}

async function listStaffNames(
  ctx: Pick<QueryCtx, "db">,
  staffProfileIds: Set<Id<"staffProfile">>
) {
  const staffEntries = await Promise.all(
    Array.from(staffProfileIds).map(async (staffProfileId) => {
      const staffProfile = await ctx.db.get("staffProfile", staffProfileId);
      return staffProfile ? [staffProfileId, staffProfile.fullName] : null;
    })
  );

  return new Map(
    staffEntries.filter(Boolean) as Array<[Id<"staffProfile">, string]>
  );
}

function sumDepositsBySession(
  deposits: CashControlDepositAllocation[]
) {
  return deposits.reduce((totals, deposit) => {
    if (!deposit.registerSessionId) {
      return totals;
    }

    totals.set(
      deposit.registerSessionId,
      (totals.get(deposit.registerSessionId) ?? 0) + deposit.amount
    );

    return totals;
  }, new Map<Id<"registerSession">, number>());
}

export function buildRegisterSessionDepositTargetId(args: {
  registerSessionId: Id<"registerSession">;
  submissionKey: string;
}) {
  return `${args.registerSessionId}:${args.submissionKey}`;
}

function buildRegisterSessionSummary(args: {
  approvalRequest?: CashControlApprovalRequest | null;
  registerSession: CashControlRegisterSession;
  staffNamesById: StaffNameMap;
  totalDeposited: number;
}) {
  return {
    ...args.registerSession,
    closedByStaffName: args.registerSession.closedByStaffProfileId
      ? args.staffNamesById.get(args.registerSession.closedByStaffProfileId) ?? null
      : null,
    openedByStaffName: args.registerSession.openedByStaffProfileId
      ? args.staffNamesById.get(args.registerSession.openedByStaffProfileId) ?? null
      : null,
    pendingApprovalRequest: args.approvalRequest
      ? {
          _id: args.approvalRequest._id,
          reason: args.approvalRequest.reason,
          requestedByStaffName: args.approvalRequest.requestedByStaffProfileId
            ? args.staffNamesById.get(args.approvalRequest.requestedByStaffProfileId) ?? null
            : null,
          status: args.approvalRequest.status,
        }
      : null,
    totalDeposited: args.totalDeposited,
  };
}

export function buildCashControlsDashboardSnapshot(args: {
  approvalRequestsBySessionId: Map<Id<"registerSession">, CashControlApprovalRequest>;
  deposits: CashControlDepositAllocation[];
  registerSessions: CashControlRegisterSession[];
  staffNamesById: StaffNameMap;
}) {
  const totalDepositedBySessionId = sumDepositsBySession(args.deposits);
  const registerNumberBySessionId = new Map(
    args.registerSessions.map((registerSession) => [
      registerSession._id,
      registerSession.registerNumber?.trim() || "Unnamed register",
    ])
  );

  const sessionSummaries = [...args.registerSessions]
    .sort((left, right) => right.openedAt - left.openedAt)
    .map((registerSession) =>
      buildRegisterSessionSummary({
        approvalRequest: args.approvalRequestsBySessionId.get(registerSession._id) ?? null,
        registerSession,
        staffNamesById: args.staffNamesById,
        totalDeposited: totalDepositedBySessionId.get(registerSession._id) ?? 0,
      })
    );

  return {
    openSessions: sessionSummaries.filter((registerSession) =>
      registerSession.status === "open" || registerSession.status === "active"
    ),
    pendingCloseouts: sessionSummaries.filter(
      (registerSession) => registerSession.status === "closing"
    ),
    recentDeposits: [...args.deposits]
      .sort((left, right) => right.recordedAt - left.recordedAt)
      .slice(0, RECENT_DEPOSIT_LIMIT)
      .map((deposit) => ({
        _id: deposit._id,
        amount: deposit.amount,
        notes: deposit.notes,
        recordedAt: deposit.recordedAt,
        recordedByStaffName: deposit.actorStaffProfileId
          ? args.staffNamesById.get(deposit.actorStaffProfileId) ?? null
          : null,
        reference: deposit.externalReference,
        registerNumber: deposit.registerSessionId
          ? registerNumberBySessionId.get(deposit.registerSessionId) ?? "Unnamed register"
          : "Unnamed register",
        registerSessionId: deposit.registerSessionId ?? null,
      })),
    unresolvedVariances: sessionSummaries.filter((registerSession) => {
      const variance = registerSession.variance ?? 0;

      return (
        variance !== 0 &&
        (registerSession.status === "closing" ||
          Boolean(registerSession.pendingApprovalRequest))
      );
    }),
  };
}

async function listRegisterSessionsForDashboard(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">
) {
  const [openSessions, activeSessions, closingSessions] = await Promise.all([
    ctx.db
      .query("registerSession")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", storeId).eq("status", "open")
      )
      .take(SESSION_LIMIT),
    ctx.db
      .query("registerSession")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", storeId).eq("status", "active")
      )
      .take(SESSION_LIMIT),
    ctx.db
      .query("registerSession")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", storeId).eq("status", "closing")
      )
      .take(SESSION_LIMIT),
  ]);

  return [...openSessions, ...activeSessions, ...closingSessions];
}

async function listStoreDeposits(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">
) {
  const allocations =
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- The cash-controls dashboard needs the full store-scoped deposit ledger to compute register totals and recent deposit history.
    await ctx.db
      .query("paymentAllocation")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .collect();

  return allocations.filter(isCashControlDepositAllocation);
}

async function listSessionDeposits(
  ctx: Pick<QueryCtx, "db">,
  registerSessionId: Id<"registerSession">
) {
  const allocations =
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- Session detail should show the complete deposit ledger for one drawer.
    await ctx.db
      .query("paymentAllocation")
      .withIndex("by_registerSessionId", (q) => q.eq("registerSessionId", registerSessionId))
      .collect();

  return allocations.filter(isCashControlDepositAllocation);
}

async function listRegisterSessionTimeline(
  ctx: Pick<QueryCtx, "db">,
  registerSessionId: Id<"registerSession">
) {
  return (
    await ctx.db
      .query("operationalEvent")
      .withIndex("by_registerSessionId", (q) => q.eq("registerSessionId", registerSessionId))
      .order("desc")
      .take(TIMELINE_LIMIT)
  ).sort((left, right) => right.createdAt - left.createdAt);
}

function collectStaffProfileIds(args: {
  approvalRequests: CashControlApprovalRequest[];
  deposits: CashControlDepositAllocation[];
  registerSessions: CashControlRegisterSession[];
  timeline?: Array<Pick<Doc<"operationalEvent">, "actorStaffProfileId">>;
}) {
  const staffProfileIds = new Set<Id<"staffProfile">>();

  for (const registerSession of args.registerSessions) {
    if (registerSession.openedByStaffProfileId) {
      staffProfileIds.add(registerSession.openedByStaffProfileId);
    }

    if (registerSession.closedByStaffProfileId) {
      staffProfileIds.add(registerSession.closedByStaffProfileId);
    }
  }

  for (const approvalRequest of args.approvalRequests) {
    if (approvalRequest.requestedByStaffProfileId) {
      staffProfileIds.add(approvalRequest.requestedByStaffProfileId);
    }
  }

  for (const deposit of args.deposits) {
    if (deposit.actorStaffProfileId) {
      staffProfileIds.add(deposit.actorStaffProfileId);
    }
  }

  for (const event of args.timeline ?? []) {
    if (event.actorStaffProfileId) {
      staffProfileIds.add(event.actorStaffProfileId);
    }
  }

  return staffProfileIds;
}

export const getDashboardSnapshot = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const [registerSessions, pendingApprovalRequests, deposits] = await Promise.all([
      listRegisterSessionsForDashboard(ctx, args.storeId),
      ctx.db
        .query("approvalRequest")
        .withIndex("by_storeId_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", "pending")
        )
        .order("desc")
        .take(SESSION_LIMIT),
      listStoreDeposits(ctx, args.storeId),
    ]);

    const relevantApprovalRequests = pendingApprovalRequests.filter(
      (approvalRequest) =>
        approvalRequest.requestType === "variance_review" &&
        Boolean(approvalRequest.registerSessionId)
    );
    const approvalRequestsBySessionId = new Map(
      relevantApprovalRequests.map((approvalRequest) => [
        approvalRequest.registerSessionId!,
        approvalRequest,
      ])
    );
    const staffNamesById = await listStaffNames(
      ctx,
      collectStaffProfileIds({
        approvalRequests: relevantApprovalRequests,
        deposits,
        registerSessions,
      })
    );

    return buildCashControlsDashboardSnapshot({
      approvalRequestsBySessionId,
      deposits,
      registerSessions,
      staffNamesById,
    });
  },
});

export const getRegisterSessionSnapshot = query({
  args: {
    registerSessionId: v.id("registerSession"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const registerSession = await ctx.db.get("registerSession", args.registerSessionId);

    if (!registerSession || registerSession.storeId !== args.storeId) {
      throw new Error("Register session not found for this store.");
    }

    const [store, deposits, timeline, approvalRequest] = await Promise.all([
      ctx.db.get("store", args.storeId),
      listSessionDeposits(ctx, args.registerSessionId),
      listRegisterSessionTimeline(ctx, args.registerSessionId),
      registerSession.managerApprovalRequestId
        ? ctx.db.get("approvalRequest", registerSession.managerApprovalRequestId)
        : Promise.resolve(null),
    ]);
    const approvalRequests = approvalRequest ? [approvalRequest] : [];
    const staffNamesById = await listStaffNames(
      ctx,
      collectStaffProfileIds({
        approvalRequests,
        deposits,
        registerSessions: [registerSession],
        timeline,
      })
    );
    const totalDeposited = deposits.reduce((sum, deposit) => sum + deposit.amount, 0);
    const closeoutReview =
      registerSession.countedCash !== undefined
        ? buildRegisterSessionCloseoutReview({
            countedCash: registerSession.countedCash,
            config: getCashControlsConfig(store),
            expectedCash: registerSession.expectedCash,
          })
        : null;

    return {
      closeoutReview,
      deposits: deposits
        .sort((left, right) => right.recordedAt - left.recordedAt)
        .map((deposit) => ({
          _id: deposit._id,
          amount: deposit.amount,
          notes: deposit.notes,
          recordedAt: deposit.recordedAt,
          recordedByStaffName: deposit.actorStaffProfileId
            ? staffNamesById.get(deposit.actorStaffProfileId) ?? null
            : null,
          reference: deposit.externalReference,
          registerSessionId: deposit.registerSessionId ?? null,
        })),
      registerSession: {
        ...buildRegisterSessionSummary({
          approvalRequest,
          registerSession,
          staffNamesById,
          totalDeposited,
        }),
        netExpectedCash: registerSession.expectedCash,
      },
      timeline: timeline.map((event) => ({
        _id: event._id,
        actorStaffName: event.actorStaffProfileId
          ? staffNamesById.get(event.actorStaffProfileId) ?? null
          : null,
        createdAt: event.createdAt,
        eventType: event.eventType,
        message: event.message,
        reason: event.reason,
      })),
    };
  },
});

export const recordRegisterSessionDeposit = mutation({
  args: {
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    actorUserId: v.optional(v.id("athenaUser")),
    amount: v.number(),
    notes: v.optional(v.string()),
    reference: v.optional(v.string()),
    registerSessionId: v.id("registerSession"),
    storeId: v.id("store"),
    submissionKey: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.amount <= 0) {
      throw new Error("Deposit amount must be positive.");
    }

    const submissionKey = trimOptional(args.submissionKey);

    if (!submissionKey) {
      throw new Error("A submission key is required to record a register deposit.");
    }

    const registerSession = await ctx.db.get("registerSession", args.registerSessionId);

    if (!registerSession || registerSession.storeId !== args.storeId) {
      throw new Error("Register session not found for this store.");
    }

    const targetId = buildRegisterSessionDepositTargetId({
      registerSessionId: args.registerSessionId,
      submissionKey,
    });
    const existingDeposit = await ctx.db
      .query("paymentAllocation")
      .withIndex("by_storeId_target", (q) =>
        q.eq("storeId", args.storeId).eq("targetType", CASH_DEPOSIT_SUBJECT_TYPE).eq("targetId", targetId)
      )
      .first();

    if (existingDeposit && isCashControlDepositAllocation(existingDeposit)) {
      return {
        action: "duplicate" as const,
        deposit: existingDeposit,
        registerSession,
      };
    }

    const deposit = await recordPaymentAllocationWithCtx(ctx, {
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
      allocationType: CASH_DEPOSIT_ALLOCATION_TYPE,
      amount: args.amount,
      collectedInStore: true,
      direction: "out",
      externalReference: trimOptional(args.reference),
      method: "cash",
      notes: trimOptional(args.notes),
      organizationId: registerSession.organizationId,
      registerSessionId: args.registerSessionId,
      storeId: args.storeId,
      targetId,
      targetType: CASH_DEPOSIT_SUBJECT_TYPE,
    });
    const updatedRegisterSession = await recordRegisterSessionDepositWithCtx(ctx, {
      amount: args.amount,
      registerSessionId: args.registerSessionId,
    });

    if (!updatedRegisterSession) {
      throw new Error("Register session deposit was recorded without a session.");
    }

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
      eventType: "register_session_cash_deposit_recorded",
      message: `Recorded cash deposit of ${args.amount}.`,
      metadata: {
        amount: args.amount,
        reference: trimOptional(args.reference),
        submissionKey,
      },
      organizationId: registerSession.organizationId,
      paymentAllocationId: deposit?._id,
      reason: trimOptional(args.notes),
      registerSessionId: args.registerSessionId,
      storeId: args.storeId,
      subjectId: targetId,
      subjectLabel: registerSession.registerNumber,
      subjectType: CASH_DEPOSIT_SUBJECT_TYPE,
    });

    const occurredAt = Date.now();
    const traceResult = await recordRegisterSessionTraceBestEffort(ctx, {
      stage: "deposit_recorded",
      session: updatedRegisterSession,
      occurredAt,
      amount: args.amount,
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
    });

    await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
      registerSessionId: args.registerSessionId,
      traceId: traceResult.traceId,
      workflowTraceId: updatedRegisterSession.workflowTraceId,
    });

    return {
      action: "recorded" as const,
      deposit,
      registerSession: updatedRegisterSession,
    };
  },
});
