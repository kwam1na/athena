import { describe, expect, it } from "vitest";

import {
  removeStorefrontHiddenCategories,
  removeStorefrontHiddenSubcategories as removeNestedStorefrontHiddenSubcategories,
  shouldShowCategoryOnStorefront,
} from "./categories";
import { removeStorefrontHiddenSubcategoryList } from "./subcategories";

describe("storefront hidden inventory filters", () => {
  it("removes the POS quick-add category from storefront category navigation", () => {
    expect(
      removeStorefrontHiddenCategories([
        { slug: "lace-fronts", name: "Lace fronts" },
        { slug: "pos-quick-add", name: "POS quick add" },
      ]),
    ).toEqual([{ slug: "lace-fronts", name: "Lace fronts" }]);
  });

  it("removes categories hidden by storefront visibility control", () => {
    expect(
      removeStorefrontHiddenCategories([
        { slug: "lace-fronts", name: "Lace fronts" },
        {
          slug: "legacy-import",
          name: "Legacy import",
          showOnStorefront: false,
        },
      ]),
    ).toEqual([{ slug: "lace-fronts", name: "Lace fronts" }]);
  });

  it("keeps reserved storefront category filters stronger than the visibility control", () => {
    expect(
      shouldShowCategoryOnStorefront({
        slug: "pos-quick-add",
        showOnStorefront: true,
      }),
    ).toBe(false);
  });

  it("removes uncategorized subcategories from nested storefront navigation", () => {
    expect(
      removeNestedStorefrontHiddenSubcategories([
        {
          slug: "lace-fronts",
          subcategories: [
            { slug: "closures", name: "Closures" },
            { slug: "uncategorized", name: "Uncategorized" },
          ],
        },
      ]),
    ).toEqual([
      {
        slug: "lace-fronts",
        subcategories: [{ slug: "closures", name: "Closures" }],
      },
    ]);
  });

  it("removes uncategorized from the direct storefront subcategory list", () => {
    expect(
      removeStorefrontHiddenSubcategoryList([
        { slug: "bundles", name: "Bundles" },
        { slug: "uncategorized", name: "Uncategorized" },
      ]),
    ).toEqual([{ slug: "bundles", name: "Bundles" }]);
  });
});
