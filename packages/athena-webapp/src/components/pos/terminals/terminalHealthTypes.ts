import type { Id } from "~/convex/_generated/dataModel";

export type TerminalRecord = {
  _creationTime?: number;
  _id: Id<"posTerminal"> | string;
  browserInfo?: {
    colorDepth?: number;
    language?: string;
    platform?: string;
    screenResolution?: string;
    userAgent: string;
    vendor?: string;
  };
  displayName: string;
  registeredAt: number;
  registeredByUserId: Id<"athenaUser"> | string;
  registerNumber?: string | null;
  status: "active" | "lost" | "revoked" | string;
  storeId?: Id<"store"> | string;
};

export type TerminalRuntimeStatus = {
  _creationTime?: number;
  _id?: string;
  appUpdate?: TerminalRuntimeAppUpdateEvidence;
  appSessionRecovery?: {
    status:
      | "ready"
      | "recovering"
      | "retrying"
      | "waiting_for_network"
      | "blocked_terminal"
      | "blocked_app_account"
      | "blocked_store_mismatch"
      | "retry_exhausted"
      | "stale_assertion"
      | string;
  };
  appShell?: {
    observedAt: number;
    ready: boolean;
  };
  appVersion?: string;
  browserInfo?: {
    language?: string;
    online?: boolean;
    platform?: string;
    userAgent?: string;
  };
  buildSha?: string;
  localStore: {
    available: boolean;
    failureMessage?: string;
    schemaVersion?: number;
    terminalSeedReady: boolean;
  };
  receivedAt: number;
  reportedAt: number;
  snapshots: {
    availabilityAgeMs?: number;
    catalogAgeMs?: number;
    serviceCatalogAgeMs?: number;
    registerReadModelAgeMs?: number;
  };
  source:
    | "pos-hub"
    | "register"
    | "support-diagnostics"
    | "sync-runtime"
    | string;
  staffAuthority: {
    expiresAt?: number;
    staffProfileId?: Id<"staffProfile"> | string;
    status: "expired" | "missing" | "ready" | "unknown" | string;
  };
  drawerAuthority?: {
    cloudRegisterSessionId?: string;
    localRegisterSessionId: string;
    observedAt: number;
    reason?: string;
    status: "blocked" | "healthy" | string;
  };
  storeId?: Id<"store"> | string;
  sync: {
    failedEventCount: number;
    lastFailureMessage?: string;
    lastSyncedSequence?: number;
    lastTrigger?: string;
    localOnlyEventCount: number;
    nextPendingUploadSequence?: number;
    oldestPendingEventAt?: number;
    pendingEventCount: number;
    reviewEvents?: Array<{
      createdAt: number;
      localEventId: string;
      localPosSessionId?: string;
      localRegisterSessionId?: string;
      localTransactionId?: string;
      sequence: number;
      staffProfileId?: string;
      status: string;
      type: string;
      uploaded?: boolean;
      uploadSequence?: number;
    }>;
    reviewEventCount: number;
    status:
      | "failed"
      | "idle"
      | "needs_review"
      | "pending"
      | "syncing"
      | "unavailable"
      | "unknown"
      | string;
    uploadableEventCount: number;
  };
  terminalId?: Id<"posTerminal"> | string;
  activeRegisterSession?: {
    cloudRegisterSessionId?: string;
    localRegisterSessionId: string;
    observedAt: number;
    openedAt?: number;
    registerNumber?: string;
    status: "open" | "active" | "closing" | "closed" | string;
  };
};

export type TerminalRuntimeAppUpdateEvidence = {
  blockerSummary?: string;
  canApply?: boolean;
  command?: {
    executionId?: string;
    issuedAt?: number;
    nonce?: string;
  };
  currentBuildId?: string;
  currentBuildSha?: string;
  detectorStatus?: "failed" | "ok" | "unknown" | string;
  errorCode?: string;
  latestBuildId?: string;
  observedAt?: number;
  pendingBuildId?: string;
  selectedBlockerCode?:
    | "active_command"
    | "active_sale"
    | "resume_required"
    | "unknown"
    | string;
  stagingAssetCount?: number;
  stagingFailedAssetCount?: number;
  stagingReason?: string;
  stagingRejectedAssetCount?: number;
  stagingStatus?: "staged" | "unknown" | "unstaged" | string;
  status:
    | "applying"
    | "blocked"
    | "checking"
    | "current"
    | "detector_failed"
    | "detector-failed"
    | "ready"
    | "ready_unstaged"
    | "staged"
    | "update_ready"
    | "update_ready_unstaged"
    | "unknown"
    | string;
};

