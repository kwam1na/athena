import path from "node:path";
import { describe, expect, it } from "vitest";

import { discoverPublicMutationExports } from "../../../../scripts/convex-operation-admission-check";
import { OPERATION_ADMISSION_DEFINITIONS } from "./definitions";
import {
  OPERATION_ADMISSION_LEGACY_EXEMPTIONS,
  OPERATION_ADMISSION_MIGRATION_INVENTORY,
} from "./migrationInventory";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

describe("operation admission migration inventory", () => {
  it("has exact, non-duplicated legacy exemptions with migration metadata", () => {
    const seen = new Set<string>();

    for (const exemption of OPERATION_ADMISSION_LEGACY_EXEMPTIONS) {
      expect(exemption.functionName).toMatch(/^[^:]+:[^:]+$/);
      expect(exemption.capability).toBeTruthy();
      expect(exemption.wave).toBeTruthy();
      expect(exemption.owner).toBe("V26-1094");
      expect(exemption.reason).toBeTruthy();
      expect(seen.has(exemption.functionName)).toBe(false);
      seen.add(exemption.functionName);
    }
  });

  it("keeps migration groups meaningful for follow-up waves", () => {
    expect(OPERATION_ADMISSION_MIGRATION_INVENTORY).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          wave: "daily-operations",
          capability: "daily_operations.write",
          functions: expect.arrayContaining([
            "operations/dailyClose:completeDailyClose",
          ]),
        }),
      ]),
    );
    expect(OPERATION_ADMISSION_DEFINITIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          functionName:
            "operations/openWorkInventoryReviews:resolveSyncedSaleInventoryReviewGroup",
        }),
      ]),
    );
    const legacyFunctionNames = OPERATION_ADMISSION_LEGACY_EXEMPTIONS.map(
      (exemption): string => exemption.functionName,
    );
    expect(legacyFunctionNames).not.toContain(
      "operations/openWorkInventoryReviews:resolveSyncedSaleInventoryReviewGroup",
    );
    expect(legacyFunctionNames).not.toContain(
      "sharedDemo/public:requestManualRestore",
    );
    expect(legacyFunctionNames).not.toContain(
      "sharedDemo/public:resetBrowserExperience",
    );
    expect(legacyFunctionNames).not.toContain(
      "sharedDemo/public:bindRegisterBaselineToTerminal",
    );
  });

  it("keeps demo-reachable follow-up groups inventoried until their handlers migrate", () => {
    expect(OPERATION_ADMISSION_MIGRATION_INVENTORY).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "pos.sale.complete",
          functions: expect.arrayContaining([
            "pos/public/transactions:completeTransaction",
          ]),
          wave: "pos",
        }),
        expect.objectContaining({
          capability: "cash.control.write",
          functions: expect.arrayContaining([
            "cashControls/deposits:recordRegisterSessionDeposit",
          ]),
          wave: "cash-controls",
        }),
        expect.objectContaining({
          capability: "inventory.adjust",
          functions: expect.arrayContaining([
            "stockOps/adjustments:submitStockAdjustmentBatch",
          ]),
          wave: "catalog",
        }),
        expect.objectContaining({
          capability: "orders.fulfill",
          functions: expect.arrayContaining(["storeFront/onlineOrder:update"]),
          wave: "storefront",
        }),
        expect.objectContaining({
          capability: "staff.communication.write",
          functions: expect.arrayContaining([
            "operations/staffMessages:postStaffMessage",
          ]),
          wave: "identity-and-staff",
        }),
      ]),
    );
  });

  it("covers every current public mutation until operation definitions replace exemptions", async () => {
    const discovered = await discoverPublicMutationExports(REPO_ROOT);
    const inventoried = new Set<string>(
      [
        ...OPERATION_ADMISSION_DEFINITIONS.map(
          (definition) => definition.functionName,
        ),
        ...OPERATION_ADMISSION_LEGACY_EXEMPTIONS.map(
          (exemption) => exemption.functionName,
        ),
      ].filter(
        (functionName): functionName is string =>
          typeof functionName === "string",
      ),
    );
    const missing = discovered
      .map((entry) => entry.functionName)
      .filter((functionName) => !inventoried.has(functionName));

    expect(missing).toEqual([]);
  }, 30_000);
});
