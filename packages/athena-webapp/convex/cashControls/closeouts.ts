import { mutation, MutationCtx, query, QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { buildApprovalRequest } from "../operations/approvalRequestHelpers";
import {
  APPROVAL_ACTIONS,
  consumeCommandApprovalProofWithCtx,
} from "../operations/approvalActions";
import { consumeApprovalProofWithCtx } from "../operations/approvalProofs";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import {
  buildRegisterSessionDateDerivationPatch,
  rejectRegisterSessionCloseoutWithCtx,
  reopenRejectedRegisterSessionCloseoutWithCtx,
  resolveRegisterSessionOperatingDateContext,
} from "../operations/registerSessions";
import {
  buildRegisterSessionCloseoutReview,
  getCashControlsConfig,
  type CashControlsConfig,
  type RegisterSessionCloseoutReview,
} from "../operations/registerSessionCloseoutGate";
import { recordRegisterSessionTraceBestEffort } from "../operations/registerSessionTracing";
import { authenticateStaffCredentialWithCtx } from "../operations/staffCredentials";
import type { OperationalRole } from "../operations/staffRoles";
import { commandResultValidator } from "../lib/commandResultValidators";
import { toDisplayAmount } from "../lib/currency";
import {
  getCloseoutHoldOperatorMessage,
  hasCashAffectingCloseoutHolds,
  listRegisterSessionCloseoutHolds,
} from "../pos/application/sync/registerSessionCloseoutHolds";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { currencyFormatter } from "../utils";
import {
  approvalRequired,
  ok,
  userError,
  type ApprovalCommandResult,
  type CommandResult,
} from "../../shared/commandResult";
import type { ApprovalRequirement } from "../../shared/approvalPolicy";
import { formatStaffDisplayName } from "../../shared/staffDisplayName";

export {
  buildRegisterSessionCloseoutReview,
  getCashControlsConfig,
};
export type { CashControlsConfig, RegisterSessionCloseoutReview };

const CLOSEOUT_SESSION_LIMIT = 100;
const REGISTER_VARIANCE_REVIEW_ACTION =
  APPROVAL_ACTIONS.registerSessionVarianceReview;
const REGISTER_VARIANCE_REVIEW_ACTION_KEY = REGISTER_VARIANCE_REVIEW_ACTION.key;
const REGISTER_OPENING_FLOAT_CORRECTION_ACTION =
  APPROVAL_ACTIONS.registerSessionOpeningFloatCorrection;
const REGISTER_OPENING_FLOAT_CORRECTION_ACTION_KEY =
  REGISTER_OPENING_FLOAT_CORRECTION_ACTION.key;
const REGISTER_CLOSEOUT_REOPEN_ACTION =
  APPROVAL_ACTIONS.registerSessionCloseoutReopen;
const REGISTER_CLOSEOUT_MODIFICATION_SUBMIT_ACTION =
  APPROVAL_ACTIONS.registerSessionCloseoutModificationSubmit;

function formatCloseoutVarianceAmount(
  currency: string | undefined,
  amount: number,
) {
  const storeCurrency = currency?.trim() || "GHS";

  try {
    return currencyFormatter(storeCurrency).format(toDisplayAmount(amount));
  } catch {
    return currencyFormatter("GHS").format(toDisplayAmount(amount));
  }
}

function buildRegisterCloseoutVarianceTimelineMessage(args: {
  currency?: string;
  registerNumber?: string;
  variance: number;
}) {
  const registerLabel = args.registerNumber?.trim()
    ? /^register\b/i.test(args.registerNumber)
      ? args.registerNumber
      : `Register ${args.registerNumber}`
    : "Register session";

  return `${registerLabel} closeout recorded with a cash variance of ${formatCloseoutVarianceAmount(args.currency, args.variance)}.`;
}

function buildRegisterCloseoutSubmittedTimelineMessage(args: {
  currency?: string;
  registerNumber?: string;
  variance: number;
}) {
  const registerLabel = args.registerNumber?.trim()
    ? /^register\b/i.test(args.registerNumber)
      ? args.registerNumber
      : `Register ${args.registerNumber}`
    : "Register session";
  const cashResult =
    args.variance === 0
      ? "an exact cash match"
      : `a cash variance of ${formatCloseoutVarianceAmount(args.currency, args.variance)}`;

  return `${registerLabel} closeout submitted with ${cashResult}. Finalize after pending register corrections are resolved.`;
}

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

type CloseoutApprovalRequestRecord = Pick<
  Doc<"approvalRequest">,
  | "_id"
  | "createdAt"
  | "metadata"
  | "notes"
  | "reason"
  | "registerSessionId"
  | "requestType"
  | "requestedByStaffProfileId"
  | "status"
>;

type CloseoutApprovalRequestSummary = {
  _id: Id<"approvalRequest">;
  createdAt: number;
  notes?: string;
  reason?: string;
  requestedByStaffName: string | null;
  status: string;
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
  approvalProofId?: Id<"approvalProof">;
  closeoutModificationApprovalProofId?: Id<"approvalProof">;
  countedCash: number;
  notes?: string;
  registerSessionId: Id<"registerSession">;
  requestedByStaffProfileId?: Id<"staffProfile">;
  staffPinHash?: string;
  staffUsername?: string;
  storeId: Id<"store">;
};

type FinalizeRegisterSessionCloseoutArgs = {
  actorStaffProfileId?: Id<"staffProfile">;
  actorUserId?: Id<"athenaUser">;
  approvalProofId?: Id<"approvalProof">;
  registerSessionId: Id<"registerSession">;
  requestedByStaffProfileId?: Id<"staffProfile">;
  staffPinHash?: string;
  staffUsername?: string;
  storeId: Id<"store">;
};

type SubmitRegisterSessionCloseoutResult =
  | {
      action: "closed";
      closeoutReview: RegisterSessionCloseoutReview;
      registerSession: Doc<"registerSession"> | null;
    }
  | {
      action: "submitted";
      closeoutReview: RegisterSessionCloseoutReview;
      pendingVoidApprovalCount: number;
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

type ReopenRegisterSessionCloseoutArgs = {
  actorStaffProfileId?: Id<"staffProfile">;
  actorUserId?: Id<"athenaUser">;
  approvalProofId?: Id<"approvalProof">;
  registerSessionId: Id<"registerSession">;
  requestedByStaffProfileId?: Id<"staffProfile">;
  storeId: Id<"store">;
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

const submitRegisterSessionCloseoutResultValidator = commandResultValidator(
  v.union(
    v.object({
      action: v.literal("closed"),
      closeoutReview: closeoutReviewValidator,
      registerSession: v.union(v.null(), v.any()),
    }),
    v.object({
      action: v.literal("submitted"),
      closeoutReview: closeoutReviewValidator,
      pendingVoidApprovalCount: v.number(),
      registerSession: v.union(v.null(), v.any()),
    }),
  ),
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

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}

function getLatestReopenedCloseoutRecord(registerSession: Doc<"registerSession">) {
  const latestRecord = registerSession.closeoutRecords?.at(-1);

  return latestRecord?.type === "reopened" ? latestRecord : null;
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

export function buildRegisterSessionVarianceApprovalRequirement(args: {
  approvalRequestId?: Id<"approvalRequest">;
  closeoutReview: RegisterSessionCloseoutReview;
  countedCash: number;
  expectedCash: number;
  registerSession: Pick<Doc<"registerSession">, "_id" | "registerNumber">;
}): ApprovalRequirement {
  return {
    action: REGISTER_VARIANCE_REVIEW_ACTION,
    copy: {
      title: "Manager approval required",
      message:
        args.closeoutReview.reason ??
        "Manager review is required before this register session can close.",
      primaryActionLabel: "Approve closeout",
      secondaryActionLabel: "Got it",
    },
    metadata: {
      countedCash: args.countedCash,
      expectedCash: args.expectedCash,
      variance: args.closeoutReview.variance,
    },
    reason:
      args.closeoutReview.reason ??
      "Manager approval is required before this register session can close.",
    requiredRole: "manager",
    resolutionModes: args.approvalRequestId
      ? [
          {
            kind: "inline_manager_proof",
          },
          {
            approvalRequestId: args.approvalRequestId,
            kind: "async_request",
            requestType: "variance_review",
          },
        ]
      : [
          {
            kind: "inline_manager_proof",
          },
        ],
    selfApproval: "allowed",
    subject: {
      id: args.registerSession._id,
      label: args.registerSession.registerNumber,
      type: "register_session",
    },
  };
}

function submittedCloseoutPendingVoidsResult(args: {
  closeoutReview: RegisterSessionCloseoutReview;
  pendingVoidApprovalCount: number;
  registerSession: Doc<"registerSession"> | null;
}): CommandResult<SubmitRegisterSessionCloseoutResult> {
  return ok({
    action: "submitted" as const,
    closeoutReview: args.closeoutReview,
    pendingVoidApprovalCount: args.pendingVoidApprovalCount,
    registerSession: args.registerSession,
  });
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

async function resolveCloseoutActorStaffProfileId(
  ctx: Pick<MutationCtx, "db">,
  args: {
    allowedCredentialRoles?: OperationalRole[];
    athenaUserId: Id<"athenaUser">;
    staffProfileId?: Id<"staffProfile">;
    staffPinHash?: string;
    staffUsername?: string;
    storeId: Id<"store">;
  },
): Promise<CommandResult<Id<"staffProfile"> | undefined>> {
  if (!args.staffProfileId) {
    return ok(undefined);
  }

  const staffProfile = await ctx.db.get("staffProfile", args.staffProfileId);
  if (
    !staffProfile ||
    staffProfile.storeId !== args.storeId ||
    staffProfile.status !== "active"
  ) {
    return userError({
      code: "authorization_failed",
      message: "Closeout staff actor does not match the signed-in user.",
    });
  }

  if (staffProfile.linkedUserId === args.athenaUserId) {
    return ok(staffProfile._id);
  }

  if (args.staffPinHash && args.staffUsername) {
    const authentication = await authenticateStaffCredentialWithCtx(ctx, {
      allowedRoles: args.allowedCredentialRoles,
      pinHash: args.staffPinHash,
      storeId: args.storeId,
      username: args.staffUsername,
    });

    if (authentication.kind !== "ok") {
      return authentication;
    }

    if (authentication.data.staffProfileId === staffProfile._id) {
      return ok(staffProfile._id);
    }
  }

  return userError({
    code: "authorization_failed",
    message: "Closeout staff actor does not match the signed-in user.",
  });
}

async function cancelPendingApprovalIfNeeded(args: {
  ctx: Pick<MutationCtx, "db">;
  approvalRequestId?: Id<"approvalRequest">;
  decisionApprovedByStaffProfileId?: Id<"staffProfile">;
  decisionApprovalProofId?: Id<"approvalProof">;
  decisionNotes?: string;
  registerSessionId?: Id<"registerSession">;
  reviewedByUserId?: Id<"athenaUser">;
  reviewedByStaffProfileId?: Id<"staffProfile">;
  storeId?: Id<"store">;
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

  if (
    approvalRequest.requestType !== "variance_review" ||
    (args.registerSessionId &&
      approvalRequest.registerSessionId !== args.registerSessionId) ||
    (args.storeId && approvalRequest.storeId !== args.storeId)
  ) {
    return approvalRequest;
  }

  await args.ctx.db.patch("approvalRequest", approvalRequest._id, {
    status: "cancelled",
    ...omitUndefined({
      decisionApprovedByStaffProfileId:
        args.decisionApprovedByStaffProfileId,
      decisionApprovalProofId: args.decisionApprovalProofId,
    }),
    reviewedByStaffProfileId: args.reviewedByStaffProfileId,
    reviewedByUserId: args.reviewedByUserId,
    decisionNotes:
      args.decisionNotes ?? "Superseded by a new register closeout submission.",
    decidedAt: Date.now(),
  });

  return args.ctx.db.get("approvalRequest", approvalRequest._id);
}

export const getCloseoutSnapshot = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (
    ctx: QueryCtx,
    args: { storeId: Id<"store"> }
  ): Promise<CloseoutSnapshot> => {
    const { store } = await requireCashControlsStoreAccess(ctx, args.storeId);
    const registerSessions = await listRegisterSessionsForCloseout(ctx, args.storeId);
    const config = getCashControlsConfig(store);
    const approvalRequestIds = Array.from(
      new Set(
        registerSessions
          .map((registerSession) => registerSession.managerApprovalRequestId)
          .filter(Boolean) as Id<"approvalRequest">[],
      ),
    );
    const approvalRequests = await Promise.all(
      approvalRequestIds.map((approvalRequestId) =>
        ctx.db.get("approvalRequest", approvalRequestId),
      ),
    );
    const approvalMap = new Map<Id<"approvalRequest">, CloseoutApprovalRequestRecord>();
    for (const approvalRequest of approvalRequests) {
      if (
        approvalRequest &&
        approvalRequest.registerSessionId &&
        approvalRequest.requestType === "variance_review"
      ) {
        approvalMap.set(approvalRequest._id, approvalRequest);
      }
    }
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
                notes: approvalRequest.notes,
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
    approvalProofId: v.optional(v.id("approvalProof")),
    closeoutModificationApprovalProofId: v.optional(v.id("approvalProof")),
    countedCash: v.number(),
    notes: v.optional(v.string()),
    registerSessionId: v.id("registerSession"),
    requestedByStaffProfileId: v.optional(v.id("staffProfile")),
    staffPinHash: v.optional(v.string()),
    staffUsername: v.optional(v.string()),
    storeId: v.id("store"),
  },
  returns: submitRegisterSessionCloseoutResultValidator,
  handler: async (
    ctx: MutationCtx,
    args: SubmitRegisterSessionCloseoutArgs
  ): Promise<ApprovalCommandResult<SubmitRegisterSessionCloseoutResult>> => {
    if (args.countedCash < 0) {
      return userError({
        code: "validation_failed",
        message: "Counted cash cannot be negative.",
      });
    }

    const { athenaUser, store } = await requireCashControlsStoreAccess(
      ctx,
      args.storeId,
    );
    const actorUserId = athenaUser._id;
    const submitActorStaffProfileResult = await resolveCloseoutActorStaffProfileId(ctx, {
      allowedCredentialRoles: ["cashier", "manager"],
      athenaUserId: athenaUser._id,
      staffProfileId: args.actorStaffProfileId ?? args.requestedByStaffProfileId,
      staffPinHash: args.staffPinHash,
      staffUsername: args.staffUsername,
      storeId: args.storeId,
    });
    if (submitActorStaffProfileResult.kind !== "ok") {
      return submitActorStaffProfileResult;
    }
    const submitActorStaffProfileId = submitActorStaffProfileResult.data;
    const registerSession = await ctx.db.get("registerSession", args.registerSessionId);

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

    if (registerSession.status === "closeout_rejected") {
      return userError({
        code: "precondition_failed",
        message:
          "Register closeout must be reopened before submitting a corrected count.",
      });
    }

    const config = getCashControlsConfig(store);
    const closeoutReview = buildRegisterSessionCloseoutReview({
      countedCash: args.countedCash,
      config,
      expectedCash: registerSession.expectedCash,
    });
    const closeoutHolds = await listRegisterSessionCloseoutHolds(ctx, {
      registerSessionId: registerSession._id,
      storeId: args.storeId,
    });
    const pendingVoidApprovalCount =
      closeoutHolds.find(
        (hold) => hold.kind === "pending_completed_sale_void_approvals",
      )?.count ?? 0;
    const hasFinalCloseoutHold = hasCashAffectingCloseoutHolds(closeoutHolds);

    if (hasFinalCloseoutHold && args.approvalProofId) {
      return userError({
        code: "precondition_failed",
        message:
          getCloseoutHoldOperatorMessage(closeoutHolds, "approve") ??
          "Resolve pending register corrections before approving final closeout.",
      });
    }
    const latestReopenedCloseout = getLatestReopenedCloseoutRecord(registerSession);
    let closeoutSubmitActorStaffProfileId = submitActorStaffProfileId;
    let approvedByStaffProfileId: Id<"staffProfile"> | undefined;

    if (
      registerSession.status === "closing" &&
      registerSession.managerApprovalRequestId &&
      closeoutReview.requiresApproval
    ) {
      const pendingApprovalRequest = await ctx.db.get(
        "approvalRequest",
        registerSession.managerApprovalRequestId,
      );

      if (
        pendingApprovalRequest?.status === "pending" &&
        pendingApprovalRequest.requestType === "variance_review" &&
        pendingApprovalRequest.registerSessionId === registerSession._id
      ) {
        const metadata = pendingApprovalRequest.metadata ?? {};
        const pendingCountedCash =
          typeof metadata.countedCash === "number"
            ? metadata.countedCash
            : undefined;
        const pendingExpectedCash =
          typeof metadata.expectedCash === "number"
            ? metadata.expectedCash
            : undefined;
        const pendingVariance =
          typeof metadata.variance === "number" ? metadata.variance : undefined;
        const submittedNotes = trimOptional(args.notes);
        const pendingNotes = trimOptional(pendingApprovalRequest.notes);

        if (
          pendingCountedCash === args.countedCash &&
          pendingExpectedCash === registerSession.expectedCash &&
          pendingVariance === closeoutReview.variance &&
          pendingNotes === submittedNotes
        ) {
          return approvalRequired(
            buildRegisterSessionVarianceApprovalRequirement({
              approvalRequestId: pendingApprovalRequest._id,
              closeoutReview,
              countedCash: args.countedCash,
              expectedCash: registerSession.expectedCash,
              registerSession,
            }),
          );
        }

        // A changed count or note is a correction before review. Let the
        // existing replacement flow cancel the stale approval and create a new
        // request with the corrected closeout metadata.
      }
    }

    if (latestReopenedCloseout) {
      if (
        !registerSession.organizationId ||
        !args.closeoutModificationApprovalProofId ||
        !latestReopenedCloseout.actorStaffProfileId
      ) {
        return userError({
          code: "authentication_failed",
          message:
            "The manager who reopened this closeout must submit the correction.",
        });
      }

      const proof = await consumeCommandApprovalProofWithCtx(ctx, {
        action: REGISTER_CLOSEOUT_MODIFICATION_SUBMIT_ACTION,
        approvalProofId: args.closeoutModificationApprovalProofId,
        requiredRole: "manager",
        requestedByStaffProfileId: closeoutSubmitActorStaffProfileId,
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

      if (
        proof.data.approvedByStaffProfileId !==
        latestReopenedCloseout.actorStaffProfileId
      ) {
        return userError({
          code: "authorization_failed",
          message:
            "The manager who reopened this closeout must submit the correction.",
        });
      }

      closeoutSubmitActorStaffProfileId = proof.data.approvedByStaffProfileId;
      approvedByStaffProfileId = proof.data.approvedByStaffProfileId;
    }

    if (
      closeoutReview.requiresApproval &&
      args.approvalProofId &&
      !hasFinalCloseoutHold
    ) {
      if (!registerSession.organizationId) {
        return userError({
          code: "precondition_failed",
          message: "Register session is missing organization context.",
        });
      }

      const proof = await consumeCommandApprovalProofWithCtx(ctx, {
        action: REGISTER_VARIANCE_REVIEW_ACTION,
        approvalProofId: args.approvalProofId,
        requiredRole: "manager",
        requestedByStaffProfileId: closeoutSubmitActorStaffProfileId,
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

      const canReviewVariance = await staffProfileCanReviewCloseoutVariance(ctx, {
        organizationId: registerSession.organizationId,
        staffProfileId: proof.data.approvedByStaffProfileId,
        storeId: args.storeId,
      });

      if (!canReviewVariance) {
        return userError({
          code: "authorization_failed",
          message: "Only managers can approve or reject register variance reviews.",
        });
      }

      approvedByStaffProfileId = proof.data.approvedByStaffProfileId;
    }

    if (
      closeoutReview.requiresApproval &&
      !args.approvalProofId &&
      !hasFinalCloseoutHold &&
      closeoutSubmitActorStaffProfileId &&
      !approvedByStaffProfileId &&
      registerSession.organizationId
    ) {
      const actorCanReviewVariance = await staffProfileCanReviewCloseoutVariance(
        ctx,
        {
          organizationId: registerSession.organizationId,
          staffProfileId: closeoutSubmitActorStaffProfileId,
          storeId: args.storeId,
        },
      );

      if (actorCanReviewVariance) {
        return approvalRequired(
          buildRegisterSessionVarianceApprovalRequirement({
            closeoutReview,
            countedCash: args.countedCash,
            expectedCash: registerSession.expectedCash,
            registerSession,
          }),
        );
      }
    }

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
        actorStaffProfileId: closeoutSubmitActorStaffProfileId,
        actorUserId,
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

    if (hasFinalCloseoutHold) {
      await recordOperationalEventWithCtx(ctx, {
        actorStaffProfileId: closeoutSubmitActorStaffProfileId,
        actorUserId,
        eventType: "register_session_closeout_submitted",
        message: buildRegisterCloseoutSubmittedTimelineMessage({
          currency: store?.currency,
          registerNumber: registerSession.registerNumber,
          variance: closeoutReview.variance,
        }),
        metadata: {
          countedCash: args.countedCash,
          expectedCash: registerSession.expectedCash,
          holdKinds: closeoutHolds
            .filter((hold) => hold.cashAffecting && hold.count > 0)
            .map((hold) => hold.kind),
          pendingVoidApprovalCount,
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

      return submittedCloseoutPendingVoidsResult({
        closeoutReview,
        pendingVoidApprovalCount,
        registerSession: closingSession ?? (await ctx.db.get("registerSession", registerSession._id)),
      });
    }

    if (closeoutReview.requiresApproval) {
      await cancelPendingApprovalIfNeeded({
        approvalRequestId: registerSession.managerApprovalRequestId,
        ctx,
        registerSessionId: registerSession._id,
        reviewedByStaffProfileId: closeoutSubmitActorStaffProfileId,
        reviewedByUserId: actorUserId,
        storeId: args.storeId,
      });

      if (approvedByStaffProfileId) {
        const closedSession = await ctx.runMutation(
          internal.operations.registerSessions.closeRegisterSession,
          {
            closedByStaffProfileId: approvedByStaffProfileId,
            closedByUserId: actorUserId,
            countedCash: args.countedCash,
            registerSessionId: args.registerSessionId,
          }
        );

        await recordOperationalEventWithCtx(ctx, {
          actorStaffProfileId: approvedByStaffProfileId,
          actorUserId,
          eventType: "register_session_closeout_approved",
          message: "Manager approved the register closeout.",
          metadata: {
            actionKey: latestReopenedCloseout
              ? REGISTER_CLOSEOUT_MODIFICATION_SUBMIT_ACTION.key
              : REGISTER_VARIANCE_REVIEW_ACTION_KEY,
            approvalMode: "inline_manager_proof",
            approvalProofId:
              args.approvalProofId ??
              args.closeoutModificationApprovalProofId,
            countedCash: args.countedCash,
            decision: "approved",
            expectedCash: registerSession.expectedCash,
            requiredRole: "manager",
            variance: closeoutReview.variance,
          },
          organizationId: registerSession.organizationId,
          reason: trimOptional(args.notes),
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
          actorStaffProfileId: approvedByStaffProfileId,
          actorUserId,
          countedCash: args.countedCash,
          variance: closeoutReview.variance,
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
          actorStaffProfileId: approvedByStaffProfileId,
          actorUserId,
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
      }

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
          requestedByStaffProfileId: closeoutSubmitActorStaffProfileId,
          requestedByUserId: actorUserId,
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
      const approvalRequestCreatedAt = approvalRequest?.createdAt ?? Date.now();
      const closeoutContext = await resolveRegisterSessionOperatingDateContext(ctx, {
        at: approvalRequestCreatedAt,
        storeId: args.storeId,
      });

      await ctx.db.patch("registerSession", registerSession._id, {
        managerApprovalRequestId: approvalRequestId,
        ...buildRegisterSessionDateDerivationPatch({
          closeoutContext,
          closeoutOwnedAt: approvalRequestCreatedAt,
          closeoutOwnershipSource: "approval_request",
        }),
      });

      await recordOperationalEventWithCtx(ctx, {
        actorStaffProfileId: closeoutSubmitActorStaffProfileId,
        actorUserId,
        approvalRequestId,
        eventType: "register_session_variance_review_requested",
        message: buildRegisterCloseoutVarianceTimelineMessage({
          currency: store?.currency,
          registerNumber: registerSession.registerNumber,
          variance: closeoutReview.variance,
        }),
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
          actorStaffProfileId: closeoutSubmitActorStaffProfileId,
          actorUserId,
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

      return approvalRequired(approvalRequirement);
    }

    await cancelPendingApprovalIfNeeded({
      approvalRequestId: registerSession.managerApprovalRequestId,
      ctx,
      registerSessionId: registerSession._id,
      reviewedByStaffProfileId: closeoutSubmitActorStaffProfileId,
      reviewedByUserId: actorUserId,
      storeId: args.storeId,
    });

    const closedSession = await ctx.runMutation(
      internal.operations.registerSessions.closeRegisterSession,
      {
        closedByStaffProfileId: closeoutSubmitActorStaffProfileId,
        closedByUserId: actorUserId,
        countedCash: args.countedCash,
        registerSessionId: args.registerSessionId,
      }
    );

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: closeoutSubmitActorStaffProfileId,
      actorUserId,
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
      actorStaffProfileId: closeoutSubmitActorStaffProfileId,
      actorUserId,
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

export const finalizeRegisterSessionCloseout = mutation({
  args: {
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    actorUserId: v.optional(v.id("athenaUser")),
    approvalProofId: v.optional(v.id("approvalProof")),
    registerSessionId: v.id("registerSession"),
    requestedByStaffProfileId: v.optional(v.id("staffProfile")),
    staffPinHash: v.optional(v.string()),
    staffUsername: v.optional(v.string()),
    storeId: v.id("store"),
  },
  returns: submitRegisterSessionCloseoutResultValidator,
  handler: async (
    ctx: MutationCtx,
    args: FinalizeRegisterSessionCloseoutArgs,
  ): Promise<ApprovalCommandResult<SubmitRegisterSessionCloseoutResult>> => {
    const { athenaUser, store } = await requireCashControlsStoreAccess(
      ctx,
      args.storeId,
    );
    const actorUserId = athenaUser._id;
    const requestedByStaffProfileResult =
      await resolveCloseoutActorStaffProfileId(ctx, {
        allowedCredentialRoles: ["cashier", "manager"],
        athenaUserId: athenaUser._id,
        staffProfileId: args.requestedByStaffProfileId ?? args.actorStaffProfileId,
        staffPinHash: args.staffPinHash,
        staffUsername: args.staffUsername,
        storeId: args.storeId,
      });
    if (requestedByStaffProfileResult.kind !== "ok") {
      return requestedByStaffProfileResult;
    }
    const requestedByStaffProfileId = requestedByStaffProfileResult.data;
    const registerSession = await ctx.db.get("registerSession", args.registerSessionId);

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

    if (registerSession.status !== "closing") {
      return userError({
        code: "precondition_failed",
        message: "Register session is not in closeout.",
      });
    }

    if (registerSession.countedCash === undefined) {
      return userError({
        code: "precondition_failed",
        message: "Counted cash is required before finalizing closeout.",
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
          getCloseoutHoldOperatorMessage(closeoutHolds, "finalize") ??
          "Resolve pending register corrections before finalizing closeout.",
      });
    }

    const closeoutReview = buildRegisterSessionCloseoutReview({
      countedCash: registerSession.countedCash,
      config: getCashControlsConfig(store),
      expectedCash: registerSession.expectedCash,
    });

    if (!registerSession.organizationId) {
      return userError({
        code: "precondition_failed",
        message: "Register session is missing organization context.",
      });
    }

    let closedByStaffProfileId = requestedByStaffProfileId;

    if (!closeoutReview.requiresApproval) {
      if (!requestedByStaffProfileId) {
        return userError({
          code: "authorization_failed",
          message: "Manager staff authentication is required to finalize closeout.",
        });
      }

      const canFinalize = await staffProfileCanReviewCloseoutVariance(ctx, {
        organizationId: registerSession.organizationId,
        staffProfileId: requestedByStaffProfileId,
        storeId: args.storeId,
      });

      if (!canFinalize) {
        return userError({
          code: "authorization_failed",
          message: "Only managers can finalize register closeouts.",
        });
      }
    }

    if (closeoutReview.requiresApproval && !args.approvalProofId) {
      return approvalRequired(
        buildRegisterSessionVarianceApprovalRequirement({
          closeoutReview,
          countedCash: registerSession.countedCash,
          expectedCash: registerSession.expectedCash,
          registerSession,
        }),
      );
    }

    if (closeoutReview.requiresApproval) {
      const approvalProofId = args.approvalProofId;

      if (!approvalProofId) {
        return approvalRequired(
          buildRegisterSessionVarianceApprovalRequirement({
            closeoutReview,
            countedCash: registerSession.countedCash,
            expectedCash: registerSession.expectedCash,
            registerSession,
          }),
        );
      }

      const proof = await consumeCommandApprovalProofWithCtx(ctx, {
        action: REGISTER_VARIANCE_REVIEW_ACTION,
        approvalProofId,
        requiredRole: "manager",
        requestedByStaffProfileId,
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

      const canFinalize = await staffProfileCanReviewCloseoutVariance(ctx, {
        organizationId: registerSession.organizationId,
        staffProfileId: proof.data.approvedByStaffProfileId,
        storeId: args.storeId,
      });

      if (!canFinalize) {
        return userError({
          code: "authorization_failed",
          message: "Only managers can finalize register closeouts.",
        });
      }

      closedByStaffProfileId = proof.data.approvedByStaffProfileId;
    }

    await cancelPendingApprovalIfNeeded({
      approvalRequestId: registerSession.managerApprovalRequestId,
      ctx,
      registerSessionId: registerSession._id,
      reviewedByStaffProfileId: closedByStaffProfileId,
      reviewedByUserId: actorUserId,
      decisionNotes: "Finalized after pending void approvals were resolved.",
      storeId: args.storeId,
    });

    const closedSession = await ctx.runMutation(
      internal.operations.registerSessions.closeRegisterSession,
      {
        closedByStaffProfileId,
        closedByUserId: actorUserId,
        countedCash: registerSession.countedCash,
        registerSessionId: registerSession._id,
      },
    );

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: closedByStaffProfileId,
      actorUserId,
      eventType: "register_session_closed",
      message: closeoutReview.hasVariance
        ? `Register session closed with a variance of ${closeoutReview.variance}.`
        : "Register session closed with an exact cash match.",
      metadata: {
        countedCash: registerSession.countedCash,
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
      actorStaffProfileId: closedByStaffProfileId,
      actorUserId,
      countedCash: registerSession.countedCash,
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
    approvalProofId: v.optional(v.id("approvalProof")),
    registerSessionId: v.id("registerSession"),
    requestedByStaffProfileId: v.optional(v.id("staffProfile")),
    storeId: v.id("store"),
  },
  returns: reopenRegisterSessionResultValidator,
  handler: async (
    ctx: MutationCtx,
    args: ReopenRegisterSessionCloseoutArgs
  ): Promise<CommandResult<ReopenRegisterSessionResult>> => {
    const { athenaUser } = await requireCashControlsStoreAccess(ctx, args.storeId);
    const actorUserId = athenaUser._id;
    const registerSession = await ctx.db.get("registerSession", args.registerSessionId);

    if (!registerSession || registerSession.storeId !== args.storeId) {
      return userError({
        code: "not_found",
        message: "Register session not found for this store.",
      });
    }

    if (registerSession.status === "closeout_rejected") {
      if (!registerSession.organizationId || !args.approvalProofId) {
        return userError({
          code: "authentication_failed",
          message: "Only managers can reopen a rejected register closeout.",
        });
      }

      const proof = await consumeCommandApprovalProofWithCtx(ctx, {
        action: REGISTER_CLOSEOUT_REOPEN_ACTION,
        approvalProofId: args.approvalProofId,
        requiredRole: "manager",
        requestedByStaffProfileId: args.requestedByStaffProfileId,
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

      const canReopenRejectedCloseout = await staffProfileCanReviewCloseoutVariance(ctx, {
        organizationId: registerSession.organizationId,
        staffProfileId: proof.data.approvedByStaffProfileId,
        storeId: args.storeId,
      });

      if (!canReopenRejectedCloseout) {
        return userError({
          code: "authorization_failed",
          message: "Only managers can reopen a rejected register closeout.",
        });
      }

      const previousCloseout = omitUndefined({
        countedCash: registerSession.countedCash,
        expectedCash: registerSession.expectedCash,
        notes: registerSession.notes,
        variance: registerSession.variance,
      });
      const reopenedSession = await reopenRejectedRegisterSessionCloseoutWithCtx(
        ctx,
        {
          actorStaffProfileId: proof.data.approvedByStaffProfileId,
          actorUserId,
          registerSessionId: args.registerSessionId,
          reason: "Correction needed after manager rejection.",
        },
      );
      const reopenedAt = Date.now();

      await recordOperationalEventWithCtx(ctx, {
        actorStaffProfileId: proof.data.approvedByStaffProfileId,
        actorUserId,
        eventType: "register_session_closeout_reopened",
        message: "Rejected register closeout reopened for correction.",
        metadata: previousCloseout,
        organizationId: registerSession.organizationId,
        reason: "Correction needed after manager rejection.",
        registerSessionId: registerSession._id,
        storeId: args.storeId,
        subjectId: registerSession._id,
        subjectLabel: registerSession.registerNumber,
        subjectType: "register_session",
      });

      const traceResult = await recordRegisterSessionTraceBestEffort(ctx, {
        stage: "closeout_reopened",
        session: reopenedSession ?? {
          ...registerSession,
          status: "closing",
        },
        occurredAt: reopenedAt,
        actorStaffProfileId: proof.data.approvedByStaffProfileId,
        actorUserId,
        countedCash: registerSession.countedCash,
        reason: "Correction needed after manager rejection.",
        variance: registerSession.variance,
      });

      await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
        registerSessionId: registerSession._id,
        traceCreated: traceResult.traceCreated,
        traceId: traceResult.traceId,
        workflowTraceId: reopenedSession?.workflowTraceId,
      });

      return ok({
        action: "reopened",
        approvalRequest: null,
        registerSession: reopenedSession,
      });
    }

    if (registerSession.status !== "closing") {
      if (registerSession.status !== "closed") {
        return userError({
          code: "precondition_failed",
          message: "Register session is not in closeout.",
        });
      }

      if (!registerSession.organizationId || !args.approvalProofId) {
        return userError({
          code: "authentication_failed",
          message: "Only managers can reopen a closed register closeout.",
        });
      }

      const proof = await consumeCommandApprovalProofWithCtx(ctx, {
        action: REGISTER_CLOSEOUT_REOPEN_ACTION,
        approvalProofId: args.approvalProofId,
        requiredRole: "manager",
        requestedByStaffProfileId: args.requestedByStaffProfileId,
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

      const canReopenClosedCloseout = await staffProfileCanReviewCloseoutVariance(ctx, {
        organizationId: registerSession.organizationId,
        staffProfileId: proof.data.approvedByStaffProfileId,
        storeId: args.storeId,
      });

      if (!canReopenClosedCloseout) {
        return userError({
          code: "authorization_failed",
          message: "Only managers can reopen a closed register closeout.",
        });
      }

      const previousCloseout = omitUndefined({
        closedAt: registerSession.closedAt,
        closedByStaffProfileId: registerSession.closedByStaffProfileId,
        closedByUserId: registerSession.closedByUserId,
        countedCash: registerSession.countedCash,
        expectedCash: registerSession.expectedCash,
        variance: registerSession.variance,
      });
      const reopenedSession = await ctx.runMutation(
        internal.operations.registerSessions.reopenClosedRegisterSessionCloseout,
        {
          actorStaffProfileId: proof.data.approvedByStaffProfileId,
          actorUserId,
          reason: "Closed register closeout reopened for correction.",
          registerSessionId: args.registerSessionId,
        }
      );
      const reopenedAt = Date.now();

      await recordOperationalEventWithCtx(ctx, {
        actorStaffProfileId: proof.data.approvedByStaffProfileId,
        actorUserId,
        eventType: "register_session_closeout_reopened",
        message: "Closed register closeout reopened for correction.",
        metadata: previousCloseout,
        organizationId: registerSession.organizationId,
        reason: "Correction needed after closeout was saved.",
        registerSessionId: registerSession._id,
        storeId: args.storeId,
        subjectId: registerSession._id,
        subjectLabel: registerSession.registerNumber,
        subjectType: "register_session",
      });

      const traceResult = await recordRegisterSessionTraceBestEffort(ctx, {
        stage: "closeout_reopened",
        session: reopenedSession ?? {
          ...registerSession,
          status: "closing",
        },
        occurredAt: reopenedAt,
        actorStaffProfileId: proof.data.approvedByStaffProfileId,
        actorUserId,
        countedCash: registerSession.countedCash,
        reason: "Correction needed after closeout was saved.",
        variance: registerSession.variance,
      });

      await persistRegisterSessionWorkflowTraceIdBestEffort(ctx, {
        registerSessionId: registerSession._id,
        traceCreated: traceResult.traceCreated,
        traceId: traceResult.traceId,
        workflowTraceId: reopenedSession?.workflowTraceId,
      });

      return ok({
        action: "reopened",
        approvalRequest: null,
        registerSession: reopenedSession,
      });
    }

    const actorStaffProfileResult = await resolveCloseoutActorStaffProfileId(ctx, {
      athenaUserId: athenaUser._id,
      staffProfileId: args.actorStaffProfileId ?? args.requestedByStaffProfileId,
      storeId: args.storeId,
    });
    if (actorStaffProfileResult.kind !== "ok") {
      return actorStaffProfileResult;
    }
    const actorStaffProfileId = actorStaffProfileResult.data;

    const approvalRequest = await cancelPendingApprovalIfNeeded({
      approvalRequestId: registerSession.managerApprovalRequestId,
      ctx,
      decisionNotes: "Register closeout reopened from POS.",
      registerSessionId: registerSession._id,
      reviewedByStaffProfileId: actorStaffProfileId,
      reviewedByUserId: actorUserId,
      storeId: args.storeId,
    });

    const reopenedSession = await ctx.runMutation(
      internal.operations.registerSessions.reopenRegisterSession,
      {
        registerSessionId: args.registerSessionId,
      }
    );

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId,
      actorUserId,
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

    const { athenaUser } = await requireCashControlsStoreAccess(ctx, args.storeId);
    const actorUserId = athenaUser._id;
    const actorStaffProfileResult = await resolveCloseoutActorStaffProfileId(ctx, {
      athenaUserId: athenaUser._id,
      staffProfileId: args.actorStaffProfileId,
      storeId: args.storeId,
    });
    if (actorStaffProfileResult.kind !== "ok") {
      return actorStaffProfileResult;
    }
    const actorStaffProfileId = actorStaffProfileResult.data;

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

    const approvalProof = await consumeCommandApprovalProofWithCtx(ctx, {
      action: REGISTER_OPENING_FLOAT_CORRECTION_ACTION,
      approvalProofId: args.approvalProofId,
      requiredRole: "manager",
      requestedByStaffProfileId: actorStaffProfileId,
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
      actorUserId,
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
      actorUserId,
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
    const { athenaUser } = await requireCashControlsStoreAccess(ctx, args.storeId);
    const reviewedByUserId = athenaUser._id;
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

    if (registerSession.status !== "closing") {
      return userError({
        code: "precondition_failed",
        message: "Register session is not in closeout.",
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
        decisionApprovedByStaffProfileId: reviewedByStaffProfileId,
        decisionApprovalProofId: args.approvalProofId,
        decisionNotes: trimOptional(args.decisionNotes),
        reviewedByStaffProfileId,
        reviewedByUserId,
      }
    );

    if (args.decision === "approved") {
      if (registerSession.countedCash === undefined) {
        return userError({
          code: "precondition_failed",
          message: "Counted cash is required before approving register closeout.",
        });
      }

      const closeoutHolds = await listRegisterSessionCloseoutHolds(ctx, {
        registerSessionId: registerSession._id,
        storeId: args.storeId,
      });

      if (hasCashAffectingCloseoutHolds(closeoutHolds)) {
        return ok({
          action: "approved" as const,
          approvalRequest: reviewedApprovalRequest,
          registerSession,
        });
      }

      const closedSession = await ctx.runMutation(
        internal.operations.registerSessions.closeRegisterSession,
        {
          closedByStaffProfileId: reviewedByStaffProfileId,
          closedByUserId: reviewedByUserId,
          countedCash: registerSession.countedCash,
          registerSessionId: registerSession._id,
        }
      );

      await recordOperationalEventWithCtx(ctx, {
        actorStaffProfileId: reviewedByStaffProfileId,
        actorUserId: reviewedByUserId,
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
        actorUserId: reviewedByUserId,
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
        actorUserId: reviewedByUserId,
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

    const rejectedSession = await rejectRegisterSessionCloseoutWithCtx(ctx, {
      registerSessionId: registerSession._id,
    });

    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: reviewedByStaffProfileId,
      actorUserId: reviewedByUserId,
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

    const rejectionOccurredAt = Date.now();
    const rejectionTraceResult = await recordRegisterSessionTraceBestEffort(ctx, {
      stage: "closeout_rejected",
      session: rejectedSession ?? registerSession,
      occurredAt: rejectionOccurredAt,
      actorStaffProfileId: reviewedByStaffProfileId,
      actorUserId: reviewedByUserId,
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
