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

export const posTerminalRuntimeAppShellValidator = v.object({
  observedAt: v.number(),
  ready: v.boolean(),
});

export const posTerminalRuntimeAppUpdateStatusValidator = v.union(
  v.literal("current"),
  v.literal("checking"),
  v.literal("update_ready"),
  v.literal("update_ready_unstaged"),
  v.literal("blocked"),
  v.literal("applying"),
  v.literal("detector_failed"),
  v.literal("unknown"),
);

export const posTerminalRuntimeAppUpdateStagingStatusValidator = v.union(
  v.literal("staged"),
  v.literal("unstaged"),
  v.literal("unknown"),
);

export const posTerminalRuntimeAppUpdateStagingReasonValidator = v.union(
  v.literal("asset-staging-failed"),
  v.literal("no-entry-html"),
  v.literal("no-static-assets"),
  v.literal("cache-storage-unavailable"),
  v.literal("service-worker-unavailable"),
  v.literal("service-worker-timeout"),
  v.literal("service-worker-error"),
  v.literal("unknown"),
);

export const posTerminalRuntimeAppUpdateDetectorStatusValidator = v.union(
  v.literal("ok"),
  v.literal("failed"),
  v.literal("unknown"),
);

export const posTerminalRuntimeAppUpdateBlockerCodeValidator = v.union(
  v.literal("active_sale"),
  v.literal("active_command"),
  v.literal("resume_required"),
  v.literal("unknown"),
);

export const posTerminalRuntimeAppUpdateValidator = v.object({
  blockerSummary: v.optional(posTerminalRuntimeAppUpdateBlockerCodeValidator),
  canApply: v.boolean(),
  commandExecutionId: v.optional(v.string()),
  commandId: v.optional(v.string()),
  commandIssuedAt: v.optional(v.number()),
  commandNonce: v.optional(v.string()),
  currentBuildId: v.optional(v.string()),
  detectorStatus: posTerminalRuntimeAppUpdateDetectorStatusValidator,
  observedAt: v.number(),
  pendingBuildId: v.optional(v.string()),
  selectedBlockerCode: v.optional(
    posTerminalRuntimeAppUpdateBlockerCodeValidator,
  ),
  stagingAssetCount: v.optional(v.number()),
  stagingFailedAssetCount: v.optional(v.number()),
  stagingRejectedAssetCount: v.optional(v.number()),
  stagingReason: v.optional(posTerminalRuntimeAppUpdateStagingReasonValidator),
  stagingStatus: v.optional(posTerminalRuntimeAppUpdateStagingStatusValidator),
  status: posTerminalRuntimeAppUpdateStatusValidator,
});

export const posTerminalRuntimeBrowserInfoValidator = v.object({
  userAgent: v.optional(v.string()),
  platform: v.optional(v.string()),
  language: v.optional(v.string()),
  online: v.optional(v.boolean()),
});

export const posTerminalRuntimeLocalStoreValidator = v.object({
  available: v.boolean(),
  engineReadiness: v.optional(
    v.union(v.literal("ready"), v.literal("unavailable"), v.literal("unknown")),
  ),
  healthFreshness: v.optional(
    v.union(v.literal("fresh"), v.literal("stale"), v.literal("unknown")),
  ),
  healthObservedAt: v.optional(v.number()),
  lastSuccessfulDurableCommitAt: v.optional(v.number()),
  ledgerPressure: v.optional(
    v.union(
      v.literal("normal"),
      v.literal("warning"),
      v.literal("critical"),
      v.literal("unknown"),
    ),
  ),
  maintenance: v.optional(
    v.union(
      v.literal("idle"),
      v.literal("active"),
      v.literal("blocked"),
      v.literal("unknown"),
    ),
  ),
  migration: v.optional(
    v.union(
      v.literal("idle"),
      v.literal("running"),
      v.literal("failed"),
      v.literal("unknown"),
    ),
  ),
  persistence: v.optional(
    v.union(
      v.literal("granted"),
      v.literal("denied"),
      v.literal("unsupported"),
      v.literal("unknown"),
    ),
  ),
  pressure: v.optional(
    v.union(
      v.literal("normal"),
      v.literal("warning"),
      v.literal("critical"),
      v.literal("unknown"),
    ),
  ),
  quotaBytes: v.optional(v.number()),
  schemaVersion: v.optional(v.number()),
  terminalSeedReady: v.boolean(),
  failureMessage: v.optional(v.string()),
  usageBytes: v.optional(v.number()),
});

