import { describe, expect, it } from "vitest";

import { buildAllProductsCacheKey } from "./productUtil";

describe("buildAllProductsCacheKey", () => {
  it("separates public storefront results from admin-visible catalog results", () => {
    const baseArgs = {
      storeId: "store-1",
      category: ["lace-fronts"],
      subcategory: ["closures"],
    };

    expect(
      buildAllProductsCacheKey({
        ...baseArgs,
        isVisible: true,
        excludeStorefrontHidden: true,
      }),
    ).toBe(
      "all:products:{store-1}:category:lace-fronts:subcategory:closures:isVisible:true:excludeStorefrontHidden:true",
    );

    expect(
      buildAllProductsCacheKey({
        ...baseArgs,
        isVisible: false,
      }),
    ).toBe(
      "all:products:{store-1}:category:lace-fronts:subcategory:closures:isVisible:false",
    );
  });
});
