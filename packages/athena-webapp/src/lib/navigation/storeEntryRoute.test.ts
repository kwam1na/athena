import { describe, expect, it } from "vitest";

import {
  getStoreEntryRouteForRole,
  OPERATIONS_STORE_ENTRY_ROUTE,
  POS_STORE_ENTRY_ROUTE,
} from "./storeEntryRoute";

describe("getStoreEntryRouteForRole", () => {
  it("sends POS-only users to the POS hub", () => {
    expect(getStoreEntryRouteForRole("pos_only")).toBe(POS_STORE_ENTRY_ROUTE);
  });

  it("defaults non-POS-only users to operations", () => {
    expect(getStoreEntryRouteForRole("full_admin")).toBe(
      OPERATIONS_STORE_ENTRY_ROUTE
    );
    expect(getStoreEntryRouteForRole(null)).toBe(OPERATIONS_STORE_ENTRY_ROUTE);
  });
});
