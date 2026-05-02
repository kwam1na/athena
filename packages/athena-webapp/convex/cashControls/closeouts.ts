import { mutation, MutationCtx, query, QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { buildApprovalRequest } from "../operations/approvalRequestHelpers";
import { consumeApprovalProofWithCtx } from "../operations/approvalProofs";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { recordRegisterSessionTraceBestEffort } from "../operations/registerSessionTracing";
import { commandResultValidator } from "../lib/commandResultValidators";
import {
  approvalRequired,
  ok,
  userError,
  type ApprovalCommandResult,
  type CommandResult,
} from "../../shared/commandResult";
import { formatStaffDisplayName } from "../../shared/staffDisplayName";

const CLOSEOUT_SESSION_LIMIT = 100;
const DEFAULT_VARIANCE_APPROVAL_THRESHOLD = 5000;
const REGISTER_VARIANCE_REVIEW_ACTION_KEY =
  "cash_controls.register_session.review_variance";
const REGISTER_OPENING_FLOAT_CORRECTION_ACTION_KEY =
  "cash_controls.register_session.correct_opening_float";

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

type CashControlsConfig = {
  requireManagerSignoffForAnyVariance: boolean;
  requireManagerSignoffForOvers: boolean;
  requireManagerSignoffForShorts: boolean;
  varianceApprovalThreshold: number;
};

type CloseoutApprovalRequestRecord = Pick<
  Doc<"approvalRequest">,
  "_id" | "createdAt" | "reason" | "registerSessionId" | "requestType" | "requestedByStaffProfileId" | "status"
>;

type CloseoutApprovalRequestSummary = {
  _id: Id<"approvalRequest">;
  createdAt: number;
  reason?: string;
  requestedByStaffName: string | null;
  status: string;
};

type RegisterSessionCloseoutReview = ReturnType<typeof buildRegisterSessionCloseoutReview>;

type RegisterSessionVarianceApprovalRequirement = {
  actionKey: typeof REGISTER_VARIANCE_REVIEW_ACTION_KEY;
  approvalRequestId?: Id<"approvalRequest">;
  mode: "async_approval";
  reason: string;
  requiredRole: "manager";
  subject: {
    id: Id<"registerSession">;
    label?: string;
    type: "register_session";
  };
  context: {
    countedCash: number;
    expectedCash: number;
    variance: number;
  };
};

type CloseoutSnapshot = {
  config: CashControlsConfig;
  registerSessions: Array<
    Doc<"registerSession"> & {
      approvalRequest: CloseoutApprovalRequestSummary | null;
      closeoutReview: RegisterSessionCloseoutReview | null;
      closedByStaffName: string | null;
      openedByStaffName: string | null;
    }
  >;
};

type SubmitRegisterSessionCloseoutArgs = {
  actorStaffProfileId?: Id<"staffProfile">;
  actorUserId?: Id<"athenaUser">;
  countedCash: number;
  notes?: string;
  registerSessionId: Id<"registerSession">;
  storeId: Id<"store">;
};

type SubmitRegisterSessionCloseoutResult =
  | {
      action: "approval_required";
      approvalRequirement: RegisterSessionVarianceApprovalRequirement;
      approvalRequest: Doc<"approvalRequest"> | null;
      closeoutReview: RegisterSessionCloseoutReview;
      registerSession: Doc<"registerSession"> | null;
    }
  | {
      action: "closed";
      closeoutReview: RegisterSessionCloseoutReview;
      registerSession: Doc<"registerSession"> | null;
    };

type ReviewRegisterSessionCloseoutArgs = {
  approvalProofId: Id<"approvalProof">;
  decision: "approved" | "rejected";
  decisionNotes?: string;
  registerSessionId: Id<"registerSession">;
  reviewedByUserId?: Id<"athenaUser">;
  storeId: Id<"store">;
};

type ReviewRegisterSessionCloseoutResult =
  | {
      action: "approved";
      approvalRequest: Doc<"approvalRequest"> | null;
      registerSession: Doc<"registerSession"> | null;
    }
  | {
      action: "rejected";
      approvalRequest: Doc<"approvalRequest"> | null;
      registerSession: Doc<"registerSession"> | null;
    };

type ReopenRegisterSessionResult = {
  action: "reopened";
  approvalRequest: Doc<"approvalRequest"> | null;
  registerSession: Doc<"registerSession"> | null;
};

type CorrectRegisterSessionOpeningFloatArgs = {
  actorStaffProfileId?: Id<"staffProfile">;
  actorUserId?: Id<"athenaUser">;
  approvalProofId?: Id<"approvalProof">;
  correctedOpeningFloat: number;
  reason: string;
  registerSessionId: Id<"registerSession">;
  storeId: Id<"store">;
};

function buildOpeningFloatCorrectionApprovalRequirement(args: {
  correctedOpeningFloat: number;
  previousOpeningFloat: number;
  reason: string;
  registerSession: Doc<"registerSession">;
}) {
  return {
    action: {
      key: REGISTER_OPENING_FLOAT_CORRECTION_ACTION_KEY,
      label: "Correct opening float",
    },
    reason:
      "Manager approval is required to correct the register opening float.",
    requiredRole: "manager" as const,
    selfApproval: "allowed" as const,
    subject: {
      id: args.registerSession._id,
      label: args.registerSession.registerNumber,
      type: "register_session",
    },
    copy: {
      title: "Manager approval required",
      message:
        "Authorization is needed from a manager to correct this register opening float.",
      primaryActionLabel: "Approve correction",
      secondaryActionLabel: "Cancel",
    },
    resolutionModes: [{ kind: "inline_manager_proof" as const }],
    metadata: {
      correctedOpeningFloat: args.correctedOpeningFloat,
      previousOpeningFloat: args.previousOpeningFloat,
      reason: args.reason,
    },
  };
}

type CorrectRegisterSessionOpeningFloatResult = {
  action: "corrected" | "unchanged";
  correctedOpeningFloat: number;
  previousOpeningFloat: number;
  registerSession: Doc<"registerSession"> | null;
};

const closeoutReviewValidator = v.object({
  hasVariance: v.boolean(),
  reason: v.optional(v.string()),
  requiresApproval: v.boolean(),
  variance: v.number(),
});

const registerSessionVarianceApprovalRequirementValidator = v.object({
  actionKey: v.literal("cash_controls.register_session.review_variance"),
  approvalRequestId: v.optional(v.id("approvalRequest")),
  context: v.object({
    countedCash: v.number(),
    expectedCash: v.number(),
    variance: v.number(),
  }),
  mode: v.literal("async_approval"),
  reason: v.string(),
  requiredRole: v.literal("manager"),
  subject: v.object({
    id: v.id("registerSession"),
    label: v.optional(v.string()),
    type: v.literal("register_session"),
  }),
});

const submitRegisterSessionCloseoutResultValidator = v.union(
  v.object({
    kind: v.literal("ok"),
    data: v.union(
      v.object({
        action: v.literal("approval_required"),
        approvalRequirement: registerSessionVarianceApprovalRequirementValidator,
        approvalRequest: v.union(v.null(), v.any()),
        closeoutReview: closeoutReviewValidator,
        registerSession: v.union(v.null(), v.any()),
      }),
      v.object({
        action: v.literal("closed"),
        closeoutReview: closeoutReviewValidator,
        registerSession: v.union(v.null(), v.any()),
      }),
    ),
  }),
  v.object({
    kind: v.literal("user_error"),
    error: userErrorValidator,
  }),
);

const reviewRegisterSessionCloseoutResultValidator = v.union(
  v.object({
    kind: v.literal("ok"),
    data: v.union(
      v.object({
        action: v.literal("approved"),
        approvalRequest: v.union(v.null(), v.any()),
        registerSession: v.union(v.null(), v.any()),
      }),
      v.object({
        action: v.literal("rejected"),
        approvalRequest: v.union(v.null(), v.any()),
        registerSession: v.union(v.null(), v.any()),
      }),
    ),
  }),
  v.object({
    kind: v.literal("user_error"),
    error: userErrorValidator,
  }),
);

const reopenRegisterSessionResultValidator = v.union(
  v.object({
    kind: v.literal("ok"),
    data: v.object({
      action: v.literal("reopened"),
      approvalRequest: v.union(v.null(), v.any()),
      registerSession: v.union(v.null(), v.any()),
    }),
  }),
  v.object({
    kind: v.literal("user_error"),
    error: userErrorValidator,
  }),
);

const correctRegisterSessionOpeningFloatResultValidator = commandResultValidator(
  v.object({
    action: v.union(v.literal("corrected"), v.literal("unchanged")),
    correctedOpeningFloat: v.number(),
    previousOpeningFloat: v.number(),
    registerSession: v.union(v.null(), v.any()),
  }),
);

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
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

export function getCashControlsConfig(store?: { config?: unknown } | null): CashControlsConfig {
  const operations = asRecord(asRecord(store?.config).operations);
  const cashControls = asRecord(operations.cashControls);
  const threshold = asNumber(cashControls.varianceApprovalThreshold);

  return {
    requireManagerSignoffForAnyVariance:
      asBoolean(cashControls.requireManagerSignoffForAnyVariance) ?? false,
    requireManagerSignoffForOvers:
      asBoolean(cashControls.requireManagerSignoffForOvers) ?? false,
    requireManagerSignoffForShorts:
      asBoolean(cashControls.requireManagerSignoffForShorts) ?? false,
    varianceApprovalThreshold: Math.max(
      0,
      threshold ?? DEFAULT_VARIANCE_APPROVAL_THRESHOLD
    ),
  };
}

export function buildRegisterSessionCloseoutReview(args: {
  countedCash: number;
  expectedCash: number;
  config: CashControlsConfig;
}) {
  const variance = args.countedCash - args.expectedCash;
  const hasVariance = variance !== 0;
  const isOver = variance > 0;
  const isShort = variance < 0;
  const exceedsThreshold =
    Math.abs(variance) > args.config.varianceApprovalThreshold;
  const requiresApproval =
    (hasVariance && args.config.requireManagerSignoffForAnyVariance) ||
    (isOver && args.config.requireManagerSignoffForOvers) ||
    (isShort && args.config.requireManagerSignoffForShorts) ||
    exceedsThreshold;

  if (!requiresApproval) {
    return {
      hasVariance,
      reason: undefined,
      requiresApproval: false as const,
      variance,
    };
  }

  if (exceedsThreshold) {
    return {
      hasVariance,
      reason: `Variance of ${variance} exceeded the closeout approval threshold.`,
      requiresApproval: true as const,
      variance,
    };
  }

  if (args.config.requireManagerSignoffForAnyVariance) {
    return {
      hasVariance,
      reason: `Manager signoff is required for any register variance (${variance}).`,
      requiresApproval: true as const,
      variance,
    };
  }

  return {
    hasVariance,
    reason: isOver
      ? `Manager signoff is required for register overages (${variance}).`
      : `Manager signoff is required for register shortages (${variance}).`,
    requiresApproval: true as const,
    variance,
  };
}

export function buildRegisterSessionVarianceApprovalRequirement(args: {
  approvalRequestId?: Id<"approvalRequest">;
  closeoutReview: RegisterSessionCloseoutReview;
  countedCash: number;
  expectedCash: number;
  registerSession: Pick<Doc<"registerSession">, "_id" | "registerNumber">;
}): RegisterSessionVarianceApprovalRequirement {
  return {
    actionKey: REGISTER_VARIANCE_REVIEW_ACTION_KEY,
    approvalRequestId: args.approvalRequestId,
    mode: "async_approval",
    reason:
      args.closeoutReview.reason ??
      "Manager approval is required before this register session can close.",
    requiredRole: "manager",
    subject: {
      id: args.registerSession._id,
      label: args.registerSession.registerNumber,
      type: "register_session",
    },
    context: {
      countedCash: args.countedCash,
      expectedCash: args.expectedCash,
      variance: args.closeoutReview.variance,
    },
  };
}

async function listRegisterSessionsForCloseout(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">
): Promise<Array<Doc<"registerSession">>> {
  const [openSessions, activeSessions, closingSessions] = await Promise.all([
    ctx.db
      .query("registerSession")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", storeId).eq("status", "open")
      )
      .take(CLOSEOUT_SESSION_LIMIT),
    ctx.db
      .query("registerSession")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", storeId).eq("status", "active")
      )
      .take(CLOSEOUT_SESSION_LIMIT),
    ctx.db
      .query("registerSession")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", storeId).eq("status", "closing")
      )
      .take(CLOSEOUT_SESSION_LIMIT),
  ]);

  return [...openSessions, ...activeSessions, ...closingSessions].sort(
    (left, right) => right.openedAt - left.openedAt
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

async function staffProfileCanReviewCloseoutVariance(
  ctx: Pick<MutationCtx, "db">,
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

  const roleAssignments = await ctx.db
    .query("staffRoleAssignment")
    .withIndex("by_staffProfileId", (q) =>
      q.eq("staffProfileId", args.staffProfileId)
    )
    .take(20);

  return roleAssignments.some(
    (assignment) =>
      assignment.status === "active" &&
      assignment.role === "manager" &&
      assignment.organizationId === args.organizationId &&
      assignment.storeId === args.storeId,
  );
}

async function cancelPendingApprovalIfNeeded(args: {
  ctx: Pick<MutationCtx, "db" | "runMutation">;
  approvalRequestId?: Id<"approvalRequest">;
  decisionNotes?: string;
  reviewedByUserId?: Id<"athenaUser">;
  reviewedByStaffProfileId?: Id<"staffProfile">;
}): Promise<Doc<"approvalRequest"> | null> {
  if (!args.approvalRequestId) {
    return null;
  }

  const approvalRequest = await args.ctx.db.get(
    "approvalRequest",
    args.approvalRequestId
  );

  if (!approvalRequest || approvalRequest.status !== "pending") {
    return approvalRequest;
  }

  return args.ctx.runMutation(internal.operations.approvalRequests.decideApprovalRequestInternal, {
    approvalRequestId: approvalRequest._id,
    decision: "cancelled",
    reviewedByStaffProfileId: args.reviewedByStaffProfileId,
    reviewedByUserId: args.reviewedByUserId,
    decisionNotes:
      args.decisionNotes ?? "Superseded by a new register closeout submission.",
  });
}

export const getCloseoutSnapshot = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (
    ctx: QueryCtx,
    args: { storeId: Id<"store"> }
  ): Promise<CloseoutSnapshot> => {
    const [registerSessions, pendingApprovalRequests, store] = await Promise.all([
      listRegisterSessionsForCloseout(ctx, args.storeId),
      ctx.db
        .query("approvalRequest")
        .withIndex("by_storeId_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", "pending")
        )
        .take(CLOSEOUT_SESSION_LIMIT),
      ctx.runQuery(internal.inventory.stores.findById, { id: args.storeId }),
    ]);
    const config = getCashControlsConfig(store);
    const approvalMap = new Map<Id<"approvalRequest">, CloseoutApprovalRequestRecord>(
      pendingApprovalRequests
        .filter(
          (approvalRequest: Doc<"approvalRequest">) =>
            approvalRequest.registerSessionId &&
            approvalRequest.requestType === "variance_review"
        )
        .map((approvalRequest: Doc<"approvalRequest">) => [
          approvalRequest._id,
          approvalRequest,
        ])
    );
    const staffProfileIds = new Set<Id<"staffProfile">>();

    for (const registerSession of registerSessions) {
      if (registerSession.openedByStaffProfileId) {
        staffProfileIds.add(registerSession.openedByStaffProfileId);
      }

      if (registerSession.closedByStaffProfileId) {
        staffProfileIds.add(registerSession.closedByStaffProfileId);
      }

      const approvalRequest = registerSession.managerApprovalRequestId
        ? approvalMap.get(registerSession.managerApprovalRequestId)
        : null;

      if (approvalRequest?.requestedByStaffProfileId) {
        staffProfileIds.add(approvalRequest.requestedByStaffProfileId);
      }
    }

    const staffMap = await listStaffNames(ctx, staffProfileIds);

    return {
      config,
      registerSessions: registerSessions.map((registerSession: Doc<"registerSession">) => {
        const approvalRequest = registerSession.managerApprovalRequestId
          ? approvalMap.get(registerSession.managerApprovalRequestId)
          : null;
        const closeoutReview =
          registerSession.countedCash !== undefined
            ? buildRegisterSessionCloseoutReview({
                countedCash: registerSession.countedCash,
                config,
                expectedCash: registerSession.expectedCash,
              })
            : null;

        return {
          ...registerSession,
          approvalRequest: approvalRequest
            ? {
                _id: approvalRequest._id,
                createdAt: approvalRequest.createdAt,
                reason: approvalRequest.reason,
                requestedByStaffName: approvalRequest.requestedByStaffProfileId
                  ? staffMap.get(approvalRequest.requestedByStaffProfileId) ?? null
                  : null,
                status: approvalRequest.status,
              }
            : null,
          closeoutReview,
          closedByStaffName: registerSession.closedByStaffProfileId
            ? staffMap.get(registerSession.closedByStaffProfileId) ?? null
            : null,
          openedByStaffName: registerSession.openedByStaffProfileId
            ? staffMap.get(registerSession.openedByStaffProfileId) ?? null
            : null,
        };
      }),
    };
  },
});

