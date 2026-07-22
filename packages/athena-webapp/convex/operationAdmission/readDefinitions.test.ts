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
          functionName:
            "operations/operationalWorkItems:getPendingApprovalCountSummary",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
      ]),
    );
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
