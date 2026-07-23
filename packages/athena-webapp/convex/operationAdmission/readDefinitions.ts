import type { Id } from "../_generated/dataModel";
import type { OperationReadDefinition } from "./types";

export function defineReadOperation<T extends OperationReadDefinition>(
  definition: T,
) {
  return definition;
}

function defineDailyOperationsRead(functionName: string, operationId: string) {
  return defineReadOperation({
    functionName,
    operationId,
    access: { kind: "read", intent: "daily_operations.view" },
    scope: { kind: "store", storeIdArg: "storeId" },
    actors: { normalUser: "admit", sharedDemo: "admit" },
  });
}

function defineOperationalWorkRead(functionName: string, operationId: string) {
  return defineReadOperation({
    functionName,
    operationId,
    access: { kind: "read", intent: "operations.workItems.view" },
    scope: { kind: "store", storeIdArg: "storeId" },
    actors: { normalUser: "admit", sharedDemo: "admit" },
  });
}

function defineDailyCloseRead(functionName: string, operationId: string) {
  return defineReadOperation({
    functionName,
    operationId,
    access: { kind: "read", intent: "daily_close.view" },
    scope: { kind: "store", storeIdArg: "storeId" },
    actors: { normalUser: "admit", sharedDemo: "admit" },
  });
}

function definePosRead(functionName: string, operationId: string) {
  return defineReadOperation({
    functionName,
    operationId,
    access: { kind: "read", intent: "pos.view" },
    scope: { kind: "store", storeIdArg: "storeId" },
    actors: { normalUser: "admit", sharedDemo: "admit" },
  });
}

function defineCashControlsRead(functionName: string, operationId: string) {
  return defineReadOperation({
    functionName,
    operationId,
    access: { kind: "read", intent: "cash_controls.view" },
    scope: { kind: "store", storeIdArg: "storeId" },
    actors: { normalUser: "admit", sharedDemo: "admit" },
  });
}

function defineStockAdjustmentsRead(functionName: string, operationId: string) {
  return defineReadOperation({
    functionName,
    operationId,
    access: { kind: "read", intent: "stock_adjustments.view" },
    scope: { kind: "store", storeIdArg: "storeId" },
    actors: { normalUser: "admit", sharedDemo: "admit" },
  });
}

function defineInventoryCatalogRead(functionName: string, operationId: string) {
  return defineReadOperation({
    functionName,
    operationId,
    access: { kind: "read", intent: "inventory.catalog.view" },
    scope: { kind: "store", storeIdArg: "storeId" },
    actors: { normalUser: "admit", sharedDemo: "admit" },
  });
}

function defineOnlineOrdersRead(functionName: string, operationId: string) {
  return defineReadOperation({
    functionName,
    operationId,
    access: { kind: "read", intent: "online_orders.view" },
    scope: { kind: "store", storeIdArg: "storeId" },
    actors: { normalUser: "admit", sharedDemo: "admit" },
  });
}

function defineOrganizationRead(functionName: string, operationId: string) {
  return defineReadOperation({
    functionName,
    operationId,
    access: { kind: "read", intent: "organization.view" },
    scope: { kind: "organization", organizationIdArg: "organizationId" },
    actors: { normalUser: "admit", sharedDemo: "admit" },
  });
}

export const getDailyOperationsSnapshotReadDefinition =
  defineDailyOperationsRead(
    "operations/dailyOperations:getDailyOperationsSnapshot",
    "operations.dailyOperations.getDailyOperationsSnapshot.read",
  );

export const getDailyOperationsDetailSnapshotReadDefinition =
  defineDailyOperationsRead(
    "operations/dailyOperations:getDailyOperationsDetailSnapshot",
    "operations.dailyOperations.getDailyOperationsDetailSnapshot.read",
  );

export const getDailyOperationsWeekAnalyticsSnapshotReadDefinition =
  defineDailyOperationsRead(
    "operations/dailyOperations:getDailyOperationsWeekAnalyticsSnapshot",
    "operations.dailyOperations.getDailyOperationsWeekAnalyticsSnapshot.read",
  );

