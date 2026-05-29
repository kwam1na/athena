import { v } from "convex/values";

import { mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { commandResultValidator } from "../../lib/commandResultValidators";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import { userError } from "../../../shared/commandResult";
import {
  deleteTerminal as deleteTerminalCommand,
  registerTerminal as registerTerminalCommand,
  submitTerminalRuntimeStatus as submitTerminalRuntimeStatusCommand,
  updateTerminal as updateTerminalCommand,
  type TerminalRuntimeStatusInput,
} from "../application/commands/terminals";
import {
  getTerminalByFingerprint as getTerminalByFingerprintQuery,
  getTerminalHealthSummary as getTerminalHealthSummaryQuery,
  listTerminalHealthSummaries as listTerminalHealthSummariesQuery,
  listTerminals as listTerminalsQuery,
} from "../application/queries/terminals";
import { hashPosTerminalSyncSecret } from "../application/sync/terminalSyncSecret";
import {
  posTerminalRuntimeBrowserInfoValidator,
  posTerminalRuntimeDrawerAuthorityValidator,
  posTerminalRuntimeLocalStoreValidator,
  posTerminalRuntimeSnapshotsValidator,
  posTerminalRuntimeStaffAuthorityValidator,
  posTerminalRuntimeStatusSourceValidator,
  posTerminalRuntimeSyncValidator,
  posTerminalRuntimeTerminalIntegrityValidator,
} from "../../schemas/pos/posTerminalRuntimeStatus";

const statusValidator = v.union(
  v.literal("active"),
  v.literal("revoked"),
  v.literal("lost"),
);

const browserInfoValidator = v.object({
  userAgent: v.string(),
  platform: v.optional(v.string()),
  language: v.optional(v.string()),
  vendor: v.optional(v.string()),
  screenResolution: v.optional(v.string()),
  colorDepth: v.optional(v.number()),
});

const terminalReturnValidator = v.object({
  _id: v.id("posTerminal"),
  _creationTime: v.number(),
  storeId: v.id("store"),
  fingerprintHash: v.string(),
  displayName: v.string(),
  registerNumber: v.optional(v.string()),
  registeredByUserId: v.id("athenaUser"),
  browserInfo: browserInfoValidator,
  registeredAt: v.number(),
  status: statusValidator,
});

const terminalProvisioningReturnValidator = v.object({
  _id: v.id("posTerminal"),
  _creationTime: v.number(),
  storeId: v.id("store"),
  fingerprintHash: v.string(),
  syncSecretHash: v.optional(v.string()),
  displayName: v.string(),
  registerNumber: v.optional(v.string()),
  registeredByUserId: v.id("athenaUser"),
  browserInfo: browserInfoValidator,
  registeredAt: v.number(),
  status: statusValidator,
});

const runtimeStatusInputValidator = v.object({
  reportedAt: v.number(),
  source: posTerminalRuntimeStatusSourceValidator,
  appVersion: v.optional(v.string()),
  buildSha: v.optional(v.string()),
  browserInfo: v.optional(posTerminalRuntimeBrowserInfoValidator),
  localStore: posTerminalRuntimeLocalStoreValidator,
  sync: posTerminalRuntimeSyncValidator,
  staffAuthority: posTerminalRuntimeStaffAuthorityValidator,
  snapshots: posTerminalRuntimeSnapshotsValidator,
  terminalIntegrity: v.optional(posTerminalRuntimeTerminalIntegrityValidator),
  drawerAuthority: v.optional(posTerminalRuntimeDrawerAuthorityValidator),
});

const runtimeStatusWriteResultValidator = v.object({
  terminalId: v.id("posTerminal"),
  reportedAt: v.number(),
  receivedAt: v.number(),
});

const runtimeStatusSnapshotReturnValidator = v.object({
  ...runtimeStatusInputValidator.fields,
  receivedAt: v.number(),
});

const terminalSyncEvidenceReturnValidator = v.object({
  latestEvent: v.union(
    v.object({
      localEventId: v.string(),
      localRegisterSessionId: v.string(),
      sequence: v.number(),
      eventType: v.string(),
      status: v.string(),
      occurredAt: v.number(),
      submittedAt: v.number(),
      acceptedAt: v.optional(v.number()),
      projectedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  latestReviewEvent: v.optional(v.union(
    v.object({
      localEventId: v.string(),
      localRegisterSessionId: v.string(),
      sequence: v.number(),
      eventType: v.string(),
      status: v.string(),
    }),
    v.null(),
  )),
  sampledEventCount: v.number(),
  acceptedCount: v.number(),
  projectedCount: v.number(),
  conflictedCount: v.number(),
  heldCount: v.number(),
  rejectedCount: v.number(),
  unresolvedConflictCount: v.optional(v.number()),
  unresolvedConflicts: v.optional(v.array(v.object({
    _id: v.id("posLocalSyncConflict"),
    conflictType: v.string(),
    createdAt: v.number(),
    localEventId: v.string(),
    localRegisterSessionId: v.string(),
    sequence: v.number(),
    summary: v.string(),
  }))),
  acceptedThroughSequence: v.optional(v.number()),
  cursorUpdatedAt: v.optional(v.number()),
});

const terminalHealthActionTargetReturnValidator = v.union(
  v.object({
    type: v.literal("cash_control_register_session"),
    registerSessionId: v.id("registerSession"),
  }),
  v.object({
    type: v.literal("open_work"),
  }),
  v.object({
    type: v.literal("pos_register"),
  }),
  v.object({
    type: v.literal("pos_settings"),
  }),
);

const terminalHealthStatusValidator = v.union(
  v.literal("online"),
  v.literal("stale"),
  v.literal("offline"),
  v.literal("needs_attention"),
  v.literal("unknown"),
);

const terminalHealthAttentionReasonReturnValidator = v.object({
  actionTarget: v.optional(terminalHealthActionTargetReturnValidator),
  count: v.optional(v.number()),
  latestEventSequence: v.optional(v.number()),
  latestEventStatus: v.optional(v.string()),
  nextPendingUploadSequence: v.optional(v.number()),
  oldestPendingEventAt: v.optional(v.number()),
  source: v.union(
    v.literal("cloud_sync"),
    v.literal("local_runtime"),
    v.literal("terminal_runtime"),
  ),
  summary: v.string(),
  type: v.union(
    v.literal("cloud_conflict"),
    v.literal("cloud_held"),
    v.literal("cloud_rejected"),
    v.literal("local_review"),
    v.literal("local_store_unavailable"),
    v.literal("sync_failed"),
    v.literal("sync_unavailable"),
    v.literal("terminal_authorization_failed"),
    v.literal("drawer_authority_blocked"),
    v.literal("terminal_seed_missing"),
  ),
});

const terminalRegistrationSummaryReturnValidator = v.object({
  _id: v.id("posTerminal"),
  displayName: v.string(),
  registerNumber: v.optional(v.string()),
  registeredByUserId: v.id("athenaUser"),
  browserInfo: browserInfoValidator,
  registeredAt: v.number(),
  status: statusValidator,
});

const terminalHealthSummaryReturnValidator = v.object({
  terminal: terminalRegistrationSummaryReturnValidator,
  health: terminalHealthStatusValidator,
  runtimeAgeMs: v.union(v.number(), v.null()),
  runtimeStatus: v.union(runtimeStatusSnapshotReturnValidator, v.null()),
  attentionReasons: v.array(terminalHealthAttentionReasonReturnValidator),
  syncEvidence: terminalSyncEvidenceReturnValidator,
});

type TerminalRecord = {
  syncSecretHash?: string;
};

function stripTerminalSyncSecret<T extends TerminalRecord>(terminal: T) {
  const { syncSecretHash: _syncSecretHash, ...publicTerminal } = terminal;
  return publicTerminal;
}

function stripRuntimeStatusInput(
  status: TerminalRuntimeStatusInput,
): TerminalRuntimeStatusInput {
  return {
    reportedAt: status.reportedAt,
    source: status.source,
    appVersion: status.appVersion,
    buildSha: status.buildSha,
    browserInfo: status.browserInfo
      ? {
          userAgent: status.browserInfo.userAgent,
          platform: status.browserInfo.platform,
          language: status.browserInfo.language,
          online: status.browserInfo.online,
        }
      : undefined,
    localStore: {
      available: status.localStore.available,
      schemaVersion: status.localStore.schemaVersion,
      terminalSeedReady: status.localStore.terminalSeedReady,
      failureMessage: status.localStore.failureMessage,
    },
    sync: {
      status: status.sync.status,
      pendingEventCount: status.sync.pendingEventCount,
      uploadableEventCount: status.sync.uploadableEventCount,
      failedEventCount: status.sync.failedEventCount,
      reviewEventCount: status.sync.reviewEventCount,
      localOnlyEventCount: status.sync.localOnlyEventCount,
      oldestPendingEventAt: status.sync.oldestPendingEventAt,
      nextPendingUploadSequence: status.sync.nextPendingUploadSequence,
      lastSyncedSequence: status.sync.lastSyncedSequence,
      lastTrigger: status.sync.lastTrigger,
      lastFailureMessage: status.sync.lastFailureMessage,
    },
    staffAuthority: {
      status: status.staffAuthority.status,
      staffProfileId: status.staffAuthority.staffProfileId,
      expiresAt: status.staffAuthority.expiresAt,
    },
    terminalIntegrity: status.terminalIntegrity
      ? {
          observedAt: status.terminalIntegrity.observedAt,
          reason: status.terminalIntegrity.reason,
          status: status.terminalIntegrity.status,
        }
      : undefined,
    drawerAuthority: status.drawerAuthority
      ? {
          cloudRegisterSessionId: status.drawerAuthority.cloudRegisterSessionId,
          localRegisterSessionId: status.drawerAuthority.localRegisterSessionId,
          observedAt: status.drawerAuthority.observedAt,
          reason: status.drawerAuthority.reason,
          status: status.drawerAuthority.status,
        }
      : undefined,
    snapshots: {
      catalogAgeMs: status.snapshots.catalogAgeMs,
      availabilityAgeMs: status.snapshots.availabilityAgeMs,
      registerReadModelAgeMs: status.snapshots.registerReadModelAgeMs,
    },
  };
}

async function requireTerminalStoreAccess(
  ctx: Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">,
  args: {
    allowedRoles: ["full_admin"] | ["full_admin", "pos_only"];
    failureMessage: string;
    storeId: Id<"store">;
    userId: Id<"athenaUser">;
  },
) {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: args.allowedRoles,
    failureMessage: args.failureMessage,
    organizationId: store.organizationId,
    userId: args.userId,
  });
}

export const listTerminals = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.array(terminalReturnValidator),
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireTerminalStoreAccess(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You do not have access to view POS terminals.",
      storeId: args.storeId,
      userId: athenaUser._id,
    });
	    const terminals = await listTerminalsQuery(ctx, args);
	    return terminals.map(stripTerminalSyncSecret);
  },
});

