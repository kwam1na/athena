import { v } from "convex/values";

import { mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { commandResultValidator } from "../../lib/commandResultValidators";
import { registerTerminalOperationDefinition } from "../../operationAdmission/definitions";
import { admitSharedDemoPublicMutation } from "../../operationAdmission/publicMutation";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import { requireStoreMemberAccessWithCtx } from "../../lib/storeMemberAccess";
import { ok, userError } from "../../../shared/commandResult";
import {
  acknowledgeRegisterLifecycleAuthority as acknowledgeRegisterLifecycleAuthorityService,
} from "../application/commands/registerLifecycleAuthority";
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
  previewTerminalRecovery as previewTerminalRecoveryQuery,
} from "../application/queries/terminals";
import {
  getRegisterLifecycleAuthority as getRegisterLifecycleAuthorityQuery,
  getRegisterLifecycleAuthorityAcknowledgement as getRegisterLifecycleAuthorityAcknowledgementQuery,
  getRegisterLifecycleAuthorityShadow as getRegisterLifecycleAuthorityShadowQuery,
  isValidRegisterLifecycleAuthorityCandidates,
} from "../application/queries/registerLifecycleAuthority";
import { hashPosTerminalSyncSecret } from "../application/sync/terminalSyncSecret";
import { resolveTerminalCloudRepair as resolveTerminalCloudRepairCommand } from "../application/terminalRecovery/resolveTerminalCloudRepair";
import {
  acknowledgeTerminalRecoveryCommand as acknowledgeTerminalRecoveryCommandService,
  claimTerminalRecoveryCommand as claimTerminalRecoveryCommandService,
  issueTerminalRecoveryCommand as issueTerminalRecoveryCommandService,
  listClaimableTerminalRecoveryCommands,
} from "../application/terminalRecovery/terminalCommandService";
import type { TerminalRecoveryPreview } from "../application/terminalOperationalState/types";
import { runAcceptedRuntimeStatusSideEffects } from "../application/terminalRuntime/postRuntimeStatusSideEffects";
import {
  createTerminalRecoveryCommandReadRepository,
  createTerminalRecoveryCommandRepository,
} from "../infrastructure/repositories/terminalRecoveryRepository";
import { getLatestRuntimeStatusForTerminal } from "../infrastructure/repositories/terminalRepository";
import {
  disconnectRemoteAssistRuntimeSession,
} from "../../remoteAssist/application/sessionService";
import { createRemoteAssistReadRepository } from "../../remoteAssist/infrastructure/remoteAssistReadRepository";
import { createRemoteAssistRepository } from "../../remoteAssist/infrastructure/remoteAssistRepository";
import {
  posTerminalRecoveryCommandPayloadValidator,
  posTerminalRecoveryCommandStatusValidator,
  posTerminalRecoveryCommandTypeValidator,
  posTerminalRecoveryExpectedEvidenceValidator,
  posTerminalRecoveryLocalReviewEventValidator,
  posTerminalRecoveryVerificationStatusValidator,
} from "../../schemas/pos/posTerminalRecovery";
import {
  posRegisterAuthorityReplicationOutcomeValidator,
  posRegisterAuthorityReplicationRolloutCohortValidator,
  posRegisterAuthorityReplicationRolloutModeValidator,
} from "../../schemas/pos/posRegisterAuthorityReplicationStatus";
import {
  posTerminalRuntimeActiveRegisterSessionValidator,
  posTerminalRuntimeAppSessionRecoveryValidator,
  posTerminalRuntimeAppShellValidator,
  posTerminalRuntimeAppUpdateValidator,
  posTerminalRuntimeBrowserInfoValidator,
  posTerminalRuntimeDrawerAuthorityReasonValidator,
  posTerminalRuntimeDrawerAuthorityValidator,
  posTerminalRuntimeLocalStoreValidator,
  posTerminalRuntimeSaleAuthorityValidator,
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

const transactionCapabilityValidator = v.union(
  v.literal("products_and_services"),
  v.literal("products_only"),
  v.literal("services_only"),
);

const loginModeValidator = v.union(
  v.literal("standard"),
  v.literal("pos_only"),
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
  heartbeatEnabled: v.optional(v.boolean()),
  registerNumber: v.optional(v.string()),
  loginMode: v.optional(loginModeValidator),
  transactionCapability: v.optional(transactionCapabilityValidator),
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
  heartbeatEnabled: v.optional(v.boolean()),
  registerNumber: v.optional(v.string()),
  loginMode: v.optional(loginModeValidator),
  transactionCapability: v.optional(transactionCapabilityValidator),
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
  appSessionRecovery: v.optional(
    posTerminalRuntimeAppSessionRecoveryValidator,
  ),
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
  runtimeCounters: v.optional(v.record(v.string(), v.number())),
});

const runtimeStatusWriteResultValidator = v.object({
  activeRegisterSessionDirective: v.optional(
    v.object({
      cloudRegisterSessionId: v.string(),
      expectedCash: v.number(),
      localRegisterSessionId: v.string(),
      observedAt: v.number(),
      openedAt: v.number(),
      openingFloat: v.number(),
      registerNumber: v.optional(v.string()),
      staffProfileId: v.optional(v.id("staffProfile")),
      status: v.literal("active"),
    }),
  ),
  drawerAuthorityDirective: v.optional(
    v.object({
      cloudRegisterSessionId: v.optional(v.string()),
      localRegisterSessionId: v.string(),
      message: v.optional(v.string()),
      observedAt: v.number(),
      reason: v.optional(posTerminalRuntimeDrawerAuthorityReasonValidator),
      registerNumber: v.optional(v.string()),
      status: v.union(v.literal("healthy"), v.literal("blocked")),
    }),
  ),
  terminalId: v.id("posTerminal"),
  reportedAt: v.number(),
  receivedAt: v.number(),
});

