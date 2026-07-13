import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  decideSharedDemoEffect,
  requireSharedDemoCapability,
  requireSharedDemoOrderFulfillmentUpdate,
  SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY,
  validateSharedDemoCoverage,
} from "./policy";

describe("shared demo policy", () => {
  it("allows only the six write capabilities and reports reads", () => {
    expect(requireSharedDemoCapability("pos.sale.complete")).toBe("pos.sale.complete");
    expect(requireSharedDemoCapability("reports.read")).toBe("reports.read");
    expect(() => requireSharedDemoCapability("billing.update" as never)).toThrow(
      "This action is unavailable in the shared demo.",
    );
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
    for (const update of [
      { status: "cancelled" },
      { status: "refunded" },
      { paymentCollected: true },
      { status: "delivered", paymentCollected: true },
    ]) {
      expect(() => requireSharedDemoOrderFulfillmentUpdate(update)).toThrow(
        "This action is unavailable in the shared demo.",
      );
    }
  });
});
