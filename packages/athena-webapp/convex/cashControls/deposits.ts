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
import { createConvexLocalSyncRepository } from "../pos/infrastructure/repositories/localSyncRepository";
import { parseStoredLocalSyncEvent } from "../pos/application/sync/ingestLocalEvents";
import { projectLocalSyncEvent } from "../pos/application/sync/projectLocalEvents";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { isPosUsableRegisterSessionStatus } from "../../shared/registerSessionStatus";
import { formatStaffDisplayName } from "../../shared/staffDisplayName";

const CASH_DEPOSIT_ALLOCATION_TYPE = "cash_deposit";
const CASH_DEPOSIT_SUBJECT_TYPE = "register_cash_deposit";
const RECENT_DEPOSIT_LIMIT = 10;
const SESSION_LIMIT = 100;
const STAFF_ROLE_LOOKUP_LIMIT = 20;
const SYNC_CONFLICT_LIMIT = 500;
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

const registerSessionSyncReviewResultValidator = v.union(
  v.object({
    kind: v.literal("ok"),
    data: v.object({
      action: v.union(v.literal("already_resolved"), v.literal("resolved")),
      projectedCount: v.optional(v.number()),
      registerSession: v.union(v.null(), v.any()),
      resolvedCount: v.number(),
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
  "_id" | "notes" | "reason" | "requestedByStaffProfileId" | "status"
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
  | "closeoutRecords"
  | "countedCash"
  | "expectedCash"
  | "managerApprovalRequestId"
  | "notes"
  | "openedAt"
  | "openedByStaffProfileId"
  | "openingFloat"
  | "registerNumber"
  | "status"
  | "storeId"
  | "terminalId"
  | "variance"
  | "workflowTraceId"
>;

type CashControlSyncConflict = Pick<
  Doc<"posLocalSyncConflict">,
  | "_id"
  | "conflictType"
  | "createdAt"
  | "localEventId"
  | "sequence"
  | "status"
  | "summary"
> &
  Partial<
    Pick<Doc<"posLocalSyncConflict">, "localRegisterSessionId" | "terminalId">
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

type ResolveRegisterSessionSyncReviewResult = {
  action: "already_resolved" | "resolved";
  projectedCount?: number;
  registerSession: Doc<"registerSession"> | null;
  resolvedCount: number;
};

async function requireCashControlsStoreAccess(
  ctx: QueryCtx | MutationCtx,
  storeId: Id<"store">,
) {
  const store = await ctx.db.get("store", storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin", "pos_only"],
    failureMessage: "You do not have access to cash controls.",
    organizationId: store.organizationId,
    userId: athenaUser._id,
  });

  return { athenaUser, store };
}

async function resolveDepositActorStaffProfileId(
  ctx: MutationCtx,
  args: {
    athenaUserId: Id<"athenaUser">;
    staffProfileId?: Id<"staffProfile">;
    storeId: Id<"store">;
  },
) {
  if (!args.staffProfileId) {
    throw new Error("Deposit staff actor is required.");
  }

  const staffProfile = await ctx.db.get("staffProfile", args.staffProfileId);
  if (
    !staffProfile ||
    staffProfile.storeId !== args.storeId ||
    staffProfile.status !== "active" ||
    staffProfile.linkedUserId !== args.athenaUserId
  ) {
    throw new Error("Deposit staff actor does not match the signed-in user.");
  }

  return staffProfile._id;
}

async function staffProfileCanResolveSyncReview(
  ctx: Pick<QueryCtx, "db">,
  args: {
    organizationId: Id<"organization">;
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
  },
) {
  const staffProfile = await ctx.db.get("staffProfile", args.staffProfileId);
  if (
    !staffProfile ||
    staffProfile.status !== "active" ||
    staffProfile.organizationId !== args.organizationId ||
    staffProfile.storeId !== args.storeId
  ) {
    return false;
  }

  const assignments = await ctx.db
    .query("staffRoleAssignment")
    .withIndex("by_staffProfileId", (q) =>
      q.eq("staffProfileId", args.staffProfileId),
    )
    .take(STAFF_ROLE_LOOKUP_LIMIT);

  return assignments.some(
    (assignment) =>
      assignment.role === "manager" &&
      assignment.status === "active" &&
      assignment.organizationId === args.organizationId &&
      assignment.storeId === args.storeId,
  );
}

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
  syncConflicts?: CashControlSyncConflict[];
  terminalNamesById: Map<Id<"posTerminal">, string>;
  totalDeposited: number;
}) {
  const syncConflicts = args.syncConflicts ?? [];
  return {
    ...args.registerSession,
    closedByStaffName: args.registerSession.closedByStaffProfileId
      ? args.staffNamesById.get(args.registerSession.closedByStaffProfileId) ?? null
      : null,
    openedByStaffName: args.registerSession.openedByStaffProfileId
      ? args.staffNamesById.get(args.registerSession.openedByStaffProfileId) ?? null
      : null,
    terminalName: args.registerSession.terminalId
      ? args.terminalNamesById.get(args.registerSession.terminalId) ?? null
      : null,
    pendingApprovalRequest: args.approvalRequest
      ? {
          _id: args.approvalRequest._id,
          notes: args.approvalRequest.notes,
          reason: args.approvalRequest.reason,
          requestedByStaffName: args.approvalRequest.requestedByStaffProfileId
            ? args.staffNamesById.get(args.approvalRequest.requestedByStaffProfileId) ?? null
            : null,
          status: args.approvalRequest.status,
        }
      : null,
    localSyncStatus:
      syncConflicts.length > 0
        ? {
            status: "needs_review",
            reconciliationItems: syncConflicts.map((conflict) => ({
              createdAt: conflict.createdAt,
              id: conflict._id,
              localEventId: conflict.localEventId,
              sequence: conflict.sequence,
              status: conflict.status,
              summary: conflict.summary,
              type: conflict.conflictType,
            })),
          }
        : null,
    totalDeposited: args.totalDeposited,
  };
}

async function resolveRegisterSessionWorkflowTraceId(
  ctx: QueryCtx,
  registerSession: CashControlRegisterSession,
) {
  if (registerSession.workflowTraceId) {
    return registerSession.workflowTraceId;
  }

  const traceId = `register_session:${registerSession._id}`;
  const trace = await ctx.db
    .query("workflowTrace")
    .withIndex("by_storeId_traceId", (q) =>
      q.eq("storeId", registerSession.storeId).eq("traceId", traceId)
    )
    .first();

  return trace ? traceId : undefined;
}

async function appendRegisterSessionWorkflowTraceIds(
  ctx: QueryCtx,
  registerSessions: CashControlRegisterSession[],
) {
  return Promise.all(
    registerSessions.map(async (registerSession) => ({
      ...registerSession,
      workflowTraceId: await resolveRegisterSessionWorkflowTraceId(
        ctx,
        registerSession,
      ),
    }))
  );
}

export function buildCashControlsDashboardSnapshot(args: {
  approvalRequestsBySessionId: Map<Id<"registerSession">, CashControlApprovalRequest>;
  deposits: CashControlDepositAllocation[];
  registerSessions: CashControlRegisterSession[];
  staffNamesById: StaffNameMap;
  syncConflictsBySessionId?: Map<Id<"registerSession">, CashControlSyncConflict[]>;
  terminalNamesById?: Map<Id<"posTerminal">, string>;
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
        syncConflicts:
          args.syncConflictsBySessionId?.get(registerSession._id) ?? [],
        terminalNamesById: args.terminalNamesById ?? new Map(),
        totalDeposited: totalDepositedBySessionId.get(registerSession._id) ?? 0,
      })
    );

  return {
    registerSessions: sessionSummaries,
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
        registerSession.localSyncStatus?.status === "needs_review" ||
        (variance !== 0 &&
          (registerSession.status === "closing" ||
            Boolean(registerSession.pendingApprovalRequest)))
      );
    }),
  };
}

