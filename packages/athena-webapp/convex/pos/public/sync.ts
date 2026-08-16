import { v } from "convex/values";

import { mutation } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import {
  ingestLocalEventsOperationDefinition,
  ingestRegisterSessionActivityOperationDefinition,
  reportLocalSyncDeadLetterOperationDefinition,
} from "../../operationAdmission/definitions";
import { recordLocalSyncDeadLetter } from "../application/sync/deadLetter";
import { admitPublicMutation } from "../../platform/operationAdmission";
import type { OperationMutationCtx } from "../../operationAdmission/types";
import { commandResultValidator } from "../../lib/commandResultValidators";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import { ok, userError } from "../../../shared/commandResult";
import {
  requireSharedDemoCapability,
  type SharedDemoCapability,
} from "../../sharedDemo/policy";
import { ingestLocalEventsWithCtx } from "../application/sync/ingestLocalEvents";
import { approvalRequestSchema } from "../../schemas/operations/approvalRequest";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import { hashPosTerminalSyncSecret } from "../application/sync/terminalSyncSecret";
import { posLocalSyncMappingKindValidator } from "../../schemas/pos/posLocalSyncMapping";
import {
  posLocalSyncConflictStatusValidator,
  posLocalSyncConflictTypeValidator,
} from "../../schemas/pos/posLocalSyncConflict";
import { posLocalSyncEventStatusValidator } from "../../schemas/pos/posLocalSyncEvent";
import { posLocalSyncUploadEventValidator } from "../../schemas/pos/posLocalSyncContractValidators";
import {
  posRegisterSessionActivityCategoryValidator,
  posRegisterSessionActivityMetadataValueValidator,
  posRegisterSessionActivitySkipCodeValidator,
} from "../../schemas/pos/posRegisterSessionActivity";
import { ingestRegisterSessionActivityWithCtx } from "../application/sync/posRegisterSessionActivity";
import { emitNotificationWithCtx } from "../../notifications/emit";
import {
  MAX_LOCAL_SYNC_REVIEW_EVENTS,
  resolveLocalSyncReviewWithCtx,
} from "../application/sync/resolveLocalSyncReview";

const localSyncMappingValidator = v.object({
  _id: v.string(),
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  syncScope: v.optional(v.union(v.literal("pos"), v.literal("expense"))),
  localRegisterSessionId: v.string(),
  localExpenseSessionId: v.optional(v.string()),
  localEventId: v.string(),
  localIdKind: posLocalSyncMappingKindValidator,
  localId: v.string(),
  cloudTable: v.string(),
  cloudId: v.string(),
  createdAt: v.number(),
});

const localSyncConflictValidator = v.object({
  _id: v.string(),
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  localRegisterSessionId: v.string(),
  localEventId: v.string(),
  sequence: v.number(),
  conflictType: posLocalSyncConflictTypeValidator,
  status: posLocalSyncConflictStatusValidator,
  summary: v.string(),
  details: v.record(v.string(), v.any()),
  createdAt: v.number(),
  resolvedAt: v.optional(v.number()),
  resolvedByStaffProfileId: v.optional(v.id("staffProfile")),
  resolvedByUserId: v.optional(v.id("athenaUser")),
});

const localSyncResultValidator = commandResultValidator(
  v.object({
    accepted: v.array(
      v.object({
        localEventId: v.string(),
        sequence: v.number(),
        status: posLocalSyncEventStatusValidator,
      }),
    ),
    held: v.array(
      v.object({
        localEventId: v.string(),
        sequence: v.number(),
        code: v.literal("out_of_order"),
        message: v.string(),
      }),
    ),
    mappings: v.array(localSyncMappingValidator),
    conflicts: v.array(localSyncConflictValidator),
    syncCursor: v.object({
      syncScope: v.optional(v.union(v.literal("pos"), v.literal("expense"))),
      localSyncCursorId: v.optional(v.string()),
      localRegisterSessionId: v.union(v.string(), v.null()),
      localExpenseSessionId: v.optional(v.union(v.string(), v.null())),
      acceptedThroughSequence: v.number(),
    }),
  }),
);

