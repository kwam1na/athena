import { v } from "convex/values";

export const posTerminalRuntimeStatusSourceValidator = v.union(
  v.literal("pos-hub"),
  v.literal("register"),
  v.literal("sync-runtime"),
  v.literal("support-diagnostics"),
);

export const posTerminalRuntimeSyncStatusValidator = v.union(
  v.literal("idle"),
  v.literal("pending"),
  v.literal("syncing"),
  v.literal("failed"),
  v.literal("needs_review"),
  v.literal("unavailable"),
  v.literal("unknown"),
);

export const posTerminalRuntimeStaffAuthorityStatusValidator = v.union(
  v.literal("ready"),
  v.literal("missing"),
  v.literal("expired"),
  v.literal("unknown"),
);

export const posTerminalRuntimeAppSessionRecoveryStatusValidator = v.union(
  v.literal("ready"),
  v.literal("recovering"),
  v.literal("retrying"),
  v.literal("waiting_for_network"),
  v.literal("blocked_terminal"),
  v.literal("blocked_app_account"),
  v.literal("blocked_store_mismatch"),
  v.literal("retry_exhausted"),
  v.literal("stale_assertion"),
);

export const posTerminalRuntimeAppSessionRecoveryValidator = v.object({
  status: posTerminalRuntimeAppSessionRecoveryStatusValidator,
});

export const posTerminalRuntimeBrowserInfoValidator = v.object({
  userAgent: v.optional(v.string()),
  platform: v.optional(v.string()),
  language: v.optional(v.string()),
  online: v.optional(v.boolean()),
});

export const posTerminalRuntimeLocalStoreValidator = v.object({
  available: v.boolean(),
  schemaVersion: v.optional(v.number()),
  terminalSeedReady: v.boolean(),
  failureMessage: v.optional(v.string()),
});

export const posTerminalRuntimeSyncValidator = v.object({
  status: posTerminalRuntimeSyncStatusValidator,
  pendingEventCount: v.number(),
  uploadableEventCount: v.number(),
  failedEventCount: v.number(),
  reviewEventCount: v.number(),
  localOnlyEventCount: v.number(),
  reviewEvents: v.optional(v.array(v.object({
    createdAt: v.number(),
    localEventId: v.string(),
    localPosSessionId: v.optional(v.string()),
    localRegisterSessionId: v.optional(v.string()),
    localTransactionId: v.optional(v.string()),
    sequence: v.number(),
    staffProfileId: v.optional(v.string()),
    status: v.string(),
    type: v.string(),
    uploaded: v.optional(v.boolean()),
    uploadSequence: v.optional(v.number()),
  }))),
  oldestPendingEventAt: v.optional(v.number()),
  nextPendingUploadSequence: v.optional(v.number()),
  lastSyncedSequence: v.optional(v.number()),
  lastTrigger: v.optional(v.string()),
  lastFailureMessage: v.optional(v.string()),
});

export const posTerminalRuntimeStaffAuthorityValidator = v.object({
  status: posTerminalRuntimeStaffAuthorityStatusValidator,
  staffProfileId: v.optional(v.id("staffProfile")),
  expiresAt: v.optional(v.number()),
});

export const posTerminalRuntimeSnapshotsValidator = v.object({
  catalogAgeMs: v.optional(v.number()),
  serviceCatalogAgeMs: v.optional(v.number()),
  availabilityAgeMs: v.optional(v.number()),
  registerReadModelAgeMs: v.optional(v.number()),
});

export const posTerminalRuntimeTerminalIntegrityReasonValidator = v.union(
  v.literal("authorization_failed"),
  v.literal("ownership_conflict"),
  v.literal("repair_rejected"),
  v.literal("seed_write_failed"),
  v.literal("store_access_missing"),
  v.literal("terminal_revoked"),
  v.literal("unknown"),
);

export const posTerminalRuntimeDrawerAuthorityReasonValidator = v.union(
  v.literal("authority_unknown"),
  v.literal("cloud_closed"),
  v.literal("lifecycle_rejected"),
);

export const posTerminalRuntimeTerminalIntegrityValidator = v.object({
  observedAt: v.number(),
  reason: v.optional(posTerminalRuntimeTerminalIntegrityReasonValidator),
  status: v.union(
    v.literal("healthy"),
    v.literal("repairing"),
    v.literal("requires_reprovision"),
    v.literal("reset_required"),
  ),
});

export const posTerminalRuntimeDrawerAuthorityValidator = v.object({
  cloudRegisterSessionId: v.optional(v.string()),
  localRegisterSessionId: v.string(),
  observedAt: v.number(),
  reason: v.optional(posTerminalRuntimeDrawerAuthorityReasonValidator),
  status: v.union(v.literal("healthy"), v.literal("blocked")),
});

export const posTerminalRuntimeStatusSchema = v.object({
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  reportedAt: v.number(),
  receivedAt: v.number(),
  source: posTerminalRuntimeStatusSourceValidator,
  appVersion: v.optional(v.string()),
  buildSha: v.optional(v.string()),
  browserInfo: v.optional(posTerminalRuntimeBrowserInfoValidator),
  appSessionRecovery: v.optional(
    posTerminalRuntimeAppSessionRecoveryValidator,
  ),
  localStore: posTerminalRuntimeLocalStoreValidator,
  sync: posTerminalRuntimeSyncValidator,
  staffAuthority: posTerminalRuntimeStaffAuthorityValidator,
  snapshots: posTerminalRuntimeSnapshotsValidator,
  terminalIntegrity: v.optional(posTerminalRuntimeTerminalIntegrityValidator),
  drawerAuthority: v.optional(posTerminalRuntimeDrawerAuthorityValidator),
});