export type TerminalSyncEvent = {
  _id?: string;
  acceptedAt?: number;
  eventType: string;
  heldReason?: string;
  localEventId: string;
  localRegisterSessionId: string;
  occurredAt: number;
  projectedAt?: number;
  rejectionCode?: string;
  rejectionMessage?: string;
  sequence: number;
  status: string;
  submittedAt: number;
};

export type TerminalSyncReviewEvent = Pick<
  TerminalSyncEvent,
  "eventType" | "localEventId" | "localRegisterSessionId" | "sequence" | "status"
>;

export type TerminalSyncConflict = {
  _id: string;
  conflictType: string;
  createdAt: number;
  localEventId: string;
  localRegisterSessionId: string;
  reviewTarget?: {
    type: "open_work";
    workItemId: Id<"operationalWorkItem"> | string;
    workItemType: "synced_sale_inventory_review";
  };
  sequence: number;
  summary: string;
};

export type TerminalSyncEvidence = {
  acceptedCount?: number;
  acceptedThroughSequence?: number | null;
  conflictedCount?: number;
  cursorUpdatedAt?: number | null;
  heldCount?: number;
  latestEvent?: TerminalSyncEvent | null;
  latestReviewEvent?: TerminalSyncReviewEvent | null;
  latestReviewEventsByStatus?: {
    conflicted?: TerminalSyncReviewEvent | null;
    held?: TerminalSyncReviewEvent | null;
    rejected?: TerminalSyncReviewEvent | null;
  };
  projectedCount?: number;
  rejectedCount?: number;
  sampledEventCount?: number;
  unresolvedConflictCount?: number;
  unresolvedConflicts?: TerminalSyncConflict[];
};

export type TerminalHealthAttentionActionTarget =
  | {
      automaticRepairEligible?: boolean;
      registerSessionId: Id<"registerSession"> | string;
      type: "cash_control_register_session";
    }
  | { label?: string; type: "open_work" }
  | { type: "pos_register" }
  | { type: "pos_settings" };

export type TerminalHealthAttentionReason = {
  actionTarget?: TerminalHealthAttentionActionTarget;
  count?: number;
  latestEventSequence?: number;
  latestEventStatus?: string;
  nextPendingUploadSequence?: number;
  oldestPendingEventAt?: number;
  source: "cloud_sync" | "local_runtime" | "terminal_runtime" | string;
  summary: string;
  type:
    | "cloud_conflict"
    | "cloud_held"
    | "cloud_rejected"
    | "synced_sale_inventory_review"
    | "local_review"
    | "local_store_unavailable"
    | "sync_failed"
    | "sync_unavailable"
    | "terminal_authorization_failed"
    | "drawer_authority_blocked"
    | "terminal_seed_missing"
    | string;
};

export type TerminalRecoveryReadinessStatus =
  | "able_to_transact_now"
  | "drawer_open"
  | "healthy_idle"
  | "needs_cloud_repair"
  | "needs_manual_review"
  | "needs_terminal_action"
  | string;

export type TerminalRecoveryActionKind =
  | "cloud_repair"
  | "manual_review"
  | "terminal_command"
  | string;

export type TerminalRecoveryActionStatus =
  | "available"
  | "blocked"
  | "completed"
  | "expired"
  | "failed"
  | "pending"
  | "claimed"
  | "verified"
  | "waiting_for_check_in"
  | string;

export type TerminalRecoveryAction = {
  commandId?: string;
  commandContext?: TerminalRecoveryCommandContext;
  commandType?: TerminalRecoveryCommandType;
  expectedEvidence?: TerminalRecoveryExpectedEvidence;
  expectedPreconditionHash?: string;
  expectedVerification?: string;
  kind: TerminalRecoveryActionKind;
  label: string;
  latestAcknowledgement?: string;
  status?: TerminalRecoveryActionStatus;
};

export type TerminalRecoveryCommandType =
  | "retry_sync"
  | "repair_terminal_seed"
  | "clear_stale_drawer_authority"
  | "refresh_staff_authority"
  | "refresh_snapshots"
  | "report_diagnostics"
  | "update_app";

export type TerminalRecoveryCommandContext = {
  cloudRegisterSessionId?: string;
  expectedBlockerType?: string;
  expectedConflictIds?: Array<Id<"posLocalSyncConflict">>;
  expectedTerminalSeedIdentity?: string;
  localRegisterSessionId?: string;
  reason?: string;
};

