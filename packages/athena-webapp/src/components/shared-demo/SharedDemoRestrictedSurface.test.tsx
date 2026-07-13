import { describe, expect, it } from "vitest";

import { isSharedDemoRestrictedPath } from "./sharedDemoRestrictions";

describe("shared demo restricted surfaces", () => {
  it("blocks administration routes while preserving operating routes", () => {
    for (const path of [
      "/demo/store/central/members",
      "/demo/store/central/app-settings",
      "/demo/store/central/configuration",
      "/demo/store/central/bulk-operations",
      "/demo/store/central/products/new",
      "/demo/settings/organization",
    ]) {
      expect(isSharedDemoRestrictedPath(path), path).toBe(true);
    }
    for (const path of [
      "/demo/store/central/pos",
      "/demo/store/central/reports",
      "/demo/store/central/orders/ready",
      "/demo/store/central/operations/stock-adjustments",
    ]) {
      expect(isSharedDemoRestrictedPath(path), path).toBe(false);
    }
  });
});
