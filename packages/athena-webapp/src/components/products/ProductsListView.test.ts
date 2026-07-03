import { describe, expect, it } from "vitest";

import { getCategoryProductQueryOptions } from "./ProductsListView.logic";

describe("ProductsListView category query", () => {
  it("requests live products for the reserved POS quick-add category", () => {
    expect(getCategoryProductQueryOptions("pos-quick-add")).toEqual({
      availability: "live",
    });
  });

  it("requests hidden draft products for the reserved POS pending-checkout category", () => {
    expect(getCategoryProductQueryOptions("pos-pending-checkout")).toEqual({
      availability: "draft",
      isVisible: false,
    });
  });

  it("requests hidden draft products for the legacy import category", () => {
    expect(getCategoryProductQueryOptions("legacy-import")).toEqual({
      availability: "draft",
      isVisible: false,
    });
  });

  it("leaves normal category queries on the default visible live-product path", () => {
    expect(getCategoryProductQueryOptions("hair")).toEqual({});
    expect(getCategoryProductQueryOptions(undefined)).toEqual({});
  });
});
