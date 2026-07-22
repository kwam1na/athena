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