export type TerminalRecoveryExpectedEvidence = {
  appUpdateCommandExecutionId?: string;
  appUpdateStatus?:
    | "applying"
    | "blocked"
    | "current"
    | "detector_failed"
    | "unknown"
    | "update_ready"
    | "update_ready_unstaged";
  drawerAuthorityStatus?: "healthy" | "blocked";
  localRegisterSessionId?: string;
  localStoreAvailable?: boolean;
  saleAuthorityStatus?: "ready" | "missing" | "blocked" | "unknown";
  staffAuthorityStatus?: "ready" | "missing" | "expired" | "unknown";
  syncStatus?:
    | "failed"
    | "idle"
    | "needs_review"
    | "pending"
    | "syncing"
    | "unavailable"
    | "unknown";
  terminalIntegrityStatus?:
    | "healthy"
    | "repairing"
    | "requires_reprovision"
    | "reset_required";
  terminalSeedReady?: boolean;
};

export type TerminalRecoveryBlockerCategory =
  | "cloud_repair"
  | "manual_review"
  | "terminal_required"
  | string;

export type TerminalRecoveryBlocker = {
  action?: TerminalRecoveryAction | null;
  actionTarget?: TerminalHealthAttentionActionTarget;
  category: TerminalRecoveryBlockerCategory;
  detail?: string;
  id?: string;
  status?: TerminalRecoveryActionStatus;
  summary: string;
  title?: string;
};

export type TerminalRecoveryPreview = {
  appUpdate?: TerminalAppUpdatePreview | null;
  blockers?: TerminalRecoveryBlocker[];
  cloudRepair?: {
    preconditionHash: string;
    safeConflictIds: string[];
    skippedConflictIds: string[];
  };
  commandStatus?: {
    commandId?: string;
    commandType?: TerminalRecoveryCommandType;
    label?: string;
    latestAcknowledgement?: string;
    status?: TerminalRecoveryActionStatus;
    verificationStatus?: TerminalRecoveryActionStatus;
  } | null;
  evidence?: {
    activeRegisterSession?: boolean;
    freshRuntimeRequiredForAbleToTransactNow: true;
  };
  manualReview?: Array<{
    reason: string;
    source:
      | "cloud_repair"
      | TerminalHealthAttentionReason["source"];
    type: "unsafe_cloud_conflict" | TerminalHealthAttentionReason["type"];
  }>;
  readiness?: {
    status?: TerminalRecoveryReadinessStatus;
    summary?: string;
  } | TerminalRecoveryReadinessStatus | null;
  runtimeFresh?: boolean;
  terminalActions?: Array<{
    commandContext: TerminalRecoveryCommandContext;
    commandType: TerminalRecoveryCommandType;
    expectedEvidence: TerminalRecoveryExpectedEvidence;
    reason: string;
  }>;
  verification?: {
    latestCheckInAt?: number;
    status?: TerminalRecoveryActionStatus;
    summary?: string;
  } | null;
};

export type TerminalAppUpdateStatus =
  | "applying"
  | "blocked"
  | "current"
  | "detector_failed"
  | "stale"
  | "unknown"
  | "update_ready"
  | "update_ready_unstaged";

export type TerminalAppUpdatePreview = {
  commandCorrelated?: boolean;
  currentBuildId?: string;
  evidenceFresh: boolean;
  observedAt?: number;
  pendingBuildId?: string;
  stagingAssetCount?: number;
  stagingFailedAssetCount?: number;
  stagingReason?: string;
  stagingRejectedAssetCount?: number;
  stagingStatus?: string;
  status: TerminalAppUpdateStatus;
  summary?: string;
};

export type TerminalHealthSummary = {
  attentionReasons?: TerminalHealthAttentionReason[];
  health?: "needs_attention" | "offline" | "online" | "stale" | "unknown" | string;
  registerSessionLink?: {
    registerSessionId: Id<"registerSession"> | string;
    status: "active" | "open" | string;
  } | null;
  recovery?: TerminalRecoveryPreview | null;
  recoveryPreview?: TerminalRecoveryPreview | null;
  runtimeStatus: TerminalRuntimeStatus | null;
  syncEvidence: TerminalSyncEvidence;
  terminal: TerminalRecord;
};

export type TerminalHealthDetail = TerminalHealthSummary;