export const posTerminalRuntimeSyncValidator = v.object({
  status: posTerminalRuntimeSyncStatusValidator,
  pendingEventCount: v.number(),
  uploadableEventCount: v.number(),
  failedEventCount: v.number(),
  reviewEventCount: v.number(),
  localOnlyEventCount: v.number(),
  reviewEvents: v.optional(
    v.array(
      v.object({
        createdAt: v.number(),
        localEventId: v.string(),
        localPosSessionId: v.optional(v.string()),
        localRegisterSessionId: v.optional(v.string()),
        // Legacy fields are accepted for existing runtime rows but are stripped
        // before new check-ins are persisted or terminal health reads are returned.
        localTransactionId: v.optional(v.string()),
        sequence: v.number(),
        staffProfileId: v.optional(v.string()),
        status: v.string(),
        type: v.string(),
        uploaded: v.optional(v.boolean()),
        uploadSequence: v.optional(v.number()),
      }),
    ),
  ),
  oldestPendingEventAt: v.optional(v.number()),
  nextPendingUploadSequence: v.optional(v.number()),
  lastSyncedSequence: v.optional(v.number()),
  lastTrigger: v.optional(v.string()),
  lastFailureMessage: v.optional(v.string()),
  backoffUntil: v.optional(v.number()),
  heldEventCount: v.optional(v.number()),
  heldWithoutProgress: v.optional(v.boolean()),
});

export const posTerminalRuntimeStaffAuthorityValidator = v.object({
  status: posTerminalRuntimeStaffAuthorityStatusValidator,
  staffProfileId: v.optional(v.id("staffProfile")),
  expiresAt: v.optional(v.number()),
});

export const posTerminalRuntimeSaleAuthorityValidator = v.object({
  observedAt: v.number(),
  status: v.union(
    v.literal("ready"),
    v.literal("missing"),
    v.literal("blocked"),
    v.literal("unknown"),
  ),
  localPosSessionId: v.optional(v.string()),
  localRegisterSessionId: v.optional(v.string()),
  staffProfileId: v.optional(v.id("staffProfile")),
  transactionMode: v.optional(
    v.union(
      v.literal("products_and_services"),
      v.literal("products_only"),
      v.literal("services_only"),
    ),
  ),
});

export const posTerminalRuntimeActiveRegisterSessionValidator = v.object({
  cloudRegisterSessionId: v.optional(v.string()),
  localRegisterSessionId: v.string(),
  observedAt: v.number(),
  openedAt: v.optional(v.number()),
  registerNumber: v.optional(v.string()),
  status: v.union(
    v.literal("open"),
    v.literal("active"),
    v.literal("closing"),
    v.literal("closeout_rejected"),
    v.literal("closed"),
  ),
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
  appSessionRecovery: v.optional(posTerminalRuntimeAppSessionRecoveryValidator),
  appShell: v.optional(posTerminalRuntimeAppShellValidator),
  appUpdate: v.optional(posTerminalRuntimeAppUpdateValidator),
  localStore: posTerminalRuntimeLocalStoreValidator,
  sync: posTerminalRuntimeSyncValidator,
  staffAuthority: posTerminalRuntimeStaffAuthorityValidator,
  saleAuthority: v.optional(posTerminalRuntimeSaleAuthorityValidator),
  activeRegisterSession: v.optional(
    posTerminalRuntimeActiveRegisterSessionValidator,
  ),
  snapshots: posTerminalRuntimeSnapshotsValidator,
  terminalIntegrity: v.optional(posTerminalRuntimeTerminalIntegrityValidator),
  drawerAuthority: v.optional(posTerminalRuntimeDrawerAuthorityValidator),
  recoveryVerificationCursor: v.optional(v.string()),
  // Best-effort counters from silent-catch rails (storage probes, leader
  // election); names are client-defined, values are non-negative totals.
  runtimeCounters: v.optional(v.record(v.string(), v.number())),
});