const terminalRemoteAssistSessionReturnValidator = v.object({
  _id: v.id("remoteAssistSession"),
  effectiveMode: v.union(v.literal("attended"), v.literal("unattended")),
  sensitiveModeActive: v.boolean(),
  status: v.union(
    v.literal("pending_attended_approval"),
    v.literal("connecting"),
    v.literal("active"),
    v.literal("ended"),
    v.literal("expired"),
    v.literal("denied"),
  ),
});

const runtimeStatusSnapshotReturnValidator = v.object({
  ...runtimeStatusInputValidator.fields,
  receivedAt: v.number(),
});

const registerLifecycleAuthorityCandidateValidator = v.object({
  cloudRegisterSessionId: v.optional(v.string()),
  localRegisterSessionId: v.string(),
});

const registerLifecycleAuthorityShadowReturnValidator = v.object({
  candidateCount: v.number(),
  maximumDocumentReads: v.number(),
  mode: v.literal("shadow"),
  results: v.array(
    v.object({
      classification: v.union(
        v.literal("unmapped"),
        v.literal("sale_usable"),
        v.literal("sale_blocked"),
        v.literal("stale_cloud_subject"),
        v.literal("repair_required"),
      ),
      cloudRegisterSessionId: v.optional(v.string()),
      cloudStatus: v.optional(
        v.union(
          v.literal("open"),
          v.literal("active"),
          v.literal("closing"),
          v.literal("closeout_rejected"),
          v.literal("closed"),
        ),
      ),
      localRegisterSessionId: v.string(),
    }),
  ),
});

const registerLifecycleAuthorityReturnValidator = v.object({
  bootstrap: v.optional(
    v.object({
      authorityCursor: v.object({
        lifecycleRevision: v.number(),
        mappingAuthorityRevision: v.number(),
      }),
      classification: v.literal("sale_usable"),
      cloudRegisterSessionId: v.string(),
      cloudStatus: v.union(v.literal("open"), v.literal("active")),
      expectedCash: v.number(),
      lifecycleRevision: v.number(),
      localRegisterSessionId: v.string(),
      mappingAuthorityRevision: v.number(),
      openedAt: v.number(),
      openingFloat: v.number(),
      registerNumber: v.optional(v.string()),
      staffProfileId: v.optional(v.id("staffProfile")),
    }),
  ),
  candidateCount: v.number(),
  maximumDocumentReads: v.number(),
  results: v.array(
    v.object({
      authorityCursor: v.object({
        lifecycleRevision: v.number(),
        mappingAuthorityRevision: v.number(),
      }),
      classification: v.union(
        v.literal("unmapped"),
        v.literal("sale_usable"),
        v.literal("sale_blocked"),
        v.literal("stale_cloud_subject"),
        v.literal("repair_required"),
      ),
      cloudRegisterSessionId: v.optional(v.string()),
      cloudStatus: v.optional(
        v.union(
          v.literal("open"),
          v.literal("active"),
          v.literal("closing"),
          v.literal("closeout_rejected"),
          v.literal("closed"),
        ),
      ),
      lifecycleRevision: v.number(),
      localRegisterSessionId: v.string(),
      mappingAuthorityRevision: v.number(),
    }),
  ),
});

const registerLifecycleAuthorityAcknowledgementReturnValidator = v.object({
  accepted: v.literal(true),
  coalesced: v.boolean(),
});

const registerLifecycleAuthorityAcknowledgementInspectionReturnValidator =
  v.object({
    appVersion: v.optional(v.string()),
    buildSha: v.optional(v.string()),
    cloudRegisterSessionId: v.optional(v.string()),
    lifecycleRevision: v.number(),
    localRegisterSessionId: v.string(),
    mappingAuthorityRevision: v.number(),
    outcome: posRegisterAuthorityReplicationOutcomeValidator,
    receivedAt: v.number(),
    rolloutCohort: posRegisterAuthorityReplicationRolloutCohortValidator,
    rolloutMode: posRegisterAuthorityReplicationRolloutModeValidator,
    terminalId: v.id("posTerminal"),
  });

const terminalSyncReviewTargetReturnValidator = v.object({
  type: v.literal("open_work"),
  workItemId: v.id("operationalWorkItem"),
  workItemType: v.literal("synced_sale_inventory_review"),
});