const MAX_LOCAL_SYNC_EVENTS_PER_REQUEST = 250;
const MAX_PENDING_CHECKOUT_DEFINITIONS_PER_REQUEST = 50;
const MAX_REGISTER_SESSION_ACTIVITY_PER_REQUEST = 250;

export function sharedDemoCapabilityForSyncEvent(
  eventType: Doc<"posLocalSyncEvent">["eventType"],
): SharedDemoCapability {
  switch (eventType) {
    case "register_opened":
    case "register_closed":
    case "register_reopened":
      return "cash.control.write";
    case "store_day_started":
      return "daily_operations.write";
    case "pending_checkout_item_defined":
    case "sale_completed":
    case "sale_cleared":
      return "pos.sale.complete";
    case "expense_recorded":
      return "expense.manage";
  }
}

const registerSessionActivityUploadValidator = v.object({
  localEventId: v.string(),
  sequence: v.number(),
  uploadSequence: v.optional(v.number()),
  occurredAt: v.number(),
  staffProfileId: v.optional(v.id("staffProfile")),
  eventType: v.string(),
  category: posRegisterSessionActivityCategoryValidator,
  localExpenseSessionId: v.optional(v.string()),
  registerNumber: v.optional(v.string()),
  metadata: v.optional(
    v.record(v.string(), posRegisterSessionActivityMetadataValueValidator),
  ),
});

const registerSessionActivityResultValidator = commandResultValidator(
  v.object({
    accepted: v.array(
      v.object({
        localEventId: v.string(),
        sequence: v.number(),
        status: v.union(
          v.literal("terminal_reported"),
          v.literal("mapping_pending"),
        ),
      }),
    ),
    skipped: v.array(
      v.object({
        localEventId: v.optional(v.string()),
        sequence: v.optional(v.number()),
        code: posRegisterSessionActivitySkipCodeValidator,
      }),
    ),
    checkpoint: v.object({
      localRegisterSessionId: v.string(),
      reportedThroughSequence: v.number(),
      lastActivityReportedAt: v.optional(v.number()),
      skippedCounts: v.record(v.string(), v.number()),
    }),
  }),
);