export const getDailyOperationsStorePulseSnapshotReadDefinition =
  defineDailyOperationsRead(
    "operations/dailyOperations:getDailyOperationsStorePulseSnapshot",
    "operations.dailyOperations.getDailyOperationsStorePulseSnapshot.read",
  );

export const getDailyOperationsStoreRequestsSnapshotReadDefinition =
  defineDailyOperationsRead(
    "operations/dailyOperations:getDailyOperationsStoreRequestsSnapshot",
    "operations.dailyOperations.getDailyOperationsStoreRequestsSnapshot.read",
  );

export const getDailyOperationsOpenRegisterSessionsSnapshotReadDefinition =
  defineDailyOperationsRead(
    "operations/dailyOperations:getDailyOperationsOpenRegisterSessionsSnapshot",
    "operations.dailyOperations.getDailyOperationsOpenRegisterSessionsSnapshot.read",
  );

export const getDailyOperationsAutomationSnapshotReadDefinition =
  defineDailyOperationsRead(
    "operations/dailyOperations:getDailyOperationsAutomationSnapshot",
    "operations.dailyOperations.getDailyOperationsAutomationSnapshot.read",
  );

export const getDailyOperationsTodayRefreshSnapshotReadDefinition =
  defineDailyOperationsRead(
    "operations/dailyOperations:getDailyOperationsTodayRefreshSnapshot",
    "operations.dailyOperations.getDailyOperationsTodayRefreshSnapshot.read",
  );

export const getDailyOperationsTimelineSnapshotReadDefinition =
  defineDailyOperationsRead(
    "operations/dailyOperations:getDailyOperationsTimelineSnapshot",
    "operations.dailyOperations.getDailyOperationsTimelineSnapshot.read",
  );

export const getDailyOperationsTimelinePreviewSnapshotReadDefinition =
  defineDailyOperationsRead(
    "operations/dailyOperations:getDailyOperationsTimelinePreviewSnapshot",
    "operations.dailyOperations.getDailyOperationsTimelinePreviewSnapshot.read",
  );

export const getDailyOpeningSnapshotReadDefinition = defineDailyOperationsRead(
  "operations/dailyOpening:getDailyOpeningSnapshot",
  "operations.dailyOpening.getDailyOpeningSnapshot.read",
);

export const getOpeningAutoStartPolicyReadDefinition =
  defineDailyOperationsRead(
    "operations/dailyOperationsAutomation:getOpeningAutoStartPolicy",
    "operations.dailyOperationsAutomation.getOpeningAutoStartPolicy.read",
  );

export const getEodAutoCompletePolicyReadDefinition = defineDailyOperationsRead(
  "operations/dailyOperationsAutomation:getEodAutoCompletePolicy",
  "operations.dailyOperationsAutomation.getEodAutoCompletePolicy.read",
);

export const getRegisterCloseoutApprovalPolicyReadDefinition =
  defineDailyOperationsRead(
    "operations/dailyOperationsAutomation:getRegisterCloseoutApprovalPolicy",
    "operations.dailyOperationsAutomation.getRegisterCloseoutApprovalPolicy.read",
  );

export const getOpenWorkCountSummaryReadDefinition = defineOperationalWorkRead(
  "operations/operationalWorkItems:getOpenWorkCountSummary",
  "operations.operationalWorkItems.getOpenWorkCountSummary.read",
);

export const getPendingApprovalCountSummaryReadDefinition =
  defineOperationalWorkRead(
    "operations/operationalWorkItems:getPendingApprovalCountSummary",
    "operations.operationalWorkItems.getPendingApprovalCountSummary.read",
  );

export const getQueueSnapshotReadDefinition = defineOperationalWorkRead(
  "operations/operationalWorkItems:getQueueSnapshot",
  "operations.operationalWorkItems.getQueueSnapshot.read",
);

export const getDailyCloseSnapshotReadDefinition = defineDailyCloseRead(
  "operations/dailyClose:getDailyCloseSnapshot",
  "operations.dailyClose.getDailyCloseSnapshot.read",
);