const terminalSyncReviewSummaryReturnValidator = v.object({
  groups: v.array(
    v.object({
      actionTarget: v.optional(
        v.object({
          type: v.literal("register_session"),
          registerSessionId: v.id("registerSession"),
        }),
      ),
      actionability: v.union(
        v.literal("cash_controls_review"),
        v.literal("diagnostic_only"),
        v.literal("manual_review"),
        v.literal("open_work_review"),
      ),
      conflictType: v.string(),
      count: v.number(),
      latestCreatedAt: v.number(),
      latestSequence: v.number(),
      owner: v.union(
        v.literal("cash_controls"),
        v.literal("diagnostic"),
        v.literal("manual_review"),
        v.literal("operations_open_work"),
      ),
      reviewTarget: v.optional(terminalSyncReviewTargetReturnValidator),
    }),
  ),
  meta: v.object({
    sampledCount: v.number(),
    cap: v.number(),
    hasMore: v.boolean(),
    targetResolutionIncomplete: v.boolean(),
  }),
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
  latestReviewEventsByStatus: v.optional(v.object({
    conflicted: v.optional(v.union(
      v.object({
        localEventId: v.string(),
        localRegisterSessionId: v.string(),
        sequence: v.number(),
        eventType: v.string(),
        status: v.string(),
      }),
      v.null(),
    )),
    held: v.optional(v.union(
      v.object({
        localEventId: v.string(),
        localRegisterSessionId: v.string(),
        sequence: v.number(),
        eventType: v.string(),
        status: v.string(),
      }),
      v.null(),
    )),
    rejected: v.optional(v.union(
      v.object({
        localEventId: v.string(),
        localRegisterSessionId: v.string(),
        sequence: v.number(),
        eventType: v.string(),
        status: v.string(),
      }),
      v.null(),
    )),
  })),
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
    reviewTarget: v.optional(terminalSyncReviewTargetReturnValidator),
    sequence: v.number(),
    summary: v.string(),
  }))),
  reviewSummary: terminalSyncReviewSummaryReturnValidator,
  acceptedThroughSequence: v.optional(v.number()),
  cursorUpdatedAt: v.optional(v.number()),
});

const terminalHealthActionTargetReturnValidator = v.union(
  v.object({
    type: v.literal("cash_control_register_session"),
    automaticRepairEligible: v.optional(v.boolean()),
    registerSessionId: v.id("registerSession"),
  }),
  v.object({
    type: v.literal("open_work"),
    label: v.optional(v.string()),
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
    v.literal("synced_sale_inventory_review"),
    v.literal("local_review"),
    v.literal("local_store_unavailable"),
    v.literal("sync_failed"),
    v.literal("sync_unavailable"),
    v.literal("terminal_authorization_failed"),
    v.literal("drawer_authority_blocked"),
    v.literal("terminal_seed_missing"),
  ),
});

const terminalOperationalExplanationReturnValidator = v.object({
  blockingDomain: v.union(
    v.literal("cloud_repair"),
    v.literal("manual_review"),
    v.literal("none"),
    v.literal("sync_review"),
    v.literal("terminal_runtime"),
  ),
  detail: v.string(),
  evidenceReferences: v.array(
    v.object({
      count: v.optional(v.number()),
      source: v.union(
        v.literal("cloud_repair"),
        v.literal("cloud_register_lifecycle"),
        v.literal("local_runtime"),
        v.literal("recovery_command"),
        v.literal("sync_evidence"),
        v.literal("cloud_sync"),
        v.literal("terminal_runtime"),
      ),
      summary: v.string(),
      type: v.string(),
    }),
  ),
  headline: v.string(),
  lane: v.union(
    v.literal("able_to_transact_now"),
    v.literal("drawer_open"),
    v.literal("healthy_idle"),
    v.literal("needs_cloud_repair"),
    v.literal("needs_manual_review"),
    v.literal("needs_terminal_action"),
    v.literal("sale_ready_with_review_backlog"),
    v.literal("stale_runtime"),
    v.literal("unknown"),
  ),
  nextStep: v.string(),
  primaryOwner: v.union(
    v.literal("cash_controls"),
    v.literal("manager"),
    v.literal("none"),
    v.literal("operations"),
    v.literal("support"),
    v.literal("terminal"),
  ),
  saleImpact: v.union(
    v.literal("can_transact_now"),
    v.literal("not_ready"),
    v.literal("unknown"),
  ),
  secondaryActions: v.array(
    v.object({
      label: v.string(),
      primaryOwner: v.union(
        v.literal("cash_controls"),
        v.literal("manager"),
        v.literal("operations"),
        v.literal("support"),
        v.literal("terminal"),
      ),
      supportAction: v.union(
        v.literal("manual_review"),
        v.literal("safe_cloud_repair"),
        v.literal("terminal_command"),
        v.literal("terminal_sync_retry"),
      ),
    }),
  ),
  severity: v.union(
    v.literal("critical"),
    v.literal("info"),
    v.literal("warning"),
  ),
  summaryMeta: v.object({
    hasSecondarySafeRepair: v.boolean(),
    reviewBacklogCount: v.number(),
    targetResolutionIncomplete: v.boolean(),
  }),
  supportAction: v.union(
    v.literal("manual_review"),
    v.literal("none"),
    v.literal("safe_cloud_repair"),
    v.literal("terminal_command"),
    v.literal("terminal_sync_retry"),
    v.literal("wait_for_check_in"),
  ),
});

const terminalAppUpdatePreviewReturnValidator = v.object({
  commandCorrelated: v.optional(v.boolean()),
  currentBuildId: v.optional(v.string()),
  evidenceFresh: v.boolean(),
  observedAt: v.optional(v.number()),
  pendingBuildId: v.optional(v.string()),
  stagingAssetCount: v.optional(v.number()),
  stagingFailedAssetCount: v.optional(v.number()),
  stagingReason: v.optional(v.string()),
  stagingRejectedAssetCount: v.optional(v.number()),
  stagingStatus: v.optional(v.string()),
  status: v.union(
    v.literal("applying"),
    v.literal("blocked"),
    v.literal("current"),
    v.literal("detector_failed"),
    v.literal("stale"),
    v.literal("unknown"),
    v.literal("update_ready"),
    v.literal("update_ready_unstaged"),
  ),
  summary: v.optional(v.string()),
});

