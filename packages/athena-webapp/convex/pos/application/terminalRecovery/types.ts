import type { Doc, Id } from "../../../_generated/dataModel";

export const TERMINAL_RECOVERY_COMMAND_TYPES = [
  "retry_sync",
  "repair_terminal_seed",
  "clear_stale_drawer_authority",
  "refresh_staff_authority",
  "refresh_snapshots",
  "report_diagnostics",
] as const;

export type TerminalRecoveryCommandType =
  (typeof TERMINAL_RECOVERY_COMMAND_TYPES)[number];

export type TerminalRecoveryReadiness =
  | "healthy_idle"
  | "able_to_transact_now"
  | "needs_cloud_repair"
  | "needs_terminal_action"
  | "needs_manual_review";

export type TerminalRecoveryCommandStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "failed"
  | "precondition_failed"
  | "expired"
  | "superseded";

export type TerminalRecoveryVerificationStatus =
  | "waiting_for_acknowledgement"
  | "runtime_verification_ready"
  | "verified"
  | "verification_failed";

export type TerminalRecoveryCommandPayload = {
  cloudRegisterSessionId?: string;
  expectedBlockerType?: string;
  expectedConflictIds?: Array<Id<"posLocalSyncConflict">>;
  expectedTerminalSeedIdentity?: string;
  localRegisterSessionId?: string;
  reason?: string;
};

export type TerminalRecoveryExpectedEvidence = {
  drawerAuthorityStatus?: "healthy" | "blocked";
  localRegisterSessionId?: string;
  localStoreAvailable?: boolean;
  saleAuthorityStatus?: "ready" | "missing" | "blocked" | "unknown";
  staffAuthorityStatus?: "ready" | "missing" | "expired" | "unknown";
  syncStatus?: Doc<"posTerminalRuntimeStatus">["sync"]["status"];
  terminalIntegrityStatus?: NonNullable<
    Doc<"posTerminalRuntimeStatus">["terminalIntegrity"]
  >["status"];
  terminalSeedReady?: boolean;
};

export type TerminalRecoveryCommandAckResult =
  | "completed"
  | "failed"
  | "precondition_failed";
