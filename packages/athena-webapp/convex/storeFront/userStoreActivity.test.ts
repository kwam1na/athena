import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  assertStoreFrontActorMatchesStore,
  getLastViewedProducts,
} from "./user";

describe("store-scoped user activity", () => {
  it("rejects actors from another store before analytics can be used", () => {
    expect(() =>
      assertStoreFrontActorMatchesStore(
        { storeId: "store-b" as Id<"store"> },
        "store-a" as Id<"store">,
      ),
    ).toThrow("Customer activity is not available for this store.");
  });

  it("allows actors from the requested store", () => {
    expect(() =>
      assertStoreFrontActorMatchesStore(
        { storeId: "store-a" as Id<"store"> },
        "store-a" as Id<"store">,
      ),
    ).not.toThrow();
  });

  it("keeps last-viewed products aligned with the exported return validator", () => {
    assertConformsToExportedReturns(getLastViewedProducts, [
      {
        sku: "WIG-001",
        productId: "product-a" as Id<"product">,
        productCategory: "Wigs",
        quantityAvailable: 4,
      },
    ]);
  });
});
