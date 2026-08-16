import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  decideSharedDemoEffect,
  deriveSharedDemoRepresentedCapabilities,
  deriveSharedDemoRepresentedReadIntents,
  requireSharedDemoCapability,
  requireSharedDemoOrderFulfillmentUpdate,
  requireSharedDemoRegisterSessionSyncReview,
  SHARED_DEMO_ALLOWED_READ_INTENTS,
  validateSharedDemoCoverage,
} from "./policy";
import {
  ATHENA_CAPABILITY_CATALOG,
  SHARED_DEMO_ALLOWED_CAPABILITIES,
} from "../platform/capabilityCatalog";
import { OPERATION_ADMISSION_DEFINITIONS } from "../operationAdmission/definitions";
import { OPERATION_READ_ADMISSION_DEFINITIONS } from "../operationAdmission/readDefinitions";

describe("shared demo policy", () => {
  it("keeps the demo allowlist separate from Athena's complete capability catalog", () => {
    expect(ATHENA_CAPABILITY_CATALOG.length).toBeGreaterThan(50);
    expect(new Set(ATHENA_CAPABILITY_CATALOG.map(({ id }) => id)).size).toBe(
      ATHENA_CAPABILITY_CATALOG.length,
    );
    expect(SHARED_DEMO_ALLOWED_CAPABILITIES).toEqual([
      "approvals.manage",
      "cash.control.write",
      "catalog.maintain",
      "catalog.quick_add",
      "customer.messaging.send",
      "daily_operations.write",
      "expense.manage",
      "inventory.adjust",
      "orders.fulfill",
      "orders.manage",
      "orders.return",
      "payments.refund",
      "pos.sale.complete",
      "pos.sync.write",
      "pos.transaction.correct",
      "pos.transaction.void",
      "reviews.manage",
      "staff.authenticate",
      "staff.communication.write",
    ]);
    expect(requireSharedDemoCapability("expense.manage")).toBe(
      "expense.manage",
    );
    expect(requireSharedDemoCapability("pos.sale.complete")).toBe(
      "pos.sale.complete",
    );
    expect(requireSharedDemoCapability("catalog.maintain")).toBe(
      "catalog.maintain",
    );
    expect(requireSharedDemoCapability("demo.lifecycle")).toBe(
      "demo.lifecycle",
    );
    expect(() =>
      requireSharedDemoCapability("billing.update" as never),
    ).toThrow("This action isn't allowed in the demo.");
  });

  it("defaults unknown effects to denied and never calls live providers", async () => {
    const live = vi.fn();
    expect(
      await decideSharedDemoEffect("customer_message.send", { live }),
    ).toEqual({
      kind: "simulated",
      label: "No customer message was sent.",
    });
    expect(await decideSharedDemoEffect("payment.refund", { live })).toEqual({
      kind: "simulated",
      label: "No live payment refund was issued.",
    });
    expect(await decideSharedDemoEffect("unknown.gateway", { live })).toEqual({
      kind: "denied",
      reason: "unclassified",
    });
    expect(live).not.toHaveBeenCalled();
  });

  it("keeps demo coverage complete and unique, derived from the definitions", () => {
    expect(
      validateSharedDemoCoverage(
        OPERATION_ADMISSION_DEFINITIONS,
        OPERATION_READ_ADMISSION_DEFINITIONS,
      ),
    ).toEqual([]);
  });

  /**
   * Forward direction: a grant with nothing implementing it.
   *
   * `SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY` used to answer this by hand —
   * a list of `functionName -> capability` pairs that a test then confirmed
   * still existed on disk. It could claim representation for a function whose
   * demo guard had since been removed, because "the export exists" and "the
   * demo can reach it" are different facts and only the first was checked.
   */
  it("represents every granted demo capability with an admitted definition", () => {
    const represented = deriveSharedDemoRepresentedCapabilities(
      OPERATION_ADMISSION_DEFINITIONS,
    );
    for (const capability of SHARED_DEMO_ALLOWED_CAPABILITIES) {
      expect([...represented], capability).toContain(capability);
    }
  });

  it("represents every granted demo read intent with an admitted read definition", () => {
    const represented = deriveSharedDemoRepresentedReadIntents(
      OPERATION_READ_ADMISSION_DEFINITIONS,
    );
    for (const intent of SHARED_DEMO_ALLOWED_READ_INTENTS) {
      expect([...represented], intent).toContain(intent);
    }
  });

  /**
   * Reverse direction, and the one that actually protects the demo boundary:
   * a definition that admits the demo for something the demo was never
   * granted. The legacy inventory could not express this at all — it only
   * listed representatives, so a newly added `sharedDemo: "admit"` on an
   * ungranted capability was invisible to it.
   */
  it("never admits the demo for an ungranted capability or read intent", () => {
    const granted = new Set<string>([
      ...SHARED_DEMO_ALLOWED_CAPABILITIES,
      "demo.lifecycle",
    ]);
    for (const capability of deriveSharedDemoRepresentedCapabilities(
      OPERATION_ADMISSION_DEFINITIONS,
    )) {
      expect(granted.has(capability), capability).toBe(true);
    }

    const grantedIntents = new Set<string>(SHARED_DEMO_ALLOWED_READ_INTENTS);
    for (const intent of deriveSharedDemoRepresentedReadIntents(
      OPERATION_READ_ADMISSION_DEFINITIONS,
    )) {
      expect(grantedIntents.has(intent), intent).toBe(true);
    }
  });

  it("names a real Convex export for every demo-admitted definition", () => {
    for (const definition of OPERATION_ADMISSION_DEFINITIONS) {
      if (definition.actors.sharedDemo !== "admit") continue;
      if (!definition.functionName) continue;
      const [moduleName, exportName] = definition.functionName.split(":");
      const source = readFileSync(
        resolve(__dirname, `../${moduleName}.ts`),
        "utf8",
      );
      expect(source, definition.functionName).toMatch(
        new RegExp(`export const ${exportName}\\s*=`),
      );
    }
  });

  it("allows only fulfillment status changes through the generic order update", () => {
    expect(() =>
      requireSharedDemoOrderFulfillmentUpdate({ status: "delivered" }),
    ).not.toThrow();
    expect(() =>
      requireSharedDemoOrderFulfillmentUpdate({ status: "picked-up" }),
    ).not.toThrow();
    expect(() =>
      requireSharedDemoOrderFulfillmentUpdate({ status: "cancelled" }),
    ).not.toThrow();
    expect(() =>
      requireSharedDemoOrderFulfillmentUpdate({
        paymentCollected: true,
        paymentCollectedAt: 123,
      }),
    ).not.toThrow();
    for (const update of [
      { status: "refunded" },
      { paymentCollected: true },
      { status: "delivered", paymentCollected: true },
    ]) {
      expect(() => requireSharedDemoOrderFulfillmentUpdate(update)).toThrow(
        "This action isn't allowed in the demo.",
      );
    }
  });

  it("allows only duplicate register-opening rejection through demo sync review", () => {
    expect(() =>
      requireSharedDemoRegisterSessionSyncReview({
        decision: "rejected",
        reviewKinds: ["duplicate_register_open", "duplicate_register_open"],
      }),
    ).not.toThrow();

    for (const review of [
      {
        decision: "approved" as const,
        reviewKinds: ["duplicate_register_open"],
      },
      { decision: "rejected" as const, reviewKinds: [] },
      {
        decision: "rejected" as const,
        reviewKinds: ["duplicate_register_open", "inventory_review"],
      },
    ]) {
      expect(() => requireSharedDemoRegisterSessionSyncReview(review)).toThrow(
        "This action isn't allowed in the demo.",
      );
    }
  });
});