export const submitRegisterSessionCloseout = mutation({
  args: {
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    actorUserId: v.optional(v.id("athenaUser")),
    countedCash: v.number(),
    notes: v.optional(v.string()),
    registerSessionId: v.id("registerSession"),
    storeId: v.id("store"),
  },
  returns: submitRegisterSessionCloseoutResultValidator,
  handler: async (
    ctx: MutationCtx,
    args: SubmitRegisterSessionCloseoutArgs
  ): Promise<CommandResult<SubmitRegisterSessionCloseoutResult>> => {
    if (args.countedCash < 0) {
      return userError({
        code: "validation_failed",
        message: "Counted cash cannot be negative.",
      });
    }

    const [registerSession, store] = await Promise.all([
      ctx.db.get("registerSession", args.registerSessionId),
      ctx.runQuery(internal.inventory.stores.findById, { id: args.storeId }),
    ]);

    if (!registerSession || registerSession.storeId !== args.storeId) {
      return userError({
        code: "not_found",
        message: "Register session not found for this store.",
      });
    }

    if (registerSession.status === "closed") {
      return userError({
        code: "precondition_failed",
        message: "Register session is already closed.",
      });
    }

    const config = getCashControlsConfig(store);
    const closeoutReview = buildRegisterSessionCloseoutReview({
      countedCash: args.countedCash,
      config,
      expectedCash: registerSession.expectedCash,
    });

    const closingSession = await ctx.runMutation(
      internal.operations.registerSessions.beginRegisterSessionCloseout,
      {
        countedCash: args.countedCash,
        notes: trimOptional(args.notes),
        registerSessionId: args.registerSessionId,
      }
    );

    const closeoutSubmittedAt = Date.now();
    const closeoutSubmittedTraceResult = await recordRegisterSessionTraceBestEffort(
      ctx,
      {
        stage: "closeout_submitted",
        session:
          closingSession ??
          ({
            ...registerSession,
            countedCash: args.countedCash,
            status: "closing",
          } as typeof registerSession),
        occurredAt: closeoutSubmittedAt,
        actorStaffProfileId: args.actorStaffProfileId,
        actorUserId: args.actorUserId,
        countedCash: args.countedCash,
        variance: closeoutReview.variance,
      },
    );

    await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
      registerSessionId: registerSession._id,
      traceCreated: closeoutSubmittedTraceResult.traceCreated,
      traceId: closeoutSubmittedTraceResult.traceId,
      workflowTraceId: registerSession.workflowTraceId,
    });

    if (closeoutReview.requiresApproval) {
      await cancelPendingApprovalIfNeeded({
        approvalRequestId: registerSession.managerApprovalRequestId,
        ctx,
        reviewedByStaffProfileId: args.actorStaffProfileId,
        reviewedByUserId: args.actorUserId,
      });

      const approvalRequestId = await ctx.db.insert(
        "approvalRequest",
        buildApprovalRequest({
          metadata: {
            countedCash: args.countedCash,
            expectedCash: registerSession.expectedCash,
            variance: closeoutReview.variance,
          },
          notes: trimOptional(args.notes),
          organizationId: registerSession.organizationId,
          reason: closeoutReview.reason,
          registerSessionId: registerSession._id,
          requestType: "variance_review",
          requestedByStaffProfileId: args.actorStaffProfileId,
          requestedByUserId: args.actorUserId,
          storeId: args.storeId,
          subjectId: registerSession._id,
          subjectType: "register_session",
        })
      );
      const approvalRequest = await ctx.db.get("approvalRequest", approvalRequestId);
      const approvalRequirement =
        buildRegisterSessionVarianceApprovalRequirement({
          approvalRequestId,
          closeoutReview,
          countedCash: args.countedCash,
          expectedCash: registerSession.expectedCash,
          registerSession,
        });

      await ctx.db.patch("registerSession", registerSession._id, {
        managerApprovalRequestId: approvalRequestId,
      });

      await recordOperationalEventWithCtx(ctx, {
        actorStaffProfileId: args.actorStaffProfileId,
        actorUserId: args.actorUserId,
        approvalRequestId,
        eventType: "register_session_variance_review_requested",
        message:
          closeoutReview.reason ??
          "Register closeout submitted for manager variance review.",
        metadata: {
          actionKey: REGISTER_VARIANCE_REVIEW_ACTION_KEY,
          approvalMode: "async_approval",
          approvalRequestId,
          countedCash: args.countedCash,
          expectedCash: registerSession.expectedCash,
          requiredRole: "manager",
          variance: closeoutReview.variance,
        },
        organizationId: registerSession.organizationId,
        reason: closeoutReview.reason,
        registerSessionId: registerSession._id,
        storeId: args.storeId,
        subjectId: registerSession._id,
        subjectLabel: registerSession.registerNumber,
        subjectType: "register_session",
      });

      const approvalPendingSession = await ctx.db.get(
        "registerSession",
        registerSession._id
      );
      const approvalPendingAt = Date.now();
      const approvalPendingTraceResult = await recordRegisterSessionTraceBestEffort(
        ctx,
        {
          stage: "approval_pending",
          session:
            approvalPendingSession ??
            ({
              ...registerSession,
              countedCash: args.countedCash,
              managerApprovalRequestId: approvalRequestId,
              status: "closing",
            } as typeof registerSession),
          occurredAt: approvalPendingAt,
          actorStaffProfileId: args.actorStaffProfileId,
          actorUserId: args.actorUserId,
          approvalRequestId,
          countedCash: args.countedCash,
          variance: closeoutReview.variance,
        },
      );

      await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
        registerSessionId: registerSession._id,
        traceCreated: approvalPendingTraceResult.traceCreated,
        traceId: approvalPendingTraceResult.traceId,
        workflowTraceId: approvalPendingSession?.workflowTraceId,
      });

      return ok({
        action: "approval_required" as const,
        approvalRequirement,
        approvalRequest,
        closeoutReview,
        registerSession: approvalPendingSession,
      });
    }

    await cancelPendingApprovalIfNeeded({
      approvalRequestId: registerSession.managerApprovalRequestId,
      ctx,
      reviewedByStaffProfileId: args.actorStaffProfileId,
      reviewedByUserId: args.actorUserId,
    });

    const closedSession = await ctx.runMutation(
      internal.operations.registerSessions.closeRegisterSession,
      {
        closedByStaffProfileId: args.actorStaffProfileId,
        closedByUserId: args.actorUserId,
        countedCash: args.countedCash,
        registerSessionId: args.registerSessionId,
      }
    );

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
      eventType: "register_session_closed",
      message: closeoutReview.hasVariance
        ? `Register session closed with a variance of ${closeoutReview.variance}.`
        : "Register session closed with an exact cash match.",
      metadata: {
        countedCash: args.countedCash,
        expectedCash: registerSession.expectedCash,
        variance: closeoutReview.variance,
      },
      organizationId: registerSession.organizationId,
      reason: closeoutReview.reason,
      registerSessionId: registerSession._id,
      storeId: args.storeId,
      subjectId: registerSession._id,
      subjectLabel: registerSession.registerNumber,
      subjectType: "register_session",
    });

    const closedTraceResult = await recordRegisterSessionTraceBestEffort(ctx, {
      stage: "closed",
      session: closedSession ?? registerSession,
      occurredAt: closedSession?.closedAt,
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
      countedCash: args.countedCash,
      variance: closeoutReview.variance,
    });

    await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
      registerSessionId: registerSession._id,
      traceCreated: closedTraceResult.traceCreated,
      traceId: closedTraceResult.traceId,
      workflowTraceId: closedSession?.workflowTraceId,
    });

    return ok({
      action: "closed" as const,
      closeoutReview,
      registerSession: closedSession,
    });
  },
});