const terminalRegistrationSummaryReturnValidator = v.object({
  _id: v.id("posTerminal"),
  displayName: v.string(),
  heartbeatEnabled: v.optional(v.boolean()),
  registerNumber: v.optional(v.string()),
  loginMode: v.optional(loginModeValidator),
  transactionCapability: v.optional(transactionCapabilityValidator),
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
  operationalExplanation: terminalOperationalExplanationReturnValidator,
  recoveryPreview: v.union(
    v.object({
      readiness: v.union(
        v.literal("healthy_idle"),
        v.literal("drawer_open"),
        v.literal("able_to_transact_now"),
        v.literal("needs_cloud_repair"),
        v.literal("needs_terminal_action"),
        v.literal("needs_manual_review"),
      ),
      runtimeFresh: v.boolean(),
      evidence: v.object({
        activeRegisterSession: v.boolean(),
        freshRuntimeRequiredForAbleToTransactNow: v.literal(true),
      }),
      appUpdate: terminalAppUpdatePreviewReturnValidator,
      cloudRepair: v.object({
        preconditionHash: v.string(),
        safeConflictIds: v.array(v.id("posLocalSyncConflict")),
        skippedConflictIds: v.array(v.id("posLocalSyncConflict")),
      }),
      commandStatus: v.union(
        v.object({
          appUpdateCommandExecutionId: v.optional(v.string()),
          commandId: v.optional(v.id("posTerminalRecoveryCommand")),
          commandType: posTerminalRecoveryCommandTypeValidator,
          label: v.string(),
          latestAcknowledgement: v.optional(v.string()),
          localReviewEvents: v.optional(
            v.array(posTerminalRecoveryLocalReviewEventValidator),
          ),
          status: posTerminalRecoveryCommandStatusValidator,
          verificationStatus: posTerminalRecoveryVerificationStatusValidator,
        }),
        v.null(),
      ),
      terminalActions: v.array(
        v.object({
          commandType: posTerminalRecoveryCommandTypeValidator,
          expectedEvidence: posTerminalRecoveryExpectedEvidenceValidator,
          commandContext: posTerminalRecoveryCommandPayloadValidator,
          reason: v.string(),
        }),
      ),
      manualReview: v.array(
        v.object({
          reason: v.string(),
          source: v.union(
            v.literal("cloud_sync"),
            v.literal("local_runtime"),
            v.literal("terminal_runtime"),
            v.literal("cloud_repair"),
          ),
          type: v.string(),
        }),
      ),
    }),
    v.null(),
  ),
  registerSessionLink: v.union(
    v.object({
      registerSessionId: v.id("registerSession"),
      status: v.union(
        v.literal("open"),
        v.literal("active"),
      ),
    }),
    v.null(),
  ),
  syncEvidence: terminalSyncEvidenceReturnValidator,
});

const terminalRecoveryCommandReturnValidator = v.object({
  _id: v.id("posTerminalRecoveryCommand"),
  _creationTime: v.number(),
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
  acknowledgement: v.optional(
    v.object({
      acknowledgedAt: v.number(),
      clearedLocalReviewEventIds: v.optional(v.array(v.string())),
      localReviewEvents: v.optional(
        v.array(posTerminalRecoveryLocalReviewEventValidator),
      ),
      message: v.optional(v.string()),
      result: v.union(
        v.literal("completed"),
        v.literal("failed"),
        v.literal("precondition_failed"),
      ),
    }),
  ),
  verifiedAt: v.optional(v.number()),
});

