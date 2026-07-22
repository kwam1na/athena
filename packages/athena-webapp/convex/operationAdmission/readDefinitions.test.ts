import { describe, expect, it } from "vitest";

import {
  defineReadOperation,
  OPERATION_READ_ADMISSION_DEFINITIONS,
  validateReadOperationDefinition,
} from "./readDefinitions";

describe("operation read admission definitions", () => {
  it("keeps exported read definitions valid", () => {
    for (const definition of OPERATION_READ_ADMISSION_DEFINITIONS) {
      expect(validateReadOperationDefinition(definition)).toEqual([]);
    }
  });

  it("defines daily operations viewing on read intent instead of write capability", () => {
    expect(OPERATION_READ_ADMISSION_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          access: { kind: "read", intent: "daily_operations.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "operations/dailyOperations:getDailyOperationsSnapshot",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
      ]),
    );
  });

  it("defines operations route count summaries on read intent instead of write capability", () => {
    expect(OPERATION_READ_ADMISSION_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          access: { kind: "read", intent: "operations.workItems.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName:
            "operations/operationalWorkItems:getOpenWorkCountSummary",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "operations.workItems.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "operations/operationalWorkItems:getQueueSnapshot",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "operations.workItems.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName:
            "operations/operationalWorkItems:getPendingApprovalCountSummary",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
      ]),
    );
  });

  it("defines demo-visible daily close reads on read intent", () => {
    expect(OPERATION_READ_ADMISSION_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          access: { kind: "read", intent: "daily_close.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "operations/dailyClose:getDailyCloseSnapshot",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "daily_close.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "operations/dailyClose:getDailyCloseLifecycleGate",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "daily_close.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "operations/dailyClose:listCompletedDailyCloseHistory",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "daily_close.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName:
            "operations/dailyClose:getCompletedDailyCloseHistoryDetail",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
      ]),
    );
  });

  it("defines demo-visible cash controls and POS reads on read intent", () => {
    expect(OPERATION_READ_ADMISSION_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          access: { kind: "read", intent: "cash_controls.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "cashControls/deposits:getDashboardSnapshot",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "cash_controls.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName:
            "cashControls/registerSessionActivity:listRegisterSessionActivity",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "stock_adjustments.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName:
            "stockOps/cycleCountDrafts:getActiveCycleCountDraftSummary",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "pos.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "pos/public/register:getState",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "pos.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "pos/public/terminals:listTerminals",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "pos.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "inventory/posSessions:getStoreActiveSessionOperations",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "pos.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "inventory/posSessions:getActiveSession",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "pos.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "inventory/posSessions:getStoreSessions",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "pos.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName:
            "pos/public/catalog:listRegisterCatalogAvailabilitySnapshot",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "pos.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "pos/public/catalog:getRegisterCatalogRevision",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "pos.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "operations/staffProfiles:listStaffProfiles",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "pos.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "serviceOps/catalog:listPosServiceCatalogSnapshot",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          access: { kind: "read", intent: "daily_operations.view" },
          actors: { normalUser: "admit", sharedDemo: "admit" },
          functionName: "operations/dailyOpening:getDailyOpeningSnapshot",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
      ]),
    );
  });

  it("resolves transaction detail reads through the transaction store", async () => {
    const definition = OPERATION_READ_ADMISSION_DEFINITIONS.find(
      (candidate) =>
        candidate.functionName === "pos/public/transactions:getTransactionById",
    );

    expect(definition?.scope.kind).toBe("store");
    if (
      definition?.scope.kind !== "store" ||
      !("resolve" in definition.scope) ||
      !definition.scope.resolve
    ) {
      throw new Error("Expected transaction read to declare store resolver.");
    }

    const db = {
      get: async (tableName: string, id: string) =>
        tableName === "posTransaction" && id === "txn-1"
          ? { storeId: "store-1" }
          : null,
    };

    await expect(
      definition.scope.resolve({ db } as never, {
        transactionId: "txn-1",
      }),
    ).resolves.toEqual({ storeId: "store-1" });
    await expect(
      definition.scope.resolve({ db } as never, {
        transactionId: "missing-txn",
      }),
    ).resolves.toEqual({});
  });

  it("fails closed for incomplete read metadata", () => {
    expect(
      validateReadOperationDefinition(
        defineReadOperation({
          operationId: "",
          access: { kind: "read", intent: "" },
          scope: { kind: "store" } as never,
          actors: { normalUser: "admit", sharedDemo: "admit" },
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        "Operation read definition must declare operationId.",
        "Operation read definition must declare an access intent.",
        "Store scope must declare storeIdArg or resolve.",
      ]),
    );
  });
});
