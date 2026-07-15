import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  classifySharedDemoPublicFunction,
  decideSharedDemoEffect,
  requireSharedDemoCapability,
  requireSharedDemoOrderFulfillmentUpdate,
  SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY,
  validateSharedDemoCoverage,
} from "./policy";
import {
  ATHENA_CAPABILITY_CATALOG,
  SHARED_DEMO_ALLOWED_CAPABILITIES,
} from "./capabilityCatalog";

describe("shared demo policy", () => {
  it("keeps the demo allowlist separate from Athena's complete capability catalog", () => {
    expect(ATHENA_CAPABILITY_CATALOG.length).toBeGreaterThan(50);
    expect(new Set(ATHENA_CAPABILITY_CATALOG.map(({ id }) => id)).size).toBe(
      ATHENA_CAPABILITY_CATALOG.length,
    );
    expect(SHARED_DEMO_ALLOWED_CAPABILITIES).toEqual([
      "approvals.manage",
      "cash.control.write",
      "catalog.quick_add",
      "daily_operations.write",
      "inventory.adjust",
      "orders.fulfill",
      "pos.sale.complete",
      "reports.read",
      "staff.authenticate",
      "staff.communication.write",
    ]);
    expect(requireSharedDemoCapability("pos.sale.complete")).toBe("pos.sale.complete");
    expect(requireSharedDemoCapability("reports.read")).toBe("reports.read");
    expect(() => requireSharedDemoCapability("billing.update" as never)).toThrow(
      "This action is unavailable in the demo.",
    );
  });

  it("classifies known Athena writes before applying the demo allowlist", () => {
    expect(
      classifySharedDemoPublicFunction("cashControls/closeouts:correctRegisterSessionOpeningFloat"),
    ).toEqual({
      capability: "cash.control.write",
      decision: "declared",
      demoDecision: "allowed",
    });
    expect(
      classifySharedDemoPublicFunction("inventory/products:create"),
    ).toEqual({
      capability: "catalog.manage",
      decision: "declared",
      demoDecision: "denied",
    });
    expect(
      classifySharedDemoPublicFunction("pos/public/catalog:quickAddSku"),
    ).toEqual({
      capability: "catalog.quick_add",
      decision: "declared",
      demoDecision: "allowed",
    });
    expect(
      classifySharedDemoPublicFunction(
        "operations/approvalRequests:decideApprovalRequest",
      ),
    ).toEqual({
      capability: "approvals.manage",
      decision: "declared",
      demoDecision: "allowed",
    });
    expect(
      classifySharedDemoPublicFunction(
        "operations/staffCredentials:authenticateStaffCredentialForApproval",
      ),
    ).toEqual({
      capability: "staff.authenticate",
      decision: "declared",
      demoDecision: "allowed",
    });
    expect(classifySharedDemoPublicFunction("unknown/module:write")).toEqual({
      decision: "denied",
      reason: "unclassified",
    });
  });

  it("defaults unknown effects to denied and never calls live providers", async () => {
    const live = vi.fn();
    expect(await decideSharedDemoEffect("customer_message.send", { live })).toEqual({
      kind: "simulated",
      label: "No customer message was sent.",
    });
    expect(await decideSharedDemoEffect("unknown.gateway", { live })).toEqual({
      kind: "denied",
      reason: "unclassified",
    });
    expect(live).not.toHaveBeenCalled();
  });

  it("keeps the classification registry complete and unique", () => {
    expect(validateSharedDemoCoverage()).toEqual([]);
  });

  it("maps every classification to an actual exported Convex function", () => {
    for (const entry of SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY) {
      const [moduleName, exportName] = entry.functionName.split(":");
      const source = readFileSync(
        resolve(__dirname, `../${moduleName}.ts`),
        "utf8",
      );
      expect(source, entry.functionName).toMatch(
        new RegExp(`export const ${exportName}\\s*=`),
      );
      if (entry.capability !== "reports.read") {
        expect(source, `${entry.functionName} must invoke ${entry.capability}`).toContain(
          `"${entry.capability}"`,
        );
      }
    }
  });

  it("allows only fulfillment status changes through the generic order update", () => {
    expect(() =>
      requireSharedDemoOrderFulfillmentUpdate({ status: "delivered" }),
    ).not.toThrow();
    expect(() =>
      requireSharedDemoOrderFulfillmentUpdate({ status: "picked-up" }),
    ).not.toThrow();
    for (const update of [
      { status: "cancelled" },
      { status: "refunded" },
      { paymentCollected: true },
      { status: "delivered", paymentCollected: true },
    ]) {
      expect(() => requireSharedDemoOrderFulfillmentUpdate(update)).toThrow(
        "This action is unavailable in the demo.",
      );
    }
  });
});