export const getTerminalByFingerprint = query({
  args: {
    storeId: v.id("store"),
    fingerprintHash: v.string(),
  },
  returns: v.union(terminalReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireTerminalStoreAccess(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You do not have access to view POS terminals.",
      storeId: args.storeId,
      userId: athenaUser._id,
    });
	    const terminal = await getTerminalByFingerprintQuery(ctx, args);
	    return terminal ? stripTerminalSyncSecret(terminal) : null;
  },
});

export const listTerminalHealthSummaries = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.array(terminalHealthSummaryReturnValidator),
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireTerminalStoreAccess(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You do not have access to view POS terminal health.",
      storeId: args.storeId,
      userId: athenaUser._id,
    });
    return listTerminalHealthSummariesQuery(ctx, args);
  },
});

export const getTerminalHealthSummary = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
  },
  returns: v.union(terminalHealthSummaryReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireTerminalStoreAccess(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You do not have access to view POS terminal health.",
      storeId: args.storeId,
      userId: athenaUser._id,
    });
    return getTerminalHealthSummaryQuery(ctx, args);
  },
});

export const listTerminalHealth = listTerminalHealthSummaries;
export const getTerminalHealthDetail = getTerminalHealthSummary;

export const submitTerminalRuntimeStatus = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    syncSecretHash: v.string(),
    status: runtimeStatusInputValidator,
  },
  returns: commandResultValidator(runtimeStatusWriteResultValidator),
  handler: async (ctx, args) => {
    let athenaUser;
    try {
      athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
      await requireTerminalStoreAccess(ctx, {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage:
          "You do not have access to update this POS terminal status.",
        storeId: args.storeId,
        userId: athenaUser._id,
      });
    } catch {
      return userError({
        code: "authorization_failed",
        message: "You do not have access to update this POS terminal status.",
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
      terminal.registeredByUserId !== athenaUser._id ||
      !terminal.syncSecretHash ||
      terminal.syncSecretHash !== submittedSyncSecretHash
    ) {
      return userError({
        code: "authorization_failed",
        message: "You do not have access to update this POS terminal status.",
        metadata: { terminalAuthorizationFailure: true },
      });
    }

    return submitTerminalRuntimeStatusCommand(ctx, {
      storeId: args.storeId,
      terminalId: args.terminalId,
      status: stripRuntimeStatusInput(args.status),
    });
  },
});

