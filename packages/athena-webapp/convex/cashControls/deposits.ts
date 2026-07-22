import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  recordRegisterSessionDepositOperationDefinition,
  resolveRegisterSessionSyncReviewOperationDefinition,
} from "../operationAdmission/definitions";
import { admitSharedDemoPublicMutation } from "../operationAdmission/publicMutation";
import { requireSharedDemoStoreCapabilityIfApplicable } from "../sharedDemo/actor";
import { requireSharedDemoRegisterSessionSyncReview } from "../sharedDemo/policy";
import { requireReadySharedDemoWriteWithCtx } from "../sharedDemo/restore";
import {
  buildRegisterSessionCloseoutReview,
  getCashControlsConfig,
} from "./closeouts";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { recordPaymentAllocationWithCtx } from "../operations/paymentAllocations";
import {
  recordRegisterSessionDepositWithCtx,
  rejectRegisterSessionCloseoutWithCtx,
} from "../operations/registerSessions";
import { recordRegisterSessionTraceBestEffort } from "../operations/registerSessionTracing";
import { patchRegisterSessionWithAuthority } from "../operations/registerSessionAuthorityRevision";
import { consumeApprovalProofWithCtx } from "../operations/approvalProofs";
import { toPesewas } from "../lib/currency";
import {
  listCompletedTransactions,
  listTransactionItems,
} from "../pos/infrastructure/repositories/transactionRepository";
import {
  buildRegisterSessionLocalSyncStatus,
  classifyRegisterSessionSyncReview,
  listOpenLocalSyncConflictsByRegisterSession as listRegisterSessionSyncReviewConflicts,
  STAFF_ACCESS_SYNC_REVIEW_SUMMARY,
  type RegisterSessionSyncConflict,
} from "../pos/application/sync/registerSessionSyncReview";
import { createConvexLocalSyncRepository } from "../pos/infrastructure/repositories/localSyncRepository";
import { parseStoredLocalSyncEvent } from "../pos/application/sync/ingestLocalEvents";
import {
  createOrReuseRegisterSessionRepairMapping,
  projectLocalSyncEvent,
} from "../pos/application/sync/projectLocalEvents";
import {
  buildPendingCompletedSaleVoidApprovalSummary,
  filterPendingCompletedSaleVoidApprovals,
  filterPendingTransactionItemAdjustmentApprovals,
  getCloseoutHoldOperatorMessage,
  hasCashAffectingCloseoutHolds,
  listPendingRegisterSessionApprovalRequests,
  listRegisterSessionCloseoutHolds,
  type RegisterSessionPendingVoidApprovalSummary,
} from "../pos/application/sync/registerSessionCloseoutHolds";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { isRegisterSessionSaleUsable } from "../../shared/registerSessionLifecyclePolicy";
import { formatStaffDisplayName } from "../../shared/staffDisplayName";
import { buildPaymentTotals } from "../operations/paymentTotals";

export { listOpenLocalSyncConflictsByRegisterSession } from "../pos/application/sync/registerSessionSyncReview";

const CASH_DEPOSIT_ALLOCATION_TYPE = "cash_deposit";
const CASH_DEPOSIT_SUBJECT_TYPE = "register_cash_deposit";
const REGISTER_SESSION_SYNC_REVIEW_APPROVAL_ACTION_KEY =
  "cash_controls.register_session.resolve_sync_review";
const RECENT_DEPOSIT_LIMIT = 10;
const SESSION_LIMIT = 100;
const STAFF_ROLE_LOOKUP_LIMIT = 20;
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
      action: v.union(
        v.literal("already_resolved"),
        v.literal("resolved"),
        v.literal("rejected"),
      ),
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

function isProoflessStaffAccessSyncReview(
  conflict: RegisterSessionSyncConflict,
) {
  return (
    conflict.conflictType === "permission" &&
    conflict.summary === STAFF_ACCESS_SYNC_REVIEW_SUMMARY &&
    conflict.details?.hasStaffProof === false
  );
}

type StaffNameMap = Map<Id<"staffProfile">, string>;

type CashControlApprovalRequest = Pick<
  Doc<"approvalRequest">,
  "_id" | "notes" | "reason" | "requestedByStaffProfileId" | "status"
>;

type CashControlPendingVoidApprovalSummary =
  RegisterSessionPendingVoidApprovalSummary;

type CashControlDepositAllocation = Pick<
  Doc<"paymentAllocation">,
  | "_id"
  | "actorStaffProfileId"
  | "amount"
  | "businessEventKey"
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

type CashControlSyncConflict = RegisterSessionSyncConflict;

type StoredLocalSyncEvent = NonNullable<
  Awaited<
    ReturnType<ReturnType<typeof createConvexLocalSyncRepository>["findEvent"]>
  >
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
  | "status"
  | "total"
  | "transactionNumber"
  | "voidedAt"
  | "workflowTraceId"
>;

type RecordRegisterSessionDepositResult = {
  action: "duplicate" | "recorded";
  deposit: Doc<"paymentAllocation"> | null;
  registerSession: Doc<"registerSession"> | null;
};

type ResolveRegisterSessionSyncReviewResult = {
  action: "already_resolved" | "resolved" | "rejected";
  projectedCount?: number;
  registerSession: Doc<"registerSession"> | null;
  resolvedCount: number;
};