const terminalCloudRepairResultValidator = v.object({
  preconditionHash: v.string(),
  resolvedConflictIds: v.array(v.id("posLocalSyncConflict")),
  skippedConflictIds: v.array(v.id("posLocalSyncConflict")),
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
    appSessionRecovery: status.appSessionRecovery
      ? {
          status: status.appSessionRecovery.status,
        }
      : undefined,
    appShell: status.appShell
      ? {
          observedAt: status.appShell.observedAt,
          ready: status.appShell.ready,
        }
      : undefined,
    appUpdate: status.appUpdate
      ? {
          blockerSummary:
            status.appUpdate.blockerSummary ??
            status.appUpdate.selectedBlockerCode,
          canApply: status.appUpdate.canApply,
          commandExecutionId: status.appUpdate.commandExecutionId,
          commandId: status.appUpdate.commandId,
          commandIssuedAt: status.appUpdate.commandIssuedAt,
          commandNonce: status.appUpdate.commandNonce,
          currentBuildId: status.appUpdate.currentBuildId,
          detectorStatus: status.appUpdate.detectorStatus,
          observedAt: status.appUpdate.observedAt,
          pendingBuildId: status.appUpdate.pendingBuildId,
          selectedBlockerCode: status.appUpdate.selectedBlockerCode,
          stagingAssetCount: status.appUpdate.stagingAssetCount,
          stagingFailedAssetCount: status.appUpdate.stagingFailedAssetCount,
          stagingReason: status.appUpdate.stagingReason,
          stagingRejectedAssetCount: status.appUpdate.stagingRejectedAssetCount,
          stagingStatus: status.appUpdate.stagingStatus,
          status: status.appUpdate.status,
        }
      : undefined,
    localStore: {
      available: status.localStore.available,
      schemaVersion: status.localStore.schemaVersion,
      terminalSeedReady: status.localStore.terminalSeedReady,
      failureMessage: status.localStore.failureMessage,
      engineReadiness: status.localStore.engineReadiness,
      healthFreshness: status.localStore.healthFreshness,
      healthObservedAt: status.localStore.healthObservedAt,
      lastSuccessfulDurableCommitAt:
        status.localStore.lastSuccessfulDurableCommitAt,
      ledgerPressure: status.localStore.ledgerPressure,
      maintenance: status.localStore.maintenance,
      migration: status.localStore.migration,
      persistence: status.localStore.persistence,
      pressure: status.localStore.pressure,
      quotaBytes: status.localStore.quotaBytes,
      usageBytes: status.localStore.usageBytes,
    },
    sync: {
      status: status.sync.status,
      pendingEventCount: status.sync.pendingEventCount,
      uploadableEventCount: status.sync.uploadableEventCount,
      failedEventCount: status.sync.failedEventCount,
      reviewEventCount: status.sync.reviewEventCount,
      localOnlyEventCount: status.sync.localOnlyEventCount,
      reviewEvents: stripRuntimeReviewEvents(status.sync.reviewEvents),
      oldestPendingEventAt: status.sync.oldestPendingEventAt,
      nextPendingUploadSequence: status.sync.nextPendingUploadSequence,
      lastSyncedSequence: status.sync.lastSyncedSequence,
      lastTrigger: status.sync.lastTrigger,
      lastFailureMessage: status.sync.lastFailureMessage,
      backoffUntil: status.sync.backoffUntil,
      heldEventCount: status.sync.heldEventCount,
      heldWithoutProgress: status.sync.heldWithoutProgress,
    },
    runtimeCounters: status.runtimeCounters,
    staffAuthority: {
      status: status.staffAuthority.status,
      staffProfileId: status.staffAuthority.staffProfileId,
      expiresAt: status.staffAuthority.expiresAt,
    },
    saleAuthority: status.saleAuthority
      ? {
          observedAt: status.saleAuthority.observedAt,
          status: status.saleAuthority.status,
          localPosSessionId: status.saleAuthority.localPosSessionId,
          localRegisterSessionId: status.saleAuthority.localRegisterSessionId,
          staffProfileId: status.saleAuthority.staffProfileId,
          transactionMode: status.saleAuthority.transactionMode,
        }
      : undefined,
    activeRegisterSession: status.activeRegisterSession
      ? {
          cloudRegisterSessionId:
            status.activeRegisterSession.cloudRegisterSessionId,
          localRegisterSessionId:
            status.activeRegisterSession.localRegisterSessionId,
          observedAt: status.activeRegisterSession.observedAt,
          openedAt: status.activeRegisterSession.openedAt,
          registerNumber: status.activeRegisterSession.registerNumber,
          status: status.activeRegisterSession.status,
        }
      : undefined,
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
      serviceCatalogAgeMs: status.snapshots.serviceCatalogAgeMs,
      availabilityAgeMs: status.snapshots.availabilityAgeMs,
      registerReadModelAgeMs: status.snapshots.registerReadModelAgeMs,
    },
  };
}

function stripRuntimeReviewEvents(
  reviewEvents: TerminalRuntimeStatusInput["sync"]["reviewEvents"],
) {
  return reviewEvents?.map((event) => ({
    createdAt: event.createdAt,
    localEventId: event.localEventId,
    ...(event.localPosSessionId
      ? { localPosSessionId: event.localPosSessionId }
      : {}),
    ...(event.localRegisterSessionId
      ? { localRegisterSessionId: event.localRegisterSessionId }
      : {}),
    sequence: event.sequence,
    status: event.status,
    type: event.type,
    ...(event.uploaded !== undefined ? { uploaded: event.uploaded } : {}),
    ...(typeof event.uploadSequence === "number"
      ? { uploadSequence: event.uploadSequence }
      : {}),
  }));
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

async function requireActiveTerminalSyncSecret(
  ctx: Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">,
  args: {
    storeId: Id<"store">;
    syncSecretHash: string;
    terminalId: Id<"posTerminal">;
  },
) {
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
    return null;
  }
  return terminal;
}

export const listTerminals = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.array(terminalReturnValidator),
  handler: async (ctx, args) => {
    await requireStoreMemberAccessWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      demoAccess: { kind: "read" },
      failureMessage: "You do not have access to view POS terminals.",
      storeId: args.storeId,
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
    await requireStoreMemberAccessWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      demoAccess: { kind: "read" },
      failureMessage: "You do not have access to view POS terminals.",
      storeId: args.storeId,
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
    await requireStoreMemberAccessWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      demoAccess: { kind: "read" },
      failureMessage: "You do not have access to view POS terminal health.",
      storeId: args.storeId,
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
    await requireStoreMemberAccessWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      demoAccess: { kind: "read" },
      failureMessage: "You do not have access to view POS terminal health.",
      storeId: args.storeId,
    });
    return getTerminalHealthSummaryQuery(ctx, args);
  },
});

export const getRegisterLifecycleAuthorityAcknowledgement = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
  },
  returns: v.union(
    registerLifecycleAuthorityAcknowledgementInspectionReturnValidator,
    v.null(),
  ),
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireTerminalStoreAccess(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage:
        "You do not have access to view POS terminal authority replication.",
      storeId: args.storeId,
      userId: athenaUser._id,
    });
    return getRegisterLifecycleAuthorityAcknowledgementQuery(ctx, args);
  },
});

export const previewTerminalRecovery = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
  },
  returns: terminalHealthSummaryReturnValidator.fields.recoveryPreview,
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireTerminalStoreAccess(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You do not have access to view POS terminal recovery.",
      storeId: args.storeId,
      userId: athenaUser._id,
    });
    return previewTerminalRecoveryQuery(ctx, args);
  },
});

export const listTerminalHealth = listTerminalHealthSummaries;
export const getTerminalHealthDetail = getTerminalHealthSummary;

