import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import {
  appVerificationCodeSchema,
  athenaUserSchema,
  bannerMessageSchema,
  bestSellerSchema,
  catalogSummarySchema,
  categorySchema,
  colorSchema,
  featuredItemSchema,
  inviteCodeSchema,
  organizationMemberSchema,
  organizationSchema,
  inventoryHoldSchema,
  inventoryImportCostOverlayBulkDecisionRequestSchema,
  inventoryImportCostOverlayRowSchema,
  inventoryImportCostOverlayRunSchema,
  inventoryImportProvisionalSkuSchema,
  inventoryImportReviewVersionSchema,
  inventoryImportReviewVersionPayloadChunkSchema,
  inventoryImportReviewVersionPayloadUploadSchema,
  posRegisterCatalogRevisionSchema,
  productSchema,
  productSkuSearchSchema,
  productSkuSchema,
  promoCodeItemSchema,
  promoCodeSchema,
  redeemedPromoCodeSchema,
  storeAssetSchema,
  storeScheduleSchema,
  storeTimezoneVersionSchema,
  storeSchema,
  subcategorySchema,
  complimentaryProductsCollectionSchema,
  complimentaryProductSchema,
} from "./schemas/inventory";
import {
  bagItemSchema,
  bagSchema,
  savedBagSchema,
  savedBagItemSchema,
  guestSchema,
  checkoutSessionSchema,
  checkoutSessionItemSchema,
  onlineOrderSchema,
  onlineOrderItemSchema,
  storeFrontVerificationCode,
  storeFrontUserSchema,
  storeFrontSessionSchema,
  supportTicketSchema,
  analyticsSchema,
  reviewSchema,
  rewardPointsSchema,
  rewardTransactionSchema,
  rewardTierSchema,
  offerSchema,
} from "./schemas/storeFront";
import {
  posTransactionSchema,
  posTransactionItemSchema,
  posAmountMigrationRunSchema,
  posTransactionServiceLineSchema,
  posTransactionAdjustmentSchema,
  posTransactionAdjustmentLineSchema,
  posSessionItemSchema,
  posCustomerSchema,
  posTerminalSchema,
  expenseSessionSchema,
  expenseSessionItemSchema,
  expenseTransactionSchema,
  expenseTransactionItemSchema,
  posLocalSyncConflictSchema,
  posLocalSyncCursorSchema,
  posLocalSyncEventSchema,
  posLocalSyncMappingSchema,
  posRegisterMappingAuthoritySchema,
  posRegisterAuthorityReplicationStatusSchema,
  posPendingCheckoutItemSchema,
  posPendingCheckoutLookupAliasSchema,
  posLocalStaffProofSchema,
  posRecoveryCredentialSchema,
  posTerminalRecoveryCommandSchema,
  posTerminalRuntimeStatusSchema,
  posRegisterSessionActivitySchema,
  posRegisterSessionActivityCheckpointSchema,
  posLifecycleJournalSchema,
  posLifecycleJournalCursorSchema,
  posClientEventSchema,
} from "./schemas/pos";
import { posSessionSchema } from "./schemas/pos/posSession";
import {
  mtnCollectionsTokenSchema,
  mtnCollectionTransactionSchema,
} from "./schemas/payments/mtnCollections";
import {
  customerMessageDeliverySchema,
  receiptShareTokenSchema,
} from "./schemas/customerMessaging";
import {
  approvalRequestSchema,
  customerProfileSchema,
  dailyCloseSchema,
  dailyOpeningSchema,
  inventoryMovementSchema,
  managerElevationSchema,
  operationalEventSchema,
  operationalWorkItemSchema,
  oversizedOperationalWorkRepairActionSchema,
  oversizedOperationalWorkRepairSchema,
  paymentAllocationSchema,
  registerSessionSchema,
  skuActivityEventSchema,
  staffCredentialSchema,
  staffProfileSchema,
  staffRoleAssignmentSchema,
} from "./schemas/operations";
import {
  workflowTraceEventSchema,
  workflowTraceLookupSchema,
  workflowTraceSchema,
} from "./schemas/observability";
import {
  serviceAppointmentSchema,
  serviceCatalogSchema,
  serviceCaseLineItemSchema,
  serviceCaseSchema,
  serviceInventoryUsageSchema,
} from "./schemas/serviceOps";
import {
  purchaseOrderLineItemSchema,
  purchaseOrderSchema,
  receivingBatchSchema,
  cycleCountDraftLineSchema,
  cycleCountDraftSchema,
  stockAdjustmentBatchSchema,
  vendorSchema,
} from "./schemas/stockOps";
import {
  automationNotificationDeliverySchema,
  automationPolicySchema,
  automationRunSchema,
  scheduledRunLedgerSchema,
} from "./schemas/automation";
import {
  notificationDeliverySchema,
  notificationIntentSchema,
  notificationSubscriptionSchema,
} from "./schemas/notifications";
import {
  contextEventImportRunSchema,
  contextEventSchema,
} from "./schemas/contextTracking";
import {
  intelligenceArtifactSchema,
  intelligenceContextSnapshotSchema,
  intelligenceProviderInvocationSchema,
  intelligenceRunSchema,
} from "./schemas/intelligence";
import {
  agentBudgetLedgerSchema,
  agentBudgetReservationSchema,
  agentCapabilityCallSchema,
  agentCitationBindingSchema,
  agentClaimSupportSchema,
  agentCompatibilityEpochSchema,
  agentEnablementSwitchSchema,
  agentSpendWindowSchema,
  agentEvidenceAccessAuditSchema,
  agentProgramAttemptSchema,
  agentPromptPayloadSchema,
  agentReplayPayloadSchema,
  agentRunGrantSchema,
  agentScratchDescriptorSchema,
  agentTurnBindingSchema,
} from "./schemas/agentHarness";
import {
  remoteAssistClientSchema,
  remoteAssistSessionEventSchema,
  remoteAssistSessionSchema,
} from "./schemas/remoteAssist";
import {
  reportingInventoryDeficitLedgerSchema,
  reportingInventoryDeficitLotSchema,
  reportingInventoryDeficitResolutionWorkSchema,
  reportingInventoryEffectSchema,
  reportingInventoryEffectSourceReferenceSchema,
  reportingInventoryPositionSchema,
  reportingInventoryPositionRevisionSchema,
  reportingSkuValuationCorrectionSchema,
} from "./schemas/inventoryLedger";
import {
  reportingIdentityMigrationCandidateSchema,
  reportingIdentityMigrationRunSchema,
  reportingIntegrityAttemptSchema,
} from "./schemas/migrations";
import {
  reportFactSchema,
  reportDaySchema,
  reportSkuDaySchema,
  reportOverviewSchema,
  reportPeriodSkuRollupSchema,
  reportDirtyDaySchema,
  reportDirtyWeekSchema,
  reportWeekAcceptedSchema,
  reportWeekCurrentSchema,
  reportRangeResultSchema,
  reportRangeMovementSkuSchema,
  reportRangeMixSkuSchema,
  reportMovementAdmissionSchema,
  reportVerificationRunSchema,
} from "./schemas/reports";
import {
  walkthroughBudgetCounterSchema,
  walkthroughNotificationAttemptSchema,
  walkthroughOperationsAuditSchema,
  walkthroughPrivacyChallengeSchema,
  walkthroughRequestSchema,
  walkthroughRequestTombstoneSchema,
} from "./schemas/marketing/walkthroughRequest";
import {
  landingFunnelDailyBucketSchema,
  landingFunnelEventSchema,
} from "./schemas/marketing/landingFunnelEvent";
import {
  sharedDemoBaselineRowSchema,
  sharedDemoBaselineDocumentSchema,
  sharedDemoRestoreAuditSchema,
  sharedDemoRestoreStateSchema,
} from "./schemas/sharedDemo";
import { staffMessageSchema } from "./schemas/staffMessages";
import {
  harnessWaiverApprovalSchema,
  harnessWaiverPasskeySchema,
  harnessWaiverRegistrationAuthorizationSchema,
  harnessWaiverRegistrationSchema,
} from "./schemas/harnessWaiver";