async function requireCashControlsStoreAccess(
  ctx: QueryCtx | MutationCtx,
  storeId: Id<"store">,
  options?: { allowSharedDemoCashControl?: boolean },
) {
  const store = await ctx.db.get("store", storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  const athenaUser = await requireAuthenticatedAthenaUserWithCtx(
    ctx,
    options?.allowSharedDemoCashControl
      ? { sharedDemoCapability: "cash.control.write" }
      : undefined,
  );
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

function numberDetail(
  details: Record<string, unknown> | undefined,
  key: string,
) {
  const value = details?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringDetail(
  details: Record<string, unknown> | undefined,
  key: string,
) {
  const value = details?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordDetail(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sanitizeCashControlTimelineMetadata(
  metadata?: Record<string, unknown> | null,
) {
  if (!metadata) {
    return null;
  }

  const safeMetadata: Record<string, unknown> = {};
  for (const key of [
    "amount",
    "countedCash",
    "decision",
    "expectedCash",
    "managerOverride",
    "managerOverrideCount",
    "projectedCloseoutCount",
    "reference",
    "syncOrigin",
    "variance",
  ]) {
    if (metadata[key] !== undefined) {
      safeMetadata[key] = metadata[key];
    }
  }

  return Object.keys(safeMetadata).length > 0 ? safeMetadata : null;
}

function arrayDetail(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map(recordDetail)
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function roundCurrencyAmount(value: number) {
  return Number(value.toFixed(2));
}

function normalizeReviewedNonCashOverpaymentPayload(
  payload: Record<string, unknown>,
) {
  const totals = recordDetail(payload.totals);
  const expectedTotal = numberDetail(totals ?? undefined, "total");
  const payments = arrayDetail(payload.payments);
  if (expectedTotal === null || payments.length === 0) {
    return payload;
  }

  const totalPaid = roundCurrencyAmount(
    payments.reduce(
      (sum, payment) => sum + Math.max(0, numberDetail(payment, "amount") ?? 0),
      0,
    ),
  );
  const nonCashPaid = roundCurrencyAmount(
    payments
      .filter((payment) => payment.method !== "cash")
      .reduce(
        (sum, payment) =>
          sum + Math.max(0, numberDetail(payment, "amount") ?? 0),
        0,
      ),
  );
  if (totalPaid < expectedTotal || nonCashPaid <= expectedTotal) {
    return payload;
  }

  let remaining = roundCurrencyAmount(Math.max(0, expectedTotal));
  const normalizedPayments: Record<string, unknown>[] = [];
  for (const payment of payments) {
    if (payment.method === "cash") {
      continue;
    }

    if (remaining <= 0) {
      break;
    }

    const amount = roundCurrencyAmount(
      Math.min(Math.max(0, numberDetail(payment, "amount") ?? 0), remaining),
    );
    if (amount <= 0) {
      continue;
    }

    normalizedPayments.push({ ...payment, amount });
    remaining = roundCurrencyAmount(remaining - amount);
  }

  return {
    ...payload,
    payments: normalizedPayments,
  };
}

function buildReviewedSaleProjectionEvent(syncEvent: StoredLocalSyncEvent) {
  if (syncEvent.eventType !== "sale_completed") {
    return syncEvent;
  }

  return {
    ...syncEvent,
    payload: normalizeReviewedNonCashOverpaymentPayload(syncEvent.payload),
  };
}

function isRepairableRegisterSessionStatus(status?: string | null) {
  return status === "open" || status === "active" || status === "closing";
}

async function getCompletedTransactionForRegisterMappingRepair(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  localSyncRepository: ReturnType<typeof createConvexLocalSyncRepository>,
  args: {
    conflict: RegisterSessionSyncConflict;
    registerSessionId: Id<"registerSession">;
    syncEvent: StoredLocalSyncEvent;
    terminalId: Id<"posTerminal">;
  },
): Promise<
  | { kind: "matched"; transaction: Doc<"posTransaction"> }
  | { kind: "unprojected" }
  | { kind: "mismatch" }
> {
  const payload = recordDetail(args.syncEvent.payload) ?? {};
  const localTransactionId =
    stringDetail(args.conflict.details, "localTransactionId") ??
    stringDetail(payload, "localTransactionId");
  let sawTransactionMapping = false;

  if (localTransactionId) {
    const transactionMapping = await localSyncRepository.findMapping({
      storeId: args.syncEvent.storeId,
      terminalId: args.terminalId,
      localRegisterSessionId: args.syncEvent.localRegisterSessionId,
      localIdKind: "transaction",
      localId: localTransactionId,
    });
    sawTransactionMapping = Boolean(transactionMapping);
    if (transactionMapping?.cloudTable === "posTransaction") {
      const transaction = await ctx.db.get(
        "posTransaction",
        transactionMapping.cloudId as Id<"posTransaction">,
      );
      if (
        transaction?.status === "completed" &&
        transaction.storeId === args.syncEvent.storeId &&
        transaction.terminalId === args.terminalId &&
        transaction.registerSessionId === args.registerSessionId
      ) {
        return { kind: "matched", transaction };
      }
      return { kind: "mismatch" };
    }
  }

  const receiptNumbers = new Set(
    [
      stringDetail(payload, "receiptNumber"),
      stringDetail(payload, "localReceiptNumber"),
      args.conflict.sale?.receiptNumber ?? null,
      args.conflict.sale?.localReceiptNumber ?? null,
    ].filter((value): value is string => Boolean(value)),
  );
  if (receiptNumbers.size === 0) {
    return { kind: "unprojected" };
  }

  const totals = recordDetail(payload.totals);
  const total = totals ? numberDetail(totals, "total") : null;
  const candidates = await ctx.db
    .query("posTransaction")
    .withIndex("by_storeId_status_registerSessionId_completedAt", (q) =>
      q
        .eq("storeId", args.syncEvent.storeId)
        .eq("status", "completed")
        .eq("registerSessionId", args.registerSessionId),
    )
    .take(100);
  const matches = candidates.filter((transaction) => {
    if (transaction.terminalId !== args.terminalId) {
      return false;
    }
    if (!receiptNumbers.has(transaction.transactionNumber)) {
      return false;
    }
    return total === null || transaction.total === total;
  });

  if (matches.length === 1) {
    return { kind: "matched", transaction: matches[0] };
  }

  return { kind: sawTransactionMapping ? "mismatch" : "unprojected" };
}

async function salePrecedesLocalCloseoutIfPresent(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  args: {
    storeId: Id<"store">;
    syncEvent: StoredLocalSyncEvent;
    terminalId: Id<"posTerminal">;
  },
) {
  const localCloseoutEvents = await ctx.db
    .query("posLocalSyncEvent")
    .withIndex("by_store_terminal_register_sequence", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("terminalId", args.terminalId)
        .eq("localRegisterSessionId", args.syncEvent.localRegisterSessionId),
    )
    .take(100);
  const closeoutEvent = localCloseoutEvents
    .filter((event) => event.eventType === "register_closed")
    .sort((left, right) => left.sequence - right.sequence)[0];

  return !closeoutEvent || args.syncEvent.sequence < closeoutEvent.sequence;
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
  },
) {
  if (!args.traceId || args.workflowTraceId || !args.traceCreated) {
    return;
  }

  try {
    await patchRegisterSessionWithAuthority(ctx, args.registerSessionId, {
      workflowTraceId: args.traceId,
    });
  } catch (error) {
    console.error("[workflow-trace] register.session.trace.link", error);
  }
}

function isCashControlDepositAllocation(
  allocation: Pick<
    Doc<"paymentAllocation">,
    "allocationType" | "direction" | "registerSessionId"
  >,
) {
  return (
    allocation.allocationType === CASH_DEPOSIT_ALLOCATION_TYPE &&
    allocation.direction === "out" &&
    Boolean(allocation.registerSessionId)
  );
}

async function listStaffNames(
  ctx: Pick<QueryCtx, "db">,
  staffProfileIds: Set<Id<"staffProfile">>,
) {
  const staffEntries = await Promise.all(
    Array.from(staffProfileIds).map(async (staffProfileId) => {
      const staffProfile = await ctx.db.get("staffProfile", staffProfileId);
      const staffName = formatStaffDisplayName(staffProfile);
      return staffName ? [staffProfileId, staffName] : null;
    }),
  );

  return new Map(
    staffEntries.filter(Boolean) as Array<[Id<"staffProfile">, string]>,
  );
}

function sumDepositsBySession(deposits: CashControlDepositAllocation[]) {
  return deposits.reduce((totals, deposit) => {
    if (!deposit.registerSessionId) {
      return totals;
    }

    totals.set(
      deposit.registerSessionId,
      (totals.get(deposit.registerSessionId) ?? 0) + deposit.amount,
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
  pendingVoidApprovals?: CashControlPendingVoidApprovalSummary | null;
  registerSession: CashControlRegisterSession;
  staffNamesById: StaffNameMap;
  syncConflicts?: CashControlSyncConflict[];
  terminalNamesById: Map<Id<"posTerminal">, string>;
  totalDeposited: number;
  totalSales?: number;
}) {
  const syncConflicts = args.syncConflicts ?? [];
  return {
    ...args.registerSession,
    closedByStaffName: args.registerSession.closedByStaffProfileId
      ? (args.staffNamesById.get(args.registerSession.closedByStaffProfileId) ??
        null)
      : null,
    openedByStaffName: args.registerSession.openedByStaffProfileId
      ? (args.staffNamesById.get(args.registerSession.openedByStaffProfileId) ??
        null)
      : null,
    terminalName: args.registerSession.terminalId
      ? (args.terminalNamesById.get(args.registerSession.terminalId) ?? null)
      : null,
    pendingApprovalRequest: args.approvalRequest
      ? {
          _id: args.approvalRequest._id,
          notes: args.approvalRequest.notes,
          reason: args.approvalRequest.reason,
          requestedByStaffName: args.approvalRequest.requestedByStaffProfileId
            ? (args.staffNamesById.get(
                args.approvalRequest.requestedByStaffProfileId,
              ) ?? null)
            : null,
          status: args.approvalRequest.status,
        }
      : null,
    pendingVoidApprovals: args.pendingVoidApprovals ?? {
      cashAffectingCount: 0,
      cashAdjustmentCount: 0,
      cashAdjustmentDelta: 0,
      cashAmount: 0,
      count: 0,
      items: [],
    },
    localSyncStatus: buildRegisterSessionLocalSyncStatus(syncConflicts, {
      staffNamesById: args.staffNamesById,
    }),
    totalDeposited: args.totalDeposited,
    ...(args.totalSales !== undefined ? { totalSales: args.totalSales } : {}),
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
      q.eq("storeId", registerSession.storeId).eq("traceId", traceId),
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
    })),
  );
}

export function buildCashControlsDashboardSnapshot(args: {
  approvalRequestsBySessionId: Map<
    Id<"registerSession">,
    CashControlApprovalRequest
  >;
  deposits: CashControlDepositAllocation[];
  pendingVoidApprovalsBySessionId?: Map<
    Id<"registerSession">,
    CashControlPendingVoidApprovalSummary
  >;
  registerSessions: CashControlRegisterSession[];
  staffNamesById: StaffNameMap;
  syncConflictsBySessionId?: Map<
    Id<"registerSession">,
    CashControlSyncConflict[]
  >;
  terminalNamesById?: Map<Id<"posTerminal">, string>;
  totalSalesBySessionId?: Map<Id<"registerSession">, number>;
}) {
  const totalDepositedBySessionId = sumDepositsBySession(args.deposits);
  const registerNumberBySessionId = new Map(
    args.registerSessions.map((registerSession) => [
      registerSession._id,
      registerSession.registerNumber?.trim() || "Unnamed register",
    ]),
  );

  const sessionSummaries = [...args.registerSessions]
    .sort((left, right) => right.openedAt - left.openedAt)
    .map((registerSession) =>
      buildRegisterSessionSummary({
        approvalRequest:
          args.approvalRequestsBySessionId.get(registerSession._id) ?? null,
        pendingVoidApprovals:
          args.pendingVoidApprovalsBySessionId?.get(registerSession._id) ??
          null,
        registerSession,
        staffNamesById: args.staffNamesById,
        syncConflicts:
          args.syncConflictsBySessionId?.get(registerSession._id) ?? [],
        terminalNamesById: args.terminalNamesById ?? new Map(),
        totalDeposited: totalDepositedBySessionId.get(registerSession._id) ?? 0,
        totalSales: args.totalSalesBySessionId?.get(registerSession._id),
      }),
    );

  return {
    registerSessions: sessionSummaries,
    openSessions: sessionSummaries.filter((registerSession) =>
      isRegisterSessionSaleUsable(registerSession),
    ),
    pendingCloseouts: sessionSummaries.filter(
      (registerSession) =>
        registerSession.status === "closing" ||
        registerSession.status === "closeout_rejected",
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
          ? (args.staffNamesById.get(deposit.actorStaffProfileId) ?? null)
          : null,
        reference: deposit.externalReference,
        registerNumber: deposit.registerSessionId
          ? (registerNumberBySessionId.get(deposit.registerSessionId) ??
            "Unnamed register")
          : "Unnamed register",
        registerSessionId: deposit.registerSessionId ?? null,
      })),
    unresolvedVariances: sessionSummaries.filter((registerSession) => {
      const variance = registerSession.variance ?? 0;

      return (
        registerSession.localSyncStatus?.status === "needs_review" ||
        (variance !== 0 &&
          (registerSession.status === "closing" ||
            registerSession.status === "closeout_rejected" ||
            Boolean(registerSession.pendingApprovalRequest)))
      );
    }),
  };
}

async function listRegisterSessionsForDashboard(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
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
  syncConflictsBySessionId: Map<
    Id<"registerSession">,
    CashControlSyncConflict[]
  >,
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
    }),
  );

  return new Map(
    terminalEntries.filter(Boolean) as Array<[Id<"posTerminal">, string]>,
  );
}

