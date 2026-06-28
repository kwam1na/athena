import type { Doc, Id } from "../../../_generated/dataModel";
import type { TerminalSyncEvidence } from "../../domain/terminalSyncEvidence";
import type {
  TerminalRecoveryCommandPayload,
  TerminalRecoveryCommandType,
  TerminalRecoveryExpectedEvidence,
  TerminalRecoveryReadiness,
} from "../terminalRecovery/types";

export type TerminalSalesReadiness =
  | "healthy_idle"
  | "drawer_open"
  | "able_to_transact_now";

export type TerminalSupportRecovery =
  | {
      reasonCount: number;
      status: "needs_cloud_repair" | "needs_manual_review" | "needs_terminal_action";
    }
  | null;

export type TerminalOperationalExplanation = {
  blockingDomain:
    | "cloud_repair"
    | "manual_review"
    | "none"
    | "sync_review"
    | "terminal_runtime";
  detail: string;
  evidenceReferences: Array<{
    count?: number;
    source:
      | "cloud_repair"
      | TerminalHealthAttentionReason["source"]
      | TerminalDiagnosticEvidence[number]["source"];
    summary: string;
    type: "diagnostic" | "safe_cloud_conflict" | TerminalHealthAttentionReason["type"];
  }>;
  headline: string;
  lane:
    | TerminalSalesReadiness
    | "needs_cloud_repair"
    | "needs_manual_review"
    | "needs_terminal_action"
    | "sale_ready_with_review_backlog"
    | "stale_runtime"
    | "unknown";
  nextStep: string;
  primaryOwner:
    | "cash_controls"
    | "manager"
    | "none"
    | "operations"
    | "support"
    | "terminal";
  saleImpact: "can_transact_now" | "not_ready" | "unknown";
  secondaryActions: Array<{
    label: string;
    primaryOwner:
      | "cash_controls"
      | "manager"
      | "operations"
      | "support"
      | "terminal";
    supportAction:
      | "manual_review"
      | "safe_cloud_repair"
      | "terminal_command"
      | "terminal_sync_retry";
  }>;
  severity: "critical" | "info" | "warning";
  summaryMeta: {
    hasSecondarySafeRepair: boolean;
    reviewBacklogCount: number;
    targetResolutionIncomplete: boolean;
  };
  supportAction:
    | "manual_review"
    | "none"
    | "safe_cloud_repair"
    | "terminal_command"
    | "terminal_sync_retry"
    | "wait_for_check_in";
};

export type TerminalDiagnosticEvidence = Array<{
  severity: "info" | "warning";
  source:
    | "cloud_register_lifecycle"
    | "local_runtime"
    | "recovery_command"
    | "sync_evidence";
  summary: string;
}>;

export type TerminalHealthAttentionReason = {
  actionTarget?: TerminalHealthAttentionActionTarget;
  count?: number;
  latestEventSequence?: number;
  latestEventStatus?: string;
  nextPendingUploadSequence?: number;
  oldestPendingEventAt?: number;
  source: "cloud_sync" | "local_runtime" | "terminal_runtime";
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
    | "terminal_seed_missing";
};

export type TerminalHealthAttentionActionTarget =
  | {
      automaticRepairEligible?: boolean;
      type: "cash_control_register_session";
      registerSessionId: Id<"registerSession">;
    }
  | { label?: string; type: "open_work" }
  | { type: "pos_register" }
  | { type: "pos_settings" };

export type TerminalHealth =
  | "online"
  | "stale"
  | "offline"
  | "needs_attention"
  | "unknown";

export type TerminalRecoveryPreview = {
  appUpdate: TerminalAppUpdatePreview;
  readiness: TerminalRecoveryReadiness;
  runtimeFresh: boolean;
  evidence: {
    freshRuntimeRequiredForAbleToTransactNow: true;
    activeRegisterSession: boolean;
  };
  cloudRepair: {
    preconditionHash: string;
    safeConflictIds: Array<Id<"posLocalSyncConflict">>;
    skippedConflictIds: Array<Id<"posLocalSyncConflict">>;
  };
  commandStatus: {
    appUpdateCommandExecutionId?: string;
    commandId?: Id<"posTerminalRecoveryCommand">;
    commandType: TerminalRecoveryCommandType;
    label: string;
    latestAcknowledgement?: string;
    status: Doc<"posTerminalRecoveryCommand">["status"];
    verificationStatus: Doc<"posTerminalRecoveryCommand">["verificationStatus"];
  } | null;
  terminalActions: Array<{
    commandType: TerminalRecoveryCommandType;
    expectedEvidence: TerminalRecoveryExpectedEvidence;
    commandContext: TerminalRecoveryCommandPayload;
    reason: string;
  }>;
  manualReview: Array<{
    reason: string;
    source:
      | TerminalHealthAttentionReason["source"]
      | "cloud_repair";
    type: TerminalHealthAttentionReason["type"] | "unsafe_cloud_conflict";
  }>;
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

export type TerminalOperationalState = {
  appUpdateEvidence: TerminalRecoveryPreview["appUpdate"];
  attentionReasons: TerminalHealthAttentionReason[];
  diagnosticEvidence: TerminalDiagnosticEvidence;
  operationalExplanation: TerminalOperationalExplanation;
  recoveryEvidence: {
    cloudRepair: TerminalRecoveryPreview["cloudRepair"];
    commandStatus: TerminalRecoveryPreview["commandStatus"];
    manualReview: TerminalRecoveryPreview["manualReview"];
    terminalActions: TerminalRecoveryPreview["terminalActions"];
  };
  recoveryPreview: TerminalRecoveryPreview;
  registerEvidence: {
    activeRegisterSession: boolean;
    cloudRegisterSessionSaleUsable?: boolean;
    latestCloudRegisterSessionStatus?: Doc<"registerSession">["status"];
  };
  terminalHealth: TerminalHealth;
  runtimeEvidence: {
    effectiveStatus: Doc<"posTerminalRuntimeStatus"> | null;
    fresh: boolean;
    runtimeAgeMs: number | null;
  };
  salesReadiness: TerminalSalesReadiness;
  supportRecovery: TerminalSupportRecovery;
  syncEvidence: TerminalSyncEvidence;
  terminalIdentity: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    terminalStatus: Doc<"posTerminal">["status"];
  };
};

export type TerminalOperationalPolicyInput = {
  appUpdate: TerminalRecoveryPreview["appUpdate"];
  activeRegisterSession?: Doc<"registerSession"> | null;
  attentionReasons?: TerminalHealthAttentionReason[];
  cloudRepair: TerminalRecoveryPreview["cloudRepair"];
  commandStatus: TerminalRecoveryPreview["commandStatus"];
  drawerAuthorityRegisterSession?: Doc<"registerSession"> | null;
  latestCloudRegisterSessionStatus?: Doc<"registerSession">["status"];
  latestRegisterSession?: Doc<"registerSession"> | null;
  runtimeStatus: Doc<"posTerminalRuntimeStatus"> | null;
  runtimeAgeMs: number | null;
  runtimeFresh: boolean;
  storeId: Id<"store">;
  syncEvidence: TerminalSyncEvidence;
  terminalId: Id<"posTerminal">;
  terminalStatus: Doc<"posTerminal">["status"];
};
