import { describe, expect, it } from "vitest";

import {
  defineOperation,
  OPERATION_ADMISSION_DEFINITIONS,
  validateOperationDefinition,
} from "./definitions";

describe("operation admission definitions", () => {
  it("keeps exported operation definitions valid", () => {
    for (const definition of OPERATION_ADMISSION_DEFINITIONS) {
      expect(validateOperationDefinition(definition)).toEqual([]);
    }
  });

  it("defines the shared-demo lifecycle public writes on the admission rail", () => {
    expect(OPERATION_ADMISSION_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actors: { normalUser: "deny", sharedDemo: "admit" },
          capability: "demo.lifecycle",
          functionName: "sharedDemo/public:requestManualRestore",
          readiness: { kind: "none" },
        }),
        expect.objectContaining({
          actors: { normalUser: "deny", sharedDemo: "admit" },
          capability: "demo.lifecycle",
          functionName: "sharedDemo/public:resetBrowserExperience",
          readiness: { kind: "none" },
        }),
        expect.objectContaining({
          actors: { normalUser: "deny", sharedDemo: "admit" },
          capability: "demo.lifecycle",
          functionName: "sharedDemo/public:bindRegisterBaselineToTerminal",
          readiness: {
            kind: "store_write",
            expectedEpochArg: "expectedEpoch",
          },
        }),
      ]),
    );
  });

  it("accepts a valid store-scoped write definition", () => {
    const definition = defineOperation({
      operationId: "operations/openWorkInventoryReviews.resolveGroup",
      capability: "daily_operations.write",
      scope: { kind: "store", storeIdArg: "storeId" },
      readiness: { kind: "store_write" },
      effects: { mode: "none" },
      actors: { normalUser: "admit", sharedDemo: "deny" },
    });

    expect(validateOperationDefinition(definition)).toEqual([]);
  });

  it("fails closed for unknown capabilities and incomplete scope declarations", () => {
    expect(
      validateOperationDefinition({
        operationId: "bad.capability",
        capability: "billing.update" as never,
        scope: { kind: "none" },
        readiness: { kind: "none" },
        effects: { mode: "none" },
        actors: { normalUser: "admit", sharedDemo: "deny" },
      }),
    ).toContain("Unknown operation capability: billing.update");

    expect(
      validateOperationDefinition({
        operationId: "bad.scope",
        capability: "daily_operations.write",
        scope: { kind: "store" } as never,
        readiness: { kind: "store_write" },
        effects: { mode: "none" },
        actors: { normalUser: "admit", sharedDemo: "deny" },
      }),
    ).toContain("Store scope must declare storeIdArg or resolve.");
  });

  it("requires demo-writable operations to declare a store write readiness fence", () => {
    expect(
      validateOperationDefinition({
        operationId: "demo.needs.readiness",
        capability: "daily_operations.write",
        scope: { kind: "store", storeIdArg: "storeId" },
        readiness: { kind: "none" },
        effects: { mode: "none" },
        actors: { normalUser: "admit", sharedDemo: "admit" },
      }),
    ).toContain(
      "Shared-demo writable operations must declare store_write readiness.",
    );
  });

  it("allows demo lifecycle operations to manage the restore readiness fence", () => {
    expect(
      validateOperationDefinition({
        operationId: "demo.lifecycle",
        capability: "demo.lifecycle",
        scope: { kind: "none" },
        readiness: { kind: "none" },
        effects: { mode: "none" },
        actors: { normalUser: "deny", sharedDemo: "admit" },
      }),
    ).toEqual([]);
  });
});
