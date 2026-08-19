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
          actors: { normalUser: "deny", sharedDemo: "admit", public: "deny" },
          capability: "demo.lifecycle",
          functionName: "sharedDemo/public:requestManualRestore",
          readiness: { kind: "none" },
        }),
        expect.objectContaining({
          actors: { normalUser: "deny", sharedDemo: "admit", public: "deny" },
          capability: "demo.lifecycle",
          functionName: "sharedDemo/public:resetBrowserExperience",
          readiness: { kind: "none" },
        }),
        expect.objectContaining({
          actors: { normalUser: "deny", sharedDemo: "admit", public: "deny" },
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

  it("defines the demo-reachable order-management writes on the admission rail", () => {
    // These carry no storeId argument: each resolves its store from the row it
    // touches, so a demo caller cannot widen scope by passing another store.
    for (const functionName of [
      "storeFront/onlineOrderItem:update",
      "storeFront/onlineOrder:returnItemsToStock",
      "storeFront/onlineOrder:returnAllItemsToStock",
    ]) {
      const definition = OPERATION_ADMISSION_DEFINITIONS.find(
        (candidate) => candidate.functionName === functionName,
      );

      expect(definition, functionName).toBeDefined();
      expect(definition!.actors.sharedDemo, functionName).toBe("admit");
      expect(definition!.scope.kind, functionName).toBe("store");
      expect(
        "resolve" in definition!.scope && definition!.scope.resolve,
        functionName,
      ).toBeTruthy();
      expect(definition!.readiness.kind, functionName).toBe("store_write");
    }
  });

  it("accepts a valid store-scoped write definition", () => {
    const definition = defineOperation({
      kind: "mutation" as const,
      operationId: "operations/openWorkInventoryReviews.resolveGroup",
      capability: "daily_operations.write",
      scope: { kind: "store", storeIdArg: "storeId" },
      readiness: { kind: "store_write" },
      effects: { mode: "none" },
      actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
    });

    expect(validateOperationDefinition(definition)).toEqual([]);
  });

  it("defines catalog summary repair as a demo-visible store write", () => {
    expect(OPERATION_ADMISSION_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actors: { normalUser: "admit", sharedDemo: "admit", public: "deny" },
          capability: "catalog.maintain",
          functionName: "inventory/products:repairCatalogSummary",
          operationId: "inventory/products.repairCatalogSummary",
          readiness: { kind: "store_write", expectedEpochArg: undefined },
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
      ]),
    );
  });

  it("admits cost-overlay commands only for normal full-admin flows", () => {
    expect(OPERATION_ADMISSION_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
          capability: "inventory.import",
          functionName:
            "inventory/inventoryImportCostOverlay:createCostOverlayRun",
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
          capability: "inventory.import",
          functionName:
            "inventory/inventoryImportCostOverlay:prepareCostOverlayRun",
        }),
        expect.objectContaining({
          actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
          capability: "inventory.import",
          functionName:
            "inventory/inventoryImportCostOverlay:abandonCostOverlayRun",
        }),
        expect.objectContaining({
          actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
          functionName:
            "inventory/inventoryImportCostOverlay:confirmCostOverlayApply",
        }),
        expect.objectContaining({
          actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
          functionName:
            "inventory/inventoryImportCostOverlay:requestCostOverlayUndo",
        }),
        expect.objectContaining({
          actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
          functionName:
            "inventory/inventoryImportCostOverlay:retryCostOverlayWork",
        }),
      ]),
    );
  });

  it("admits review payload upload commands only for normal full-admin flows", () => {
    expect(OPERATION_ADMISSION_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
          capability: "inventory.import",
          functionName:
            "inventory/catalogImport:stageInventoryImportReviewVersionPayloadChunk",
          readiness: { kind: "store_write" },
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
        expect.objectContaining({
          actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
          capability: "inventory.import",
          functionName:
            "inventory/catalogImport:finalizeInventoryImportReviewVersionPayload",
          readiness: { kind: "store_write" },
          scope: { kind: "store", storeIdArg: "storeId" },
        }),
      ]),
    );
  });

  it("fails closed for unknown capabilities and incomplete scope declarations", () => {
    expect(
      validateOperationDefinition({
        kind: "mutation" as const,
        operationId: "bad.capability",
        capability: "billing.update" as never,
        scope: { kind: "none" },
        readiness: { kind: "none" },
        effects: { mode: "none" },
        actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
      }),
    ).toContain("Unknown operation capability: billing.update");

    expect(
      validateOperationDefinition({
        kind: "mutation" as const,
        operationId: "bad.scope",
        capability: "daily_operations.write",
        scope: { kind: "store" } as never,
        readiness: { kind: "store_write" },
        effects: { mode: "none" },
        actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
      }),
    ).toContain("Store scope must declare storeIdArg or resolve.");
  });

  it("requires demo-writable operations to declare a store write readiness fence", () => {
    expect(
      validateOperationDefinition({
        kind: "mutation" as const,
        operationId: "demo.needs.readiness",
        capability: "daily_operations.write",
        scope: { kind: "store", storeIdArg: "storeId" },
        readiness: { kind: "none" },
        effects: { mode: "none" },
        actors: { normalUser: "admit", sharedDemo: "admit", public: "deny" },
      }),
    ).toContain(
      "Shared-demo writable operations must declare store_write readiness.",
    );
  });

  it("allows demo lifecycle operations to manage the restore readiness fence", () => {
    expect(
      validateOperationDefinition({
        kind: "mutation" as const,
        operationId: "demo.lifecycle",
        capability: "demo.lifecycle",
        scope: { kind: "none" },
        readiness: { kind: "none" },
        effects: { mode: "none" },
        actors: { normalUser: "deny", sharedDemo: "admit", public: "deny" },
      }),
    ).toEqual([]);
  });

  it("rejects store_write readiness on action and http kinds", () => {
    expect(
      validateOperationDefinition({
        kind: "action",
        operationId: "action.wrong.readiness",
        capability: "customer.messaging.send",
        scope: { kind: "store", storeIdArg: "storeId" },
        readiness: { kind: "store_write" },
        effects: { mode: "none" },
        actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
      }),
    ).toContain(
      "Readiness store_write is only valid on mutation kinds (action declared it).",
    );
  });

  it("requires store_ready on a demo-admitted action", () => {
    expect(
      validateOperationDefinition({
        kind: "action",
        operationId: "action.demo.readiness",
        capability: "customer.messaging.send",
        scope: { kind: "store", storeIdArg: "storeId" },
        readiness: { kind: "none" },
        effects: { mode: "protected", gateways: ["order_notification.send"] },
        actors: { normalUser: "admit", sharedDemo: "admit", public: "deny" },
      }),
    ).toContain(
      "Shared-demo admitted action and http operations must declare store_ready readiness.",
    );
  });

  it("rejects a storefront-customer actor on a Convex mutation kind", () => {
    expect(
      validateOperationDefinition({
        kind: "mutation",
        operationId: "mutation.storefrontCustomer",
        capability: "orders.create",
        scope: { kind: "store", storeIdArg: "storeId" },
        readiness: { kind: "store_write" },
        effects: { mode: "none" },
        actors: {
          normalUser: "deny",
          sharedDemo: "deny",
          storefrontCustomer: "admit",
          public: "deny",
        },
      }),
    ).toContain(
      "actors.storefrontCustomer is only valid on http and http_read kinds.",
    );
  });

  it("rejects a storefront-customer definition without store scope", () => {
    expect(
      validateOperationDefinition({
        kind: "http",
        operationId: "http.storefrontCustomer.noScope",
        capability: "orders.create",
        scope: { kind: "none" },
        readiness: { kind: "none" },
        effects: { mode: "none" },
        ingressVerification: { kind: "origin_allowlist" },
        actors: {
          normalUser: "deny",
          sharedDemo: "deny",
          storefrontCustomer: "admit",
          public: "deny",
        },
      }),
    ).toContain("Storefront-customer operations must declare a store scope.");
  });

  it("rejects an http write that admits both storefront customers and the public", () => {
    const errors = validateOperationDefinition({
      kind: "http",
      operationId: "http.both.actors",
      capability: "orders.create",
      scope: { kind: "store", storeIdArg: "storeId" },
      readiness: { kind: "none" },
      effects: { mode: "none" },
      ingressVerification: { kind: "origin_allowlist" },
      actors: {
        normalUser: "deny",
        sharedDemo: "deny",
        storefrontCustomer: "admit",
        public: "admit",
      },
    });

    expect(errors).toContain(
      "An http write may not admit both storefrontCustomer and public.",
    );
  });

  it("requires an origin allowlist on a customer http write", () => {
    expect(
      validateOperationDefinition({
        kind: "http",
        operationId: "http.customer.noOrigin",
        capability: "orders.create",
        scope: { kind: "store", storeIdArg: "storeId" },
        readiness: { kind: "none" },
        effects: { mode: "none" },
        actors: {
          normalUser: "deny",
          sharedDemo: "deny",
          storefrontCustomer: "admit",
          public: "deny",
        },
      }),
    ).toContain(
      "Storefront-customer http writes must declare ingressVerification origin_allowlist.",
    );
  });

  it("requires ingress verification on a public webhook definition", () => {
    expect(
      validateOperationDefinition({
        kind: "http",
        operationId: "http.webhook.unverified",
        capability: "billing.manage",
        scope: { kind: "none" },
        readiness: { kind: "none" },
        effects: { mode: "none" },
        actors: {
          normalUser: "deny",
          sharedDemo: "deny",
          storefrontCustomer: "deny",
          public: "admit",
        },
      }),
    ).toContain("Public http definitions must declare ingressVerification.");
  });

  it("validates a dynamic capability set against the catalog", () => {
    expect(
      validateOperationDefinition({
        kind: "mutation",
        operationId: "dynamic.capability.unknown",
        capability: {
          kind: "dynamic",
          candidates: ["pos.sync.write", "not.a.capability" as never],
          resolve: () => ["pos.sync.write"],
        },
        scope: { kind: "store", storeIdArg: "storeId" },
        readiness: { kind: "store_write" },
        effects: { mode: "none" },
        actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
      }),
    ).toContain("Unknown operation capability: not.a.capability");
  });

  it("rejects a target guard that binds no argument", () => {
    expect(
      validateOperationDefinition({
        kind: "mutation",
        operationId: "target.unbound",
        capability: "catalog.manage",
        scope: { kind: "store", storeIdArg: "storeId" },
        readiness: { kind: "store_write" },
        effects: { mode: "none" },
        target: { protectDemoFoundation: {} },
        actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
      }),
    ).toContain(
      "target.protectDemoFoundation must bind at least one id argument.",
    );
  });

  it("converts the customer email actions to store_ready action definitions", () => {
    for (const operationId of [
      "storeFront/onlineOrderUtilFns.sendOrderUpdateEmail",
      "storeFront/reviews.sendFeedbackRequest",
    ]) {
      const definition = OPERATION_ADMISSION_DEFINITIONS.find(
        (candidate) => candidate.operationId === operationId,
      );
      expect(definition, operationId).toBeDefined();
      expect(definition!.kind, operationId).toBe("action");
      expect(definition!.readiness, operationId).toEqual({
        kind: "store_ready",
      });
      expect(validateOperationDefinition(definition!), operationId).toEqual([]);
    }
  });
});