export async function listOpenLocalSyncConflictsByRegisterSession(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
) {
  const conflicts = await ctx.db
    .query("posLocalSyncConflict")
    .withIndex("by_store_status", (q) =>
      q.eq("storeId", storeId).eq("status", "needs_review"),
    )
    .take(SYNC_CONFLICT_LIMIT);
  const entries = await Promise.all(
    conflicts.map(async (conflict) => {
      const registerSessionMapping = await ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_local", (q) =>
          q
            .eq("storeId", conflict.storeId)
            .eq("terminalId", conflict.terminalId)
            .eq("localRegisterSessionId", conflict.localRegisterSessionId)
            .eq("localIdKind", "registerSession")
            .eq("localId", conflict.localRegisterSessionId),
        )
        .unique();
      if (registerSessionMapping?.cloudTable === "registerSession") {
        return [
          registerSessionMapping.cloudId as Id<"registerSession">,
          conflict,
        ] as const;
      }

      const normalizeId = (
        ctx.db as unknown as {
          normalizeId?: (
            tableName: string,
            value: string,
          ) => Id<"registerSession"> | null;
        }
      ).normalizeId;
      const cloudRegisterSessionId =
        normalizeId?.call(
          ctx.db,
          "registerSession",
          conflict.localRegisterSessionId,
        ) ?? null;
      if (cloudRegisterSessionId) {
        const registerSession = await ctx.db.get(
          "registerSession",
          cloudRegisterSessionId,
        );
        if (
          registerSession?.storeId === conflict.storeId &&
          registerSession.terminalId === conflict.terminalId
        ) {
          return [cloudRegisterSessionId, conflict] as const;
        }
      }

      return null;
    }),
  );

  return entries.reduce(
    (conflictsBySessionId, entry) => {
      if (!entry) return conflictsBySessionId;
      const [registerSessionId, conflict] = entry;
      conflictsBySessionId.set(registerSessionId, [
        ...(conflictsBySessionId.get(registerSessionId) ?? []),
        conflict,
      ]);
      return conflictsBySessionId;
    },
    new Map<Id<"registerSession">, CashControlSyncConflict[]>(),
  );
}