export const getTerminalRuntimeConfig = query({
  args: {
    storeId: v.id("store"),
    syncSecretHash: v.string(),
    terminalId: v.id("posTerminal"),
  },
  returns: v.union(
    v.object({
      heartbeatEnabled: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const terminal = await requireActiveTerminalSyncSecret(ctx, {
      storeId: args.storeId,
      syncSecretHash: args.syncSecretHash,
      terminalId: args.terminalId,
    });
    if (!terminal) {
      return null;
    }

    return {
      heartbeatEnabled: terminal.heartbeatEnabled !== false,
    };
  },
});

export const getRegisterLifecycleAuthorityShadow = query({
  args: {
    candidates: v.array(registerLifecycleAuthorityCandidateValidator),
    storeId: v.id("store"),
    syncSecretHash: v.string(),
    terminalId: v.id("posTerminal"),
  },
  returns: v.union(registerLifecycleAuthorityShadowReturnValidator, v.null()),
  handler: async (ctx, args) => {
    if (!isValidRegisterLifecycleAuthorityCandidates(args.candidates)) {
      return null;
    }

    const terminal = await requireActiveTerminalSyncSecret(ctx, {
      storeId: args.storeId,
      syncSecretHash: args.syncSecretHash,
      terminalId: args.terminalId,
    });
    if (!terminal) return null;

    return getRegisterLifecycleAuthorityShadowQuery(ctx, {
      candidates: args.candidates,
      storeId: args.storeId,
      terminal,
    });
  },
});

export const getRegisterLifecycleAuthority = query({
  args: {
    candidates: v.array(registerLifecycleAuthorityCandidateValidator),
    storeId: v.id("store"),
    syncSecretHash: v.string(),
    terminalId: v.id("posTerminal"),
  },
  returns: v.union(registerLifecycleAuthorityReturnValidator, v.null()),
  handler: async (ctx, args) => {
    if (!isValidRegisterLifecycleAuthorityCandidates(args.candidates)) {
      return null;
    }

    const terminal = await requireActiveTerminalSyncSecret(ctx, {
      storeId: args.storeId,
      syncSecretHash: args.syncSecretHash,
      terminalId: args.terminalId,
    });
    if (!terminal) return null;

    return getRegisterLifecycleAuthorityQuery(ctx, {
      candidates: args.candidates,
      storeId: args.storeId,
      terminal,
    });
  },
});

export const acknowledgeRegisterLifecycleAuthority = mutation({
  args: {
    appVersion: v.optional(v.string()),
    buildSha: v.optional(v.string()),
    cloudRegisterSessionId: v.optional(v.string()),
    lifecycleRevision: v.number(),
    localRegisterSessionId: v.string(),
    mappingAuthorityRevision: v.number(),
    outcome: posRegisterAuthorityReplicationOutcomeValidator,
    rolloutCohort: posRegisterAuthorityReplicationRolloutCohortValidator,
    rolloutMode: posRegisterAuthorityReplicationRolloutModeValidator,
    storeId: v.id("store"),
    syncSecretHash: v.string(),
    terminalId: v.id("posTerminal"),
  },
  returns: v.union(
    registerLifecycleAuthorityAcknowledgementReturnValidator,
    v.null(),
  ),
  handler: async (ctx, args) => {
    const terminal = await requireActiveTerminalSyncSecret(ctx, {
      storeId: args.storeId,
      syncSecretHash: args.syncSecretHash,
      terminalId: args.terminalId,
    });
    if (!terminal) return null;

    try {
      const result = await acknowledgeRegisterLifecycleAuthorityService(ctx, {
        appVersion: args.appVersion,
        buildSha: args.buildSha,
        cloudRegisterSessionId: args.cloudRegisterSessionId,
        lifecycleRevision: args.lifecycleRevision,
        localRegisterSessionId: args.localRegisterSessionId,
        mappingAuthorityRevision: args.mappingAuthorityRevision,
        outcome: args.outcome,
        rolloutCohort: args.rolloutCohort,
        rolloutMode: args.rolloutMode,
        storeId: args.storeId,
        terminal,
      });
      return result.status === "accepted"
        ? { accepted: true as const, coalesced: result.coalesced }
        : null;
    } catch {
      return null;
    }
  },
});

export const submitTerminalRuntimeStatus = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    syncSecretHash: v.string(),
    status: runtimeStatusInputValidator,
  },
  returns: commandResultValidator(runtimeStatusWriteResultValidator),
  handler: async (ctx, args) => {
    const terminal = await requireActiveTerminalSyncSecret(ctx, {
      storeId: args.storeId,
      syncSecretHash: args.syncSecretHash,
      terminalId: args.terminalId,
    });
    if (!terminal) {
      return userError({
        code: "authorization_failed",
        message: "You do not have access to update this POS terminal status.",
        metadata: { terminalAuthorizationFailure: true },
      });
    }

    const safeStatus = stripRuntimeStatusInput(args.status);
    const result = await submitTerminalRuntimeStatusCommand(ctx, {
      storeId: args.storeId,
      terminalId: args.terminalId,
      trustedTerminal: terminal,
      status: safeStatus,
    });
    if (result.kind !== "ok") {
      return result;
    }

    const {
      acceptedForSideEffects,
      recoveryVerificationCursor,
      runtimeStatusId,
      ...runtimeStatusWriteResult
    } = result.data;
    if (acceptedForSideEffects !== false) {
      await runAcceptedRuntimeStatusSideEffects({
        ctx,
        receivedAt: result.data.receivedAt,
        recoveryVerificationCursor,
        runtimeStatus: safeStatus,
        runtimeStatusId,
        storeId: args.storeId,
        terminal,
        terminalId: args.terminalId,
      });
    }
    return ok(runtimeStatusWriteResult);
  },
});