export const reopenRegisterSessionCloseout = mutation({
  args: {
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    actorUserId: v.optional(v.id("athenaUser")),
    registerSessionId: v.id("registerSession"),
    storeId: v.id("store"),
  },
  returns: reopenRegisterSessionResultValidator,
  handler: async (
    ctx: MutationCtx,
    args
  ): Promise<CommandResult<ReopenRegisterSessionResult>> => {
    const registerSession = await ctx.db.get("registerSession", args.registerSessionId);

    if (!registerSession || registerSession.storeId !== args.storeId) {
      return userError({
        code: "not_found",
        message: "Register session not found for this store.",
      });
    }

    if (registerSession.status !== "closing") {
      return userError({
        code: "precondition_failed",
        message: "Register session is not in closeout.",
      });
    }

    const approvalRequest = await cancelPendingApprovalIfNeeded({
      approvalRequestId: registerSession.managerApprovalRequestId,
      ctx,
      decisionNotes: "Register closeout reopened from POS.",
      reviewedByStaffProfileId: args.actorStaffProfileId,
      reviewedByUserId: args.actorUserId,
    });

    const reopenedSession = await ctx.runMutation(
      internal.operations.registerSessions.reopenRegisterSession,
      {
        registerSessionId: args.registerSessionId,
      }
    );

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
      eventType: "register_session_closeout_reopened",
      message: "Register closeout reopened from POS.",
      organizationId: registerSession.organizationId,
      registerSessionId: registerSession._id,
      storeId: args.storeId,
      subjectId: registerSession._id,
      subjectLabel: registerSession.registerNumber,
      subjectType: "register_session",
    });

    return ok({
      action: "reopened",
      approvalRequest,
      registerSession: reopenedSession,
    });
  },
});