export const ingestLocalEvents = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    syncSecretHash: v.string(),
    expectedDemoEpoch: v.optional(v.number()),
    submittedAt: v.optional(v.number()),
    events: v.array(posLocalSyncUploadEventValidator),
  },
  returns: localSyncResultValidator,
  handler: admitPublicMutation(
    ingestLocalEventsOperationDefinition,
    async (ctx, args) => {
      if (args.events.length > MAX_LOCAL_SYNC_EVENTS_PER_REQUEST) {
        return userError({
          code: "validation_failed",
          message: `Sync uploads can include at most ${MAX_LOCAL_SYNC_EVENTS_PER_REQUEST} events.`,
        });
      }

      const pendingDefinitionCount = args.events.filter(
        (event: (typeof args.events)[number]) =>
          event.eventType === "pending_checkout_item_defined",
      ).length;
      if (
        pendingDefinitionCount > MAX_PENDING_CHECKOUT_DEFINITIONS_PER_REQUEST
      ) {
        return userError({
          code: "validation_failed",
          message: `Sync uploads can include at most ${MAX_PENDING_CHECKOUT_DEFINITIONS_PER_REQUEST} pending checkout items.`,
        });
      }

      const store = await ctx.db.get("store", args.storeId);
      if (!store) {
        return userError({
          code: "not_found",
          message: "Store not found.",
        });
      }

      let athenaUser: Doc<"athenaUser">;
      try {
        const admittedActor = (ctx as OperationMutationCtx).operationAdmission
          .actor;
        if (admittedActor.kind === "shared_demo") {
          const capabilities = new Set<SharedDemoCapability>(
            args.events.map((event: (typeof args.events)[number]) =>
              sharedDemoCapabilityForSyncEvent(event.eventType),
            ),
          );
          for (const capability of capabilities) {
            requireSharedDemoCapability(capability);
          }
        }
        const resolvedAthenaUser =
          await requireAuthenticatedAthenaUserWithCtx(ctx);
        if (!resolvedAthenaUser) throw new Error("Sign in again to continue.");
        athenaUser = resolvedAthenaUser;
        await requireOrganizationMemberRoleWithCtx(ctx, {
          allowedRoles: ["full_admin", "pos_only"],
          failureMessage: "You do not have access to sync this POS terminal.",
          organizationId: store.organizationId,
          userId: athenaUser._id,
        });
      } catch {
        return userError({
          code: "authorization_failed",
          message: "You do not have access to sync this POS terminal.",
        });
      }
      const terminal = await ctx.db.get("posTerminal", args.terminalId);
      const submittedSyncSecretHash = await hashPosTerminalSyncSecret(
        args.syncSecretHash,
      );
      if (
        !terminal ||
        terminal.storeId !== args.storeId ||
        terminal.status !== "active" ||
        !terminal.syncSecretHash ||
        terminal.syncSecretHash !== submittedSyncSecretHash
      ) {
        return userError({
          code: "authorization_failed",
          message: "You do not have access to sync this POS terminal.",
          metadata: { terminalAuthorizationFailure: true },
        });
      }

      const result = await ingestLocalEventsWithCtx(ctx, {
        ...args,
        submittedByUserId: athenaUser._id,
        submittedAt: args.submittedAt ?? Date.now(),
      });

      if (result.kind === "ok") {
        await scheduleRegisterCloseoutNotifications(ctx, {
          events: args.events,
          mappings: result.data.mappings,
        });
      }

      return result;
    },
  ),
});

