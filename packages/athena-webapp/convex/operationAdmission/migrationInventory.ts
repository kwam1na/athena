export type OperationAdmissionMigrationWave =
  | "administration"
  | "billing-and-payments"
  | "cash-controls"
  | "catalog"
  | "daily-operations"
  | "demo-lifecycle"
  | "expense"
  | "identity-and-staff"
  | "intelligence"
  | "inventory-import"
  | "operations-support"
  | "pos"
  | "procurement"
  | "reporting"
  | "service-ops"
  | "store-configuration"
  | "storefront";

export type OperationAdmissionMigrationInventoryGroup = {
  wave: OperationAdmissionMigrationWave;
  capability: string;
  owner: "V26-1094";
  reason: string;
  functions: readonly string[];
};

export type OperationAdmissionLegacyExemption = {
  functionName: string;
  capability: string;
  wave: OperationAdmissionMigrationWave;
  owner: "V26-1094";
  reason: string;
};

const LEGACY_REASON =
  "Existing public write mutation pending operationAdmission definition migration.";

export const OPERATION_ADMISSION_MIGRATION_INVENTORY = [
  {
    wave: "administration",
    capability: "administration.destructive",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "inventory/organizations:remove",
      "inventory/products:removeAllProductsForStore",
      "inventory/stores:remove",
      "pos/public/terminals:deleteTerminal",
    ],
  },
  {
    wave: "administration",
    capability: "administration.maintenance",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "devPatchBadTransaction:patchBadTransaction",
      "inventory/productSku:nukeProblematicImages",
      "inventory/skuSearch:removeStaleProductSkuSearchPage",
      "inventory/skuSearch:repairProductSkuSearchPage",
    ],
  },
  {
    wave: "administration",
    capability: "organization.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "inventory/organizations:create",
      "inventory/organizations:update",
    ],
  },
  {
    wave: "administration",
    capability: "store.configure",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "inventory/storeSchedule:upsertStoreScheduleCommand",
      "inventory/stores:cleanupLegacyConfigKeysPage",
      "inventory/stores:create",
      "inventory/stores:migrateConfigToV2Page",
      "inventory/stores:patchConfigV2",
      "inventory/stores:update",
      "operations/dailyOperationsAutomation:updateEodAutoCompletePolicy",
      "operations/dailyOperationsAutomation:updateOpeningAutoStartPolicy",
      "operations/dailyOperationsAutomation:updateRegisterCloseoutApprovalPolicy",
    ],
  },
  {
    wave: "cash-controls",
    capability: "cash.control.write",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "cashControls/closeouts:correctRegisterSessionOpeningFloat",
      "cashControls/closeouts:finalizeRegisterSessionCloseout",
      "cashControls/closeouts:reopenRegisterSessionCloseout",
      "cashControls/closeouts:reviewRegisterSessionCloseout",
      "cashControls/closeouts:submitRegisterSessionCloseout",
      "cashControls/deposits:recordRegisterSessionDeposit",
      "cashControls/deposits:resolveRegisterSessionSyncReview",
      "pos/public/register:openDrawer",
    ],
  },
  {
    wave: "catalog",
    capability: "catalog.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "inventory/categories:create",
      "inventory/categories:remove",
      "inventory/categories:update",
      "inventory/colors:create",
      "inventory/colors:remove",
      "inventory/colors:update",
      "inventory/productSku:backfillUndefinedSkuVisibilityFromProducts",
      "inventory/productSku:generateUploadUrl",
      "inventory/productSku:makeAllProductsVisible",
      "inventory/productSku:update",
      "inventory/products:archive",
      "inventory/products:batchUpdateSkuPrices",
      "inventory/products:create",
      "inventory/products:createSku",
      "inventory/products:generateUniqueBarcode",
      "inventory/products:removeSku",
      "inventory/products:repairCatalogSummary",
      "inventory/products:unarchive",
      "inventory/products:update",
      "inventory/products:updateSku",
      "inventory/subcategories:create",
      "inventory/subcategories:remove",
      "inventory/subcategories:update",
    ],
  },
  {
    wave: "catalog",
    capability: "catalog.quick_add",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: ["pos/public/catalog:quickAddSku"],
  },
  {
    wave: "catalog",
    capability: "inventory.adjust",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "pos/public/transactions:updateInventory",
      "stockOps/adjustments:submitStockAdjustmentBatch",
      "stockOps/adjustments:temporaryDeleteStockAdjustmentScopeSkus",
      "stockOps/cycleCountDrafts:discardCycleCountDraft",
      "stockOps/cycleCountDrafts:ensureCycleCountDraft",
      "stockOps/cycleCountDrafts:refreshCycleCountDraftLineBaseline",
      "stockOps/cycleCountDrafts:saveCycleCountDraftLine",
      "stockOps/cycleCountDrafts:submitActiveCycleCountDrafts",
      "stockOps/cycleCountDrafts:submitCycleCountDraft",
    ],
  },
  {
    wave: "catalog",
    capability: "inventory.import",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "inventory/catalogImport:finalizeTrustedInventoryFromProductPage",
      "inventory/catalogImport:importInventory",
      "inventory/catalogImport:saveInventoryImportReviewVersion",
      "inventory/catalogImport:stageInventoryImportReviewRowsForPos",
    ],
  },
  {
    wave: "daily-operations",
    capability: "daily_operations.write",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "operations/dailyClose:completeDailyClose",
      "operations/dailyClose:reopenDailyClose",
      "operations/dailyClose:resolveDailyCloseCarryForward",
      "operations/dailyOpening:startStoreDay",
      "pos/public/terminals:registerTerminal",
    ],
  },
  {
    wave: "expense",
    capability: "expense.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "inventory/expenseSessionItems:addOrUpdateExpenseItem",
      "inventory/expenseSessionItems:removeExpenseItem",
      "inventory/expenseSessions:bindExpenseSessionToRegisterSession",
      "inventory/expenseSessions:completeExpenseSession",
      "inventory/expenseSessions:createExpenseSession",
      "inventory/expenseSessions:holdExpenseSession",
      "inventory/expenseSessions:releaseExpenseSessionInventoryHoldsAndDeleteItems",
      "inventory/expenseSessions:resumeExpenseSession",
      "inventory/expenseSessions:updateExpenseSession",
      "inventory/expenseSessions:voidExpenseSession",
      "inventory/expenseTransactions:voidExpenseTransaction",
    ],
  },
  {
    wave: "identity-and-staff",
    capability: "identity.authenticate",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "inventory/auth:syncAuthenticatedAthenaUser",
      "inventory/auth:verifyCode",
      "storeFront/auth:verifyCode",
    ],
  },
  {
    wave: "identity-and-staff",
    capability: "identity.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "operations/staffCredentials:createStaffCredential",
      "operations/staffCredentials:updateStaffCredential",
    ],
  },
  {
    wave: "identity-and-staff",
    capability: "permissions.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: ["inventory/inviteCode:create", "inventory/inviteCode:redeem"],
  },
  {
    wave: "identity-and-staff",
    capability: "staff.authenticate",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "operations/managerElevations:endManagerElevation",
      "operations/managerElevations:startManagerElevation",
      "operations/staffCredentials:authenticateStaffCredential",
      "operations/staffCredentials:authenticateStaffCredentialForApproval",
      "operations/staffCredentials:authenticateStaffCredentialForTerminal",
      "operations/staffCredentials:refreshTerminalStaffAuthority",
      "operations/staffCredentials:validateRestoredPosLocalStaffProof",
    ],
  },
  {
    wave: "identity-and-staff",
    capability: "staff.communication.write",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: ["operations/staffMessages:postStaffMessage"],
  },
  {
    wave: "identity-and-staff",
    capability: "staff.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "operations/staffProfiles:createStaffProfile",
      "operations/staffProfiles:updateStaffProfile",
    ],
  },
  {
    wave: "intelligence",
    capability: "intelligence.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: ["intelligence/runs:dismissArtifact"],
  },
  {
    wave: "operations-support",
    capability: "appointments.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "serviceOps/appointments:cancelAppointment",
      "serviceOps/appointments:convertAppointmentToWalkIn",
      "serviceOps/appointments:createAppointment",
      "serviceOps/appointments:rescheduleAppointment",
    ],
  },
  {
    wave: "operations-support",
    capability: "integrations.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: ["inventory/stores:patchConfigV2Command"],
  },
  {
    wave: "operations-support",
    capability: "remote_assist.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "remoteAssist/public:endSupportSession",
      "remoteAssist/public:startSession",
    ],
  },
  {
    wave: "operations-support",
    capability: "reviews.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "storeFront/reviews:approve",
      "storeFront/reviews:create",
      "storeFront/reviews:deleteReview",
      "storeFront/reviews:markHelpful",
      "storeFront/reviews:publish",
      "storeFront/reviews:reject",
      "storeFront/reviews:unpublish",
      "storeFront/reviews:update",
    ],
  },
  {
    wave: "operations-support",
    capability: "rewards.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "storeFront/rewards:awardPointsForGuestOrders",
      "storeFront/rewards:awardPointsForPastOrder",
      "storeFront/rewards:createRewardTier",
      "storeFront/rewards:redeemPoints",
    ],
  },
  {
    wave: "pos",
    capability: "pos.catalog.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "pos/public/catalog:createOrReusePendingCheckoutItemForSale",
      "pos/public/catalog:finalizePendingCheckoutTrustedInventoryFromProductPage",
      "pos/public/catalog:resolvePendingCheckoutItemReview",
    ],
  },
  {
    wave: "pos",
    capability: "pos.customer.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "pos/public/customers:createCustomer",
      "pos/public/customers:linkToGuest",
      "pos/public/customers:linkToStoreFrontUser",
      "pos/public/customers:resolveGuestMatch",
      "pos/public/customers:resolvePosCustomerSelection",
      "pos/public/customers:resolveStoreFrontUserMatch",
      "pos/public/customers:updateCustomer",
      "pos/public/customers:updateCustomerStats",
    ],
  },
  {
    wave: "pos",
    capability: "pos.recovery.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "pos/public/posRecoveryCodes:revokeRecoveryCode",
      "pos/public/posRecoveryCodes:rotateRecoveryCode",
      "pos/public/posRecoveryCodes:unlockRecoveryCode",
    ],
  },
  {
    wave: "pos",
    capability: "pos.sale.complete",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "pos/public/transactions:completeTransaction",
      "pos/public/transactions:createTransactionFromSession",
    ],
  },
  {
    wave: "pos",
    capability: "pos.session.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "inventory/posSessionItems:addOrUpdateItem",
      "inventory/posSessionItems:removeItem",
      "inventory/posSessions:bindSessionToRegisterSession",
      "inventory/posSessions:cleanupOldSessions",
      "inventory/posSessions:completeSession",
      "inventory/posSessions:createSession",
      "inventory/posSessions:expireAllSessionsForStaff",
      "inventory/posSessions:expireSessionFromOperations",
      "inventory/posSessions:holdSession",
      "inventory/posSessions:releaseSessionInventoryHoldsAndDeleteItems",
      "inventory/posSessions:resumeSession",
      "inventory/posSessions:syncSessionCheckoutState",
      "inventory/posSessions:updateSession",
      "inventory/posSessions:voidSession",
    ],
  },
  {
    wave: "pos",
    capability: "pos.sync.write",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "pos/public/sync:ingestLocalEvents",
      "pos/public/sync:ingestRegisterSessionActivity",
      "pos/public/sync:resolveLocalSyncReview",
      "pos/public/telemetry:recordClientEvents",
    ],
  },
  {
    wave: "pos",
    capability: "pos.terminal.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "pos/public/terminalAppSessions:validateTerminalAppSessionRecovery",
      "pos/public/terminals:acknowledgeRegisterLifecycleAuthority",
      "pos/public/terminals:acknowledgeTerminalRecoveryCommand",
      "pos/public/terminals:claimTerminalRecoveryCommand",
      "pos/public/terminals:disconnectRemoteAssistSession",
      "pos/public/terminals:issueTerminalRecoveryCommand",
      "pos/public/terminals:resolveTerminalCloudRepair",
      "pos/public/terminals:submitTerminalRuntimeStatus",
      "pos/public/terminals:updateTerminal",
    ],
  },
  {
    wave: "pos",
    capability: "pos.transaction.correct",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "pos/public/transactions:adjustTransactionItems",
      "pos/public/transactions:correctTransactionCustomer",
      "pos/public/transactions:correctTransactionPaymentMethod",
      "pos/public/transactions:markReceiptPrinted",
    ],
  },
  {
    wave: "pos",
    capability: "pos.transaction.void",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: ["pos/public/transactions:voidTransaction"],
  },
  {
    wave: "procurement",
    capability: "procurement.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "stockOps/purchaseOrders:advancePurchaseOrderToOrderedCommand",
      "stockOps/purchaseOrders:createPurchaseOrder",
      "stockOps/purchaseOrders:createPurchaseOrderCommand",
      "stockOps/purchaseOrders:updatePurchaseOrderStatus",
      "stockOps/purchaseOrders:updatePurchaseOrderStatusCommand",
      "stockOps/receiving:receivePurchaseOrderBatch",
      "stockOps/vendors:createVendor",
      "stockOps/vendors:createVendorCommand",
    ],
  },
  {
    wave: "reporting",
    capability: "exports.generate",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: ["reporting/export:requestExport"],
  },
  {
    wave: "reporting",
    capability: "reporting.generate",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: ["reporting/customRangeRequests:requestCustomRange"],
  },
  {
    wave: "reporting",
    capability: "reporting.maintain",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "reporting/evidence:resolvePendingCheckoutSkuAttributionConflictForStore",
      "reporting/inventory/corrections:correctSkuValuation",
      "reporting/maintenance/authorizedPosBackfill:authorizePosReportingBackfill",
      "reporting/maintenance/legacyCompatibility:approveDraft",
      "reporting/maintenance/legacyCompatibility:createDraft",
    ],
  },
  {
    wave: "service-ops",
    capability: "service.cases.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "serviceOps/serviceCases:addServiceCaseLineItem",
      "serviceOps/serviceCases:createServiceCase",
      "serviceOps/serviceCases:createWalkInServiceCase",
      "serviceOps/serviceCases:recordServiceInventoryUsage",
      "serviceOps/serviceCases:updateServiceCaseStatus",
    ],
  },
  {
    wave: "service-ops",
    capability: "service.catalog.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "serviceOps/catalog:archiveServiceCatalogItem",
      "serviceOps/catalog:createServiceCatalogItem",
      "serviceOps/catalog:updateServiceCatalogItem",
    ],
  },
  {
    wave: "service-ops",
    capability: "service.intake.write",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: ["operations/serviceIntake:createServiceIntake"],
  },
  {
    wave: "storefront",
    capability: "billing.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: ["serviceOps/serviceCases:recordServicePayment"],
  },
  {
    wave: "storefront",
    capability: "customer.messaging.send",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: ["storeFront/supportTicket:create"],
  },
  {
    wave: "storefront",
    capability: "orders.create",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: ["storeFront/checkoutSession:create"],
  },
  {
    wave: "storefront",
    capability: "orders.fulfill",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: ["storeFront/onlineOrder:update"],
  },
  {
    wave: "storefront",
    capability: "orders.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "storeFront/onlineOrder:create",
      "storeFront/onlineOrder:updateOrderItems",
      "storeFront/onlineOrder:updateOwner",
      "storeFront/onlineOrderItem:update",
    ],
  },
  {
    wave: "storefront",
    capability: "orders.return",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "storeFront/onlineOrder:returnAllItemsToStock",
      "storeFront/onlineOrder:returnItemsToStock",
    ],
  },
  {
    wave: "storefront",
    capability: "payments.refund",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: ["storeFront/onlineOrder:processReturnExchange"],
  },
  {
    wave: "storefront",
    capability: "storefront.analytics.write",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "storeFront/analytics:clear",
      "storeFront/analytics:create",
      "storeFront/analytics:updateOwner",
    ],
  },
  {
    wave: "storefront",
    capability: "storefront.content.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "inventory/bannerMessage:remove",
      "inventory/bannerMessage:upsert",
      "inventory/bestSeller:create",
      "inventory/bestSeller:remove",
      "inventory/bestSeller:updateRanks",
      "inventory/complimentaryProduct:batchCreateComplimentaryProducts",
      "inventory/complimentaryProduct:createCollection",
      "inventory/complimentaryProduct:createComplimentaryProduct",
      "inventory/complimentaryProduct:toggleCollectionActive",
      "inventory/complimentaryProduct:toggleComplimentaryProductActive",
      "inventory/featuredItem:create",
      "inventory/featuredItem:remove",
      "inventory/featuredItem:updateRanks",
      "inventory/promoCode:create",
      "inventory/promoCode:remove",
      "inventory/promoCode:update",
      "storeFront/offers:create",
    ],
  },
  {
    wave: "storefront",
    capability: "storefront.session.manage",
    owner: "V26-1094",
    reason: LEGACY_REASON,
    functions: [
      "storeFront/bag:deleteBag",
      "storeFront/guest:deleteGuest",
      "storeFront/savedBag:deleteSavedBag",
    ],
  },
] as const satisfies readonly OperationAdmissionMigrationInventoryGroup[];

export const OPERATION_ADMISSION_LEGACY_EXEMPTIONS =
  OPERATION_ADMISSION_MIGRATION_INVENTORY.flatMap((group) =>
    group.functions.map((functionName) => ({
      functionName,
      capability: group.capability,
      wave: group.wave,
      owner: group.owner,
      reason: group.reason,
    })),
  ) satisfies OperationAdmissionLegacyExemption[];