export const correctRegisterSessionOpeningFloat = mutation({
  args: {
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    actorUserId: v.optional(v.id("athenaUser")),
    approvalProofId: v.optional(v.id("approvalProof")),
    correctedOpeningFloat: v.number(),
    reason: v.string(),
    registerSessionId: v.id("registerSession"),
    storeId: v.id("store"),
  },
  returns: correctRegisterSessionOpeningFloatResultValidator,
  handler: async (
    ctx: MutationCtx,
    args: CorrectRegisterSessionOpeningFloatArgs
  ): Promise<ApprovalCommandResult<CorrectRegisterSessionOpeningFloatResult>> => {
    const reason = trimOptional(args.reason);

    if (!Number.isFinite(args.correctedOpeningFloat) || args.correctedOpeningFloat < 0) {
      return userError({
        code: "validation_failed",
        message: "Corrected opening float must be a non-negative amount.",
      });
    }

    if (!reason) {
      return userError({
        code: "validation_failed",
        message: "Reason is required to correct an opening float.",
      });
    }

    const registerSession = await ctx.db.get(
      "registerSession",
      args.registerSessionId
    );

    if (!registerSession || registerSession.storeId !== args.storeId) {
      return userError({
        code: "not_found",
        message: "Register session not found for this store.",
      });
    }

    if (registerSession.status !== "open" && registerSession.status !== "active") {
      return userError({
        code: "precondition_failed",
        message: "Opening float can only be corrected while the register session is open.",
      });
    }

    const previousOpeningFloat = registerSession.openingFloat;

    if (!args.approvalProofId) {
      return approvalRequired(
        buildOpeningFloatCorrectionApprovalRequirement({
          correctedOpeningFloat: args.correctedOpeningFloat,
          previousOpeningFloat,
          reason,
          registerSession,
        }),
      );
    }

    const approvalProof = await consumeApprovalProofWithCtx(ctx, {
      actionKey: REGISTER_OPENING_FLOAT_CORRECTION_ACTION_KEY,
      approvalProofId: args.approvalProofId,
      requiredRole: "manager",
      storeId: args.storeId,
      subject: {
        type: "register_session",
        id: registerSession._id,
        label: registerSession.registerNumber,
      },
    });

    if (approvalProof.kind !== "ok") {
      return approvalProof;
    }

    if (args.correctedOpeningFloat === previousOpeningFloat) {
      return ok({
        action: "unchanged" as const,
        correctedOpeningFloat: args.correctedOpeningFloat,
        previousOpeningFloat,
        registerSession,
      });
    }

    const updatedSession = await ctx.runMutation(
      internal.operations.registerSessions.correctRegisterSessionOpeningFloat,
      {
        correctedOpeningFloat: args.correctedOpeningFloat,
        registerSessionId: args.registerSessionId,
      }
    );
    const correctionOccurredAt = Date.now();

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: approvalProof.data.approvedByStaffProfileId,
      actorUserId: args.actorUserId,
      eventType: "register_session_opening_float_corrected",
      message: "Register session opening float corrected.",
      metadata: {
        approvalProofId: args.approvalProofId,
        correctedOpeningFloat: args.correctedOpeningFloat,
        expectedCash: updatedSession?.expectedCash,
        previousOpeningFloat,
        reason,
      },
      organizationId: registerSession.organizationId,
      reason,
      registerSessionId: registerSession._id,
      storeId: args.storeId,
      subjectId: registerSession._id,
      subjectLabel: registerSession.registerNumber,
      subjectType: "register_session",
    });

    const traceResult = await recordRegisterSessionTraceBestEffort(ctx, {
      stage: "opening_float_corrected",
      session: updatedSession ?? {
        ...registerSession,
        expectedCash:
          registerSession.expectedCash +
          (args.correctedOpeningFloat - previousOpeningFloat),
        openingFloat: args.correctedOpeningFloat,
      },
      occurredAt: correctionOccurredAt,
      actorStaffProfileId: approvalProof.data.approvedByStaffProfileId,
      actorUserId: args.actorUserId,
      correctedOpeningFloat: args.correctedOpeningFloat,
      previousOpeningFloat,
      reason,
    });

    await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
      registerSessionId: registerSession._id,
      traceCreated: traceResult.traceCreated,
      traceId: traceResult.traceId,
      workflowTraceId: updatedSession?.workflowTraceId,
    });

    return ok({
      action: "corrected" as const,
      correctedOpeningFloat: args.correctedOpeningFloat,
      previousOpeningFloat,
      registerSession: updatedSession,
    });
  },
});

