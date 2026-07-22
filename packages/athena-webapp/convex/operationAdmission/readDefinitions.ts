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

export const getPosRecentTransactionsWithCustomersReadDefinition =
  definePosRead(
    "pos/public/transactions:getRecentTransactionsWithCustomers",
    "pos.public.transactions.getRecentTransactionsWithCustomers.read",
  );

export const listPosClientEventsReadDefinition = definePosRead(
  "pos/public/telemetry:listClientEvents",
  "pos.public.telemetry.listClientEvents.read",
);

export const getPosRegisterStateReadDefinition = definePosRead(
  "pos/public/register:getState",
  "pos.public.register.getState.read",
);

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
  getPosTodaySummaryReadDefinition,
  getPosCompletedTransactionsReadDefinition,
  getPosTransactionReadDefinition,
  getPosTransactionsByStoreReadDefinition,
  getPosTransactionByIdReadDefinition,
  getPosStoreActiveSessionOperationsReadDefinition,
  getPosRecentTransactionsWithCustomersReadDefinition,
  listPosClientEventsReadDefinition,
  getPosRegisterStateReadDefinition,
  listPosTerminalsReadDefinition,
  listPosTerminalHealthReadDefinition,
  getPosTerminalHealthReadDefinition,
  getPosTerminalByFingerprintReadDefinition,
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
