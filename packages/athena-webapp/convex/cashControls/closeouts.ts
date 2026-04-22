import { mutation, MutationCtx, query, QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { buildApprovalRequest } from "../operations/approvalRequestHelpers";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { recordRegisterSessionTraceBestEffort } from "../operations/registerSessionTracing";

const CLOSEOUT_SESSION_LIMIT = 100;
const DEFAULT_VARIANCE_APPROVAL_THRESHOLD = 5000;

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
  decision: "approved" | "rejected";
  decisionNotes?: string;
  registerSessionId: Id<"registerSession">;
  reviewedByStaffProfileId?: Id<"staffProfile">;
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
      return staffProfile ? [staffProfileId, staffProfile.fullName] : null;
    })
  );

  return new Map(
    staffEntries.filter(Boolean) as Array<[Id<"staffProfile">, string]>
  );
}

async function cancelPendingApprovalIfNeeded(args: {
  ctx: Pick<MutationCtx, "db" | "runMutation">;
  approvalRequestId?: Id<"approvalRequest">;
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
    decisionNotes: "Superseded by a new register closeout submission.",
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
  handler: async (
    ctx: MutationCtx,
    args: SubmitRegisterSessionCloseoutArgs
  ): Promise<SubmitRegisterSessionCloseoutResult> => {
    const [registerSession, store] = await Promise.all([
      ctx.db.get("registerSession", args.registerSessionId),
      ctx.runQuery(internal.inventory.stores.findById, { id: args.storeId }),
    ]);

    if (!registerSession || registerSession.storeId !== args.storeId) {
      throw new Error("Register session not found for this store.");
    }

    if (registerSession.status === "closed") {
      throw new Error("Register session is already closed.");
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
        traceId: approvalPendingTraceResult.traceId,
        workflowTraceId: approvalPendingSession?.workflowTraceId,
      });

      return {
        action: "approval_required" as const,
        approvalRequest,
        closeoutReview,
        registerSession: approvalPendingSession,
      };
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
      traceId: closedTraceResult.traceId,
      workflowTraceId: closedSession?.workflowTraceId,
    });

    return {
      action: "closed" as const,
      closeoutReview,
      registerSession: closedSession,
    };
  },
});

export const reviewRegisterSessionCloseout = mutation({
  args: {
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    decisionNotes: v.optional(v.string()),
    registerSessionId: v.id("registerSession"),
    reviewedByStaffProfileId: v.optional(v.id("staffProfile")),
    reviewedByUserId: v.optional(v.id("athenaUser")),
    storeId: v.id("store"),
  },
  handler: async (
    ctx: MutationCtx,
    args: ReviewRegisterSessionCloseoutArgs
  ): Promise<ReviewRegisterSessionCloseoutResult> => {
    const registerSession = await ctx.db.get("registerSession", args.registerSessionId);

    if (!registerSession || registerSession.storeId !== args.storeId) {
      throw new Error("Register session not found for this store.");
    }

    if (!registerSession.managerApprovalRequestId) {
      throw new Error("Register session does not have a pending closeout approval.");
    }

    const approvalRequest = await ctx.db.get(
      "approvalRequest",
      registerSession.managerApprovalRequestId
    );

    if (!approvalRequest || approvalRequest.status !== "pending") {
      throw new Error("Register closeout approval is no longer pending.");
    }

    const reviewedApprovalRequest = await ctx.runMutation(
      internal.operations.approvalRequests.decideApprovalRequestInternal,
      {
        approvalRequestId: approvalRequest._id,
        decision: args.decision,
        decisionNotes: trimOptional(args.decisionNotes),
        reviewedByStaffProfileId: args.reviewedByStaffProfileId,
        reviewedByUserId: args.reviewedByUserId,
      }
    );

    if (args.decision === "approved") {
      if (registerSession.countedCash === undefined) {
        throw new Error("Counted cash is required before approving register closeout.");
      }

      const closedSession = await ctx.runMutation(
        internal.operations.registerSessions.closeRegisterSession,
        {
          closedByStaffProfileId: args.reviewedByStaffProfileId,
          closedByUserId: args.reviewedByUserId,
          countedCash: registerSession.countedCash,
          registerSessionId: registerSession._id,
        }
      );

      await recordOperationalEventWithCtx(ctx, {
        actorStaffProfileId: args.reviewedByStaffProfileId,
        actorUserId: args.reviewedByUserId,
        approvalRequestId: approvalRequest._id,
        eventType: "register_session_closeout_approved",
        message: "Manager approved the register closeout.",
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
        actorStaffProfileId: args.reviewedByStaffProfileId,
        actorUserId: args.reviewedByUserId,
        approvalRequestId: approvalRequest._id,
        countedCash: registerSession.countedCash,
        variance: registerSession.variance,
      });

      await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
        registerSessionId: registerSession._id,
        traceId: approvalTraceResult.traceId,
        workflowTraceId: closedSession?.workflowTraceId,
      });

      const closedTraceResult = await recordRegisterSessionTraceBestEffort(ctx, {
        stage: "closed",
        session: closedSession ?? registerSession,
        occurredAt: closedSession?.closedAt,
        actorStaffProfileId: args.reviewedByStaffProfileId,
        actorUserId: args.reviewedByUserId,
        countedCash: registerSession.countedCash,
        variance: registerSession.variance,
      });

      await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
        registerSessionId: registerSession._id,
        traceId: closedTraceResult.traceId,
        workflowTraceId: closedSession?.workflowTraceId,
      });

      return {
        action: "approved" as const,
        approvalRequest: reviewedApprovalRequest,
        registerSession: closedSession,
      };
    }

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: args.reviewedByStaffProfileId,
      actorUserId: args.reviewedByUserId,
      approvalRequestId: approvalRequest._id,
      eventType: "register_session_closeout_rejected",
      message: "Manager rejected the register closeout for recount or correction.",
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
      actorStaffProfileId: args.reviewedByStaffProfileId,
      actorUserId: args.reviewedByUserId,
      approvalRequestId: approvalRequest._id,
      countedCash: registerSession.countedCash,
      variance: registerSession.variance,
    });

    await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
      registerSessionId: registerSession._id,
      traceId: rejectionTraceResult.traceId,
      workflowTraceId: rejectedSession?.workflowTraceId,
    });

    return {
      action: "rejected" as const,
      approvalRequest: reviewedApprovalRequest,
      registerSession: rejectedSession,
    };
  },
});