async function listRegisterSessionsForDashboard(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">
) {
  return ctx.db
    .query("registerSession")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .order("desc")
    .take(SESSION_LIMIT);
}

async function appendRegisterSessionsForSyncConflicts(
  ctx: Pick<QueryCtx, "db">,
  registerSessions: Doc<"registerSession">[],
  syncConflictsBySessionId: Map<Id<"registerSession">, CashControlSyncConflict[]>,
) {
  const knownSessionIds = new Set(
    registerSessions.map((registerSession) => registerSession._id),
  );
  const missingSessionIds = Array.from(syncConflictsBySessionId.keys()).filter(
    (registerSessionId) => !knownSessionIds.has(registerSessionId),
  );
  if (missingSessionIds.length === 0) return registerSessions;

  const missingSessions = await Promise.all(
    missingSessionIds.map((registerSessionId) =>
      ctx.db.get("registerSession", registerSessionId),
    ),
  );

  return [
    ...registerSessions,
    ...missingSessions.filter(Boolean),
  ] as Doc<"registerSession">[];
}

async function listTerminalNames(
  ctx: Pick<QueryCtx, "db">,
  terminalIds: Set<Id<"posTerminal">>,
) {
  const terminalEntries = await Promise.all(
    Array.from(terminalIds).map(async (terminalId) => {
      const terminal = await ctx.db.get("posTerminal", terminalId);
      const terminalName = terminal?.displayName?.trim();
      return terminalName ? [terminalId, terminalName] : null;
    })
  );

  return new Map(
    terminalEntries.filter(Boolean) as Array<[Id<"posTerminal">, string]>
  );
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
    await requireCashControlsStoreAccess(ctx, args.storeId);

    const [
      registerSessions,
      pendingApprovalRequests,
      deposits,
      syncConflictsBySessionId,
    ] = await Promise.all([
      listRegisterSessionsForDashboard(ctx, args.storeId),
      ctx.db
        .query("approvalRequest")
        .withIndex("by_storeId_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", "pending")
        )
        .order("desc")
        .take(SESSION_LIMIT),
      listStoreDeposits(ctx, args.storeId),
      listOpenLocalSyncConflictsByRegisterSession(ctx, args.storeId),
    ]);

    const dashboardRegisterSessions =
      await appendRegisterSessionsForSyncConflicts(
        ctx,
        registerSessions,
        syncConflictsBySessionId,
      );
    const dashboardRegisterSessionsWithTraceIds =
      await appendRegisterSessionWorkflowTraceIds(ctx, dashboardRegisterSessions);
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
        registerSessions: dashboardRegisterSessionsWithTraceIds,
      })
    );
    const terminalNamesById = await listTerminalNames(
      ctx,
      new Set(
        dashboardRegisterSessionsWithTraceIds
          .map((registerSession) => registerSession.terminalId)
          .filter(Boolean) as Id<"posTerminal">[],
      ),
    );

    return buildCashControlsDashboardSnapshot({
      approvalRequestsBySessionId,
      deposits,
      registerSessions: dashboardRegisterSessionsWithTraceIds,
      staffNamesById,
      syncConflictsBySessionId,
      terminalNamesById,
    });
  },
});

