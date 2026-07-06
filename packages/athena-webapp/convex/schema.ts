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
  inventoryImportProvisionalSkuSchema,
  inventoryImportReviewVersionSchema,
  productSchema,
  productSkuSearchSchema,
  productSkuSchema,
  promoCodeItemSchema,
  promoCodeSchema,
  redeemedPromoCodeSchema,
  storeAssetSchema,
  storeScheduleSchema,
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
  posPendingCheckoutItemSchema,
  posPendingCheckoutLookupAliasSchema,
  posLocalStaffProofSchema,
  posRecoveryCredentialSchema,
  posTerminalRecoveryCommandSchema,
  posTerminalRuntimeStatusSchema,
  posRegisterSessionActivitySchema,
  posRegisterSessionActivityCheckpointSchema,
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
  automationPolicySchema,
  automationRunSchema,
  scheduledRunLedgerSchema,
} from "./schemas/automation";
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
  remoteAssistClientSchema,
  remoteAssistSessionEventSchema,
  remoteAssistSessionSchema,
} from "./schemas/remoteAssist";

const schema = defineSchema({
  ...authTables,
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
    .index("by_storeId_domain_action_outcome", [
      "storeId",
      "domain",
      "action",
      "outcome",
    ])
    .index("by_storeId_outcome", ["storeId", "outcome"])
    .index("by_storeId_idempotencyKey", ["storeId", "idempotencyKey"]),
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
  athenaUser: defineTable(athenaUserSchema),
  contextEvent: defineTable(contextEventSchema)
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
    .index("by_artifactId", ["artifactId"]),
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
  bestSeller: defineTable(bestSellerSchema),
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
  featuredItem: defineTable(featuredItemSchema),
  guest: defineTable(guestSchema)
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
    .index("by_storeId_importKey", ["storeId", "importKey"]),
  inventoryImportProvisionalSku: defineTable(
    inventoryImportProvisionalSkuSchema,
  )
    .index("by_storeId_status", ["storeId", "status"])
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
    .index("by_storeId_source", ["storeId", "sourceType", "sourceId"])
    .index("by_workItemId", ["workItemId"]),
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
  posTransaction: defineTable(posTransactionSchema)
    .index("by_storeId", ["storeId"])
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
    .index("by_store_terminal", ["storeId", "terminalId"]),
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
  posLocalSyncConflict: defineTable(posLocalSyncConflictSchema)
    .index("by_store_status", ["storeId", "status"])
    .index("by_store_type_status", ["storeId", "conflictType", "status"])
    .index("by_store_terminal_status", ["storeId", "terminalId", "status"])
    .index("by_store_terminal_localEvent", [
      "storeId",
      "terminalId",
      "localEventId",
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
  purchaseOrder: defineTable(purchaseOrderSchema)
    .index("by_storeId", ["storeId"])
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
});

export default schema;