export const getDailyCloseLifecycleGateReadDefinition = defineDailyCloseRead(
  "operations/dailyClose:getDailyCloseLifecycleGate",
  "operations.dailyClose.getDailyCloseLifecycleGate.read",
);

export const listCompletedDailyCloseHistoryReadDefinition =
  defineDailyCloseRead(
    "operations/dailyClose:listCompletedDailyCloseHistory",
    "operations.dailyClose.listCompletedDailyCloseHistory.read",
  );

export const getCompletedDailyCloseHistoryDetailReadDefinition =
  defineDailyCloseRead(
    "operations/dailyClose:getCompletedDailyCloseHistoryDetail",
    "operations.dailyClose.getCompletedDailyCloseHistoryDetail.read",
  );

export const getCashControlsDashboardSnapshotReadDefinition =
  defineCashControlsRead(
    "cashControls/deposits:getDashboardSnapshot",
    "cashControls.deposits.getDashboardSnapshot.read",
  );

export const getRegisterSessionSnapshotReadDefinition = defineCashControlsRead(
  "cashControls/deposits:getRegisterSessionSnapshot",
  "cashControls.deposits.getRegisterSessionSnapshot.read",
);

export const listRegisterSessionActivityReadDefinition = defineCashControlsRead(
  "cashControls/registerSessionActivity:listRegisterSessionActivity",
  "cashControls.registerSessionActivity.listRegisterSessionActivity.read",
);

export const getActiveCycleCountDraftReadDefinition =
  defineStockAdjustmentsRead(
    "stockOps/cycleCountDrafts:getActiveCycleCountDraft",
    "stockOps.cycleCountDrafts.getActiveCycleCountDraft.read",
  );

export const getActiveCycleCountDraftSummaryReadDefinition =
  defineStockAdjustmentsRead(
    "stockOps/cycleCountDrafts:getActiveCycleCountDraftSummary",
    "stockOps.cycleCountDrafts.getActiveCycleCountDraftSummary.read",
  );

export const listInventoryProductsReadDefinition = defineInventoryCatalogRead(
  "inventory/products:getAll",
  "inventory.products.getAll.read",
);

export const searchProductSkusReadDefinition = defineInventoryCatalogRead(
  "inventory/skuSearch:searchProductSkus",
  "inventory.skuSearch.searchProductSkus.read",
);

export const listInventorySnapshotReadDefinition = defineStockAdjustmentsRead(
  "stockOps/adjustments:listInventorySnapshot",
  "stockOps.adjustments.listInventorySnapshot.read",
);

export const listInventorySnapshotForProductSkusReadDefinition =
  defineStockAdjustmentsRead(
    "stockOps/adjustments:listInventorySnapshotForProductSkus",
    "stockOps.adjustments.listInventorySnapshotForProductSkus.read",
  );

export const getInventoryUnitSummaryReadDefinition = defineStockAdjustmentsRead(
  "stockOps/adjustments:getInventoryUnitSummary",
  "stockOps.adjustments.getInventoryUnitSummary.read",
);

export const listInventorySnapshotPageReadDefinition =
  defineStockAdjustmentsRead(
    "stockOps/adjustments:listInventorySnapshotPage",
    "stockOps.adjustments.listInventorySnapshotPage.read",
  );