async function scheduleRegisterCloseoutNotifications(
  ctx: MutationCtx,
  args: {
    events: Array<{ eventType: string; localEventId: string }>;
    mappings: Array<{
      cloudId: string;
      cloudTable: string;
      localEventId: string;
      localIdKind: string;
    }>;
  },
) {
  const closeoutEventIds = new Set(
    args.events
      .filter((event) => event.eventType === "register_closed")
      .map((event) => event.localEventId),
  );

  if (closeoutEventIds.size === 0) return;

  for (const mapping of args.mappings) {
    if (
      mapping.cloudTable !== "registerSession" ||
      mapping.localIdKind !== "closeout" ||
      !closeoutEventIds.has(mapping.localEventId)
    ) {
      continue;
    }

    const registerSessionId = mapping.cloudId as Id<"registerSession">;
    // Every status is checked, not just "pending": once a manager resolves the
    // review, a pending-only lookup finds nothing and a replayed sync batch
    // would fall through to the all-clear match branch below, reporting
    // "register closed" for a drawer that was short. Each status is queried on
    // the full index prefix rather than paging the session's approvals and
    // filtering in code — a session accumulates adjustment, void, and
    // correction approvals too, and any bounded page of those could push the
    // variance review out of the window and resurrect that bug.
    const varianceReviewPages = await Promise.all(
      APPROVAL_REQUEST_STATUSES.map((status) =>
        ctx.db
          .query("approvalRequest")
          .withIndex("by_registerSessionId_status_requestType", (q) =>
            q
              .eq("registerSessionId", registerSessionId)
              .eq("status", status.value)
              .eq("requestType", "variance_review"),
          )
          .take(MAX_VARIANCE_REVIEWS_PER_CLOSEOUT + 1),
      ),
    );
    // Truncation is per query: each page has its own bound, so reviews merely
    // spread across statuses are a complete result, not a breach. Testing the
    // flattened total instead would suppress legitimate all-clears for any
    // session whose reviews happen to sum past the bound.
    const truncatedPage = varianceReviewPages.some(
      (page) => page.length > MAX_VARIANCE_REVIEWS_PER_CLOSEOUT,
    );
    const varianceReviews = varianceReviewPages.flat();
    const approvalRequest = varianceReviews.find((request) =>
      isVarianceReviewForCloseout(request, mapping.localEventId),
    );

    // A truncated page could be hiding the very review being looked for —
    // .take returns oldest-first, so the newest rows are the ones dropped.
    // Refuse to take the all-clear branch on a guess.
    if (!approvalRequest && truncatedPage) {
      const breachedSession = await ctx.db.get(
        "registerSession",
        registerSessionId,
      );
      if (!breachedSession) continue;
      await recordOperationalEventWithCtx(ctx, {
        storeId: breachedSession.storeId,
        eventType: "register_closeout_notification_skipped",
        subjectType: "registerSession",
        subjectId: String(registerSessionId),
        actorType: "automation",
        message: `Register closeout notification skipped: a single status holds more than ${MAX_VARIANCE_REVIEWS_PER_CLOSEOUT} variance reviews, so the closeout's review could not be resolved.`,
        metadata: {
          localEventId: mapping.localEventId,
          varianceReviewCount: varianceReviews.length,
        },
        metadataDedupeKeys: ["localEventId"],
      });
      continue;
    }

    // A closeout under variance review is a variance notification and never
    // also a "closed cleanly" report — whatever the review's current status,
    // and including when its emit is skipped because the pre-rail
    // implementation already reported it. The alert itself is only for a
    // review still awaiting a decision.
    if (approvalRequest) {
      if (
        approvalRequest.status === "pending" &&
        !wasVarianceNotifiedBeforeRail(approvalRequest)
      ) {
        await emitNotificationWithCtx(ctx, {
          kind: "register.closeout_variance",
          storeId: approvalRequest.storeId,
          subjectType: "approvalRequest",
          subjectId: String(approvalRequest._id),
          payload: { approvalRequestId: approvalRequest._id },
        });
      }
      continue;
    }

    const registerSession = await ctx.db.get(
      "registerSession",
      registerSessionId,
    );
    if (
      !registerSession ||
      registerSession.status !== "closed" ||
      typeof registerSession.countedCash !== "number" ||
      // Cutover guard: see isFreshVarianceReviewForCloseout. Sessions the
      // pre-rail implementation already reported carry this marker and have no
      // corresponding intent to dedupe against.
      registerSession.closeoutNotificationLocalEventId === mapping.localEventId
    ) {
      continue;
    }

    await emitNotificationWithCtx(ctx, {
      kind: "register.closeout_match",
      storeId: registerSession.storeId,
      subjectType: "registerSession",
      subjectId: String(registerSessionId),
      payload: { registerSessionId, localEventId: mapping.localEventId },
    });
  }
}

// Per (session, status) — a single closeout has at most a handful of variance
// reviews in any one status, so this bound is never reached in practice. Read
// one past it so a breach is reported rather than silently dropping the
// newest rows, which are exactly the ones a closeout lookup wants.
const MAX_VARIANCE_REVIEWS_PER_CLOSEOUT = 10;

// Derived from the schema union rather than hand-listed: a status added to
// approvalRequest but missed here would silently stop matching reviews in
// that status, and this lookup falling through is what sends an all-clear
// for a drawer that was short. Drift here has been a blocker twice.
const APPROVAL_REQUEST_STATUSES = readApprovalRequestStatuses();

type ApprovalRequestStatus = Doc<"approvalRequest">["status"];

// The cast below is unavoidable (the validator's members are structurally
// loose) but it also defeats type checking on the derivation, so verify the
// shape at module load instead. A nested union — v.union(sharedStatuses,
// v.literal("expired")) — yields members without a string `value`, which
// would silently produce q.eq("status", undefined) and reintroduce the
// missed-status fall-through that has been a blocker twice.
function readApprovalRequestStatuses(): ReadonlyArray<{
  value: ApprovalRequestStatus;
}> {
  const members = approvalRequestSchema.fields.status.members as ReadonlyArray<{
    value?: unknown;
  }>;
  const statuses = members.filter(
    (member): member is { value: ApprovalRequestStatus } =>
      typeof member.value === "string",
  );
  if (statuses.length !== members.length || statuses.length === 0) {
    throw new Error(
      "approvalRequest status validator is not a flat union of string literals; " +
        "the register closeout variance lookup cannot enumerate statuses safely.",
    );
  }
  return statuses;
}

