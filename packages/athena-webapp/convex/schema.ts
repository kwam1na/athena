import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import {
  appVerificationCodeSchema,
  athenaUserSchema,
  bannerMessageSchema,
  bestSellerSchema,
  categorySchema,
  colorSchema,
  featuredItemSchema,
  inviteCodeSchema,
  organizationMemberSchema,
  organizationSchema,
  inventoryHoldSchema,
  productSchema,
  productSkuSchema,
  promoCodeItemSchema,
  promoCodeSchema,
  redeemedPromoCodeSchema,
  storeAssetSchema,
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
  posSessionItemSchema,
  posCustomerSchema,
  posTerminalSchema,
  expenseSessionSchema,
  expenseSessionItemSchema,
  expenseTransactionSchema,
  expenseTransactionItemSchema,
} from "./schemas/pos";
import { posSessionSchema } from "./schemas/pos/posSession";
import {
  mtnCollectionsTokenSchema,
  mtnCollectionTransactionSchema,
} from "./schemas/payments/mtnCollections";
import {
  approvalRequestSchema,
  customerProfileSchema,
  inventoryMovementSchema,
  operationalEventSchema,
  operationalWorkItemSchema,
  paymentAllocationSchema,
  registerSessionSchema,
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
    .index("by_storeId_subject", ["storeId", "subjectType", "subjectId"])
    .index("by_workItemId", ["workItemId"])
    .index("by_registerSessionId", ["registerSessionId"]),
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
  athenaUser: defineTable(athenaUserSchema),
  bag: defineTable(bagSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeFrontUserId", ["storeFrontUserId"]),
  bagItem: defineTable(bagItemSchema)
    .index("by_bagId", ["bagId"])
    .index("by_productSkuId", ["productSkuId"]),
  bannerMessage: defineTable(bannerMessageSchema).index("by_storeId", [
    "storeId",
  ]),
  bestSeller: defineTable(bestSellerSchema),
  category: defineTable(categorySchema).index("by_storeId_slug", [
    "storeId",
    "slug",
  ]),
  checkoutSession: defineTable(checkoutSessionSchema)
    .index("by_storeFrontUserId", ["storeFrontUserId"])
    .index("by_storeId", ["storeId"]),
  checkoutSessionItem: defineTable(checkoutSessionItemSchema).index(
    "by_sessionId",
    ["sesionId"]
  ),
  color: defineTable(colorSchema),
  complimentaryProductsCollection: defineTable(
    complimentaryProductsCollectionSchema
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
    .index("by_sourceSessionId_status_productSkuId", [
      "sourceSessionId",
      "status",
      "productSkuId",
    ]),
  inventoryMovement: defineTable(inventoryMovementSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_productSkuId", ["storeId", "productSkuId"])
    .index("by_storeId_source", ["storeId", "sourceType", "sourceId"])
    .index("by_workItemId", ["workItemId"]),
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
  mtnCollectionsToken: defineTable(mtnCollectionsTokenSchema).index("by_storeId", ["storeId"]),
  mtnCollectionTransaction: defineTable(mtnCollectionTransactionSchema)
    .index("by_providerReference", ["providerReference"])
    .index("by_storeId_requestedAt", ["storeId", "requestedAt"]),
  organization: defineTable(organizationSchema),
  organizationMember: defineTable(organizationMemberSchema),
  posCustomer: defineTable(posCustomerSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_and_email", ["storeId", "email"])
    .index("by_storeId_and_phone", ["storeId", "phone"])
    .index("by_linkedStoreFrontUserId", ["linkedStoreFrontUserId"]),
  posTerminal: defineTable(posTerminalSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_and_fingerprintHash", ["storeId", "fingerprintHash"])
    .index("by_storeId_registerNumber", ["storeId", "registerNumber"]),
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
  posTransactionItem: defineTable(posTransactionItemSchema).index(
    "by_transactionId",
    ["transactionId"]
  ),
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
    ["sessionId"]
  ),
  expenseTransaction: defineTable(expenseTransactionSchema)
    .index("by_storeId", ["storeId"])
    .index("by_status", ["status"])
    .index("by_staffProfileId", ["staffProfileId"])
    .index("by_sessionId", ["sessionId"]),
  expenseTransactionItem: defineTable(expenseTransactionItemSchema).index(
    "by_transactionId",
    ["transactionId"]
  ),
  product: defineTable(productSchema).index("by_storeId", ["storeId"]),
  productSku: defineTable(productSkuSchema)
    .index("by_productId", ["productId"])
    .index("by_storeId", ["storeId"])
    .index("by_storeId_barcode", ["storeId", "barcode"])
    .index("by_storeId_sku", ["storeId", "sku"]),
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
    .index("by_storeId_traceId_occurredAt", ["storeId", "traceId", "occurredAt"])
    .index("by_storeId_traceId_sequence", ["storeId", "traceId", "sequence"])
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
    .index("by_storeId_subject", ["storeId", "subjectType", "subjectId"])
    .index("by_customerProfileId", ["customerProfileId"])
    .index("by_workItemId", ["workItemId"])
    .index("by_registerSessionId", ["registerSessionId"]),
  operationalWorkItem: defineTable(operationalWorkItemSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_status", ["storeId", "status"])
    .index("by_storeId_type", ["storeId", "type"])
    .index("by_storeId_assignedTo", ["storeId", "assignedToStaffProfileId"])
    .index("by_customerProfileId", ["customerProfileId"])
    .index("by_approvalState", ["approvalState"]),
  paymentAllocation: defineTable(paymentAllocationSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_target", ["storeId", "targetType", "targetId"])
    .index("by_registerSessionId", ["registerSessionId"])
    .index("by_customerProfileId", ["customerProfileId"])
    .index("by_onlineOrderId", ["onlineOrderId"])
    .index("by_workItemId", ["workItemId"]),
  redeemedPromoCode: defineTable(redeemedPromoCodeSchema).index(
    "by_promoCodeId_storeFrontUserId",
    ["promoCodeId", "storeFrontUserId"]
  ),
  registerSession: defineTable(registerSessionSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_status", ["storeId", "status"])
    .index("by_storeId_registerNumber", ["storeId", "registerNumber"])
    .index("by_terminalId", ["terminalId"])
    .index("by_managerApprovalRequestId", ["managerApprovalRequestId"]),
  savedBag: defineTable(savedBagSchema).index("by_storeFrontUserId", [
    "storeFrontUserId",
  ]),
  savedBagItem: defineTable(savedBagItemSchema).index("by_savedBagId", [
    "savedBagId",
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
    ["serviceCaseId"]
  ),
  serviceInventoryUsage: defineTable(serviceInventoryUsageSchema)
    .index("by_serviceCaseId", ["serviceCaseId"])
    .index("by_productSkuId", ["productSkuId"]),
  store: defineTable(storeSchema),
  storeAsset: defineTable(storeAssetSchema),
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