async function listStoreDeposits(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
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
  registerSessionId: Id<"registerSession">,
) {
  const allocations =
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- Session detail should show the complete deposit ledger for one drawer.
    await ctx.db
      .query("paymentAllocation")
      .withIndex("by_registerSessionId", (q) =>
        q.eq("registerSessionId", registerSessionId),
      )
      .collect();

  return allocations.filter(isCashControlDepositAllocation);
}

async function listRegisterSessionTimeline(
  ctx: Pick<QueryCtx, "db">,
  registerSessionId: Id<"registerSession">,
) {
  return (
    await ctx.db
      .query("operationalEvent")
      .withIndex("by_registerSessionId", (q) =>
        q.eq("registerSessionId", registerSessionId),
      )
      .order("desc")
      .take(TIMELINE_LIMIT)
  ).sort((left, right) => right.createdAt - left.createdAt);
}

async function listRegisterSessionTransactions(
  ctx: QueryCtx,
  args: {
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
  },
) {
  return listCompletedTransactions(ctx, {
    registerSessionId: args.registerSessionId,
    storeId: args.storeId,
  });
}

async function buildRegisterSessionFinancialPosition(
  ctx: QueryCtx,
  args: {
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
  },
) {
  const completedTransactions: Doc<"posTransaction">[] = [];
  const query = ctx.db
    .query("posTransaction")
    .withIndex("by_storeId_status_registerSessionId_completedAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "completed")
        .eq("registerSessionId", args.registerSessionId),
    );

  for await (const transaction of query) {
    completedTransactions.push(transaction);
  }

  const totalSales = completedTransactions.reduce(
    (sum, transaction) => sum + transaction.total,
    0,
  );
  const paymentTotals = buildPaymentTotals(
    completedTransactions.map((transaction) => ({
      ...transaction,
      payments: transaction.payments ?? [],
      totalPaid: transaction.totalPaid ?? transaction.total,
    })),
  );

  return {
    averageTransaction:
      completedTransactions.length > 0
        ? totalSales / completedTransactions.length
        : 0,
    paymentMix: paymentTotals
      .map((payment) => ({
        method: payment.method,
        share:
          totalSales > 0 ? Math.round((payment.amount / totalSales) * 100) : 0,
        total: payment.amount,
        transactionCount: payment.transactionCount,
      }))
      .sort((left, right) => right.total - left.total),
    totalSales,
    transactionCount: completedTransactions.length,
  };
}

async function listRegisterSessionTotalSalesBySessionId(
  ctx: QueryCtx,
  args: {
    registerSessions: CashControlRegisterSession[];
    storeId: Id<"store">;
  },
) {
  const entries = await Promise.all(
    args.registerSessions
      .filter(isRegisterSessionSaleUsable)
      .map(async (registerSession) => {
        let totalSales = 0;
        const query = ctx.db
          .query("posTransaction")
          .withIndex("by_storeId_status_registerSessionId_completedAt", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("status", "completed")
              .eq("registerSessionId", registerSession._id),
          );

        for await (const transaction of query) {
          totalSales += transaction.total;
        }

        return [registerSession._id, totalSales] as const;
      }),
  );

  return new Map(entries);
}

async function listPendingVoidApprovalSummariesBySessionId(
  ctx: Pick<QueryCtx, "db">,
  args: {
    registerSessions: Array<Pick<Doc<"registerSession">, "_id">>;
    storeId: Id<"store">;
  },
) {
  const entries = await Promise.all(
    args.registerSessions.map(async (registerSession) => {
      const approvalRequests = await listPendingRegisterSessionApprovalRequests(
        ctx,
        {
          registerSessionId: registerSession._id,
          storeId: args.storeId,
        },
      );
      return [
        registerSession._id,
        await buildPendingCompletedSaleVoidApprovalSummary(ctx, {
          approvalRequests:
            filterPendingCompletedSaleVoidApprovals(approvalRequests),
          itemAdjustmentApprovalRequests:
            filterPendingTransactionItemAdjustmentApprovals(approvalRequests),
          registerSessionId: registerSession._id,
          storeId: args.storeId,
        }),
      ] as const;
    }),
  );

  return new Map(entries);
}