function isVarianceReviewForCloseout(
  approvalRequest: Doc<"approvalRequest">,
  localEventId: string,
) {
  const metadata = approvalRequest.metadata;
  return (
    metadata?.localEventId === localEventId &&
    typeof metadata.variance === "number" &&
    metadata.variance !== 0
  );
}

// Cutover guard: reviews notified by the pre-rail implementation carry only
// this marker and have no notificationIntent to dedupe against, so a sync
// batch replayed across the deploy boundary would otherwise re-alert. Safe to
// delete once no unnotified pre-deploy closeouts remain.
function wasVarianceNotifiedBeforeRail(approvalRequest: Doc<"approvalRequest">) {
  return (
    typeof approvalRequest.metadata?.varianceNotificationScheduledAt ===
    "number"
  );
}

/**
 * Dead-letter a poison sync batch: the terminal's scheduler reports a batch
 * the server has thrown on every consecutive upload attempt, and this records
 * a `needs_review` conflict so it reaches the register-session review surface
 * instead of retrying silently forever. Tiny write surface on purpose — it
 * must succeed precisely when `ingestLocalEvents` cannot.
 */
export const reportLocalSyncDeadLetter = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    syncSecretHash: v.string(),
    expectedDemoEpoch: v.optional(v.number()),
    localRegisterSessionId: v.string(),
    localEventId: v.string(),
    sequence: v.number(),
    eventCount: v.number(),
    consecutiveFailureCount: v.number(),
    failureMessage: v.optional(v.string()),
  },
  returns: commandResultValidator(
    v.object({ conflictId: v.string(), alreadyReported: v.boolean() }),
  ),
  handler: admitPublicMutation(
    reportLocalSyncDeadLetterOperationDefinition,
    async (ctx, args) => {
      const store = await ctx.db.get("store", args.storeId);
      if (!store) {
        return userError({
          code: "not_found",
          message: "Store not found.",
        });
      }

      try {
        const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
        if (!athenaUser) throw new Error("Sign in again to continue.");
        await requireOrganizationMemberRoleWithCtx(ctx, {
          allowedRoles: ["full_admin", "pos_only"],
          failureMessage: "You do not have access to sync this POS terminal.",
          organizationId: store.organizationId,
          userId: athenaUser._id,
        });
      } catch {
        return userError({
          code: "authorization_failed",
          message: "You do not have access to sync this POS terminal.",
        });
      }

      const terminal = await ctx.db.get("posTerminal", args.terminalId);
      const submittedSyncSecretHash = await hashPosTerminalSyncSecret(
        args.syncSecretHash,
      );
      if (
        !terminal ||
        terminal.storeId !== args.storeId ||
        terminal.status !== "active" ||
        !terminal.syncSecretHash ||
        terminal.syncSecretHash !== submittedSyncSecretHash
      ) {
        return userError({
          code: "authorization_failed",
          message: "You do not have access to sync this POS terminal.",
          metadata: { terminalAuthorizationFailure: true },
        });
      }

      const { conflict, created } = await recordLocalSyncDeadLetter(ctx, {
        storeId: args.storeId,
        terminalId: args.terminalId,
        localRegisterSessionId: args.localRegisterSessionId,
        localEventId: args.localEventId,
        sequence: args.sequence,
        eventCount: args.eventCount,
        consecutiveFailureCount: args.consecutiveFailureCount,
        failureMessage: args.failureMessage ?? null,
        reportedAt: Date.now(),
      });
      return ok({
        conflictId: String(conflict._id),
        alreadyReported: !created,
      });
    },
  ),
});

