import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { buildRegisterSessionCloseoutReview, getCashControlsConfig } from "./closeouts";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { recordPaymentAllocationWithCtx } from "../operations/paymentAllocations";
import { recordRegisterSessionDepositWithCtx } from "../operations/registerSessions";
import { recordRegisterSessionTraceBestEffort } from "../operations/registerSessionTracing";
import { toPesewas } from "../lib/currency";
import {
  listCompletedTransactions,
  listTransactionItems,
} from "../pos/infrastructure/repositories/transactionRepository";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { isPosUsableRegisterSessionStatus } from "../../shared/registerSessionStatus";
import { formatStaffDisplayName } from "../../shared/staffDisplayName";

const CASH_DEPOSIT_ALLOCATION_TYPE = "cash_deposit";
const CASH_DEPOSIT_SUBJECT_TYPE = "register_cash_deposit";
const RECENT_DEPOSIT_LIMIT = 10;
const SESSION_LIMIT = 100;
const TIMELINE_LIMIT = 200;

const userErrorValidator = v.object({
  code: v.union(
    v.literal("validation_failed"),
    v.literal("authentication_failed"),
    v.literal("authorization_failed"),
    v.literal("not_found"),
    v.literal("conflict"),
    v.literal("precondition_failed"),
    v.literal("rate_limited"),
    v.literal("unavailable"),
  ),
  title: v.optional(v.string()),
  message: v.string(),
  fields: v.optional(v.record(v.string(), v.array(v.string()))),
  retryable: v.optional(v.boolean()),
  traceId: v.optional(v.string()),
  metadata: v.optional(v.record(v.string(), v.any())),
});

const registerSessionDepositResultValidator = v.union(
  v.object({
    kind: v.literal("ok"),
    data: v.object({
      action: v.union(v.literal("duplicate"), v.literal("recorded")),
      deposit: v.union(v.null(), v.any()),
      registerSession: v.union(v.null(), v.any()),
    }),
  }),
  v.object({
    kind: v.literal("user_error"),
    error: userErrorValidator,
  }),
);

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

type CashControlTransaction = Pick<
  Doc<"posTransaction">,
  | "_id"
  | "completedAt"
  | "customerInfo"
  | "customerProfileId"
  | "paymentMethod"
  | "payments"
  | "staffProfileId"
  | "total"
  | "transactionNumber"
  | "workflowTraceId"
>;

type RecordRegisterSessionDepositResult = {
  action: "duplicate" | "recorded";
  deposit: Doc<"paymentAllocation"> | null;
  registerSession: Doc<"registerSession"> | null;
};

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
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
      const staffName = formatStaffDisplayName(staffProfile);
      return staffName ? [staffProfileId, staffName] : null;
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
      isPosUsableRegisterSessionStatus(registerSession.status)
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

async function listRegisterSessionTransactions(
  ctx: QueryCtx,
  args: {
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
  }
) {
  return listCompletedTransactions(ctx, {
    registerSessionId: args.registerSessionId,
    storeId: args.storeId,
  });
}