const schema = defineSchema({
  ...authTables,
  harnessWaiverPasskey: defineTable(harnessWaiverPasskeySchema).index(
    "by_credentialId",
    ["credentialId"],
  ),
  harnessWaiverRegistrationAuthorization: defineTable(
    harnessWaiverRegistrationAuthorizationSchema,
  )
    .index("by_tokenHash", ["tokenHash"])
    .index("by_expiresAt", ["expiresAt"]),
  harnessWaiverRegistration: defineTable(harnessWaiverRegistrationSchema)
    .index("by_challenge", ["challenge"])
    .index("by_expiresAt", ["expiresAt"]),
  harnessWaiverApproval: defineTable(harnessWaiverApprovalSchema)
    .index("by_publicTokenHash", ["publicTokenHash"])
    .index("by_expiresAt", ["expiresAt"]),
  sharedDemoRestoreState: defineTable(sharedDemoRestoreStateSchema).index(
    "by_storeId",
    ["storeId"],
  ),
  sharedDemoBaselineRow: defineTable(sharedDemoBaselineRowSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_domain", ["storeId", "domain"]),
  sharedDemoBaselineDocument: defineTable(sharedDemoBaselineDocumentSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_tableName", ["storeId", "tableName"])
    .index("by_storeId_tableName_documentId", [
      "storeId",
      "tableName",
      "documentId",
    ]),
  sharedDemoRestoreAudit: defineTable(sharedDemoRestoreAuditSchema).index(
    "by_storeId_occurredAt",
    ["storeId", "occurredAt"],
  ),
  sharedDemoPrincipal: defineTable({
    authUserId: v.id("users"),
    athenaUserId: v.id("athenaUser"),
    organizationId: v.id("organization"),
    storeId: v.id("store"),
    admissionExpiresAt: v.number(),
    updatedAt: v.number(),
  }).index("by_authUserId", ["authUserId"]),
  sharedDemoAdmissionTicket: defineTable({
    authUserId: v.id("users"),
    principalId: v.id("sharedDemoPrincipal"),
    ticketHash: v.string(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_ticketHash", ["ticketHash"])
    .index("by_expiresAt", ["expiresAt"]),
  sharedDemoAdmissionRateBucket: defineTable({
    count: v.number(),
    kind: v.union(v.literal("mint"), v.literal("exchange")),
    windowStartedAt: v.number(),
  }).index("by_kind", ["kind"]),
  staffMessage: defineTable(staffMessageSchema)
    .index("by_storeId_createdAt", ["storeId", "createdAt"])
    .index("by_storeId_authorUserId_createdAt", [
      "storeId",
      "authorUserId",
      "createdAt",
    ]),
  walkthroughRequest: defineTable(walkthroughRequestSchema)
    .index("by_submissionKey", ["submissionKey"])
    .index("by_normalizedEmail_and_submittedAt", [
      "normalizedEmail",
      "submittedAt",
    ])
    .index("by_status_and_lastActivityAt", ["status", "lastActivityAt"])
    .index("by_status_and_terminalAt", ["status", "terminalAt"])
    .index("by_status_and_redactedAt_and_lastActivityAt", [
      "status",
      "redactedAt",
      "lastActivityAt",
    ])
    .index("by_status_and_redactedAt_and_terminalAt", [
      "status",
      "redactedAt",
      "terminalAt",
    ]),
  walkthroughNotificationAttempt: defineTable(
    walkthroughNotificationAttemptSchema,
  )
    .index("by_requestId", ["requestId"])
    .index("by_state_and_nextAttemptAt", ["state", "nextAttemptAt"])
    .index("by_state_and_leaseExpiresAt", ["state", "leaseExpiresAt"])
    .index("by_state_and_terminalAt", ["state", "terminalAt"]),
  walkthroughRequestTombstone: defineTable(walkthroughRequestTombstoneSchema)
    .index("by_submissionKey", ["submissionKey"])
    .index("by_keyVersion_and_dedupeHmac_and_expiresAt", [
      "keyVersion",
      "dedupeHmac",
      "expiresAt",
    ])
    .index("by_expiresAt", ["expiresAt"]),
  walkthroughOperationsAudit: defineTable(
    walkthroughOperationsAuditSchema,
  ).index("by_requestId_and_occurredAt", ["requestId", "occurredAt"]),
  walkthroughBudgetCounter: defineTable(walkthroughBudgetCounterSchema)
    .index("by_partition_and_windowStart", ["partition", "windowStart"])
    .index("by_windowStart", ["windowStart"]),
  walkthroughPrivacyChallenge: defineTable(walkthroughPrivacyChallengeSchema)
    .index("by_requestId_and_createdAt", ["requestId", "createdAt"])
    .index("by_expiresAt", ["expiresAt"]),
  landingFunnelEvent: defineTable(landingFunnelEventSchema).index(
    "by_occurredAt",
    ["occurredAt"],
  ),
  landingFunnelDailyBucket: defineTable(landingFunnelDailyBucketSchema)
    .index("by_day_and_event_and_device_and_source", [
      "day",
      "event",
      "device",
      "source",
    ])
    .index("by_updatedAt", ["updatedAt"]),
  analytics: defineTable(analyticsSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeFrontUserId", ["storeFrontUserId"])
    .index("by_storeFrontUserId_storeId", ["storeFrontUserId", "storeId"])
    .index("by_action_productId", ["action", "productId"])
    .index("by_storeId_action", ["storeId", "action"])
    .index("by_storeId_action_productId", ["storeId", "action", "productId"])
    .index("by_promoCodeId", ["promoCodeId"]),
  appVerificationCode: defineTable(appVerificationCodeSchema),
  approvalRequest: defineTable(approvalRequestSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_status", ["storeId", "status"])
    .index("by_storeId_status_requestType", [
      "storeId",
      "status",
      "requestType",
    ])
    .index("by_storeId_subject", ["storeId", "subjectType", "subjectId"])
    .index("by_storeId_status_posTransactionId", [
      "storeId",
      "status",
      "posTransactionId",
    ])
    .index("by_workItemId", ["workItemId"])
    .index("by_registerSessionId", ["registerSessionId"])
    .index("by_registerSessionId_status_requestType", [
      "registerSessionId",
      "status",
      "requestType",
    ]),
  automationPolicy: defineTable(automationPolicySchema)
    .index("by_storeId_domain_action", ["storeId", "domain", "action"])
    .index("by_domain_action_mode", ["domain", "action", "mode"])
    .index("by_storeId_mode", ["storeId", "mode"]),
  automationRun: defineTable(automationRunSchema)
    .index("by_storeId_operatingDate_domain_action", [
      "storeId",
      "operatingDate",
      "domain",
      "action",
    ])
    .index("by_storeId_operatingDate_domain_action_outcome_updatedAt", [
      "storeId",
      "operatingDate",
      "domain",
      "action",
      "outcome",
      "updatedAt",
    ])
    .index("by_storeId_domain_action_outcome", [
      "storeId",
      "domain",
      "action",
      "outcome",
    ])
    .index("by_storeId_outcome", ["storeId", "outcome"])
    .index("by_storeId_idempotencyKey", ["storeId", "idempotencyKey"]),
  automationNotificationDelivery: defineTable(
    automationNotificationDeliverySchema,
  )
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_storeId_operatingDate_action", [
      "storeId",
      "operatingDate",
      "action",
    ]),
  notificationIntent: defineTable(notificationIntentSchema)
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_status_and_emittedAt", ["status", "emittedAt"])
    .index("by_storeId_and_emittedAt", ["storeId", "emittedAt"]),
  notificationSubscription: defineTable(notificationSubscriptionSchema)
    .index("by_organizationId_and_category", ["organizationId", "category"])
    .index("by_recipientEmail", ["recipientEmail"]),
  notificationDelivery: defineTable(notificationDeliverySchema)
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_intentId", ["intentId"])
    .index("by_status_and_leaseExpiresAt", ["status", "leaseExpiresAt"])
    .index("by_status_and_nextAttemptAt", ["status", "nextAttemptAt"]),
  scheduledRunLedger: defineTable(scheduledRunLedgerSchema)
    .index("by_runKey", ["runKey"])
    .index("by_storeId_cronFamily_window", [
      "storeId",
      "cronFamily",
      "scheduledWindowStartAt",
    ])
    .index("by_scope_cronFamily_window", [
      "scope",
      "cronFamily",
      "scheduledWindowStartAt",
    ])
    .index("by_visibility_updatedAt", ["visibility", "updatedAt"]),
  approvalProof: defineTable(
    v.object({
      storeId: v.id("store"),
      organizationId: v.optional(v.id("organization")),
      actionKey: v.string(),
      subjectType: v.string(),
      subjectId: v.string(),
      subjectLabel: v.optional(v.string()),
      requiredRole: v.union(
        v.literal("manager"),
        v.literal("front_desk"),
        v.literal("stylist"),
        v.literal("technician"),
        v.literal("cashier"),
      ),
      requestedByStaffProfileId: v.optional(v.id("staffProfile")),
      approvedByStaffProfileId: v.id("staffProfile"),
      approvedByCredentialId: v.id("staffCredential"),
      reason: v.optional(v.string()),
      createdAt: v.number(),
      expiresAt: v.number(),
      consumedAt: v.optional(v.number()),
    }),
  )
    .index("by_storeId_action_subject", [
      "storeId",
      "actionKey",
      "subjectType",
      "subjectId",
    ])
    .index("by_expiresAt", ["expiresAt"]),
  approvalRequesterChallenge: defineTable(
    v.object({
      storeId: v.id("store"),
      organizationId: v.optional(v.id("organization")),
      actionKey: v.string(),
      subjectType: v.string(),
      subjectId: v.string(),
      subjectLabel: v.optional(v.string()),
      requiredRole: v.union(
        v.literal("manager"),
        v.literal("front_desk"),
        v.literal("stylist"),
        v.literal("technician"),
        v.literal("cashier"),
      ),
      requestedByStaffProfileId: v.id("staffProfile"),
      createdAt: v.number(),
      expiresAt: v.number(),
      consumedAt: v.optional(v.number()),
    }),
  )
    .index("by_storeId_action_subject", [
      "storeId",
      "actionKey",
      "subjectType",
      "subjectId",
    ])
    .index("by_expiresAt", ["expiresAt"]),
  athenaUser: defineTable(athenaUserSchema).index("by_normalizedEmail", [
    "normalizedEmail",
  ]),
  contextEvent: defineTable(contextEventSchema)
    .index("by_surface_eventId_status_occurredAt", [
      "surface",
      "eventId",
      "status",
      "occurredAt",
    ])
    .index("by_storeId_surface_idempotencyKey", [
      "storeId",
      "surface",
      "idempotencyKey",
    ])
    .index("by_storeId_surface_subject_occurredAt", [
      "storeId",
      "surface",
      "primarySubjectType",
      "primarySubjectId",
      "occurredAt",
    ])
    .index("by_storeId_surface_session_occurredAt", [
      "storeId",
      "surface",
      "sessionRefKind",
      "sessionRefId",
      "occurredAt",
    ])
    .index("by_storeId_surface_actor_status_occurredAt", [
      "storeId",
      "surface",
      "actorRefKind",
      "actorRefId",
      "status",
      "occurredAt",
    ])
    .index("by_storeId_surface_status_occurredAt", [
      "storeId",
      "surface",
      "status",
      "occurredAt",
    ])
    .index("by_storeId_surface_status_abusePartitionKey_receivedAt", [
      "storeId",
      "surface",
      "status",
      "abusePartitionKey",
      "receivedAt",
    ])
    .index("by_storeId_historicalImportRunId_status", [
      "storeId",
      "historicalImportRunId",
      "historicalImportStatus",
    ])
    .index("by_storeId_historicalImportBatchId_status", [
      "storeId",
      "historicalImportBatchId",
      "historicalImportStatus",
    ])
    .index("by_retentionClass_expiresAt", ["retentionClass", "expiresAt"]),
  contextEventImportRun: defineTable(contextEventImportRunSchema)
    .index("by_storeId_importRunId", ["storeId", "importRunId"])
    .index("by_storeId_importBatchId", ["storeId", "importBatchId"])
    .index("by_storeId_runKey", ["storeId", "runKey"])
    .index("by_storeId_status_updatedAt", ["storeId", "status", "updatedAt"]),
  intelligenceRun: defineTable(intelligenceRunSchema)
    .index("by_storeId_capability_status", ["storeId", "capability", "status"])
    .index("by_storeId_capability_debugSubject_createdAt", [
      "storeId",
      "capability",
      "debugSubjectTable",
      "debugSubjectId",
      "createdAt",
    ])
    .index("by_storeId_idempotencyKey", ["storeId", "idempotencyKey"])
    .index("by_actorRef_status", ["actorRef", "status"])
    .index("by_contextSnapshotId", ["contextSnapshotId"])
    .index("by_artifactId", ["artifactId"])
    // Compatibility-epoch repair: active statuses pinned to an older epoch.
    .index("by_status_compatibilityEpoch", ["status", "compatibilityEpoch"]),
  intelligenceContextSnapshot: defineTable(intelligenceContextSnapshotSchema)
    .index("by_runId", ["runId"])
    .index("by_storeId_capability_hash", [
      "storeId",
      "capability",
      "snapshotHash",
    ])
    .index("by_storeId_visibility_createdAt", [
      "storeId",
      "visibilityMode",
      "createdAt",
    ]),
  intelligenceArtifact: defineTable(intelligenceArtifactSchema)
    .index("by_runId", ["runId"])
    .index("by_contextSnapshotId", ["contextSnapshotId"])
    .index("by_storeId_capability_status", ["storeId", "capability", "status"])
    .index("by_storeId_kind_status", ["storeId", "kind", "status"])
    .index("by_storeId_kind_subject_status", [
      "storeId",
      "kind",
      "subjectTable",
      "subjectId",
      "status",
    ])
    .index("by_storeId_visibility_status", [
      "storeId",
      "visibilityMode",
      "status",
    ])
    .index("by_snapshotHash", ["snapshotHash"]),
  intelligenceProviderInvocation: defineTable(
    intelligenceProviderInvocationSchema,
  )
    .index("by_runId", ["runId"])
    .index("by_contextSnapshotId", ["contextSnapshotId"])
    .index("by_providerKey_status", ["providerKey", "status"])
    .index("by_storeId_capability_startedAt", [
      "storeId",
      "capability",
      "startedAt",
    ]),
  // --- Agent harness children of the intelligence aggregate (U1) ---
  agentRunGrant: defineTable(agentRunGrantSchema)
    .index("by_runId", ["runId"])
    .index("by_storeId_lifecycle", ["storeId", "lifecycle"])
    .index("by_organizationId_lifecycle", ["organizationId", "lifecycle"])
    .index("by_compatibilityEpoch_createdAt", ["compatibilityEpoch", "createdAt"]),
  agentTurnBinding: defineTable(agentTurnBindingSchema)
    .index("by_runId", ["runId"])
    .index("by_storeId_turnIdempotencyKey", ["storeId", "turnIdempotencyKey"])
    .index("by_runtimeThreadRef_createdAt", ["runtimeThreadRef", "createdAt"])
    .index("by_storeId_threadKey_createdAt", ["storeId", "threadKey", "createdAt"])
    .index("by_step_outboxNextAttemptAt", ["step", "outboxNextAttemptAt"])
    .index("by_step_abandonedAt_stepUpdatedAt", [
      "step",
      "abandonedAt",
      "stepUpdatedAt",
    ])
    .index("by_runtimeCleanupStatus_runtimeCleanupNextAttemptAt", [
      "runtimeCleanupStatus",
      "runtimeCleanupNextAttemptAt",
    ])
    .index("by_storeId_runtimeCleanupStatus", ["storeId", "runtimeCleanupStatus"])
    .index("by_organizationId_runtimeCleanupStatus", [
      "organizationId",
      "runtimeCleanupStatus",
    ]),
  agentPromptPayload: defineTable(agentPromptPayloadSchema)
    .index("by_runId", ["runId"])
    .index("by_retentionClass_expiresAt", ["retentionClass", "expiresAt"])
    .index("by_storeId", ["storeId"])
    .index("by_organizationId", ["organizationId"]),
  agentProgramAttempt: defineTable(agentProgramAttemptSchema)
    .index("by_runId_sequence", ["runId", "sequence"])
    .index("by_runId_attemptIdempotencyKey", ["runId", "attemptIdempotencyKey"])
    .index("by_runId_status", ["runId", "status"])
    .index("by_status_leaseExpiresAt", ["status", "leaseExpiresAt"])
    .index("by_storeId_createdAt", ["storeId", "createdAt"]),
  agentCapabilityCall: defineTable(agentCapabilityCallSchema)
    .index("by_runId_sequence", ["runId", "sequence"])
    .index("by_runId_callIdempotencyKey", ["runId", "callIdempotencyKey"])
    .index("by_runId_status", ["runId", "status"])
    .index("by_attemptId_status", ["attemptId", "status"])
    .index("by_storeId_capabilityId_createdAt", [
      "storeId",
      "capabilityId",
      "createdAt",
    ])
    .index("by_resultHash", ["resultHash"]),
  agentBudgetLedger: defineTable(agentBudgetLedgerSchema).index("by_runId", [
    "runId",
  ]),
  agentBudgetReservation: defineTable(agentBudgetReservationSchema)
    .index("by_runId_idempotencyKey", ["runId", "idempotencyKey"])
    .index("by_runId_status", ["runId", "status"])
    .index("by_attemptId_status", ["attemptId", "status"]),
  agentCitationBinding: defineTable(agentCitationBindingSchema)
    .index("by_runId_citationKey", ["runId", "citationKey"])
    .index("by_artifactId", ["artifactId"])
    .index("by_callId", ["callId"])
    .index("by_evidenceLifecycle_expiresAt", ["evidenceLifecycle", "expiresAt"])
    .index("by_storeId_evidenceLifecycle", ["storeId", "evidenceLifecycle"])
    .index("by_organizationId_evidenceLifecycle", [
      "organizationId",
      "evidenceLifecycle",
    ]),
  agentReplayPayload: defineTable(agentReplayPayloadSchema)
    .index("by_runId", ["runId"])
    .index("by_callId", ["callId"])
    .index("by_attemptId_subjectKind", ["attemptId", "subjectKind"])
    .index("by_retentionClass_expiresAt", ["retentionClass", "expiresAt"])
    .index("by_storeId", ["storeId"])
    .index("by_organizationId", ["organizationId"]),
  agentClaimSupport: defineTable(agentClaimSupportSchema)
    .index("by_runId", ["runId"])
    .index("by_citationBindingId", ["citationBindingId"])
    .index("by_retentionClass_expiresAt", ["retentionClass", "expiresAt"])
    .index("by_storeId", ["storeId"])
    .index("by_organizationId", ["organizationId"]),
  agentScratchDescriptor: defineTable(agentScratchDescriptorSchema)
    .index("by_runId_scratchKey", ["runId", "scratchKey"])
    .index("by_retentionClass_expiresAt", ["retentionClass", "expiresAt"])
    .index("by_storeId", ["storeId"])
    .index("by_organizationId", ["organizationId"]),
  agentEvidenceAccessAudit: defineTable(agentEvidenceAccessAuditSchema)
    .index("by_runId_accessedAt", ["runId", "accessedAt"])
    .index("by_storeId_accessedAt", ["storeId", "accessedAt"])
    .index("by_citationBindingId", ["citationBindingId"]),
  agentCompatibilityEpoch: defineTable(agentCompatibilityEpochSchema).index(
    "by_scopeKey",
    ["scopeKey"],
  ),
  agentEnablementSwitch: defineTable(agentEnablementSwitchSchema).index(
    "by_subjectKind_subjectKey",
    ["subjectKind", "subjectKey"],
  ),
  agentSpendWindow: defineTable(agentSpendWindowSchema).index(
    "by_scopeKey_windowKey",
    ["scopeKey", "windowKey"],
  ),
  bag: defineTable(bagSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeFrontUserId", ["storeFrontUserId"]),
  bagItem: defineTable(bagItemSchema)
    .index("by_bagId", ["bagId"])
    .index("by_bagId_storeFrontUserId_productSkuId", [
      "bagId",
      "storeFrontUserId",
      "productSkuId",
    ])
    .index("by_productSkuId", ["productSkuId"]),
  bannerMessage: defineTable(bannerMessageSchema).index("by_storeId", [
    "storeId",
  ]),
  bestSeller: defineTable(bestSellerSchema).index("by_storeId", ["storeId"]),
  category: defineTable(categorySchema).index("by_storeId_slug", [
    "storeId",
    "slug",
  ]),
  catalogSummary: defineTable(catalogSummarySchema).index("by_storeId", [
    "storeId",
  ]),
  checkoutSession: defineTable(checkoutSessionSchema)
    .index("by_storeFrontUserId", ["storeFrontUserId"])
    .index("by_storeId", ["storeId"])
    .index("by_storeId_hasCompletedCheckoutSession", [
      "storeId",
      "hasCompletedCheckoutSession",
    ])
    .index("by_storeId_hasCompletedCheckoutSession_expiresAt", [
      "storeId",
      "hasCompletedCheckoutSession",
      "expiresAt",
    ]),
  checkoutSessionItem: defineTable(checkoutSessionItemSchema)
    .index("by_sessionId", ["sesionId"])
    .index("by_productSkuId", ["productSkuId"]),
  color: defineTable(colorSchema),
  complimentaryProductsCollection: defineTable(
    complimentaryProductsCollectionSchema,
  ).index("by_storeId", ["storeId"]),
  complimentaryProduct: defineTable(complimentaryProductSchema)
    .index("by_storeId", ["storeId"])
    .index("by_collectionId", ["collectionId"]),
  customerProfile: defineTable(customerProfileSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_email", ["storeId", "email"])
    .index("by_storeId_phoneNumber", ["storeId", "phoneNumber"])
    .index("by_storeFrontUserId", ["storeFrontUserId"])
    .index("by_guestId", ["guestId"])
    .index("by_posCustomerId", ["posCustomerId"]),
  dailyClose: defineTable(dailyCloseSchema)
    .index("by_storeId_operatingDate", ["storeId", "operatingDate"])
    .index("by_storeId_operatingDate_lifecycleStatus", [
      "storeId",
      "operatingDate",
      "lifecycleStatus",
    ])
    .index("by_storeId_status", ["storeId", "status"])
    .index("by_storeId_isCurrent", ["storeId", "isCurrent"])
    .index("by_storeId_status_operatingDate", [
      "storeId",
      "status",
      "operatingDate",
    ]),
  dailyOpening: defineTable(dailyOpeningSchema)
    .index("by_storeId_operatingDate", ["storeId", "operatingDate"])
    .index("by_storeId_status", ["storeId", "status"])
    .index("by_storeId_status_operatingDate", [
      "storeId",
      "status",
      "operatingDate",
    ]),
  featuredItem: defineTable(featuredItemSchema).index("by_storeId", [
    "storeId",
  ]),
  // `storeId` is the guest's admission clamp — see `schemas/storeFront/guest.ts`
  // for why the column stays optional while the write path does not, and
  // `storeFront/guestStoreIdBackfill.ts` for the one-time drain that must run
  // before the next storefront deploy.
  // The guest→account MERGE GRANT lives here rather than in `guestSchema`
  // because it is not a property of the visitor — it is a server-issued
  // authorization, written by `storeFront/guest:grantMergeToStoreFrontUser` at
  // the one moment the server can see both identities and has actually
  // authenticated the account (`POST /auth/verify`). The five merge callees
  // read it off this row; nothing a caller presents authorizes a merge.
  //
  // `mergeGrantConsumedBy` records which merges have already run under the
  // current grant, so each one is single-use while the five merges the
  // storefront fires after sign-in (bag, savedBag, onlineOrder, analytics,
  // rewards) all still succeed under one grant.
  guest: defineTable(
    v.object({
      ...guestSchema.fields,
      mergeGrantedToStoreFrontUserId: v.optional(v.id("storeFrontUser")),
      mergeGrantExpiresAt: v.optional(v.number()),
      mergeGrantConsumedBy: v.optional(v.array(v.string())),
    }),
  )
    .index("by_storeId", ["storeId"])
    .index("by_marker", ["marker"]),
  inviteCode: defineTable(inviteCodeSchema),
  inventoryHold: defineTable(inventoryHoldSchema)
    .index("by_storeId_productSkuId_status_expiresAt", [
      "storeId",
      "productSkuId",
      "status",
      "expiresAt",
    ])
    .index("by_storeId_status_expiresAt", ["storeId", "status", "expiresAt"])
    .index("by_sourceSessionId_status_productSkuId", [
      "sourceSessionId",
      "status",
      "productSkuId",
    ]),
  inventoryImportReviewVersion: defineTable(inventoryImportReviewVersionSchema)
    .index("by_storeId_createdAt", ["storeId", "createdAt"])
    .index("by_storeId_importKey", ["storeId", "importKey"])
    .index("by_storeId_payloadUploadKey", ["storeId", "payloadUploadKey"]),
  inventoryImportReviewVersionPayloadChunk: defineTable(
    inventoryImportReviewVersionPayloadChunkSchema,
  )
    .index("by_reviewVersionId_chunkIndex", ["reviewVersionId", "chunkIndex"])
    .index("by_storeId_uploadKey_chunkIndex", [
      "storeId",
      "uploadKey",
      "chunkIndex",
    ]),
  inventoryImportReviewVersionPayloadUpload: defineTable(
    inventoryImportReviewVersionPayloadUploadSchema,
  )
    .index("by_storeId_uploadKey", ["storeId", "uploadKey"])
    .index("by_storeId_createdByUserId_status_expiresAt", [
      "storeId",
      "createdByUserId",
      "status",
      "expiresAt",
    ])
    .index("by_status_expiresAt", ["status", "expiresAt"]),
  inventoryImportCostOverlayRun: defineTable(
    inventoryImportCostOverlayRunSchema,
  )
    .index("by_storeId_createdAt", ["storeId", "createdAt"])
    .index("by_storeId_status_updatedAt", ["storeId", "status", "updatedAt"])
    .index("by_storeId_requestKey", ["storeId", "requestKey"])
    .index("by_reviewVersionId_createdAt", ["reviewVersionId", "createdAt"]),
  inventoryImportCostOverlayBulkDecisionRequest: defineTable(
    inventoryImportCostOverlayBulkDecisionRequestSchema,
  ).index("by_runId_requestKey", ["runId", "requestKey"]),
  inventoryImportCostOverlayRow: defineTable(
    inventoryImportCostOverlayRowSchema,
  )
    .index("by_runId_rowOrdinal", ["runId", "rowOrdinal"])
    .index("by_runId_decision_rowOrdinal", ["runId", "decision", "rowOrdinal"])
    .index("by_runId_eligibility_rowOrdinal", [
      "runId",
      "eligibility",
      "rowOrdinal",
    ])
    .index("by_runId_productSkuId", ["runId", "productSkuId"])
    .index("by_runId_workStatus_rowOrdinal", [
      "runId",
      "workStatus",
      "rowOrdinal",
    ]),
  inventoryImportProvisionalSku: defineTable(
    inventoryImportProvisionalSkuSchema,
  )
    .index("by_storeId", ["storeId"])
    .index("by_storeId_status", ["storeId", "status"])
    .index("by_storeId_status_finalizedAt", [
      "storeId",
      "status",
      "finalizedAt",
    ])
    .index("by_storeId_status_saleEvidenceQuantity", [
      "storeId",
      "status",
      "saleEvidence.totalQuantitySold",
    ])
    .index("by_storeId_importKey", ["storeId", "importKey"])
    .index("by_storeId_importKey_status", ["storeId", "importKey", "status"])
    .index("by_storeId_productSkuId_status", [
      "storeId",
      "productSkuId",
      "status",
    ])
    .index("by_storeId_reviewVersionId_productSkuId_status", [
      "storeId",
      "reviewVersionId",
      "productSkuId",
      "status",
    ])
    .index("by_storeId_productId_status", ["storeId", "productId", "status"])
    .index("by_storeId_importKey_rowKey", ["storeId", "importKey", "rowKey"])
    .index("by_storeId_reviewVersionId", ["storeId", "reviewVersionId"])
    .index("by_storeId_finalizationConversionRequestId", [
      "storeId",
      "finalizationConversionRequestId",
    ])
    .index("by_storeId_normalizedImportedBarcode_status", [
      "storeId",
      "normalizedImportedBarcode",
      "status",
    ])
    .index("by_storeId_normalizedImportedSku_status", [
      "storeId",
      "normalizedImportedSku",
      "status",
    ]),
  inventoryMovement: defineTable(inventoryMovementSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_productSkuId", ["storeId", "productSkuId"])
    .index("by_storeId_productSkuId_sourceType_createdAt", [
      "storeId",
      "productSkuId",
      "sourceType",
      "createdAt",
    ])
    .index("by_storeId_source", ["storeId", "sourceType", "sourceId"])
    .index("by_workItemId", ["workItemId"]),
  oversizedOperationalWorkRepair: defineTable(
    oversizedOperationalWorkRepairSchema,
  )
    .index("by_storeId_groupKey_status", ["storeId", "groupKey", "status"])
    .index("by_storeId_status", ["storeId", "status"]),
  oversizedOperationalWorkRepairAction: defineTable(
    oversizedOperationalWorkRepairActionSchema,
  ).index("by_repairId_occurredAt", ["repairId", "occurredAt"]),
  skuActivityEvent: defineTable(skuActivityEventSchema)
    .index("by_storeId_productSkuId_occurredAt", [
      "storeId",
      "productSkuId",
      "occurredAt",
    ])
    .index("by_storeId_source", ["storeId", "sourceType", "sourceId"])
    .index("by_storeId_idempotencyKey", ["storeId", "idempotencyKey"]),
  stockAdjustmentBatch: defineTable(stockAdjustmentBatchSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_adjustmentType_submissionKey", [
      "storeId",
      "adjustmentType",
      "submissionKey",
    ])
    .index("by_workItemId", ["operationalWorkItemId"]),
  cycleCountDraft: defineTable(cycleCountDraftSchema)
    .index("by_storeId_status_scope_owner", [
      "storeId",
      "status",
      "scopeKey",
      "ownerUserId",
    ])
    .index("by_storeId_status_scope", ["storeId", "status", "scopeKey"]),
  cycleCountDraftLine: defineTable(cycleCountDraftLineSchema)
    .index("by_draftId", ["draftId"])
    .index("by_draftId_productSkuId", ["draftId", "productSkuId"]),
  receivingBatch: defineTable(receivingBatchSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_receivedAt", ["storeId", "receivedAt"])
    .index("by_storeId_purchaseOrderId", ["storeId", "purchaseOrderId"])
    .index("by_storeId_purchaseOrderId_submissionKey", [
      "storeId",
      "purchaseOrderId",
      "submissionKey",
    ]),
  onlineOrder: defineTable(onlineOrderSchema)
    .index("by_checkoutSessionId", ["checkoutSessionId"])
    .index("by_customerProfileId", ["customerProfileId"])
    .index("by_externalTransactionId", ["externalTransactionId"])
    .index("by_storeFrontUserId", ["storeFrontUserId"])
    .index("by_storeId", ["storeId"])
    .index("by_storeId_status", ["storeId", "status"])
    .index("by_storeId_status_completedAt", [
      "storeId",
      "status",
      "completedAt",
    ])
    .index("by_externalReference", ["externalReference"]),
  onlineOrderItem: defineTable(onlineOrderItemSchema).index("by_orderId", [
    "orderId",
  ]),
  mtnCollectionsToken: defineTable(mtnCollectionsTokenSchema).index(
    "by_storeId",
    ["storeId"],
  ),
  mtnCollectionTransaction: defineTable(mtnCollectionTransactionSchema)
    .index("by_providerReference", ["providerReference"])
    .index("by_storeId_requestedAt", ["storeId", "requestedAt"]),
  receiptShareToken: defineTable(receiptShareTokenSchema)
    .index("by_tokenHash", ["tokenHash"])
    .index("by_transactionId_status", ["transactionId", "status"])
    .index("by_storeId_transactionId", ["storeId", "transactionId"]),
  customerMessageDelivery: defineTable(customerMessageDeliverySchema)
    .index("by_storeId_subject", ["storeId", "subjectType", "subjectId"])
    .index("by_providerMessageId", ["providerMessageId"])
    .index("by_storeId_intent_status", ["storeId", "intent", "status"]),
  organization: defineTable(organizationSchema).index("by_slug", ["slug"]),
  organizationMember: defineTable(organizationMemberSchema)
    .index("by_organizationId_userId", ["organizationId", "userId"])
    .index("by_userId", ["userId"]),
  posCustomer: defineTable(posCustomerSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_and_email", ["storeId", "email"])
    .index("by_storeId_and_phone", ["storeId", "phone"])
    .index("by_linkedStoreFrontUserId", ["linkedStoreFrontUserId"]),
  posTerminal: defineTable(posTerminalSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_and_fingerprintHash", ["storeId", "fingerprintHash"])
    .index("by_storeId_registerNumber", ["storeId", "registerNumber"]),
  posRecoveryCredential: defineTable(posRecoveryCredentialSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_posAccountId", ["storeId", "posAccountId"])
    .index("by_organizationId_status", ["organizationId", "status"]),
  posTerminalRuntimeStatus: defineTable(posTerminalRuntimeStatusSchema)
    .index("by_store_terminal", ["storeId", "terminalId"])
    .index("by_store_reportedAt", ["storeId", "reportedAt"])
    .index("by_terminal_receivedAt", ["terminalId", "receivedAt"]),
  posTerminalRecoveryCommand: defineTable(posTerminalRecoveryCommandSchema)
    .index("by_store_terminal_status", ["storeId", "terminalId", "status"])
    .index("by_store_terminal_status_expiresAt", [
      "storeId",
      "terminalId",
      "status",
      "expiresAt",
    ])
    .index("by_store_terminal_verification", [
      "storeId",
      "terminalId",
      "verificationStatus",
    ])
    .index("by_terminal_expiresAt", ["terminalId", "expiresAt"]),
  remoteAssistClient: defineTable(remoteAssistClientSchema)
    .index("by_organization_runtime", [
      "organizationId",
      "runtimeType",
      "runtimeIdentity",
    ])
    .index("by_store_runtime", ["storeId", "runtimeType", "runtimeIdentity"])
    .index("by_organization_presence", [
      "organizationId",
      "presenceStatus",
      "lastPresenceAt",
    ]),
  remoteAssistSession: defineTable(remoteAssistSessionSchema)
    .index("by_client_status", ["clientId", "status"])
    .index("by_client_status_expiresAt", ["clientId", "status", "expiresAt"])
    .index("by_organization_status", [
      "organizationId",
      "status",
      "requestedAt",
    ])
    .index("by_expiresAt", ["expiresAt"]),
  remoteAssistSessionEvent: defineTable(remoteAssistSessionEventSchema)
    .index("by_session", ["sessionId", "occurredAt"])
    .index("by_client", ["clientId", "occurredAt"])
    .index("by_organization_event", [
      "organizationId",
      "eventType",
      "occurredAt",
    ]),
  posAmountMigrationRun: defineTable(posAmountMigrationRunSchema).index(
    "by_table",
    ["table"],
  ),
  posTransaction: defineTable(posTransactionSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_idempotencyKey", ["storeId", "idempotencyKey"])
    .index("by_staffProfileId", ["staffProfileId"])
    .index("by_storeId_status_completedAt", [
      "storeId",
      "status",
      "completedAt",
    ])
    .index("by_storeId_status_registerSessionId_completedAt", [
      "storeId",
      "status",
      "registerSessionId",
      "completedAt",
    ]),
  posTransactionItem: defineTable(posTransactionItemSchema)
    .index("by_transactionId", ["transactionId"])
    .index("by_pendingCheckoutItemId", ["pendingCheckoutItemId"])
    .index("by_inventoryImportProvisionalSkuId", [
      "inventoryImportProvisionalSkuId",
    ]),
  posTransactionServiceLine: defineTable(posTransactionServiceLineSchema)
    .index("by_transactionId", ["transactionId"])
    .index("by_serviceCaseId", ["serviceCaseId"])
    .index("by_serviceCatalogId", ["serviceCatalogId"]),
  posTransactionAdjustment: defineTable(posTransactionAdjustmentSchema)
    .index("by_transactionId", ["transactionId"])
    .index("by_storeId_transactionId", ["storeId", "transactionId"])
    .index("by_storeId_transactionId_status", [
      "storeId",
      "transactionId",
      "status",
    ])
    .index("by_storeId_transactionId_payloadFingerprint", [
      "storeId",
      "transactionId",
      "payloadFingerprint",
    ])
    .index("by_storeId_status_appliedAt", ["storeId", "status", "appliedAt"])
    .index("by_approvalRequestId", ["approvalRequestId"])
    .index("by_payloadFingerprint", ["payloadFingerprint"]),
  posTransactionAdjustmentLine: defineTable(posTransactionAdjustmentLineSchema)
    .index("by_adjustmentId", ["adjustmentId"])
    .index("by_transactionId", ["transactionId"])
    .index("by_originalTransactionItemId", ["originalTransactionItemId"])
    .index("by_productSkuId", ["productSkuId"]),
  posPendingCheckoutItem: defineTable(posPendingCheckoutItemSchema)
    .index("by_storeId_status_updatedAt", ["storeId", "status", "updatedAt"])
    .index("by_storeId_status_evidenceQuantity", [
      "storeId",
      "status",
      "evidence.totalQuantitySold",
    ])
    .index("by_storeId_status_approvedProductSkuId", [
      "storeId",
      "status",
      "approvedProductSkuId",
    ])
    .index("by_storeId_lookup_status", [
      "storeId",
      "normalizedLookupCode",
      "status",
    ])
    .index("by_storeId_name_status", ["storeId", "normalizedName", "status"])
    .index("by_storeId_priority_updatedAt", [
      "storeId",
      "reviewPriority",
      "updatedAt",
    ])
    .index("by_storeId_provisionalProductSkuId", [
      "storeId",
      "provisionalProductSkuId",
    ])
    .index("by_storeId_provisionalProductSkuId_status", [
      "storeId",
      "provisionalProductSkuId",
      "status",
    ])
    .index("by_storeId_provisionalProductId", [
      "storeId",
      "provisionalProductId",
    ])
    .index("by_operationalWorkItemId", ["operationalWorkItemId"]),
  posPendingCheckoutLookupAlias: defineTable(
    posPendingCheckoutLookupAliasSchema,
  )
    .index("by_storeId_normalizedLookupCode_status", [
      "storeId",
      "normalizedLookupCode",
      "status",
    ])
    .index("by_storeId_productSkuId_status", [
      "storeId",
      "productSkuId",
      "status",
    ]),
  posSession: defineTable(posSessionSchema)
    .index("by_storeId", ["storeId"])
    .index("by_status", ["status"])
    .index("by_staffProfileId", ["staffProfileId"])
    .index("by_staffProfileId_and_status", ["staffProfileId", "status"])
    .index("by_registerSessionId", ["registerSessionId"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"])
    .index("by_storeId_and_status", ["storeId", "status"])
    .index("by_storeId_terminalId", ["storeId", "terminalId"])
    .index("by_storeId_staffProfileId", ["storeId", "staffProfileId"])
    .index("by_storeId_status_terminalId", ["storeId", "status", "terminalId"])
    .index("by_storeId_status_staffProfileId", [
      "storeId",
      "status",
      "staffProfileId",
    ]),
  posSessionItem: defineTable(posSessionItemSchema)
    .index("by_sessionId", ["sessionId"])
    .index("by_sessionId_productSkuId", ["sessionId", "productSkuId"]),
  posLocalSyncEvent: defineTable(posLocalSyncEventSchema)
    .index("by_store_terminal_localEvent", [
      "storeId",
      "terminalId",
      "localEventId",
    ])
    .index("by_store_terminal_register_sequence", [
      "storeId",
      "terminalId",
      "localRegisterSessionId",
      "sequence",
    ])
    .index("by_store_terminal_sequence", ["storeId", "terminalId", "sequence"])
    .index("by_store_status", ["storeId", "status"])
    .index("by_localEventId", ["localEventId"]),
  posLifecycleJournal: defineTable(posLifecycleJournalSchema)
    .index("by_storeId_eventKey", ["storeId", "eventKey"])
    .index("by_storeId_recordedAt", ["storeId", "recordedAt"])
    .index("by_storeId_sequence", ["storeId", "sequence"])
    .index("by_storeId_occurredAt_recordedAt", [
      "storeId",
      "occurredAt",
      "recordedAt",
    ])
    .index("by_organizationId_storeId_recordedAt", [
      "organizationId",
      "storeId",
      "recordedAt",
    ])
    .index("by_transactionId_recordedAt", ["transactionId", "recordedAt"]),
  posLifecycleJournalCursor: defineTable(posLifecycleJournalCursorSchema).index(
    "by_storeId",
    ["storeId"],
  ),
  posLocalSyncCursor: defineTable(posLocalSyncCursorSchema)
    .index("by_store_terminal_scope_cursor", [
      "storeId",
      "terminalId",
      "syncScope",
      "localSyncCursorId",
    ])
    .index("by_store_terminal_register", [
      "storeId",
      "terminalId",
      "localRegisterSessionId",
    ])
    .index("by_store_terminal", ["storeId", "terminalId"])
    // Gap reconciliation sweeps only cursors that are actually stuck. Cursors
    // without a gap have `undefined` here, which sorts below every timestamp,
    // so a lower-bounded range scan skips the healthy majority entirely.
    .index("by_gap_first_observed", ["gap.firstObservedAt"]),
  posLocalSyncMapping: defineTable(posLocalSyncMappingSchema)
    .index("by_store_terminal_local", [
      "storeId",
      "terminalId",
      "localRegisterSessionId",
      "localIdKind",
      "localId",
    ])
    .index("by_store_terminal_localKindId", [
      "storeId",
      "terminalId",
      "localIdKind",
      "localId",
    ])
    .index("by_local_kind_id", ["localIdKind", "localId"])
    .index("by_store_terminal_localEvent", [
      "storeId",
      "terminalId",
      "localEventId",
    ])
    .index("by_store_terminal_cloud", [
      "storeId",
      "terminalId",
      "cloudTable",
      "cloudId",
    ])
    .index("by_localEventId", ["localEventId"]),
  posRegisterMappingAuthority: defineTable(posRegisterMappingAuthoritySchema)
    .index("by_store_terminal_localRegisterSession", [
      "storeId",
      "terminalId",
      "localRegisterSessionId",
    ])
    .index("by_store_terminal", ["storeId", "terminalId"]),
  posRegisterAuthorityReplicationStatus: defineTable(
    posRegisterAuthorityReplicationStatusSchema,
  )
    .index("by_terminalId", ["terminalId"])
    .index("by_store_terminal", ["storeId", "terminalId"]),
  posLocalSyncConflict: defineTable(posLocalSyncConflictSchema)
    .index("by_store_status", ["storeId", "status"])
    .index("by_store_type_status", ["storeId", "conflictType", "status"])
    .index("by_store_terminal_status", ["storeId", "terminalId", "status"])
    .index("by_store_terminal_localEvent", [
      "storeId",
      "terminalId",
      "localEventId",
    ])
    // Event-scoped open-row read for terminal cloud repair: truncation must be
    // judged on open rows only, so settled history never blocks convergence.
    .index("by_store_terminal_localEvent_status", [
      "storeId",
      "terminalId",
      "localEventId",
      "status",
    ])
    .index("by_localEventId", ["localEventId"])
    .index("by_store_terminal_register", [
      "storeId",
      "terminalId",
      "localRegisterSessionId",
    ])
    .index("by_store_terminal_register_status_type", [
      "storeId",
      "terminalId",
      "localRegisterSessionId",
      "status",
      "conflictType",
    ])
    .index("by_store_terminal_status_type", [
      "storeId",
      "terminalId",
      "status",
      "conflictType",
    ]),
  posLocalStaffProof: defineTable(posLocalStaffProofSchema)
    .index("by_tokenHash", ["tokenHash"])
    .index("by_staff_terminal_status", [
      "staffProfileId",
      "terminalId",
      "status",
    ]),
  posRegisterSessionActivity: defineTable(posRegisterSessionActivitySchema)
    .index("by_store_registerSession_sequence", [
      "storeId",
      "registerSessionId",
      "localSequence",
    ])
    .index("by_store_registerSession_time", [
      "storeId",
      "registerSessionId",
      "occurredAt",
    ])
    .index("by_store_terminal_localEvent", [
      "storeId",
      "terminalId",
      "localEventId",
    ])
    .index("by_store_terminal_register_sequence", [
      "storeId",
      "terminalId",
      "localRegisterSessionId",
      "localSequence",
    ])
    .index("by_store_terminal_register_status", [
      "storeId",
      "terminalId",
      "localRegisterSessionId",
      "status",
    ])
    .index("by_store_activityKey", ["storeId", "activityKey"]),
  posClientEvent: defineTable(posClientEventSchema)
    .index("by_store_clientEvent", ["storeId", "clientEventId"])
    .index("by_store_received", ["storeId", "receivedAt"])
    .index("by_store_level_received", ["storeId", "level", "receivedAt"])
    .index("by_store_terminal_received", [
      "storeId",
      "terminalId",
      "receivedAt",
    ]),
  posRegisterSessionActivityCheckpoint: defineTable(
    posRegisterSessionActivityCheckpointSchema,
  )
    .index("by_store_terminal_register", [
      "storeId",
      "terminalId",
      "localRegisterSessionId",
    ])
    .index("by_store_registerSession", ["storeId", "registerSessionId"])
    .index("by_store_terminal", ["storeId", "terminalId"])
    .index("by_updatedAt", ["updatedAt"]),
  expenseSession: defineTable(expenseSessionSchema)
    .index("by_storeId", ["storeId"])
    .index("by_status", ["status"])
    .index("by_staffProfileId", ["staffProfileId"])
    .index("by_staffProfileId_and_status", ["staffProfileId", "status"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"])
    .index("by_storeId_and_status", ["storeId", "status"])
    .index("by_storeId_terminalId", ["storeId", "terminalId"])
    .index("by_storeId_staffProfileId", ["storeId", "staffProfileId"])
    .index("by_storeId_status_terminalId", ["storeId", "status", "terminalId"])
    .index("by_storeId_status_staffProfileId", [
      "storeId",
      "status",
      "staffProfileId",
    ]),
  expenseSessionItem: defineTable(expenseSessionItemSchema).index(
    "by_sessionId",
    ["sessionId"],
  ),
  expenseTransaction: defineTable(expenseTransactionSchema)
    .index("by_storeId", ["storeId"])
    .index("by_status", ["status"])
    .index("by_staffProfileId", ["staffProfileId"])
    .index("by_sessionId", ["sessionId"])
    .index("by_storeId_status_completedAt", [
      "storeId",
      "status",
      "completedAt",
    ]),
  expenseTransactionItem: defineTable(expenseTransactionItemSchema).index(
    "by_transactionId",
    ["transactionId"],
  ),
  product: defineTable(productSchema)
    .index("by_categoryId", ["categoryId"])
    .index("by_storeId", ["storeId"])
    .index("by_storeId_categoryId", ["storeId", "categoryId"])
    .index("by_storeId_subcategoryId", ["storeId", "subcategoryId"])
    .index("by_subcategoryId", ["subcategoryId"]),
  productSku: defineTable(productSkuSchema)
    .index("by_color", ["color"])
    .index("by_productId", ["productId"])
    .index("by_storeId", ["storeId"])
    .index("by_storeId_barcode", ["storeId", "barcode"])
    .index("by_storeId_sku", ["storeId", "sku"]),
  productSkuSearch: defineTable(productSkuSearchSchema)
    .index("by_productSkuId", ["productSkuId"])
    .index("by_storeId", ["storeId"])
    .index("by_storeId_barcode", ["storeId", "normalizedBarcode"])
    .index("by_storeId_categoryId", ["storeId", "categoryId"])
    .index("by_storeId_colorId", ["storeId", "colorId"])
    .index("by_storeId_productId", ["storeId", "productId"])
    .index("by_storeId_productSkuId", ["storeId", "productSkuId"])
    .index("by_storeId_sku", ["storeId", "normalizedSku"])
    .index("by_storeId_subcategoryId", ["storeId", "subcategoryId"])
    .searchIndex("searchText", {
      searchField: "searchText",
      filterFields: ["storeId"],
    }),
  posRegisterCatalogRevision: defineTable(
    posRegisterCatalogRevisionSchema,
  ).index("by_storeId", ["storeId"]),
  purchaseOrder: defineTable(purchaseOrderSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_createdAt", ["storeId", "createdAt"])
    .index("by_storeId_status", ["storeId", "status"])
    .index("by_storeId_vendorId", ["storeId", "vendorId"])
    .index("by_storeId_poNumber", ["storeId", "poNumber"]),
  purchaseOrderLineItem: defineTable(purchaseOrderLineItemSchema)
    .index("by_purchaseOrderId", ["purchaseOrderId"])
    .index("by_storeId_productSkuId", ["storeId", "productSkuId"]),
  promoCode: defineTable(promoCodeSchema),
  promoCodeItem: defineTable(promoCodeItemSchema)
    .index("by_promoCodeId", ["promoCodeId"])
    .index("by_productSkuId", ["productSkuId"]),
  workflowTrace: defineTable(workflowTraceSchema)
    .index("by_storeId_traceId", ["storeId", "traceId"])
    .index("by_storeId_workflowType_primaryLookup", [
      "storeId",
      "workflowType",
      "primaryLookupType",
      "primaryLookupValue",
    ])
    .index("by_primarySubject", ["primarySubjectType", "primarySubjectId"]),
  workflowTraceEvent: defineTable(workflowTraceEventSchema)
    .index("by_storeId_traceId_occurredAt", [
      "storeId",
      "traceId",
      "occurredAt",
    ])
    .index("by_storeId_traceId_sequence", ["storeId", "traceId", "sequence"])
    .index("by_storeId_traceId_eventKey", ["storeId", "traceId", "eventKey"])
    .index("by_traceId_sequence", ["traceId", "sequence"]),
  workflowTraceLookup: defineTable(workflowTraceLookupSchema)
    .index("by_storeId_workflowType_lookup", [
      "storeId",
      "workflowType",
      "lookupType",
      "lookupValue",
    ])
    .index("by_traceId", ["traceId"]),
  operationalEvent: defineTable(operationalEventSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_createdAt", ["storeId", "createdAt"])
    .index("by_storeId_subject", ["storeId", "subjectType", "subjectId"])
    .index("by_customerProfileId", ["customerProfileId"])
    .index("by_workItemId", ["workItemId"])
    .index("by_registerSessionId", ["registerSessionId"])
    .index("by_terminalId", ["terminalId"])
    .index("by_localEventId", ["localEventId"]),
  managerElevation: defineTable(managerElevationSchema)
    .index("by_storeId_terminalId_accountId", [
      "storeId",
      "terminalId",
      "accountId",
    ])
    .index("by_storeId_managerStaffProfileId", [
      "storeId",
      "managerStaffProfileId",
    ])
    .index("by_storeId_terminalId_accountId_expiresAt", [
      "storeId",
      "terminalId",
      "accountId",
      "expiresAt",
    ])
    .index("by_expiresAt", ["expiresAt"]),
  operationalWorkItem: defineTable(operationalWorkItemSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_status", ["storeId", "status"])
    .index("by_storeId_type", ["storeId", "type"])
    .index("by_storeId_type_status", ["storeId", "type", "status"])
    .index("by_storeId_type_status_productId", [
      "storeId",
      "type",
      "status",
      "productId",
    ])
    .index("by_storeId_type_status_productSkuId", [
      "storeId",
      "type",
      "status",
      "productSkuId",
    ])
    .index("by_storeId_type_status_appointmentId", [
      "storeId",
      "type",
      "status",
      "appointmentId",
    ])
    .index("by_storeId_assignedTo", ["storeId", "assignedToStaffProfileId"])
    .index("by_customerProfileId", ["customerProfileId"])
    .index("by_approvalState", ["approvalState"]),
  paymentAllocation: defineTable(paymentAllocationSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_recordedAt", ["storeId", "recordedAt"])
    .index("by_storeId_allocationType_direction_status_recordedAt", [
      "storeId",
      "allocationType",
      "direction",
      "status",
      "recordedAt",
    ])
    .index("by_storeId_businessEventKey", ["storeId", "businessEventKey"])
    .index("by_storeId_target", ["storeId", "targetType", "targetId"])
    .index("by_registerSessionId", ["registerSessionId"])
    .index("by_posTransactionId", ["posTransactionId"])
    .index("by_customerProfileId", ["customerProfileId"])
    .index("by_onlineOrderId", ["onlineOrderId"])
    .index("by_workItemId", ["workItemId"]),
  redeemedPromoCode: defineTable(redeemedPromoCodeSchema).index(
    "by_promoCodeId_storeFrontUserId",
    ["promoCodeId", "storeFrontUserId"],
  ),
  registerSession: defineTable(registerSessionSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_status", ["storeId", "status"])
    .index("by_storeId_status_terminalId", ["storeId", "status", "terminalId"])
    .index("by_storeId_status_openedOperatingDate", [
      "storeId",
      "status",
      "openedOperatingDate",
    ])
    .index("by_storeId_status_closeoutOperatingDate", [
      "storeId",
      "status",
      "closeoutOperatingDate",
    ])
    .index("by_storeId_closeoutOperatingDate", [
      "storeId",
      "closeoutOperatingDate",
    ])
    .index("by_storeId_registerNumber", ["storeId", "registerNumber"])
    .index("by_terminalId", ["terminalId"])
    .index("by_managerApprovalRequestId", ["managerApprovalRequestId"]),
  savedBag: defineTable(savedBagSchema).index("by_storeFrontUserId", [
    "storeFrontUserId",
  ]),
  savedBagItem: defineTable(savedBagItemSchema)
    .index("by_savedBagId", ["savedBagId"])
    .index("by_savedBagId_storeFrontUserId_productSkuId", [
      "savedBagId",
      "storeFrontUserId",
      "productSkuId",
    ]),
  serviceAppointment: defineTable(serviceAppointmentSchema)
    .index("by_storeId_startAt", ["storeId", "startAt"])
    .index("by_staffProfileId_startAt", ["assignedStaffProfileId", "startAt"])
    .index("by_customerProfileId", ["customerProfileId"])
    .index("by_serviceCaseId", ["serviceCaseId"]),
  serviceCatalog: defineTable(serviceCatalogSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_status", ["storeId", "status"])
    .index("by_storeId_slug", ["storeId", "slug"]),
  serviceCase: defineTable(serviceCaseSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_status", ["storeId", "status"])
    .index("by_storeId_status_completedAt", [
      "storeId",
      "status",
      "completedAt",
    ])
    .index("by_operationalWorkItemId", ["operationalWorkItemId"])
    .index("by_customerProfileId", ["customerProfileId"])
    .index("by_appointmentId", ["appointmentId"]),
  serviceCaseLineItem: defineTable(serviceCaseLineItemSchema).index(
    "by_serviceCaseId",
    ["serviceCaseId"],
  ),
  serviceInventoryUsage: defineTable(serviceInventoryUsageSchema)
    .index("by_serviceCaseId", ["serviceCaseId"])
    .index("by_productSkuId", ["productSkuId"]),
  store: defineTable(storeSchema)
    .index("by_slug", ["slug"])
    .index("by_organizationId_slug", ["organizationId", "slug"]),
  storeAsset: defineTable(storeAssetSchema),
  storeSchedule: defineTable(storeScheduleSchema)
    .index("by_storeId_status_effectiveFrom", [
      "storeId",
      "status",
      "effectiveFrom",
    ])
    .index("by_organizationId_storeId_status", [
      "organizationId",
      "storeId",
      "status",
    ])
    .index("by_source_status", ["source", "status"]),
  storeTimezoneVersion: defineTable(storeTimezoneVersionSchema)
    .index("by_storeId_effectiveFrom", ["storeId", "effectiveFrom"])
    .index("by_organizationId_storeId_effectiveFrom", [
      "organizationId",
      "storeId",
      "effectiveFrom",
    ])
    .index("by_storeId_contentHash", ["storeId", "contentHash"]),
  storeFrontSession: defineTable(storeFrontSessionSchema),
  storeFrontUser: defineTable(storeFrontUserSchema),
  storeFrontVerificationCode: defineTable(storeFrontVerificationCode),
  subcategory: defineTable(subcategorySchema)
    .index("by_slug", ["slug"])
    .index("by_categoryId_slug", ["categoryId", "slug"]),
  supportTicket: defineTable(supportTicketSchema),
  vendor: defineTable(vendorSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_lookupKey", ["storeId", "lookupKey"])
    .index("by_storeId_status", ["storeId", "status"]),
  review: defineTable(reviewSchema)
    .index("by_orderItemId", ["orderItemId"])
    .index("by_createdByStoreFrontUserId", ["createdByStoreFrontUserId"])
    .index("by_createdByStoreFrontUserId_productSkuId", [
      "createdByStoreFrontUserId",
      "productSkuId",
    ])
    .index("by_productSkuId", ["productSkuId"])
    .index("by_storeId", ["storeId"])
    .index("by_productId", ["productId"]),
  reportingIntegrityAttempt: defineTable(reportingIntegrityAttemptSchema)
    .index("by_storeId_occurredAt", ["storeId", "occurredAt"])
    .index("by_outcome_occurredAt", ["outcome", "occurredAt"]),
  reportingIdentityMigrationRun: defineTable(
    reportingIdentityMigrationRunSchema,
  )
    .index("by_automationIdentity_startedAt", [
      "automationIdentity",
      "startedAt",
    ])
    .index("by_operation_status", ["operation", "status"])
    .index("by_operation_status_completedAt", [
      "operation",
      "status",
      "completedAt",
    ]),
  reportingIdentityMigrationCandidate: defineTable(
    reportingIdentityMigrationCandidateSchema,
  )
    .index("by_runId_userId", ["runId", "userId"])
    .index("by_runId_normalizedIdentityFingerprint", [
      "runId",
      "normalizedIdentityFingerprint",
    ]),
  reportingInventoryPosition: defineTable(reportingInventoryPositionSchema)
    .index("by_storeId_productSkuId", ["storeId", "productSkuId"])
    .index("by_storeId_productSkuId_mode", ["storeId", "productSkuId", "mode"])
    .index("by_storeId_mode", ["storeId", "mode"])
    .index("by_storeId_mode_lastEffectAt", ["storeId", "mode", "lastEffectAt"])
    .index("by_storeId_mode_updatedAt", ["storeId", "mode", "updatedAt"]),
  reportingInventoryPositionRevision: defineTable(
    reportingInventoryPositionRevisionSchema,
  )
    .index("by_positionId", ["positionId"])
    .index("by_positionId_recordedAt", ["positionId", "recordedAt"])
    .index("by_storeId", ["storeId"])
    .index("by_storeId_recordedAt", ["storeId", "recordedAt"]),
  reportingInventoryEffect: defineTable(reportingInventoryEffectSchema)
    .index("by_storeId_productSkuId_occurrenceAt", [
      "storeId",
      "productSkuId",
      "occurrenceAt",
    ])
    .index("by_storeId_sourceDomain_businessEventKey", [
      "storeId",
      "sourceDomain",
      "businessEventKey",
    ])
    .index("by_storeId_sourceDomain_projectionStatus_createdAt", [
      "storeId",
      "sourceDomain",
      "projectionStatus",
      "createdAt",
    ])
    .index("by_storeId_projectionStatus_createdAt", [
      "storeId",
      "projectionStatus",
      "createdAt",
    ])
    .index("by_positionId_occurrenceAt", ["positionId", "occurrenceAt"])
    .index("by_positionId_effectType", ["positionId", "effectType"])
    .index("by_linkedOutboundEffectId", ["linkedOutboundEffectId"])
    .index("by_linkedOutboundEffectId_effectType", [
      "linkedOutboundEffectId",
      "effectType",
    ]),
  reportingInventoryEffectSourceReference: defineTable(
    reportingInventoryEffectSourceReferenceSchema,
  )
    .index("by_effectId", ["effectId"])
    .index("by_storeId_sourceType_sourceId", [
      "storeId",
      "sourceType",
      "sourceId",
    ]),
  reportingInventoryDeficitLot: defineTable(reportingInventoryDeficitLotSchema)
    .index("by_positionId", ["positionId"])
    .index("by_positionId_status_occurredAt", [
      "positionId",
      "status",
      "occurredAt",
    ])
    .index("by_positionId_status_occurredAt_outboundEffectId", [
      "positionId",
      "status",
      "occurredAt",
      "outboundEffectId",
    ])
    .index("by_ledgerId_status_occurredAt_outboundEffectId", [
      "ledgerId",
      "status",
      "occurredAt",
      "outboundEffectId",
    ])
    .index("by_ledgerId_outboundEffectId", ["ledgerId", "outboundEffectId"])
    .index("by_outboundEffectId", ["outboundEffectId"]),
  reportingInventoryDeficitLedger: defineTable(
    reportingInventoryDeficitLedgerSchema,
  )
    .index("by_positionId_status", ["positionId", "status"]),
  reportingInventoryDeficitResolutionWork: defineTable(
    reportingInventoryDeficitResolutionWorkSchema,
  )
    .index("by_inboundEffectId", ["inboundEffectId"])
    .index("by_ledgerId_status_updatedAt", ["ledgerId", "status", "updatedAt"])
    .index("by_positionId_status_updatedAt", [
      "positionId",
      "status",
      "updatedAt",
    ])
    .index("by_storeId_status_updatedAt", ["storeId", "status", "updatedAt"]),
  reportingSkuValuationCorrection: defineTable(
    reportingSkuValuationCorrectionSchema,
  )
    .index("by_storeId_requestKey", ["storeId", "requestKey"])
    .index("by_storeId_productSkuId_occurredAt", [
      "storeId",
      "productSkuId",
      "occurredAt",
    ]),
  rewardPoints: defineTable(rewardPointsSchema).index("by_user_store", [
    "storeFrontUserId",
    "storeId",
  ]),
  rewardTransactions: defineTable(rewardTransactionSchema)
    .index("by_user", ["storeFrontUserId"])
    .index("by_order", ["orderId"]),
  rewardTiers: defineTable(rewardTierSchema).index("by_store", ["storeId"]),
  offer: defineTable(offerSchema)
    .index("by_email", ["email"])
    .index("by_storeFrontUserId", ["storeFrontUserId"])
    .index("by_storeFrontUserId_promoCodeId", [
      "storeFrontUserId",
      "promoCodeId",
    ])
    .index("by_promoCodeId", ["promoCodeId"])
    .index("by_storeId", ["storeId"])
    .index("by_storeId_status", ["storeId", "status"]),
  staffProfile: defineTable(staffProfileSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_linkedUserId", ["storeId", "linkedUserId"])
    .index("by_storeId_status", ["storeId", "status"]),
  staffRoleAssignment: defineTable(staffRoleAssignmentSchema)
    .index("by_staffProfileId", ["staffProfileId"])
    .index("by_storeId", ["storeId"])
    .index("by_storeId_role", ["storeId", "role"]),
  staffCredential: defineTable(staffCredentialSchema)
    .index("by_staffProfileId", ["staffProfileId"])
    .index("by_staffProfileId_status", ["staffProfileId", "status"])
    .index("by_storeId_username", ["storeId", "username"])
    .index("by_storeId_status", ["storeId", "status"]),

  // --- Rebuilt reports layer (convex/reports/) ---
  reportFact: defineTable(reportFactSchema)
    .index("by_identity", [
      "storeId",
      "sourceDomain",
      "sourceId",
      "lineId",
      "factKind",
    ])
    .index("by_storeId_operatingDate", ["storeId", "operatingDate"])
    .index("by_storeId_operatingDate_observedAt", [
      "storeId",
      "operatingDate",
      "observedAt",
    ])
    .index("by_storeId_productSkuId_operatingDate", [
      "storeId",
      "productSkuId",
      "operatingDate",
    ]),
  reportDay: defineTable(reportDaySchema).index("by_storeId_operatingDate", [
    "storeId",
    "operatingDate",
  ]),
  reportSkuDay: defineTable(reportSkuDaySchema)
    .index("by_storeId_operatingDate_productSkuId", [
      "storeId",
      "operatingDate",
      "productSkuId",
    ])
    .index("by_storeId_productSkuId_operatingDate", [
      "storeId",
      "productSkuId",
      "operatingDate",
    ]),
  reportOverview: defineTable(reportOverviewSchema).index("by_storeId", [
    "storeId",
  ]),
  reportPeriodSkuRollup: defineTable(reportPeriodSkuRollupSchema)
    .index("by_storeId_periodKey_revenueSortKey", [
      "storeId",
      "periodKey",
      "revenueSortKey",
    ])
    .index("by_storeId_periodKey_unitsSortKey", [
      "storeId",
      "periodKey",
      "unitsSortKey",
    ])
    .index("by_storeId_periodKey_productSkuId", [
      "storeId",
      "periodKey",
      "productSkuId",
    ]),
  reportDirtyDay: defineTable(reportDirtyDaySchema)
    .index("by_storeId_operatingDate", ["storeId", "operatingDate"])
    .index("by_markedAt", ["markedAt"]),
  reportWeekCurrent: defineTable(reportWeekCurrentSchema).index("by_storeId", [
    "storeId",
  ]),
  reportWeekAccepted: defineTable(reportWeekAcceptedSchema)
    .index("by_storeId_cycleStartDate", ["storeId", "cycleStartDate"])
    .index("by_storeId_acceptedAt", ["storeId", "acceptedAt"]),
  reportDirtyWeek: defineTable(reportDirtyWeekSchema)
    .index("by_storeId", ["storeId"])
    .index("by_markedAt", ["markedAt"]),
  reportRangeResult: defineTable(reportRangeResultSchema)
    .index("by_storeId_requestKey", ["storeId", "requestKey"])
    .index("by_expiresAt", ["expiresAt"])
    // Global eligible-work queue for the movement lifecycle: rows whose
    // `movementEligibleAt` has passed are (re)scheduled by the sweeper's
    // unconditional backstop scan. Legacy/summary rows never set the field
    // and are excluded by querying gte 1 (undefined sorts below all numbers).
    .index("by_movementEligibleAt", ["movementEligibleAt"]),
  reportRangeMovementSku: defineTable(reportRangeMovementSkuSchema)
    // Store-bound uniqueness per (request, SKU); accumulation upserts here.
    .index("by_storeId_rangeResultId_productSkuId", [
      "storeId",
      "rangeResultId",
      "productSkuId",
    ])
    // Deterministic ranking traversal: descending |netUnits| (negated key,
    // ascending index) with stable SKU identity as the tie-break.
    .index("by_storeId_rangeResultId_absNetUnitsSortKey_productSkuId", [
      "storeId",
      "rangeResultId",
      "absNetUnitsSortKey",
      "productSkuId",
    ])
    // Direct 20-row page reads over a finalized ordinal-rank interval.
    .index("by_storeId_rangeResultId_rank", [
      "storeId",
      "rangeResultId",
      "rank",
    ])
    // Eligible-cleanup scan; children are deleted before their header.
    .index("by_expiresAt", ["expiresAt"]),
  reportRangeMixSku: defineTable(reportRangeMixSkuSchema)
    // Store-bound uniqueness per (request, SKU); accumulation upserts here.
    .index("by_storeId_rangeResultId_productSkuId", [
      "storeId",
      "rangeResultId",
      "productSkuId",
    ])
    // Deterministic top-5 selection at read time: descending units sold
    // (negated key, ascending index) with stable SKU identity as the
    // tie-break. No rank index — mix has no ranking phase.
    .index("by_storeId_rangeResultId_unitsSoldSortKey_productSkuId", [
      "storeId",
      "rangeResultId",
      "unitsSoldSortKey",
      "productSkuId",
    ])
    // Eligible-cleanup scan; children are deleted before their header.
    .index("by_expiresAt", ["expiresAt"]),
  reportMovementAdmission: defineTable(reportMovementAdmissionSchema).index(
    "by_scope_key",
    ["scope", "key"],
  ),
  reportVerificationRun: defineTable(reportVerificationRunSchema).index(
    "by_store_subject",
    ["storeId", "subjectKind", "subjectKey"],
  ),
});

export default schema;
