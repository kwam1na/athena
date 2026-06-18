import { v } from "convex/values";

export const posTerminalRecoveryCommandTypeValidator = v.union(
  v.literal("retry_sync"),
  v.literal("repair_terminal_seed"),
  v.literal("clear_stale_drawer_authority"),
  v.literal("refresh_staff_authority"),
  v.literal("refresh_snapshots"),
  v.literal("report_diagnostics"),
  v.literal("update_app"),
);

export const posTerminalRecoveryCommandStatusValidator = v.union(
  v.literal("pending"),
  v.literal("claimed"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("precondition_failed"),
  v.literal("expired"),
  v.literal("superseded"),
);

export const posTerminalRecoveryVerificationStatusValidator = v.union(
  v.literal("waiting_for_acknowledgement"),
  v.literal("runtime_verification_ready"),
  v.literal("verified"),
  v.literal("verification_failed"),
);

export const posTerminalRecoveryCommandPayloadValidator = v.object({
  cloudRegisterSessionId: v.optional(v.string()),
  expectedBlockerType: v.optional(v.string()),
  expectedConflictIds: v.optional(v.array(v.id("posLocalSyncConflict"))),
  expectedTerminalSeedIdentity: v.optional(v.string()),
  localRegisterSessionId: v.optional(v.string()),
  reason: v.optional(v.string()),
});

export const posTerminalRecoveryExpectedEvidenceValidator = v.object({
  appUpdateCommandExecutionId: v.optional(v.string()),
  appUpdateStatus: v.optional(
    v.union(
      v.literal("current"),
      v.literal("update_ready"),
      v.literal("update_ready_unstaged"),
      v.literal("blocked"),
      v.literal("applying"),
      v.literal("detector_failed"),
      v.literal("unknown"),
    ),
  ),
  drawerAuthorityStatus: v.optional(v.union(v.literal("healthy"), v.literal("blocked"))),
  localRegisterSessionId: v.optional(v.string()),
  localStoreAvailable: v.optional(v.boolean()),
  saleAuthorityStatus: v.optional(
    v.union(
      v.literal("ready"),
      v.literal("missing"),
      v.literal("blocked"),
      v.literal("unknown"),
    ),
  ),
  staffAuthorityStatus: v.optional(
    v.union(
      v.literal("ready"),
      v.literal("missing"),
      v.literal("expired"),
      v.literal("unknown"),
    ),
  ),
  syncStatus: v.optional(
    v.union(
      v.literal("idle"),
      v.literal("pending"),
      v.literal("syncing"),
      v.literal("failed"),
      v.literal("needs_review"),
      v.literal("unavailable"),
      v.literal("unknown"),
    ),
  ),
  terminalIntegrityStatus: v.optional(
    v.union(
      v.literal("healthy"),
      v.literal("repairing"),
      v.literal("requires_reprovision"),
      v.literal("reset_required"),
    ),
  ),
  terminalSeedReady: v.optional(v.boolean()),
});

export const posTerminalRecoveryCommandAckValidator = v.object({
  acknowledgedAt: v.number(),
  message: v.optional(v.string()),
  result: v.union(
    v.literal("completed"),
    v.literal("failed"),
    v.literal("precondition_failed"),
  ),
});

export const posTerminalRecoveryCommandSchema = v.object({
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  commandType: posTerminalRecoveryCommandTypeValidator,
  status: posTerminalRecoveryCommandStatusValidator,
  verificationStatus: posTerminalRecoveryVerificationStatusValidator,
  commandContext: posTerminalRecoveryCommandPayloadValidator,
  expectedEvidence: posTerminalRecoveryExpectedEvidenceValidator,
  issuedByUserId: v.id("athenaUser"),
  issuedAt: v.number(),
  expiresAt: v.number(),
  claimedAt: v.optional(v.number()),
  executionId: v.optional(v.string()),
  acknowledgement: v.optional(posTerminalRecoveryCommandAckValidator),
  verifiedAt: v.optional(v.number()),
});