function collectStaffProfileIds(args: {
  approvalRequests: CashControlApprovalRequest[];
  deposits: CashControlDepositAllocation[];
  registerSessions: CashControlRegisterSession[];
  syncConflictsBySessionId?: Map<
    Id<"registerSession">,
    CashControlSyncConflict[]
  >;
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

  for (const syncConflicts of args.syncConflictsBySessionId?.values() ?? []) {
    for (const conflict of syncConflicts) {
      if (conflict.sale?.staffProfileId) {
        staffProfileIds.add(conflict.sale.staffProfileId);
      }
    }
  }

  return staffProfileIds;
}

export const getDashboardSnapshot = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireCashControlsStoreAccess(ctx, args.storeId, {
      allowSharedDemoCashControl: true,
    });

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
          q.eq("storeId", args.storeId).eq("status", "pending"),
        )
        .order("desc")
        .take(SESSION_LIMIT),
      listStoreDeposits(ctx, args.storeId),
      listRegisterSessionSyncReviewConflicts(ctx, args.storeId, {
        includeRejectedEvidence: true,
      }),
    ]);

    const dashboardRegisterSessions =
      await appendRegisterSessionsForSyncConflicts(
        ctx,
        registerSessions,
        syncConflictsBySessionId,
      );
    const dashboardRegisterSessionsWithTraceIds =
      await appendRegisterSessionWorkflowTraceIds(
        ctx,
        dashboardRegisterSessions,
      );
    const pendingVoidApprovalsBySessionId =
      await listPendingVoidApprovalSummariesBySessionId(ctx, {
        registerSessions: dashboardRegisterSessionsWithTraceIds,
        storeId: args.storeId,
      });
    const totalSalesBySessionId =
      await listRegisterSessionTotalSalesBySessionId(ctx, {
        registerSessions: dashboardRegisterSessionsWithTraceIds,
        storeId: args.storeId,
      });
    const relevantApprovalRequests = pendingApprovalRequests.filter(
      (approvalRequest) =>
        approvalRequest.requestType === "variance_review" &&
        Boolean(approvalRequest.registerSessionId),
    );
    const approvalRequestsBySessionId = new Map(
      relevantApprovalRequests.map((approvalRequest) => [
        approvalRequest.registerSessionId!,
        approvalRequest,
      ]),
    );
    const staffNamesById = await listStaffNames(
      ctx,
      collectStaffProfileIds({
        approvalRequests: relevantApprovalRequests,
        deposits,
        registerSessions: dashboardRegisterSessionsWithTraceIds,
        syncConflictsBySessionId,
      }),
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
      pendingVoidApprovalsBySessionId,
      registerSessions: dashboardRegisterSessionsWithTraceIds,
      staffNamesById,
      syncConflictsBySessionId,
      terminalNamesById,
      totalSalesBySessionId,
    });
  },
});