export const reviewRegisterSessionCloseout = mutation({
  args: {
    approvalProofId: v.id("approvalProof"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    decisionNotes: v.optional(v.string()),
    registerSessionId: v.id("registerSession"),
    reviewedByUserId: v.optional(v.id("athenaUser")),
    storeId: v.id("store"),
  },
  returns: reviewRegisterSessionCloseoutResultValidator,
  handler: async (
    ctx: MutationCtx,
    args: ReviewRegisterSessionCloseoutArgs
  ): Promise<CommandResult<ReviewRegisterSessionCloseoutResult>> => {
    const registerSession = await ctx.db.get("registerSession", args.registerSessionId);

    if (!registerSession || registerSession.storeId !== args.storeId) {
      return userError({
        code: "not_found",
        message: "Register session not found for this store.",
      });
    }

    if (!registerSession.managerApprovalRequestId) {
      return userError({
        code: "precondition_failed",
        message: "Register session does not have a pending closeout approval.",
      });
    }

    const approvalRequest = await ctx.db.get(
      "approvalRequest",
      registerSession.managerApprovalRequestId
    );

    if (!approvalRequest || approvalRequest.status !== "pending") {
      return userError({
        code: "precondition_failed",
        message: "Register closeout approval is no longer pending.",
      });
    }

    if (!registerSession.organizationId) {
      return userError({
        code: "precondition_failed",
        message: "Register session is missing organization context.",
      });
    }

    const proof = await consumeApprovalProofWithCtx(ctx, {
      actionKey: REGISTER_VARIANCE_REVIEW_ACTION_KEY,
      approvalProofId: args.approvalProofId,
      requiredRole: "manager",
      storeId: args.storeId,
      subject: {
        type: "register_session",
        id: registerSession._id,
        label: registerSession.registerNumber,
      },
    });

    if (proof.kind !== "ok") {
      return proof;
    }

    const reviewedByStaffProfileId = proof.data.approvedByStaffProfileId;

    const canReviewVariance = await staffProfileCanReviewCloseoutVariance(ctx, {
      organizationId: registerSession.organizationId,
      staffProfileId: reviewedByStaffProfileId,
      storeId: args.storeId,
    });

    if (!canReviewVariance) {
      return userError({
        code: "authorization_failed",
        message: "Only managers can approve or reject register variance reviews.",
      });
    }

    const reviewedApprovalRequest = await ctx.runMutation(
      internal.operations.approvalRequests.decideApprovalRequestInternal,
      {
        approvalRequestId: approvalRequest._id,
        decision: args.decision,
        decisionNotes: trimOptional(args.decisionNotes),
        reviewedByStaffProfileId,
        reviewedByUserId: args.reviewedByUserId,
      }
    );

    if (args.decision === "approved") {
      if (registerSession.countedCash === undefined) {
        return userError({
          code: "precondition_failed",
          message: "Counted cash is required before approving register closeout.",
        });
      }

      const closedSession = await ctx.runMutation(
        internal.operations.registerSessions.closeRegisterSession,
        {
          closedByStaffProfileId: reviewedByStaffProfileId,
          closedByUserId: args.reviewedByUserId,
          countedCash: registerSession.countedCash,
          registerSessionId: registerSession._id,
        }
      );

      await recordOperationalEventWithCtx(ctx, {
        actorStaffProfileId: reviewedByStaffProfileId,
        actorUserId: args.reviewedByUserId,
        approvalRequestId: approvalRequest._id,
        eventType: "register_session_closeout_approved",
        message: "Manager approved the register closeout.",
        metadata: {
          actionKey: REGISTER_VARIANCE_REVIEW_ACTION_KEY,
          approvalProofId: args.approvalProofId,
          approvalRequestId: approvalRequest._id,
          decision: "approved",
          requiredRole: "manager",
          variance: registerSession.variance,
        },
        organizationId: registerSession.organizationId,
        reason: trimOptional(args.decisionNotes),
        registerSessionId: registerSession._id,
        storeId: args.storeId,
        subjectId: registerSession._id,
        subjectLabel: registerSession.registerNumber,
        subjectType: "register_session",
      });

      const approvalTraceResult = await recordRegisterSessionTraceBestEffort(ctx, {
        stage: "closeout_approved",
        session: closedSession ?? registerSession,
        occurredAt: closedSession?.closedAt,
        actorStaffProfileId: reviewedByStaffProfileId,
        actorUserId: args.reviewedByUserId,
        approvalRequestId: approvalRequest._id,
        countedCash: registerSession.countedCash,
        variance: registerSession.variance,
      });

      await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
        registerSessionId: registerSession._id,
        traceCreated: approvalTraceResult.traceCreated,
        traceId: approvalTraceResult.traceId,
        workflowTraceId: closedSession?.workflowTraceId,
      });

      const closedTraceResult = await recordRegisterSessionTraceBestEffort(ctx, {
        stage: "closed",
        session: closedSession ?? registerSession,
        occurredAt: closedSession?.closedAt,
        actorStaffProfileId: reviewedByStaffProfileId,
        actorUserId: args.reviewedByUserId,
        countedCash: registerSession.countedCash,
        variance: registerSession.variance,
      });

      await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
        registerSessionId: registerSession._id,
        traceCreated: closedTraceResult.traceCreated,
        traceId: closedTraceResult.traceId,
        workflowTraceId: closedSession?.workflowTraceId,
      });

      return ok({
        action: "approved" as const,
        approvalRequest: reviewedApprovalRequest,
        registerSession: closedSession,
      });
    }

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: reviewedByStaffProfileId,
      actorUserId: args.reviewedByUserId,
      approvalRequestId: approvalRequest._id,
      eventType: "register_session_closeout_rejected",
      message: "Manager rejected the register closeout for recount or correction.",
      metadata: {
        actionKey: REGISTER_VARIANCE_REVIEW_ACTION_KEY,
        approvalProofId: args.approvalProofId,
        approvalRequestId: approvalRequest._id,
        decision: "rejected",
        requiredRole: "manager",
        variance: registerSession.variance,
      },
      organizationId: registerSession.organizationId,
      reason: trimOptional(args.decisionNotes),
      registerSessionId: registerSession._id,
      storeId: args.storeId,
      subjectId: registerSession._id,
      subjectLabel: registerSession.registerNumber,
      subjectType: "register_session",
    });

    const rejectedSession = await ctx.db.get("registerSession", registerSession._id);
    const rejectionOccurredAt = Date.now();
    const rejectionTraceResult = await recordRegisterSessionTraceBestEffort(ctx, {
      stage: "closeout_rejected",
      session: rejectedSession ?? registerSession,
      occurredAt: rejectionOccurredAt,
      actorStaffProfileId: reviewedByStaffProfileId,
      actorUserId: args.reviewedByUserId,
      approvalRequestId: approvalRequest._id,
      countedCash: registerSession.countedCash,
      variance: registerSession.variance,
    });

    await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
      registerSessionId: registerSession._id,
      traceCreated: rejectionTraceResult.traceCreated,
      traceId: rejectionTraceResult.traceId,
      workflowTraceId: rejectedSession?.workflowTraceId,
    });

    return ok({
      action: "rejected" as const,
      approvalRequest: reviewedApprovalRequest,
      registerSession: rejectedSession,
    });
  },
});
