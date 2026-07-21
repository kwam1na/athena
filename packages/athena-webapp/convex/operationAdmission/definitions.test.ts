import { describe, expect, it } from "vitest";

import {
  defineOperation,
  validateOperationDefinition,
} from "./definitions";

describe("operation admission definitions", () => {
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
});