function collectStaffProfileIds(args: {
  approvalRequests: CashControlApprovalRequest[];
  deposits: CashControlDepositAllocation[];
  registerSessions: CashControlRegisterSession[];
  timeline?: Array<Pick<Doc<"operationalEvent">, "actorStaffProfileId">>;
  transactions?: CashControlTransaction[];
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

  for (const transaction of args.transactions ?? []) {
    if (transaction.staffProfileId) {
      staffProfileIds.add(transaction.staffProfileId);
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

    const [store, deposits, timeline, transactions, approvalRequest] = await Promise.all([
      ctx.db.get("store", args.storeId),
      listSessionDeposits(ctx, args.registerSessionId),
      listRegisterSessionTimeline(ctx, args.registerSessionId),
      listRegisterSessionTransactions(ctx, {
        registerSessionId: args.registerSessionId,
        storeId: args.storeId,
      }),
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
        transactions,
      })
    );
    const transactionItemsById = new Map(
      await Promise.all(
        transactions.map(async (transaction) => {
          const transactionItems = await listTransactionItems(ctx, transaction._id);
          return [transaction._id, transactionItems] as const;
        })
      )
    );
    const customerNamesById = new Map(
      (
        await Promise.all(
          transactions.map(async (transaction) => {
            if (!transaction.customerProfileId) {
              return null;
            }

            const customerProfile = await ctx.db.get(
              "customerProfile",
              transaction.customerProfileId
            );

            return customerProfile
              ? [transaction.customerProfileId, customerProfile.fullName]
              : null;
          })
        )
      ).filter(Boolean) as Array<[Id<"customerProfile">, string | undefined]>
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
      transactions: transactions.map((transaction) => {
        const transactionItems = transactionItemsById.get(transaction._id) ?? [];
        const paymentMethods = transaction.payments?.length
          ? Array.from(new Set(transaction.payments.map((payment) => payment.method)))
          : transaction.paymentMethod
            ? [transaction.paymentMethod]
            : [];

        return {
          _id: transaction._id,
          cashierName: transaction.staffProfileId
            ? staffNamesById.get(transaction.staffProfileId) ?? null
            : null,
          completedAt: transaction.completedAt,
          customerName:
            (transaction.customerProfileId
              ? customerNamesById.get(transaction.customerProfileId)
              : null) ??
            transaction.customerInfo?.name ??
            null,
          hasMultiplePaymentMethods: paymentMethods.length > 1,
          itemCount: transactionItems.reduce((sum, item) => sum + item.quantity, 0),
          paymentMethod: transaction.paymentMethod ?? paymentMethods[0] ?? null,
          total: transaction.total,
          transactionNumber: transaction.transactionNumber,
          workflowTraceId: transaction.workflowTraceId ?? null,
        };
      }),
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
  returns: registerSessionDepositResultValidator,
  handler: async (
    ctx,
    args
  ): Promise<CommandResult<RecordRegisterSessionDepositResult>> => {
    if (!Number.isFinite(args.amount) || args.amount <= 0) {
      return userError({
        code: "validation_failed",
        message: "Deposit amount must be positive.",
      });
    }

    const storedAmount = toPesewas(args.amount);

    const submissionKey = trimOptional(args.submissionKey);

    if (!submissionKey) {
      return userError({
        code: "validation_failed",
        message: "A submission key is required to record a register deposit.",
      });
    }

    const registerSession = await ctx.db.get("registerSession", args.registerSessionId);

    if (!registerSession || registerSession.storeId !== args.storeId) {
      return userError({
        code: "not_found",
        message: "Register session not found for this store.",
      });
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
      return ok({
        action: "duplicate" as const,
        deposit: existingDeposit,
        registerSession,
      });
    }

    if (!isPosUsableRegisterSessionStatus(registerSession.status)) {
      return userError({
        code: "precondition_failed",
        message: "Register session is not accepting new deposits.",
      });
    }

    const deposit = await recordPaymentAllocationWithCtx(ctx, {
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
      allocationType: CASH_DEPOSIT_ALLOCATION_TYPE,
      amount: storedAmount,
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
      amount: storedAmount,
      registerSessionId: args.registerSessionId,
    });

    if (!updatedRegisterSession) {
      return userError({
        code: "unavailable",
        message: "Register session deposit was recorded without a session.",
      });
    }

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
      eventType: "register_session_cash_deposit_recorded",
      message: `Recorded cash deposit of ${args.amount}.`,
      metadata: {
        amount: storedAmount,
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
      amount: storedAmount,
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
    });

    await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
      registerSessionId: args.registerSessionId,
      traceCreated: traceResult.traceCreated,
      traceId: traceResult.traceId,
      workflowTraceId: updatedRegisterSession.workflowTraceId,
    });

    return ok({
      action: "recorded" as const,
      deposit,
      registerSession: updatedRegisterSession,
    });
  },
});