export const getRegisterSessionSnapshot = query({
  args: {
    registerSessionId: v.id("registerSession"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const { store } = await requireCashControlsStoreAccess(ctx, args.storeId, {
      allowSharedDemoCashControl: true,
    });
    const registerSession = await ctx.db.get(
      "registerSession",
      args.registerSessionId,
    );

    if (!registerSession || registerSession.storeId !== args.storeId) {
      throw new Error("Register session not found for this store.");
    }

    const [
      deposits,
      timeline,
      transactions,
      approvalRequest,
      pendingVoidApprovals,
      syncConflictsBySessionId,
      workflowTraceId,
      financialPosition,
    ] = await Promise.all([
      listSessionDeposits(ctx, args.registerSessionId),
      listRegisterSessionTimeline(ctx, args.registerSessionId),
      listRegisterSessionTransactions(ctx, {
        registerSessionId: args.registerSessionId,
        storeId: args.storeId,
      }),
      registerSession.managerApprovalRequestId
        ? ctx.db.get(
            "approvalRequest",
            registerSession.managerApprovalRequestId,
          )
        : Promise.resolve(null),
      listPendingRegisterSessionApprovalRequests(ctx, {
        registerSessionId: args.registerSessionId,
        storeId: args.storeId,
      }),
      listRegisterSessionSyncReviewConflicts(ctx, args.storeId, {
        includeRejectedEvidence: true,
        registerSessionIds: [args.registerSessionId],
      }),
      resolveRegisterSessionWorkflowTraceId(ctx, registerSession),
      buildRegisterSessionFinancialPosition(ctx, {
        registerSessionId: args.registerSessionId,
        storeId: args.storeId,
      }),
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
        syncConflictsBySessionId,
        timeline,
        transactions,
      }),
    );
    const transactionItemsById = new Map(
      await Promise.all(
        transactions.map(async (transaction) => {
          const transactionItems = await listTransactionItems(
            ctx,
            transaction._id,
          );
          return [transaction._id, transactionItems] as const;
        }),
      ),
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
              transaction.customerProfileId,
            );

            return customerProfile
              ? [transaction.customerProfileId, customerProfile.fullName]
              : null;
          }),
        )
      ).filter(Boolean) as Array<[Id<"customerProfile">, string | undefined]>,
    );
    const totalDeposited = deposits.reduce(
      (sum, deposit) => sum + deposit.amount,
      0,
    );
    const itemBreakdownByProduct = new Map<
      string,
      {
        name: string;
        productSku: string | null;
        quantity: number;
        totalSales: number;
      }
    >();
    for (const transaction of transactions) {
      if (transaction.status !== "completed") {
        continue;
      }

      for (const item of transactionItemsById.get(transaction._id) ?? []) {
        const key = `${item.productId}:${item.productSkuId}`;
        const aggregate = itemBreakdownByProduct.get(key) ?? {
          name: item.productName,
          productSku: item.productSku || null,
          quantity: 0,
          totalSales: 0,
        };
        aggregate.quantity += item.quantity;
        aggregate.totalSales += item.totalPrice;
        itemBreakdownByProduct.set(key, aggregate);
      }
    }
    const itemsBreakdown = Array.from(itemBreakdownByProduct.values()).sort(
      (left, right) =>
        right.quantity - left.quantity || right.totalSales - left.totalSales,
    );
    const terminalNamesById = await listTerminalNames(
      ctx,
      new Set(registerSession.terminalId ? [registerSession.terminalId] : []),
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
      financialPosition,
      itemsBreakdown,
      deposits: deposits
        .sort((left, right) => right.recordedAt - left.recordedAt)
        .map((deposit) => ({
          _id: deposit._id,
          amount: deposit.amount,
          notes: deposit.notes,
          recordedAt: deposit.recordedAt,
          recordedByStaffName: deposit.actorStaffProfileId
            ? (staffNamesById.get(deposit.actorStaffProfileId) ?? null)
            : null,
          reference: deposit.externalReference,
          registerSessionId: deposit.registerSessionId ?? null,
        })),
      transactions: transactions.map((transaction) => {
        const transactionItems =
          transactionItemsById.get(transaction._id) ?? [];
        const paymentMethods = transaction.payments?.length
          ? Array.from(
              new Set(transaction.payments.map((payment) => payment.method)),
            )
          : transaction.paymentMethod
            ? [transaction.paymentMethod]
            : [];

        return {
          _id: transaction._id,
          cashierName: transaction.staffProfileId
            ? (staffNamesById.get(transaction.staffProfileId) ?? null)
            : null,
          completedAt: transaction.completedAt,
          customerName:
            (transaction.customerProfileId
              ? customerNamesById.get(transaction.customerProfileId)
              : null) ??
            transaction.customerInfo?.name ??
            null,
          hasMultiplePaymentMethods: paymentMethods.length > 1,
          itemCount: transactionItems.reduce(
            (sum, item) => sum + item.quantity,
            0,
          ),
          paymentMethod: transaction.paymentMethod ?? paymentMethods[0] ?? null,
          status: transaction.status,
          total: transaction.total,
          transactionNumber: transaction.transactionNumber,
          voidedAt: transaction.voidedAt ?? null,
          workflowTraceId: transaction.workflowTraceId ?? null,
        };
      }),
      registerSession: {
        ...buildRegisterSessionSummary({
          approvalRequest,
          pendingVoidApprovals:
            await buildPendingCompletedSaleVoidApprovalSummary(ctx, {
              approvalRequests:
                filterPendingCompletedSaleVoidApprovals(pendingVoidApprovals),
              itemAdjustmentApprovalRequests:
                filterPendingTransactionItemAdjustmentApprovals(
                  pendingVoidApprovals,
                ),
              registerSessionId: args.registerSessionId,
              storeId: args.storeId,
            }),
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
          ? (staffNamesById.get(event.actorStaffProfileId) ?? null)
          : null,
        createdAt: event.createdAt,
        eventType: event.eventType,
        metadata: sanitizeCashControlTimelineMetadata(event.metadata),
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
  handler: async (ctx, args) => {
    try {
      return await admitSharedDemoPublicMutation(
        recordRegisterSessionDepositOperationDefinition,
        async (
          admittedCtx,
          admittedArgs,
        ): Promise<CommandResult<RecordRegisterSessionDepositResult>> => {
    const ctx = admittedCtx;
    const args = admittedArgs;
    const demoActor = await requireSharedDemoStoreCapabilityIfApplicable(ctx, "cash.control.write", args.storeId);
    if (demoActor) await requireReadySharedDemoWriteWithCtx(ctx, { storeId: args.storeId });
    let athenaUserId: Id<"athenaUser">;
    try {
      const { athenaUser } = await requireCashControlsStoreAccess(
        ctx,
        args.storeId,
        { allowSharedDemoCashControl: true },
      );
      athenaUserId = athenaUser._id;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        message !== "Sign in again to continue." &&
        message !== "You do not have access to cash controls." &&
        !message.includes("shared_demo_action_denied")
      ) {
        throw error;
      }
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

    const targetId = buildRegisterSessionDepositTargetId({
      registerSessionId: args.registerSessionId,
      submissionKey,
    });
    const businessEventKey = `cash_deposit:${args.registerSessionId}:${submissionKey}`;
    const paymentAllocationArgs = {
      actorStaffProfileId,
      actorUserId: athenaUserId,
      allocationType: CASH_DEPOSIT_ALLOCATION_TYPE,
      amount: storedAmount,
      businessEventKey,
      collectedInStore: true,
      direction: "out" as const,
      externalReference: trimOptional(args.reference),
      method: "cash",
      notes: trimOptional(args.notes),
      organizationId: registerSession.organizationId,
      registerSessionId: args.registerSessionId,
      storeId: args.storeId,
      targetId,
      targetType: CASH_DEPOSIT_SUBJECT_TYPE,
    };
    const existingDeposit = await ctx.db
      .query("paymentAllocation")
      .withIndex("by_storeId_target", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("targetType", CASH_DEPOSIT_SUBJECT_TYPE)
          .eq("targetId", targetId),
      )
      .first();

    if (existingDeposit && isCashControlDepositAllocation(existingDeposit)) {
      const validatedDeposit = existingDeposit.businessEventKey
        ? await recordPaymentAllocationWithCtx(ctx, paymentAllocationArgs)
        : existingDeposit;
      return ok({
        action: "duplicate" as const,
        deposit: validatedDeposit,
        registerSession,
      });
    }

    if (!isRegisterSessionSaleUsable(registerSession)) {
      return userError({
        code: "precondition_failed",
        message: "Register session is not accepting new deposits.",
      });
    }

    const closeoutHolds = await listRegisterSessionCloseoutHolds(ctx, {
      registerSessionId: registerSession._id,
      storeId: args.storeId,
    });

    if (hasCashAffectingCloseoutHolds(closeoutHolds)) {
      return userError({
        code: "precondition_failed",
        message:
          getCloseoutHoldOperatorMessage(closeoutHolds, "deposit") ??
          "Resolve pending register corrections before recording a deposit.",
      });
    }

    const deposit = await recordPaymentAllocationWithCtx(
      ctx,
      paymentAllocationArgs,
    );
    const updatedRegisterSession = await recordRegisterSessionDepositWithCtx(
      ctx,
      {
        amount: storedAmount,
        registerSessionId: args.registerSessionId,
      },
    );

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
      )(ctx, args);
    } catch {
      return userError({
        code: "authorization_failed",
        message: "You do not have access to cash controls.",
      });
    }
  },
});

export const resolveRegisterSessionSyncReview = mutation({
  args: {
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    approvalProofId: v.optional(v.id("approvalProof")),
    decision: v.optional(v.union(v.literal("approved"), v.literal("rejected"))),
    registerSessionId: v.id("registerSession"),
    requestedByStaffProfileId: v.optional(v.id("staffProfile")),
    reviewConflictIds: v.optional(v.array(v.string())),
    storeId: v.id("store"),
  },
  returns: registerSessionSyncReviewResultValidator,
  handler: admitSharedDemoPublicMutation(
    resolveRegisterSessionSyncReviewOperationDefinition,
    async (
    ctx,
    args,
  ): Promise<CommandResult<ResolveRegisterSessionSyncReviewResult>> => {
    const demoActor = await requireSharedDemoStoreCapabilityIfApplicable(
      ctx,
      "cash.control.write",
      args.storeId,
    );
    if (demoActor) {
      await requireReadySharedDemoWriteWithCtx(ctx, { storeId: args.storeId });
    }
    const { athenaUser, store } = await requireCashControlsStoreAccess(
      ctx,
      args.storeId,
      { allowSharedDemoCashControl: true },
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

    const decision = args.decision ?? "approved";
    const isAutomaticResolution =
      !args.actorStaffProfileId && !args.approvalProofId;
    let reviewActorStaffProfileId: Id<"staffProfile"> | undefined;
    if (decision === "rejected" && isAutomaticResolution) {
      return userError({
        code: "precondition_failed",
        message:
          "Automatic sync repair can only apply eligible register activity.",
      });
    }
    if (args.approvalProofId) {
      const approvalProof = await consumeApprovalProofWithCtx(ctx, {
        actionKey: REGISTER_SESSION_SYNC_REVIEW_APPROVAL_ACTION_KEY,
        approvalProofId: args.approvalProofId,
        requestedByStaffProfileId: args.requestedByStaffProfileId,
        requiredRole: "manager",
        storeId: args.storeId,
        subject: {
          id: args.registerSessionId,
          label: registerSession.registerNumber,
          type: "register_session",
        },
      });

      if (approvalProof.kind !== "ok") {
        return approvalProof;
      }

      reviewActorStaffProfileId = approvalProof.data.approvedByStaffProfileId;
    } else if (args.actorStaffProfileId) {
      try {
        reviewActorStaffProfileId = await resolveDepositActorStaffProfileId(
          ctx,
          {
            athenaUserId: athenaUser._id,
            staffProfileId: args.actorStaffProfileId,
            storeId: args.storeId,
          },
        );
      } catch {
        return userError({
          code: "authorization_failed",
          message: "Only managers can resolve synced register reviews.",
        });
      }
      const canResolveReview = await staffProfileCanResolveSyncReview(ctx, {
        organizationId: store.organizationId,
        staffProfileId: reviewActorStaffProfileId,
        storeId: args.storeId,
      });
      if (!canResolveReview) {
        return userError({
          code: "authorization_failed",
          message: "Only managers can resolve synced register reviews.",
        });
      }
    }

    const conflictsBySessionId = await listRegisterSessionSyncReviewConflicts(
      ctx,
      args.storeId,
      {
        includeRejectedEvidence: true,
        includeTransactionMappingEvidence: true,
        registerSessionIds: [args.registerSessionId],
      },
    );
    const allConflicts = conflictsBySessionId.get(args.registerSessionId) ?? [];
    const requestedConflictIds = new Set<string>(args.reviewConflictIds ?? []);
    const conflicts =
      requestedConflictIds.size > 0
        ? allConflicts.filter(
            (conflict) =>
              requestedConflictIds.has(conflict._id) ||
              requestedConflictIds.has(conflict.localEventId),
          )
        : allConflicts;
    if (
      requestedConflictIds.size > 0 &&
      allConflicts.length > 0 &&
      conflicts.length === 0
    ) {
      return userError({
        code: "precondition_failed",
        message:
          "This register review changed before the action completed. Refresh the register session and try again.",
      });
    }
    if (conflicts.length === 0) {
      return ok({
        action: "already_resolved",
        registerSession,
        projectedCount: 0,
        resolvedCount: 0,
      });
    }

    if (demoActor) {
      requireSharedDemoRegisterSessionSyncReview({
        decision,
        reviewKinds: conflicts.map(
          (conflict) => classifyRegisterSessionSyncReview(conflict).reviewKind,
        ),
      });
    }

    const resolvedAt = Date.now();
    const localSyncRepository = createConvexLocalSyncRepository(ctx);
    const projectedTransactionIds: string[] = [];
    const resolvedConflictIds = new Set<Id<"posLocalSyncConflict">>();
    const localEventIds: string[] = [];
    const originalStatuses: string[] = [];
    const rejectedCloseoutLocalEventIds = new Set<string>();
    const sequences: number[] = [];
    let managerOverrideCount = 0;
    let projectedCloseoutCount = 0;

    function syncReviewConflictsMatch(
      left: CashControlSyncConflict,
      right: CashControlSyncConflict,
    ) {
      if (left._id === right._id) return true;
      if (left.summary !== right.summary) return false;

      const leftDetails = left.details ?? {};
      const rightDetails = right.details ?? {};
      const identityKeys = [
        "localIdKind",
        "localId",
        "localTransactionId",
        "localRegisterSessionId",
      ];

      return identityKeys.every(
        (key) => leftDetails[key] === rightDetails[key],
      );
    }

    function addResolvedMatchingLoadedConflicts(
      selectedConflict: (typeof conflicts)[number],
      terminalId: Id<"posTerminal">,
    ) {
      for (const candidate of allConflicts) {
        if (
          candidate.status === "needs_review" &&
          candidate.localEventId === selectedConflict.localEventId &&
          candidate.terminalId === terminalId &&
          candidate.conflictType === selectedConflict.conflictType &&
          syncReviewConflictsMatch(selectedConflict, candidate)
        ) {
          resolvedConflictIds.add(candidate._id as Id<"posLocalSyncConflict">);
        }
      }
    }

    function getOpenEventConflicts(
      selectedConflict: (typeof conflicts)[number],
      terminalId: Id<"posTerminal">,
    ) {
      return allConflicts.filter(
        (candidate) =>
          candidate.status === "needs_review" &&
          candidate.localEventId === selectedConflict.localEventId &&
          candidate.terminalId === terminalId,
      );
    }

    async function hasProjectedSaleTransactionMapping(
      syncEvent: StoredLocalSyncEvent,
      terminalId: Id<"posTerminal">,
    ) {
      const payload = recordDetail(syncEvent.payload) ?? {};
      const localTransactionId = stringDetail(payload, "localTransactionId");
      const localReceiptNumber = stringDetail(payload, "localReceiptNumber");
      const mappingInputs = [
        localTransactionId
          ? { localIdKind: "transaction" as const, localId: localTransactionId }
          : null,
        localReceiptNumber
          ? { localIdKind: "receipt" as const, localId: localReceiptNumber }
          : null,
      ].filter((input): input is NonNullable<typeof input> => Boolean(input));

      for (const mappingInput of mappingInputs) {
        const mapping = await localSyncRepository.findMapping({
          storeId: syncEvent.storeId,
          terminalId,
          localRegisterSessionId: syncEvent.localRegisterSessionId,
          ...mappingInput,
        });
        if (mapping?.cloudTable !== "posTransaction") continue;

        const transaction = await ctx.db.get(
          "posTransaction",
          mapping.cloudId as Id<"posTransaction">,
        );
        if (
          transaction?.status === "completed" &&
          transaction.storeId === syncEvent.storeId &&
          transaction.registerSessionId === args.registerSessionId
        ) {
          return true;
        }
      }

      return false;
    }

    for (const conflict of conflicts) {
      if (resolvedConflictIds.has(conflict._id as Id<"posLocalSyncConflict">)) {
        continue;
      }
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
      const hasConflictRecord = !(
        conflict.status === "rejected" && conflict._id === syncEvent._id
      );
      localEventIds.push(syncEvent.localEventId);
      originalStatuses.push(syncEvent.status);
      sequences.push(syncEvent.sequence);

      if (decision === "rejected") {
        const review = classifyRegisterSessionSyncReview(conflict);
        const hasUnselectedOpenConflictForEvent =
          requestedConflictIds.size > 0 &&
          allConflicts.some(
            (candidate) =>
              candidate.localEventId === syncEvent.localEventId &&
              candidate.terminalId === terminalId &&
              candidate.conflictType !== conflict.conflictType &&
              candidate.status === "needs_review" &&
              !requestedConflictIds.has(candidate._id) &&
              !requestedConflictIds.has(candidate.localEventId),
          );
        const shouldPreserveProjectedSaleEvent =
          syncEvent.eventType === "sale_completed" &&
          typeof syncEvent.projectedAt === "number" &&
          (review.reviewKind === "duplicate_register_open" ||
            (review.reviewKind === "duplicate_pos_session_sale" &&
              (await hasProjectedSaleTransactionMapping(
                syncEvent,
                terminalId,
              ))));
        if (
          !hasUnselectedOpenConflictForEvent &&
          !shouldPreserveProjectedSaleEvent &&
          (syncEvent.status === "conflicted" || syncEvent.status === "rejected")
        ) {
          if (
            syncEvent.eventType === "register_closed" &&
            review.reviewKind === "register_closeout_variance" &&
            !rejectedCloseoutLocalEventIds.has(syncEvent.localEventId)
          ) {
            const conflictDetails = conflict.details ?? {};
            const syncPayload = recordDetail(syncEvent.payload);
            const reviewedCountedCash =
              numberDetail(conflictDetails, "countedCash") ??
              numberDetail(syncPayload ?? undefined, "countedCash") ??
              registerSession.countedCash;
            const reviewedVariance =
              numberDetail(conflictDetails, "variance") ??
              (reviewedCountedCash !== undefined
                ? reviewedCountedCash - registerSession.expectedCash
                : registerSession.variance);
            const reviewedNotes =
              typeof conflictDetails.notes === "string"
                ? conflictDetails.notes
                : typeof syncPayload?.notes === "string"
                  ? syncPayload.notes
                  : undefined;

            await rejectRegisterSessionCloseoutWithCtx(ctx, {
              allowActiveReviewedCloseoutEvidence: true,
              countedCash: reviewedCountedCash,
              notes: reviewedNotes,
              registerSessionId: args.registerSessionId,
              variance: reviewedVariance,
            });
          }
          await localSyncRepository.patchEvent(syncEvent._id, {
            rejectionCode: "manager_rejected",
            rejectionMessage:
              "Manager rejected synced register activity during cash-controls review.",
            status: "rejected",
          });
        } else if (
          shouldPreserveProjectedSaleEvent &&
          syncEvent.status === "conflicted" &&
          typeof syncEvent.projectedAt === "number"
        ) {
          await localSyncRepository.patchEvent(syncEvent._id, {
            status: "projected",
          });
        }
        if (hasConflictRecord) {
          resolvedConflictIds.add(conflict._id as Id<"posLocalSyncConflict">);
          addResolvedMatchingLoadedConflicts(conflict, terminalId);
        }
        if (
          syncEvent.eventType === "register_closed" &&
          (review.reviewKind === "register_closeout_variance" ||
            review.reviewKind === "duplicate_register_closeout") &&
          !rejectedCloseoutLocalEventIds.has(syncEvent.localEventId)
        ) {
          const conflictDetails = conflict.details ?? {};
          rejectedCloseoutLocalEventIds.add(syncEvent.localEventId);
          await recordOperationalEventWithCtx(ctx, {
            ...(reviewActorStaffProfileId
              ? { actorStaffProfileId: reviewActorStaffProfileId }
              : {}),
            actorUserId: athenaUser._id,
            eventType: "register_session_sync_closeout_rejected",
            localEventId: syncEvent.localEventId,
            message: registerSession.registerNumber
              ? `Rejected synced closeout for Register ${registerSession.registerNumber}.`
              : "Rejected synced register closeout.",
            metadata: {
              conflictId: conflict._id,
              conflictType: conflict.conflictType,
              countedCash: conflictDetails.countedCash,
              decision: "rejected",
              expectedCash: conflictDetails.expectedCash,
              localEventId: syncEvent.localEventId,
              notes: conflictDetails.notes ?? syncEvent.payload?.notes,
              originalStatus: syncEvent.status,
              sequence: syncEvent.sequence,
              syncOrigin: "local_sync",
              variance: conflictDetails.variance,
            },
            organizationId: store.organizationId,
            registerSessionId: args.registerSessionId,
            storeId: args.storeId,
            subjectId: args.registerSessionId,
            subjectLabel: registerSession.registerNumber,
            subjectType: "register_session",
            terminalId,
          });
        }
        continue;
      }

      const shouldApplyManagerOverride =
        !isAutomaticResolution &&
        syncEvent.status === "rejected" &&
        conflict.conflictType === "server_rejected";
      if (shouldApplyManagerOverride) {
        managerOverrideCount += 1;
      }
      const review = classifyRegisterSessionSyncReview(conflict);
      const matchesLocalRegisterSession =
        !conflict.localRegisterSessionId ||
        syncEvent.localRegisterSessionId === conflict.localRegisterSessionId;
      const shouldApplyProoflessStaffAccessEvent =
        isProoflessStaffAccessSyncReview(conflict) &&
        (syncEvent.eventType === "register_opened" ||
          syncEvent.eventType === "sale_completed");
      const shouldApplyReviewedSale =
        (syncEvent.eventType === "sale_completed" &&
          matchesLocalRegisterSession &&
          (review.reviewKind === "register_not_open_sale" ||
            review.reviewKind === "inventory_review" ||
            review.reviewKind === "duplicate_pos_session_sale")) ||
        (shouldApplyManagerOverride &&
          syncEvent.eventType === "sale_completed");
      const openEventConflicts = shouldApplyReviewedSale
        ? getOpenEventConflicts(conflict, terminalId)
        : [];
      const selectedEventConflicts = openEventConflicts.filter(
        (candidate) =>
          requestedConflictIds.size === 0 ||
          requestedConflictIds.has(candidate._id) ||
          requestedConflictIds.has(candidate.localEventId),
      );
      const selectedEventReviewKinds = new Set(
        selectedEventConflicts.map(
          (candidate) =>
            classifyRegisterSessionSyncReview(candidate).reviewKind,
        ),
      );
      const hasUnselectedOpenSaleConflict =
        shouldApplyReviewedSale &&
        requestedConflictIds.size > 0 &&
        openEventConflicts.some(
          (candidate) =>
            !requestedConflictIds.has(candidate._id) &&
            !requestedConflictIds.has(candidate.localEventId),
        );
      if (hasUnselectedOpenSaleConflict) {
        return userError({
          code: "precondition_failed",
          message:
            "This synced sale has multiple review items. Resolve them together so Athena can apply the sale once.",
        });
      }
      const shouldPreserveDuplicatePosSessionSale =
        shouldApplyReviewedSale &&
        selectedEventReviewKinds.has("duplicate_pos_session_sale");
      const shouldApplyReviewedInventorySale =
        shouldApplyReviewedSale &&
        selectedEventReviewKinds.has("inventory_review");
      const shouldApplyReviewedSaleCashOverride =
        shouldApplyReviewedSale &&
        (selectedEventReviewKinds.has("register_not_open_sale") ||
          selectedEventReviewKinds.has("inventory_review"));
      const shouldApplyReviewedCloseout =
        (syncEvent.eventType === "register_closed" &&
          matchesLocalRegisterSession &&
          conflict.conflictType === "permission" &&
          review.reviewKind === "register_closeout_variance") ||
        (shouldApplyManagerOverride &&
          syncEvent.eventType === "register_closed");
      const shouldRepairMissingRegisterSessionMapping =
        syncEvent.eventType === "sale_completed" &&
        matchesLocalRegisterSession &&
        review.reviewKind === "missing_register_session_mapping";

      if (shouldRepairMissingRegisterSessionMapping) {
        if (isAutomaticResolution) {
          return userError({
            code: "precondition_failed",
            message:
              "This register review is not eligible for automatic sync repair.",
          });
        }

        if (!isRepairableRegisterSessionStatus(registerSession.status)) {
          return userError({
            code: "precondition_failed",
            message:
              "This synced sale can only be repaired before the register session is closed.",
          });
        }

        if (registerSession.status === "closing") {
          const closeoutHolds = await listRegisterSessionCloseoutHolds(ctx, {
            registerSessionId: registerSession._id,
            storeId: args.storeId,
          });
          const hasMappingRepairHold = closeoutHolds.some(
            (hold) =>
              hold.kind ===
                "repairable_missing_register_session_mapping_sales" &&
              hold.count > 0,
          );
          const salePrecedesCloseout = await salePrecedesLocalCloseoutIfPresent(
            ctx,
            {
              storeId: args.storeId,
              syncEvent,
              terminalId,
            },
          );
          if (!hasMappingRepairHold || !salePrecedesCloseout) {
            return userError({
              code: "precondition_failed",
              message:
                "This synced sale can no longer be repaired for this closeout.",
            });
          }
        }

        const completedTransaction =
          await getCompletedTransactionForRegisterMappingRepair(
            ctx,
            localSyncRepository,
            {
              conflict,
              registerSessionId: args.registerSessionId,
              syncEvent,
              terminalId,
            },
          );
        if (completedTransaction.kind === "mismatch") {
          return userError({
            code: "precondition_failed",
            message:
              "This synced sale could not be matched to a completed sale for this register session.",
          });
        }

        try {
          const mappingResult = await createOrReuseRegisterSessionRepairMapping(
            localSyncRepository,
            {
              localEventId: syncEvent.localEventId,
              localRegisterSessionId: syncEvent.localRegisterSessionId,
              now: resolvedAt,
              registerSessionId: args.registerSessionId,
              storeId: args.storeId,
              terminalId,
            },
          );
          if (
            "status" in mappingResult &&
            mappingResult.status === "conflict"
          ) {
            return userError({
              code: "precondition_failed",
              message:
                "This synced sale is already mapped to a different register session.",
            });
          }
        } catch {
          return userError({
            code: "precondition_failed",
            message:
              "This synced sale is already mapped to a different register session.",
          });
        }

        const hasUnselectedOpenConflictForEvent =
          requestedConflictIds.size > 0 &&
          allConflicts.some(
            (candidate) =>
              candidate.localEventId === syncEvent.localEventId &&
              candidate.terminalId === terminalId &&
              candidate.conflictType !== conflict.conflictType &&
              candidate.status === "needs_review" &&
              !requestedConflictIds.has(candidate._id) &&
              !requestedConflictIds.has(candidate.localEventId),
          );
        if (completedTransaction.kind === "matched") {
          if (!hasUnselectedOpenConflictForEvent) {
            await localSyncRepository.patchEvent(syncEvent._id, {
              status: "projected",
              projectedAt: resolvedAt,
            });
          }
          if (hasConflictRecord) {
            resolvedConflictIds.add(conflict._id as Id<"posLocalSyncConflict">);
          }
          projectedTransactionIds.push(completedTransaction.transaction._id);
          continue;
        }

        if (hasUnselectedOpenConflictForEvent) {
          if (hasConflictRecord) {
            resolvedConflictIds.add(conflict._id as Id<"posLocalSyncConflict">);
          }
          continue;
        }
      }

      if (isAutomaticResolution && !shouldApplyProoflessStaffAccessEvent) {
        return userError({
          code: "precondition_failed",
          message:
            "This register review is not eligible for automatic sync repair.",
        });
      }

      if (
        !shouldApplyReviewedSale &&
        !shouldApplyReviewedCloseout &&
        !shouldApplyProoflessStaffAccessEvent &&
        !shouldRepairMissingRegisterSessionMapping
      ) {
        if (
          syncEvent.eventType === "register_closed" &&
          review.reviewKind === "duplicate_register_closeout"
        ) {
          return userError({
            code: "precondition_failed",
            message:
              "This synced closeout cannot be applied because the register is already closed. Reject the synced activity to discard it.",
          });
        }

        if (review.reviewKind === "service_customer_attribution") {
          return userError({
            code: "precondition_failed",
            message:
              "This synced service sale is missing customer attribution. Reject the synced activity to clear this review, then recreate the service work with a customer if needed.",
          });
        }

        return userError({
          code: "precondition_failed",
          message:
            "This register review still needs attention before the synced activity can be applied.",
        });
      }

      if (syncEvent.status === "projected") {
        if (hasConflictRecord) {
          if (shouldApplyReviewedSale && selectedEventConflicts.length > 0) {
            for (const selectedEventConflict of selectedEventConflicts) {
              resolvedConflictIds.add(
                selectedEventConflict._id as Id<"posLocalSyncConflict">,
              );
            }
          } else {
            resolvedConflictIds.add(conflict._id as Id<"posLocalSyncConflict">);
            addResolvedMatchingLoadedConflicts(conflict, terminalId);
          }
        }
        continue;
      }

      if (syncEvent.status !== "conflicted" && !shouldApplyManagerOverride) {
        return userError({
          code: "precondition_failed",
          message:
            "This register review is not ready to apply. Refresh the register session and try again.",
        });
      }

      const parsedEvent = parseStoredLocalSyncEvent(
        localSyncRepository,
        shouldApplyManagerOverride && syncEvent.eventType === "sale_completed"
          ? buildReviewedSaleProjectionEvent(syncEvent)
          : syncEvent,
      );
      if (
        !parsedEvent.ok ||
        (shouldApplyReviewedSale &&
          parsedEvent.event.eventType !== "sale_completed") ||
        (shouldRepairMissingRegisterSessionMapping &&
          parsedEvent.event.eventType !== "sale_completed") ||
        (shouldApplyProoflessStaffAccessEvent &&
          parsedEvent.event.eventType !== "register_opened" &&
          parsedEvent.event.eventType !== "sale_completed") ||
        (shouldApplyReviewedCloseout &&
          parsedEvent.event.eventType !== "register_closed")
      ) {
        return userError({
          code: "precondition_failed",
          message:
            "This register review could not be applied because the synced activity details are incomplete.",
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
          allowReviewedClosingRegisterSaleProjection:
            shouldRepairMissingRegisterSessionMapping,
          applyExpectedTotalForReviewedNonCashOverpayment:
            shouldApplyManagerOverride || shouldApplyReviewedSaleCashOverride,
          allowReviewedInventorySaleProjection:
            shouldApplyReviewedInventorySale,
          allowReviewedDuplicatePosSessionSaleProjection:
            shouldPreserveDuplicatePosSessionSale,
          allowRegisterCloseoutVarianceProjection: shouldApplyReviewedCloseout,
          reviewedConflictIds:
            shouldApplyReviewedSale && selectedEventConflicts.length > 0
              ? selectedEventConflicts.map(
                  (reviewConflict) => reviewConflict._id,
                )
              : requestedConflictIds.size > 0
                ? Array.from(requestedConflictIds)
                : conflicts.map((reviewConflict) => reviewConflict._id),
          reviewActorStaffProfileId,
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
      if (hasConflictRecord) {
        if (shouldApplyReviewedSale && selectedEventConflicts.length > 0) {
          for (const selectedEventConflict of selectedEventConflicts) {
            resolvedConflictIds.add(
              selectedEventConflict._id as Id<"posLocalSyncConflict">,
            );
          }
        } else {
          resolvedConflictIds.add(conflict._id as Id<"posLocalSyncConflict">);
          addResolvedMatchingLoadedConflicts(conflict, terminalId);
        }
      }
      if (shouldApplyReviewedCloseout) {
        projectedCloseoutCount += 1;
      }
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
      Array.from(resolvedConflictIds).map((conflictId) =>
        ctx.db.patch("posLocalSyncConflict", conflictId, {
          resolvedAt,
          ...(reviewActorStaffProfileId
            ? { resolvedByStaffProfileId: reviewActorStaffProfileId }
            : {}),
          status: "resolved",
        }),
      ),
    );

    await recordOperationalEventWithCtx(ctx, {
      ...(reviewActorStaffProfileId
        ? { actorStaffProfileId: reviewActorStaffProfileId }
        : {}),
      actorUserId: athenaUser._id,
      eventType: "register_session_sync_review_resolved",
      message:
        decision === "rejected"
          ? conflicts.length === 1
            ? "Rejected synced register review."
            : `Rejected ${conflicts.length} synced register reviews.`
          : isAutomaticResolution
            ? projectedTransactionIds.length === 0
              ? conflicts.length === 1
                ? "Automatically resolved proofless synced register review."
                : `Automatically resolved ${conflicts.length} proofless synced register reviews.`
              : projectedTransactionIds.length === 1
                ? "Automatically applied proofless synced register sale."
                : `Automatically applied ${projectedTransactionIds.length} proofless synced register sales.`
            : managerOverrideCount > 0
              ? managerOverrideCount === 1
                ? projectedTransactionIds.length === 1
                  ? "Manager override applied rejected synced register sale."
                  : "Manager override applied rejected synced register activity."
                : `Manager override applied ${managerOverrideCount} rejected synced register events.`
              : projectedCloseoutCount > 0
                ? projectedCloseoutCount === 1
                  ? "Applied reviewed synced register closeout."
                  : `Applied ${projectedCloseoutCount} reviewed synced register closeouts.`
                : projectedTransactionIds.length === 0
                  ? conflicts.length === 1
                    ? "Resolved synced register review."
                    : `Resolved ${conflicts.length} synced register reviews.`
                  : projectedTransactionIds.length === 1
                    ? "Applied reviewed synced register sale."
                    : `Applied ${projectedTransactionIds.length} reviewed synced register sales.`,
      metadata: {
        ...(args.approvalProofId
          ? { approvalProofId: args.approvalProofId }
          : {}),
        conflictIds: conflicts.map((conflict) => conflict._id),
        conflictTypes: conflicts.map((conflict) => conflict.conflictType),
        decision,
        localEventIds,
        managerOverride: managerOverrideCount > 0,
        managerOverrideCount,
        originalStatuses,
        projectedCloseoutCount,
        projectedTransactionIds,
        sequences,
      },
      organizationId: store.organizationId,
      registerSessionId: args.registerSessionId,
      storeId: args.storeId,
      subjectId: args.registerSessionId,
      subjectLabel: registerSession.registerNumber,
      subjectType: "register_session",
    });

    return ok({
      action: decision === "rejected" ? "rejected" : "resolved",
      registerSession: await ctx.db.get(
        "registerSession",
        args.registerSessionId,
      ),
      projectedCount: projectedTransactionIds.length,
      resolvedCount: conflicts.length,
    });
    },
  ),
});
