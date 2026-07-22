import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { mutation } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import {
  ingestLocalEventsOperationDefinition,
  ingestRegisterSessionActivityOperationDefinition,
} from "../../operationAdmission/definitions";
import { withOperationMutationAdmission } from "../../operationAdmission/publicMutation";
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
import { patchRegisterSessionWithAuthority } from "../../operations/registerSessionAuthorityRevision";
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
  handler: withOperationMutationAdmission(
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

      let athenaUser;
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
          athenaUser = await ctx.db.get(
            "athenaUser",
            admittedActor.athenaUserId,
          );
          if (!athenaUser) throw new Error("Sign in again to continue.");
        } else {
          athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
        }
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
        shouldScheduleRegisterCloseoutNotifications()
      ) {
        await scheduleRegisterCloseoutNotifications(ctx, {
          events: args.events,
          mappings: result.data.mappings,
        });
      }

      return result;
    },
  ),
});

function shouldScheduleRegisterCloseoutNotifications() {
  return process.env.STAGE === "prod";
}

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

    if (approvalRequest) {
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
        { approvalRequestId: approvalRequest._id },
      );
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
      registerSession.closeoutNotificationLocalEventId === mapping.localEventId
    ) {
      continue;
    }

    await patchRegisterSessionWithAuthority(ctx, registerSessionId, {
      closeoutNotificationLocalEventId: mapping.localEventId,
      closeoutNotificationScheduledAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.operations.registerCloseoutVarianceEmail
        .sendRegisterCloseoutMatchReportToAdmins,
      { registerSessionId },
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
    expectedDemoEpoch: v.optional(v.number()),
    localRegisterSessionId: v.string(),
    registerNumber: v.optional(v.string()),
    reportedThroughSequence: v.number(),
    reportedThroughOccurredAt: v.optional(v.number()),
    submittedAt: v.optional(v.number()),
    activities: v.array(registerSessionActivityUploadValidator),
  },
  returns: registerSessionActivityResultValidator,
  handler: withOperationMutationAdmission(
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

      let athenaUser;
      try {
        const admittedActor = (ctx as OperationMutationCtx).operationAdmission
          .actor;
        if (admittedActor.kind === "shared_demo") {
          athenaUser = await ctx.db.get(
            "athenaUser",
            admittedActor.athenaUserId,
          );
          if (!athenaUser) throw new Error("Sign in again to continue.");
        } else {
          athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
        }
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