export const reportTerminalRuntimeStatus = submitTerminalRuntimeStatus;

export const registerTerminal = mutation({
  args: {
    storeId: v.id("store"),
    fingerprintHash: v.string(),
    syncSecretHash: v.string(),
    displayName: v.string(),
    registerNumber: v.string(),
    browserInfo: browserInfoValidator,
  },
  returns: commandResultValidator(terminalProvisioningReturnValidator),
  handler: async (ctx, args) => {
    try {
      const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
      await requireTerminalStoreAccess(ctx, {
        allowedRoles: ["full_admin"],
        failureMessage: "You do not have access to register this POS terminal.",
        storeId: args.storeId,
        userId: athenaUser._id,
      });
      const result = await registerTerminalCommand(ctx, {
        ...args,
        syncSecretHash: await hashPosTerminalSyncSecret(args.syncSecretHash),
        registeredByUserId: athenaUser._id,
      });
      return result.kind === "ok"
        ? {
            ...result,
            data: {
              ...result.data,
              syncSecretHash: args.syncSecretHash,
            },
          }
        : result;
    } catch {
      return userError({
        code: "authorization_failed",
        message: "You do not have access to register this POS terminal.",
      });
    }
  },
});

export const updateTerminal = mutation({
  args: {
    terminalId: v.id("posTerminal"),
    displayName: v.optional(v.string()),
    status: v.optional(statusValidator),
    browserInfo: v.optional(browserInfoValidator),
  },
  returns: terminalReturnValidator,
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    const terminal = await ctx.db.get("posTerminal", args.terminalId);
    if (!terminal) {
      throw new Error("Terminal not found");
    }

    await requireTerminalStoreAccess(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "You do not have access to update this POS terminal.",
      storeId: terminal.storeId,
      userId: athenaUser._id,
    });
	    const updatedTerminal = await updateTerminalCommand(ctx, args);
	    return stripTerminalSyncSecret(updatedTerminal);
  },
});

export const deleteTerminal = mutation({
  args: {
    terminalId: v.id("posTerminal"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    const terminal = await ctx.db.get("posTerminal", args.terminalId);
    if (!terminal) {
      return null;
    }

    await requireTerminalStoreAccess(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "You do not have access to delete this POS terminal.",
      storeId: terminal.storeId,
      userId: athenaUser._id,
    });
    return deleteTerminalCommand(ctx, args);
  },
});