export const listAthenaUserOrganizationsReadDefinition = defineReadOperation({
  functionName: "inventory/organizations:getAll",
  operationId: "inventory.organizations.getAll.read",
  access: { kind: "read", intent: "organization.view" },
  scope: { kind: "none" },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

export const getOrganizationByIdOrSlugReadDefinition = defineReadOperation({
  functionName: "inventory/organizations:getByIdOrSlug",
  operationId: "inventory.organizations.getByIdOrSlug.read",
  access: { kind: "read", intent: "organization.view" },
  scope: { kind: "none" },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

export const listOrganizationStoresReadDefinition = defineOrganizationRead(
  "inventory/stores:getAll",
  "inventory.stores.getAll.read",
);

export const getPosTodaySummaryReadDefinition = definePosRead(
  "pos/public/transactions:getTodaySummary",
  "pos.public.transactions.getTodaySummary.read",
);

export const getPosCompletedTransactionsReadDefinition = definePosRead(
  "pos/public/transactions:getCompletedTransactions",
  "pos.public.transactions.getCompletedTransactions.read",
);

export const getPosTransactionReadDefinition = defineReadOperation({
  functionName: "pos/public/transactions:getTransaction",
  operationId: "pos.public.transactions.getTransaction.read",
  access: { kind: "read", intent: "pos.view" },
  scope: {
    kind: "store",
    resolve: async (ctx, args) => {
      const transactionId = args.transactionId;
      if (typeof transactionId !== "string") {
        return {};
      }
      const transaction = await ctx.db.get(
        "posTransaction",
        transactionId as Id<"posTransaction">,
      );
      return transaction ? { storeId: transaction.storeId } : {};
    },
  },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

export const getPosTransactionsByStoreReadDefinition = definePosRead(
  "pos/public/transactions:getTransactionsByStore",
  "pos.public.transactions.getTransactionsByStore.read",
);

export const getPosTransactionByIdReadDefinition = defineReadOperation({
  functionName: "pos/public/transactions:getTransactionById",
  operationId: "pos.public.transactions.getTransactionById.read",
  access: { kind: "read", intent: "pos.view" },
  scope: {
    kind: "store",
    resolve: async (ctx, args) => {
      const transactionId = args.transactionId;
      if (typeof transactionId !== "string") {
        return {};
      }
      const transaction = await ctx.db.get(
        "posTransaction",
        transactionId as Id<"posTransaction">,
      );
      return transaction ? { storeId: transaction.storeId } : {};
    },
  },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

export const getPosStoreActiveSessionOperationsReadDefinition = definePosRead(
  "inventory/posSessions:getStoreActiveSessionOperations",
  "inventory.posSessions.getStoreActiveSessionOperations.read",
);

export const getPosActiveSessionReadDefinition = definePosRead(
  "inventory/posSessions:getActiveSession",
  "inventory.posSessions.getActiveSession.read",
);

export const getPosStoreSessionsReadDefinition = definePosRead(
  "inventory/posSessions:getStoreSessions",
  "inventory.posSessions.getStoreSessions.read",
);

export const getPosSessionItemsReadDefinition = defineReadOperation({
  functionName: "inventory/posSessionItems:getSessionItems",
  operationId: "inventory.posSessionItems.getSessionItems.read",
  access: { kind: "read", intent: "pos.view" },
  scope: {
    kind: "store",
    resolve: async (ctx, args) => {
      const sessionId = args.sessionId;
      if (typeof sessionId !== "string") {
        return {};
      }
      const session = await ctx.db.get(
        "posSession",
        sessionId as Id<"posSession">,
      );
      return session ? { storeId: session.storeId } : {};
    },
  },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

export const getPosRecentTransactionsWithCustomersReadDefinition =
  definePosRead(
    "pos/public/transactions:getRecentTransactionsWithCustomers",
    "pos.public.transactions.getRecentTransactionsWithCustomers.read",
  );

export const searchPosRegisterCatalogReadDefinition = definePosRead(
  "pos/public/catalog:search",
  "pos.public.catalog.search.read",
);

export const listPosRegisterCatalogSnapshotReadDefinition = definePosRead(
  "pos/public/catalog:listRegisterCatalogSnapshot",
  "pos.public.catalog.listRegisterCatalogSnapshot.read",
);

export const getPosRegisterCatalogRevisionReadDefinition = definePosRead(
  "pos/public/catalog:getRegisterCatalogRevision",
  "pos.public.catalog.getRegisterCatalogRevision.read",
);

export const listPosRegisterCatalogSnapshotWithRevisionReadDefinition =
  definePosRead(
    "pos/public/catalog:listRegisterCatalogSnapshotWithRevision",
    "pos.public.catalog.listRegisterCatalogSnapshotWithRevision.read",
  );

export const listPosRegisterCatalogAvailabilityReadDefinition = definePosRead(
  "pos/public/catalog:listRegisterCatalogAvailability",
  "pos.public.catalog.listRegisterCatalogAvailability.read",
);

export const listPosRegisterCatalogAvailabilitySnapshotReadDefinition =
  definePosRead(
    "pos/public/catalog:listRegisterCatalogAvailabilitySnapshot",
    "pos.public.catalog.listRegisterCatalogAvailabilitySnapshot.read",
  );

export const barcodeLookupPosRegisterCatalogReadDefinition = definePosRead(
  "pos/public/catalog:barcodeLookup",
  "pos.public.catalog.barcodeLookup.read",
);

export const listPosClientEventsReadDefinition = definePosRead(
  "pos/public/telemetry:listClientEvents",
  "pos.public.telemetry.listClientEvents.read",
);

export const getPosRegisterStateReadDefinition = definePosRead(
  "pos/public/register:getState",
  "pos.public.register.getState.read",
);

export const searchPosCustomersReadDefinition = definePosRead(
  "pos/public/customers:searchCustomers",
  "pos.public.customers.searchCustomers.read",
);

export const findPotentialPosCustomerMatchesReadDefinition = definePosRead(
  "pos/public/customers:findPotentialMatches",
  "pos.public.customers.findPotentialMatches.read",
);

export const getPosCustomerByIdReadDefinition = defineReadOperation({
  functionName: "pos/public/customers:getCustomerById",
  operationId: "pos.public.customers.getCustomerById.read",
  access: { kind: "read", intent: "pos.view" },
  scope: {
    kind: "store",
    resolve: async (ctx, args) => {
      const customerId = args.customerId;
      if (typeof customerId !== "string") {
        return {};
      }
      const customer = await ctx.db.get(
        "posCustomer",
        customerId as Id<"posCustomer">,
      );
      return customer ? { storeId: customer.storeId } : {};
    },
  },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

export const getPosCustomerTransactionsReadDefinition = defineReadOperation({
  functionName: "pos/public/customers:getCustomerTransactions",
  operationId: "pos.public.customers.getCustomerTransactions.read",
  access: { kind: "read", intent: "pos.view" },
  scope: {
    kind: "store",
    resolve: async (ctx, args) => {
      const customerId = args.customerId;
      if (typeof customerId !== "string") {
        return {};
      }
      const customer = await ctx.db.get(
        "posCustomer",
        customerId as Id<"posCustomer">,
      );
      return customer ? { storeId: customer.storeId } : {};
    },
  },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

export const findPosCustomerByStoreFrontUserReadDefinition =
  defineReadOperation({
    functionName: "pos/public/customers:findByStoreFrontUser",
    operationId: "pos.public.customers.findByStoreFrontUser.read",
    access: { kind: "read", intent: "pos.view" },
    scope: {
      kind: "store",
      resolve: async (ctx, args) => {
        const storeFrontUserId = args.storeFrontUserId;
        if (typeof storeFrontUserId !== "string") {
          return {};
        }
        const storeFrontUser = await ctx.db.get(
          "storeFrontUser",
          storeFrontUserId as Id<"storeFrontUser">,
        );
        return storeFrontUser ? { storeId: storeFrontUser.storeId } : {};
      },
    },
    actors: { normalUser: "admit", sharedDemo: "admit" },
  });

export const listPosTerminalsReadDefinition = definePosRead(
  "pos/public/terminals:listTerminals",
  "pos.public.terminals.listTerminals.read",
);

export const listPosTerminalHealthReadDefinition = definePosRead(
  "pos/public/terminals:listTerminalHealthSummaries",
  "pos.public.terminals.listTerminalHealthSummaries.read",
);

export const getPosTerminalHealthReadDefinition = definePosRead(
  "pos/public/terminals:getTerminalHealthSummary",
  "pos.public.terminals.getTerminalHealthSummary.read",
);

export const getPosTerminalByFingerprintReadDefinition = definePosRead(
  "pos/public/terminals:getTerminalByFingerprint",
  "pos.public.terminals.getTerminalByFingerprint.read",
);

export const listPosStaffProfilesReadDefinition = definePosRead(
  "operations/staffProfiles:listStaffProfiles",
  "operations.staffProfiles.listStaffProfiles.read",
);

export const listStaffMessagesReadDefinition = definePosRead(
  "operations/staffMessages:listStaffMessages",
  "operations.staffMessages.listStaffMessages.read",
);

export const getSkuActivityForProductSkuReadDefinition = definePosRead(
  "operations/skuActivity:getSkuActivityForProductSku",
  "operations.skuActivity.getSkuActivityForProductSku.read",
);

export const getUntrustedSkuSaleEvidenceReadDefinition = definePosRead(
  "operations/skuActivity:getUntrustedSkuSaleEvidence",
  "operations.skuActivity.getUntrustedSkuSaleEvidence.read",
);

export const getWorkflowTraceViewByIdReadDefinition = definePosRead(
  "workflowTraces/public:getWorkflowTraceViewById",
  "workflowTraces.public.getWorkflowTraceViewById.read",
);

export const getWorkflowTraceByLookupReadDefinition = definePosRead(
  "workflowTraces/public:getWorkflowTraceByLookup",
  "workflowTraces.public.getWorkflowTraceByLookup.read",
);

export const getOnlineOrderReadDefinition = defineReadOperation({
  functionName: "storeFront/onlineOrder:getForOperations",
  operationId: "storeFront.onlineOrder.getForOperations.read",
  access: { kind: "read", intent: "online_orders.view" },
  scope: {
    kind: "store",
    resolve: async (ctx, args) => {
      const identifier = args.identifier;
      if (typeof identifier !== "string") {
        return {};
      }
      const onlineOrderId = ctx.db.normalizeId("onlineOrder", identifier);
      let order = onlineOrderId
        ? await ctx.db.get("onlineOrder", onlineOrderId)
        : null;
      if (!order) {
        order = await ctx.db
          .query("onlineOrder")
          .withIndex("by_externalReference", (q) =>
            q.eq("externalReference", identifier),
          )
          .first();
      }
      const checkoutSessionId = ctx.db.normalizeId(
        "checkoutSession",
        identifier,
      );
      if (!order && checkoutSessionId) {
        order = await ctx.db
          .query("onlineOrder")
          .withIndex("by_checkoutSessionId", (q) =>
            q.eq("checkoutSessionId", checkoutSessionId),
          )
          .first();
      }
      return order ? { storeId: order.storeId } : {};
    },
  },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

export const listOnlineOrdersReadDefinition = defineOnlineOrdersRead(
  "storeFront/onlineOrder:getAllOnlineOrders",
  "storeFront.onlineOrder.getAllOnlineOrders.read",
);

export const getNewestOnlineOrderReadDefinition = defineOnlineOrdersRead(
  "storeFront/onlineOrder:newOrder",
  "storeFront.onlineOrder.newOrder.read",
);

export const getOnlineOrderMetricsReadDefinition = defineOnlineOrdersRead(
  "storeFront/onlineOrder:getOrderMetrics",
  "storeFront.onlineOrder.getOrderMetrics.read",
);

export const listPosServiceCatalogSnapshotReadDefinition = definePosRead(
  "serviceOps/catalog:listPosServiceCatalogSnapshot",
  "serviceOps.catalog.listPosServiceCatalogSnapshot.read",
);

export const OPERATION_READ_ADMISSION_DEFINITIONS = [
  getDailyOperationsSnapshotReadDefinition,
  getDailyOperationsDetailSnapshotReadDefinition,
  getDailyOperationsWeekAnalyticsSnapshotReadDefinition,
  getDailyOperationsStorePulseSnapshotReadDefinition,
  getDailyOperationsStoreRequestsSnapshotReadDefinition,
  getDailyOperationsOpenRegisterSessionsSnapshotReadDefinition,
  getDailyOperationsAutomationSnapshotReadDefinition,
  getDailyOperationsTodayRefreshSnapshotReadDefinition,
  getDailyOperationsTimelineSnapshotReadDefinition,
  getDailyOperationsTimelinePreviewSnapshotReadDefinition,
  getDailyOpeningSnapshotReadDefinition,
  getOpeningAutoStartPolicyReadDefinition,
  getEodAutoCompletePolicyReadDefinition,
  getRegisterCloseoutApprovalPolicyReadDefinition,
  getOpenWorkCountSummaryReadDefinition,
  getPendingApprovalCountSummaryReadDefinition,
  getQueueSnapshotReadDefinition,
  getDailyCloseSnapshotReadDefinition,
  getDailyCloseLifecycleGateReadDefinition,
  listCompletedDailyCloseHistoryReadDefinition,
  getCompletedDailyCloseHistoryDetailReadDefinition,
  getCashControlsDashboardSnapshotReadDefinition,
  getRegisterSessionSnapshotReadDefinition,
  listRegisterSessionActivityReadDefinition,
  getActiveCycleCountDraftReadDefinition,
  getActiveCycleCountDraftSummaryReadDefinition,
  listInventoryProductsReadDefinition,
  listInventorySnapshotReadDefinition,
  listInventorySnapshotForProductSkusReadDefinition,
  getInventoryUnitSummaryReadDefinition,
  listInventorySnapshotPageReadDefinition,
  listAthenaUserOrganizationsReadDefinition,
  getOrganizationByIdOrSlugReadDefinition,
  listOrganizationStoresReadDefinition,
  getPosTodaySummaryReadDefinition,
  getPosCompletedTransactionsReadDefinition,
  getPosTransactionReadDefinition,
  getPosTransactionsByStoreReadDefinition,
  getPosTransactionByIdReadDefinition,
  getPosStoreActiveSessionOperationsReadDefinition,
  getPosActiveSessionReadDefinition,
  getPosStoreSessionsReadDefinition,
  getPosSessionItemsReadDefinition,
  getPosRecentTransactionsWithCustomersReadDefinition,
  searchPosRegisterCatalogReadDefinition,
  listPosRegisterCatalogSnapshotReadDefinition,
  getPosRegisterCatalogRevisionReadDefinition,
  listPosRegisterCatalogSnapshotWithRevisionReadDefinition,
  listPosRegisterCatalogAvailabilityReadDefinition,
  listPosRegisterCatalogAvailabilitySnapshotReadDefinition,
  barcodeLookupPosRegisterCatalogReadDefinition,
  listPosClientEventsReadDefinition,
  getPosRegisterStateReadDefinition,
  searchPosCustomersReadDefinition,
  getPosCustomerByIdReadDefinition,
  getPosCustomerTransactionsReadDefinition,
  findPosCustomerByStoreFrontUserReadDefinition,
  findPotentialPosCustomerMatchesReadDefinition,
  listPosTerminalsReadDefinition,
  listPosTerminalHealthReadDefinition,
  getPosTerminalHealthReadDefinition,
  getPosTerminalByFingerprintReadDefinition,
  listPosStaffProfilesReadDefinition,
  listStaffMessagesReadDefinition,
  getSkuActivityForProductSkuReadDefinition,
  getUntrustedSkuSaleEvidenceReadDefinition,
  getWorkflowTraceViewByIdReadDefinition,
  getWorkflowTraceByLookupReadDefinition,
  getOnlineOrderReadDefinition,
  listOnlineOrdersReadDefinition,
  getNewestOnlineOrderReadDefinition,
  getOnlineOrderMetricsReadDefinition,
  listPosServiceCatalogSnapshotReadDefinition,
] as const;

export function validateReadOperationDefinition(
  definition: OperationReadDefinition,
) {
  const errors: string[] = [];
  if (!definition.operationId.trim()) {
    errors.push("Operation read definition must declare operationId.");
  }
  if (!definition.access.intent.trim()) {
    errors.push("Operation read definition must declare an access intent.");
  }
  if (definition.access.kind !== "read") {
    errors.push("Operation read definition must use read access.");
  }
  if (
    definition.scope.kind === "store" &&
    !definition.scope.storeIdArg &&
    !definition.scope.resolve
  ) {
    errors.push("Store scope must declare storeIdArg or resolve.");
  }
  if (
    definition.scope.kind === "organization" &&
    !definition.scope.organizationIdArg &&
    !definition.scope.resolve
  ) {
    errors.push(
      "Organization scope must declare organizationIdArg or resolve.",
    );
  }
  return errors;
}