export const reportTerminalRuntimeStatus = submitTerminalRuntimeStatus;

export const getRuntimeRemoteAssistSession = query({
  args: {
    storeId: v.id("store"),
    syncSecretHash: v.string(),
    terminalId: v.id("posTerminal"),
  },
  returns: v.union(terminalRemoteAssistSessionReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const terminal = await requireActiveTerminalSyncSecret(ctx, {
      storeId: args.storeId,
      syncSecretHash: args.syncSecretHash,
      terminalId: args.terminalId,
    });
    if (!terminal) {
      return null;
    }
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      return null;
    }
    const remoteAssistRepository = createRemoteAssistReadRepository(ctx);
    const client = await remoteAssistRepository.getClientByRuntime({
      organizationId: store.organizationId,
      runtimeIdentity: args.terminalId,
      runtimeType: "pos_terminal",
    });
    if (!client) {
      return null;
    }
    const session = await remoteAssistRepository.getCurrentSessionForClient({
      clientId: client._id,
      now: Date.now(),
    });
    return session
      ? {
          _id: session._id as Id<"remoteAssistSession">,
          effectiveMode: session.effectiveMode,
          sensitiveModeActive: session.sensitiveModeActive,
          status: session.status,
        }
      : null;
  },
});

export const disconnectRemoteAssistSession = mutation({
  args: {
    sessionId: v.id("remoteAssistSession"),
    storeId: v.id("store"),
    syncSecretHash: v.string(),
    terminalId: v.id("posTerminal"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const terminal = await requireActiveTerminalSyncSecret(ctx, {
      storeId: args.storeId,
      syncSecretHash: args.syncSecretHash,
      terminalId: args.terminalId,
    });
    if (!terminal) {
      return null;
    }
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      return null;
    }
    const remoteAssistRepository = createRemoteAssistRepository(ctx);
    const client = await remoteAssistRepository.getClientByRuntime({
      organizationId: store.organizationId,
      runtimeIdentity: args.terminalId,
      runtimeType: "pos_terminal",
    });
    const session = await remoteAssistRepository.getSession(args.sessionId);
    if (!client || !session || session.clientId !== client._id) {
      return null;
    }

    await disconnectRemoteAssistRuntimeSession(remoteAssistRepository, {
      clientId: client._id,
      now: Date.now(),
      sessionId: args.sessionId,
    });
    return null;
  },
});

