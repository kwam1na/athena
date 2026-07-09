import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { mutation } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { commandResultValidator } from "../../lib/commandResultValidators";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import { userError } from "../../../shared/commandResult";
import { ingestLocalEventsWithCtx } from "../application/sync/ingestLocalEvents";
import { hashPosTerminalSyncSecret } from "../application/sync/terminalSyncSecret";
import { posLocalSyncMappingKindValidator } from "../../schemas/pos/posLocalSyncMapping";
import {
  posLocalSyncConflictStatusValidator,
  posLocalSyncConflictTypeValidator,
} from "../../schemas/pos/posLocalSyncConflict";
import {
  posLocalSyncEventStatusValidator,
} from "../../schemas/pos/posLocalSyncEvent";
import { posLocalSyncUploadEventValidator } from "../../schemas/pos/posLocalSyncContractValidators";
import {
  posRegisterSessionActivityCategoryValidator,
  posRegisterSessionActivityMetadataValueValidator,
  posRegisterSessionActivitySkipCodeValidator,
} from "../../schemas/pos/posRegisterSessionActivity";
import { ingestRegisterSessionActivityWithCtx } from "../application/sync/posRegisterSessionActivity";

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
    submittedAt: v.optional(v.number()),
    events: v.array(posLocalSyncUploadEventValidator),
  },
  returns: localSyncResultValidator,
  handler: async (ctx, args) => {
    if (args.events.length > MAX_LOCAL_SYNC_EVENTS_PER_REQUEST) {
      return userError({
        code: "validation_failed",
        message: `Sync uploads can include at most ${MAX_LOCAL_SYNC_EVENTS_PER_REQUEST} events.`,
      });
    }

    const pendingDefinitionCount = args.events.filter(
      (event) => event.eventType === "pending_checkout_item_defined",
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

    let athenaUser;
    try {
      athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
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

    if (
      result.kind === "ok" &&
      shouldScheduleRegisterCloseoutVarianceAlerts()
    ) {
      await scheduleRegisterCloseoutVarianceAlerts(ctx, {
        events: args.events,
        mappings: result.data.mappings,
      });
    }

    return result;
  },
});

function shouldScheduleRegisterCloseoutVarianceAlerts() {
  return process.env.STAGE === "prod";
}

async function scheduleRegisterCloseoutVarianceAlerts(
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
    const pendingVarianceReviews = await ctx.db
      .query("approvalRequest")
      .withIndex("by_registerSessionId_status_requestType", (q) =>
        q
          .eq("registerSessionId", registerSessionId)
          .eq("status", "pending")
          .eq("requestType", "variance_review"),
      )
      .take(2);
    const approvalRequest = pendingVarianceReviews.find((request) =>
      isFreshVarianceReviewForCloseout(request, mapping.localEventId),
    );

    if (!approvalRequest) continue;

    await ctx.db.patch("approvalRequest", approvalRequest._id, {
      metadata: {
        ...(approvalRequest.metadata ?? {}),
        varianceNotificationScheduledAt: Date.now(),
      },
    });
    await ctx.scheduler.runAfter(
      0,
      internal.operations.registerCloseoutVarianceEmail
        .sendRegisterCloseoutVarianceAlertToAdmins,
      {
        approvalRequestId: approvalRequest._id,
      },
    );
  }
}

function isFreshVarianceReviewForCloseout(
  approvalRequest: Doc<"approvalRequest">,
  localEventId: string,
) {
  const metadata = approvalRequest.metadata;
  return (
    metadata?.localEventId === localEventId &&
    typeof metadata.variance === "number" &&
    metadata.variance !== 0 &&
    typeof metadata.varianceNotificationScheduledAt !== "number"
  );
}

export const ingestRegisterSessionActivity = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    syncSecretHash: v.string(),
    localRegisterSessionId: v.string(),
    registerNumber: v.optional(v.string()),
    reportedThroughSequence: v.number(),
    reportedThroughOccurredAt: v.optional(v.number()),
    submittedAt: v.optional(v.number()),
    activities: v.array(registerSessionActivityUploadValidator),
  },
  returns: registerSessionActivityResultValidator,
  handler: async (ctx, args) => {
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

    let athenaUser;
    try {
      athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
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
});
