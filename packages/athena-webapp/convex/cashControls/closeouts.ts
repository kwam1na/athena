import { mutation, MutationCtx, query, QueryCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { buildApprovalRequest } from "../operations/approvalRequestHelpers";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";

const CLOSEOUT_SESSION_LIMIT = 100;
const DEFAULT_VARIANCE_APPROVAL_THRESHOLD = 5000;

type CashControlsConfig = {
  requireManagerSignoffForAnyVariance: boolean;
  requireManagerSignoffForOvers: boolean;
  requireManagerSignoffForShorts: boolean;
  varianceApprovalThreshold: number;
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
) {
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
}) {
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
  handler: async (ctx, args) => {
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
    const approvalMap = new Map(
      pendingApprovalRequests
        .filter(
          (approvalRequest) =>
            approvalRequest.registerSessionId &&
            approvalRequest.requestType === "variance_review"
        )
        .map((approvalRequest) => [approvalRequest._id, approvalRequest])
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
      registerSessions: registerSessions.map((registerSession) => {
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
                  ? staffMap.get(approvalRequest.requestedByStaffProfileId)
                  : null,
                status: approvalRequest.status,
              }
            : null,
          closeoutReview,
          closedByStaffName: registerSession.closedByStaffProfileId
            ? staffMap.get(registerSession.closedByStaffProfileId)
            : null,
          openedByStaffName: registerSession.openedByStaffProfileId
            ? staffMap.get(registerSession.openedByStaffProfileId)
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
  handler: async (ctx, args) => {
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

    await ctx.runMutation(
      internal.operations.registerSessions.beginRegisterSessionCloseout,
      {
        countedCash: args.countedCash,
        notes: trimOptional(args.notes),
        registerSessionId: args.registerSessionId,
      }
    );

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

      return {
        action: "approval_required" as const,
        approvalRequest,
        closeoutReview,
        registerSession: await ctx.db.get("registerSession", registerSession._id),
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
  handler: async (ctx, args) => {
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

    return {
      action: "rejected" as const,
      approvalRequest: reviewedApprovalRequest,
      registerSession: await ctx.db.get("registerSession", registerSession._id),
    };
  },
});