export const getRegisterSessionSnapshot = query({
  args: {
    registerSessionId: v.id("registerSession"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const { store } = await requireCashControlsStoreAccess(ctx, args.storeId);
    const registerSession = await ctx.db.get("registerSession", args.registerSessionId);

    if (!registerSession || registerSession.storeId !== args.storeId) {
      throw new Error("Register session not found for this store.");
    }

    const [
      deposits,
      timeline,
      transactions,
      approvalRequest,
      syncConflictsBySessionId,
      workflowTraceId,
    ] = await Promise.all([
      listSessionDeposits(ctx, args.registerSessionId),
      listRegisterSessionTimeline(ctx, args.registerSessionId),
      listRegisterSessionTransactions(ctx, {
        registerSessionId: args.registerSessionId,
        storeId: args.storeId,
      }),
      registerSession.managerApprovalRequestId
        ? ctx.db.get("approvalRequest", registerSession.managerApprovalRequestId)
        : Promise.resolve(null),
      listOpenLocalSyncConflictsByRegisterSession(ctx, args.storeId),
      resolveRegisterSessionWorkflowTraceId(ctx, registerSession),
    ]);
    const registerSessionWithTraceId = {
      ...registerSession,
      workflowTraceId,
    };
    const approvalRequests = approvalRequest ? [approvalRequest] : [];
    const staffNamesById = await listStaffNames(
      ctx,
      collectStaffProfileIds({
        approvalRequests,
        deposits,
        registerSessions: [registerSessionWithTraceId],
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
    const terminalNamesById = await listTerminalNames(
      ctx,
      new Set(registerSession.terminalId ? [registerSession.terminalId] : [])
    );
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
          registerSession: registerSessionWithTraceId,
          staffNamesById,
          syncConflicts:
            syncConflictsBySessionId.get(args.registerSessionId) ?? [],
          terminalNamesById,
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
        metadata: event.metadata ?? null,
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
    let athenaUserId: Id<"athenaUser">;
    try {
      const { athenaUser } = await requireCashControlsStoreAccess(
        ctx,
        args.storeId,
      );
      athenaUserId = athenaUser._id;
    } catch {
      return userError({
        code: "authorization_failed",
        message: "You do not have access to cash controls.",
      });
    }

    if (args.actorUserId && args.actorUserId !== athenaUserId) {
      return userError({
        code: "authorization_failed",
        message: "Deposit actor does not match the signed-in user.",
      });
    }

    let actorStaffProfileId: Id<"staffProfile"> | undefined;
    try {
      actorStaffProfileId = await resolveDepositActorStaffProfileId(ctx, {
        athenaUserId,
        staffProfileId: args.actorStaffProfileId,
        storeId: args.storeId,
      });
    } catch {
      return userError({
        code: "authorization_failed",
        message: "Deposit staff actor does not match the signed-in user.",
      });
    }

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
      actorStaffProfileId,
      actorUserId: athenaUserId,
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
      actorStaffProfileId,
      actorUserId: athenaUserId,
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
      actorStaffProfileId,
      actorUserId: athenaUserId,
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

export const resolveRegisterSessionSyncReview = mutation({
  args: {
    actorStaffProfileId: v.id("staffProfile"),
    registerSessionId: v.id("registerSession"),
    storeId: v.id("store"),
  },
  returns: registerSessionSyncReviewResultValidator,
  handler: async (
    ctx,
    args,
  ): Promise<CommandResult<ResolveRegisterSessionSyncReviewResult>> => {
    const { athenaUser, store } = await requireCashControlsStoreAccess(
      ctx,
      args.storeId,
    );
    const registerSession = await ctx.db.get(
      "registerSession",
      args.registerSessionId,
    );
    if (!registerSession || registerSession.storeId !== args.storeId) {
      return userError({
        code: "not_found",
        message: "Register session not found for this store.",
      });
    }

    const canResolveReview = await staffProfileCanResolveSyncReview(ctx, {
      organizationId: store.organizationId,
      staffProfileId: args.actorStaffProfileId,
      storeId: args.storeId,
    });
    if (!canResolveReview) {
      return userError({
        code: "authorization_failed",
        message: "Only managers can resolve synced register reviews.",
      });
    }

    const conflictsBySessionId =
      await listOpenLocalSyncConflictsByRegisterSession(ctx, args.storeId);
    const conflicts = conflictsBySessionId.get(args.registerSessionId) ?? [];
    if (conflicts.length === 0) {
      return ok({
        action: "already_resolved",
        registerSession,
        projectedCount: 0,
        resolvedCount: 0,
      });
    }

    const resolvedAt = Date.now();
    const localSyncRepository = createConvexLocalSyncRepository(ctx);
    const projectedTransactionIds: string[] = [];

    for (const conflict of conflicts) {
      const terminalId = conflict.terminalId ?? registerSession.terminalId;
      if (!terminalId) {
        return userError({
          code: "precondition_failed",
          message:
            "This register review can no longer be applied because the terminal link was not found.",
        });
      }
      const syncEvent = await localSyncRepository.findEvent({
        storeId: args.storeId,
        terminalId,
        localEventId: conflict.localEventId,
      });
      if (!syncEvent) {
        return userError({
          code: "precondition_failed",
          message:
            "This register review can no longer be applied because the synced activity was not found.",
        });
      }

      const shouldApplyReviewedSale =
        syncEvent.eventType === "sale_completed" &&
        (!conflict.localRegisterSessionId ||
          syncEvent.localRegisterSessionId === conflict.localRegisterSessionId) &&
        conflict.conflictType === "permission" &&
        conflict.summary === "Register was not open before this sale synced.";

      if (!shouldApplyReviewedSale) {
        continue;
      }

      if (syncEvent.status === "projected") {
        continue;
      }

      if (syncEvent.status !== "conflicted") {
        return userError({
          code: "precondition_failed",
          message:
            "This register review is not ready to apply. Refresh the register session and try again.",
        });
      }

      const parsedEvent = parseStoredLocalSyncEvent(
        localSyncRepository,
        syncEvent,
      );
      if (!parsedEvent.ok || parsedEvent.event.eventType !== "sale_completed") {
        return userError({
          code: "precondition_failed",
          message:
            "This register review could not be applied because the synced sale details are incomplete.",
        });
      }

      const projection = await projectLocalSyncEvent(localSyncRepository, {
        storeId: args.storeId,
        terminalId,
        event: parsedEvent.event,
        syncEventId: syncEvent._id,
        submittedByUserId: athenaUser._id,
        now: resolvedAt,
        options: {
          allowClosedRegisterSaleProjection: true,
          trustStoredStaffProof: true,
        },
      });
      if (projection.status !== "projected") {
        return userError({
          code: "precondition_failed",
          message:
            "This register review still needs attention before the synced sales can be applied.",
          metadata: {
            conflictSummaries: projection.conflicts.map(
              (projectionConflict) => projectionConflict.summary,
            ),
          },
        });
      }

      await localSyncRepository.patchEvent(syncEvent._id, {
        status: "projected",
        projectedAt: resolvedAt,
      });
      projectedTransactionIds.push(
        ...projection.mappings
          .filter(
            (mapping) =>
              mapping.localIdKind === "transaction" &&
              mapping.cloudTable === "posTransaction",
          )
          .map((mapping) => mapping.cloudId),
      );
    }

    await Promise.all(
      conflicts.map((conflict) =>
        ctx.db.patch("posLocalSyncConflict", conflict._id, {
          resolvedAt,
          resolvedByStaffProfileId: args.actorStaffProfileId,
          status: "resolved",
        }),
      ),
    );

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: athenaUser._id,
      eventType: "register_session_sync_review_resolved",
      message:
        projectedTransactionIds.length === 0
          ? conflicts.length === 1
            ? "Resolved synced register review."
            : `Resolved ${conflicts.length} synced register reviews.`
          : projectedTransactionIds.length === 1
            ? "Applied reviewed synced register sale."
            : `Applied ${projectedTransactionIds.length} reviewed synced register sales.`,
      metadata: {
        conflictIds: conflicts.map((conflict) => conflict._id),
        conflictTypes: conflicts.map((conflict) => conflict.conflictType),
        projectedTransactionIds,
      },
      organizationId: store.organizationId,
      registerSessionId: args.registerSessionId,
      storeId: args.storeId,
      subjectId: args.registerSessionId,
      subjectLabel: registerSession.registerNumber,
      subjectType: "register_session",
    });

    return ok({
      action: "resolved",
      registerSession: await ctx.db.get("registerSession", args.registerSessionId),
      projectedCount: projectedTransactionIds.length,
      resolvedCount: conflicts.length,
    });
  },
});