export const registerTerminal = mutation({
  args: {
    storeId: v.id("store"),
    fingerprintHash: v.string(),
    syncSecretHash: v.string(),
    displayName: v.string(),
    heartbeatEnabled: v.optional(v.boolean()),
    registerNumber: v.string(),
    loginMode: v.optional(loginModeValidator),
    transactionCapability: v.optional(transactionCapabilityValidator),
    browserInfo: browserInfoValidator,
  },
  returns: commandResultValidator(terminalProvisioningReturnValidator),
  handler: admitSharedDemoPublicMutation(
    registerTerminalOperationDefinition,
    async (ctx, args) => {
    try {
      const { athenaUser, demoActor } = await requireStoreMemberAccessWithCtx(ctx, {
        allowedRoles: ["full_admin", "pos_only"],
        demoAccess: {
          capability: "daily_operations.write",
          kind: "capability",
        },
        failureMessage: "You do not have access to register this POS terminal.",
        storeId: args.storeId,
      });
      const result = await registerTerminalCommand(ctx, {
        ...args,
        allowRegisterNumberChange: Boolean(demoActor),
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
  ),
});

export const updateTerminal = mutation({
  args: {
    terminalId: v.id("posTerminal"),
    displayName: v.optional(v.string()),
    heartbeatEnabled: v.optional(v.boolean()),
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

export const resolveTerminalCloudRepair = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    expectedPreconditionHash: v.string(),
  },
  returns: commandResultValidator(terminalCloudRepairResultValidator),
  handler: async (ctx, args) => {
    try {
      const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
      await requireTerminalStoreAccess(ctx, {
        allowedRoles: ["full_admin"],
        failureMessage: "You do not have access to repair POS terminal health.",
        storeId: args.storeId,
        userId: athenaUser._id,
      });
      const terminal = await ctx.db.get("posTerminal", args.terminalId);
      if (!terminal || terminal.storeId !== args.storeId || terminal.status !== "active") {
        return userError({
          code: "precondition_failed",
          message: "This terminal is not active for this store.",
        });
      }
      return resolveTerminalCloudRepairCommand(ctx, {
        expectedPreconditionHash: args.expectedPreconditionHash,
        now: Date.now(),
        resolvedByUserId: athenaUser._id,
        storeId: args.storeId,
        terminalId: args.terminalId,
      });
    } catch {
      return userError({
        code: "authorization_failed",
        message: "You do not have access to repair POS terminal health.",
      });
    }
  },
});

export const issueTerminalRecoveryCommand = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    commandType: posTerminalRecoveryCommandTypeValidator,
    commandContext: posTerminalRecoveryCommandPayloadValidator,
    expectedEvidence: posTerminalRecoveryExpectedEvidenceValidator,
  },
  returns: commandResultValidator(terminalRecoveryCommandReturnValidator),
  handler: async (ctx, args) => {
    try {
      const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
      await requireTerminalStoreAccess(ctx, {
        allowedRoles: ["full_admin"],
        failureMessage:
          "You do not have access to issue POS terminal recovery commands.",
        storeId: args.storeId,
        userId: athenaUser._id,
      });
      const terminal = await ctx.db.get("posTerminal", args.terminalId);
      if (!terminal || terminal.storeId !== args.storeId || terminal.status !== "active") {
        return userError({
          code: "precondition_failed",
          message: "This terminal is not active for this store.",
        });
      }
      const recoveryPreview = await previewTerminalRecoveryQuery(ctx, {
        now: Date.now(),
        storeId: args.storeId,
        terminalId: args.terminalId,
      });
      const matchingAction =
        args.commandType === "clear_local_review_items" && recoveryPreview
          ? findMatchingTerminalRecoveryAction(recoveryPreview.terminalActions, {
              commandContext: args.commandContext,
              commandType: args.commandType,
              expectedEvidence: args.expectedEvidence,
            })
          : null;
      if (args.commandType === "clear_local_review_items" && !matchingAction) {
        return userError({
          code: "precondition_failed",
          message: "This terminal recovery command is no longer available.",
        });
      }
      const commandAction = matchingAction ?? {
        commandContext: args.commandContext,
        commandType: args.commandType,
        expectedEvidence: args.expectedEvidence,
      };
      return issueTerminalRecoveryCommandService(
        createTerminalRecoveryCommandRepository(ctx),
        {
          commandType: commandAction.commandType,
          expectedEvidence: commandAction.expectedEvidence,
          issuedAt: Date.now(),
          issuedByUserId: athenaUser._id,
          commandContext: commandAction.commandContext,
          storeId: args.storeId,
          terminalId: args.terminalId,
        },
      );
    } catch {
      return userError({
        code: "authorization_failed",
        message:
          "You do not have access to issue POS terminal recovery commands.",
      });
    }
  },
});

function findMatchingTerminalRecoveryAction(
  actions: TerminalRecoveryPreview["terminalActions"],
  target: {
    commandContext: unknown;
    commandType: string;
    expectedEvidence: unknown;
  },
) {
  return actions.find(
    (action) =>
      action.commandType === target.commandType &&
      stableStringify(action.commandContext) ===
        stableStringify(target.commandContext) &&
      stableStringify(action.expectedEvidence) ===
        stableStringify(target.expectedEvidence),
  );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter((entry) => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const listTerminalRecoveryCommands = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    syncSecretHash: v.string(),
  },
  returns: commandResultValidator(v.array(terminalRecoveryCommandReturnValidator)),
  handler: async (ctx, args) => {
    const terminal = await requireActiveTerminalSyncSecret(ctx, args);
    if (!terminal) {
      return userError({
        code: "authorization_failed",
        message:
          "You do not have access to list POS terminal recovery commands.",
        metadata: { terminalAuthorizationFailure: true },
      });
    }
    const [commands, runtimeStatus] = await Promise.all([
      listClaimableTerminalRecoveryCommands(
        createTerminalRecoveryCommandReadRepository(ctx),
        {
          now: Date.now(),
          storeId: args.storeId,
          terminalId: args.terminalId,
        },
      ),
      getLatestRuntimeStatusForTerminal(ctx, {
        storeId: args.storeId,
        terminalId: args.terminalId,
      }),
    ]);
    const supportsAppUpdateCommands = Boolean(runtimeStatus?.appUpdate);
    return {
      kind: "ok" as const,
      data: supportsAppUpdateCommands
        ? commands
        : commands.filter((command) => command.commandType !== "update_app"),
    };
  },
});

export const claimTerminalRecoveryCommand = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    syncSecretHash: v.string(),
    commandId: v.id("posTerminalRecoveryCommand"),
  },
  returns: commandResultValidator(terminalRecoveryCommandReturnValidator),
  handler: async (ctx, args) => {
    const terminal = await requireActiveTerminalSyncSecret(ctx, args);
    if (!terminal) {
      return userError({
        code: "authorization_failed",
        message:
          "You do not have access to claim POS terminal recovery commands.",
        metadata: { terminalAuthorizationFailure: true },
      });
    }
    return claimTerminalRecoveryCommandService(
      createTerminalRecoveryCommandRepository(ctx),
      {
        claimedAt: Date.now(),
        commandId: args.commandId,
        storeId: args.storeId,
        terminalId: args.terminalId,
      },
    );
  },
});

export const acknowledgeTerminalRecoveryCommand = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    syncSecretHash: v.string(),
    commandId: v.id("posTerminalRecoveryCommand"),
    result: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("precondition_failed"),
    ),
    message: v.optional(v.string()),
    clearedLocalReviewEventIds: v.optional(v.array(v.string())),
    localReviewEvents: v.optional(
      v.array(posTerminalRecoveryLocalReviewEventValidator),
    ),
    executionId: v.optional(v.string()),
  },
  returns: commandResultValidator(terminalRecoveryCommandReturnValidator),
  handler: async (ctx, args) => {
    const terminal = await requireActiveTerminalSyncSecret(ctx, args);
    if (!terminal) {
      return userError({
        code: "authorization_failed",
        message:
          "You do not have access to acknowledge POS terminal recovery commands.",
        metadata: { terminalAuthorizationFailure: true },
      });
    }
    return acknowledgeTerminalRecoveryCommandService(
      createTerminalRecoveryCommandRepository(ctx),
      {
        acknowledgedAt: Date.now(),
        clearedLocalReviewEventIds: args.clearedLocalReviewEventIds,
        commandId: args.commandId,
        executionId: args.executionId,
        localReviewEvents: args.localReviewEvents,
        message: args.message,
        result: args.result,
        storeId: args.storeId,
        terminalId: args.terminalId,
      },
    );
  },
});
