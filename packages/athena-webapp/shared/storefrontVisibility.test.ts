import { describe, expect, it } from "vitest";

import {
  isStorefrontSelectableSubcategory,
  isStorefrontVisibleCategory,
  isStorefrontVisibleSubcategory,
} from "./storefrontVisibility";

describe("storefront visibility", () => {
  it("keeps hidden and reserved categories out of storefront selections", () => {
    expect(
      isStorefrontVisibleCategory({
        showOnStorefront: true,
        slug: "hair-care",
      }),
    ).toBe(true);
    expect(
      isStorefrontVisibleCategory({
        showOnStorefront: false,
        slug: "hair-care",
      }),
    ).toBe(false);
    expect(
      isStorefrontVisibleCategory({
        showOnStorefront: true,
        slug: "pos-quick-add",
      }),
    ).toBe(false);
  });

  it("keeps reserved subcategories out of storefront selections", () => {
    expect(isStorefrontVisibleSubcategory({ slug: "closures" })).toBe(true);
    expect(isStorefrontVisibleSubcategory({ slug: "uncategorized" })).toBe(
      false,
    );
  });

  it("requires subcategory parent categories to be storefront-visible", () => {
    expect(
      isStorefrontSelectableSubcategory(
        { slug: "closures" },
        { showOnStorefront: true, slug: "hair" },
      ),
    ).toBe(true);
    expect(
      isStorefrontSelectableSubcategory(
        { slug: "closures" },
        { showOnStorefront: false, slug: "hair" },
      ),
    ).toBe(false);
    expect(
      isStorefrontSelectableSubcategory(
        { slug: "uncategorized" },
        { showOnStorefront: true, slug: "hair" },
      ),
    ).toBe(false);
  });
});