export const ingestRegisterSessionActivity = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    syncSecretHash: v.string(),
    expectedDemoEpoch: v.optional(v.number()),
    localRegisterSessionId: v.string(),
    registerNumber: v.optional(v.string()),
    reportedThroughSequence: v.number(),
    reportedThroughOccurredAt: v.optional(v.number()),
    submittedAt: v.optional(v.number()),
    activities: v.array(registerSessionActivityUploadValidator),
  },
  returns: registerSessionActivityResultValidator,
  handler: admitPublicMutation(
    ingestRegisterSessionActivityOperationDefinition,
    async (ctx, args) => {
      if (args.activities.length > MAX_REGISTER_SESSION_ACTIVITY_PER_REQUEST) {
        return userError({
          code: "validation_failed",
          message: `Activity reports can include at most ${MAX_REGISTER_SESSION_ACTIVITY_PER_REQUEST} events.`,
        });
      }

      const store = await ctx.db.get("store", args.storeId);
      if (!store) {
        return userError({
          code: "not_found",
          message: "Store not found.",
        });
      }

      try {
        const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
        if (!athenaUser) throw new Error("Sign in again to continue.");
        await requireOrganizationMemberRoleWithCtx(ctx, {
          allowedRoles: ["full_admin", "pos_only"],
          failureMessage: "You do not have access to sync this POS terminal.",
          organizationId: store.organizationId,
          userId: athenaUser._id,
        });
      } catch {
        return userError({
          code: "authorization_failed",
          message: "You do not have access to sync this POS terminal.",
        });
      }

      const terminal = await ctx.db.get("posTerminal", args.terminalId);
      const submittedSyncSecretHash = await hashPosTerminalSyncSecret(
        args.syncSecretHash,
      );
      if (
        !terminal ||
        terminal.storeId !== args.storeId ||
        terminal.status !== "active" ||
        !terminal.syncSecretHash ||
        terminal.syncSecretHash !== submittedSyncSecretHash
      ) {
        return userError({
          code: "authorization_failed",
          message: "You do not have access to sync this POS terminal.",
          metadata: { terminalAuthorizationFailure: true },
        });
      }

      return ingestRegisterSessionActivityWithCtx(ctx, {
        storeId: args.storeId,
        terminalId: args.terminalId,
        localRegisterSessionId: args.localRegisterSessionId,
        registerNumber: args.registerNumber,
        reportedThroughSequence: args.reportedThroughSequence,
        reportedThroughOccurredAt: args.reportedThroughOccurredAt,
        submittedAt: args.submittedAt ?? Date.now(),
        activities: args.activities,
      });
    },
  ),
});

export const resolveLocalSyncReview = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    localEventIds: v.array(v.string()),
    submittedAt: v.optional(v.number()),
  },
  returns: commandResultValidator(
    v.object({
      resolvedEventIds: v.array(v.string()),
      resolvedConflictCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    if (args.localEventIds.length > MAX_LOCAL_SYNC_REVIEW_EVENTS) {
      return userError({
        code: "validation_failed",
        message: `A review resolution request can include at most ${MAX_LOCAL_SYNC_REVIEW_EVENTS} events.`,
      });
    }

    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      return userError({ code: "not_found", message: "Store not found." });
    }

    let athenaUser;
    try {
      athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
      // One explicit POS org role gates the round-trip; a terminal cannot
      // resolve a server-owned conflict without an authorized org member.
      await requireOrganizationMemberRoleWithCtx(ctx, {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage: "You do not have access to resolve POS sync reviews.",
        organizationId: store.organizationId,
        userId: athenaUser._id,
      });
    } catch {
      return userError({
        code: "authorization_failed",
        message: "You do not have access to resolve POS sync reviews.",
      });
    }

    const result = await resolveLocalSyncReviewWithCtx(ctx, {
      storeId: args.storeId,
      terminalId: args.terminalId,
      localEventIds: args.localEventIds,
      resolvedByUserId: athenaUser._id,
      now: args.submittedAt ?? Date.now(),
    });

    return ok(result);
  },
});
