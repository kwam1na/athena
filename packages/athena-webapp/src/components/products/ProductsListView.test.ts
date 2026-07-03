import { describe, expect, it } from "vitest";

import {
  getCategoryProductPageIndex,
  getCategoryProductQueryOptions,
  writeCategoryProductPageSearch,
} from "./ProductsListView.logic";

describe("ProductsListView category query", () => {
  it("requests live products for the reserved POS quick-add category", () => {
    expect(getCategoryProductQueryOptions("pos-quick-add")).toEqual({
      availability: "live",
    });
  });

  it("requests unarchived products for the reserved POS pending-checkout category", () => {
    expect(getCategoryProductQueryOptions("pos-pending-checkout")).toEqual({
      availability: "unarchived",
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

describe("ProductsListView category pagination", () => {
  it("reads URL page search params as zero-based page indexes", () => {
    expect(getCategoryProductPageIndex(undefined)).toBe(0);
    expect(getCategoryProductPageIndex(1)).toBe(0);
    expect(getCategoryProductPageIndex("2")).toBe(1);
    expect(getCategoryProductPageIndex("3.9")).toBe(2);
  });

  it("falls back to the first page for invalid URL page search params", () => {
    expect(getCategoryProductPageIndex("")).toBe(0);
    expect(getCategoryProductPageIndex("abc")).toBe(0);
    expect(getCategoryProductPageIndex("0")).toBe(0);
    expect(getCategoryProductPageIndex("-1")).toBe(0);
  });

  it("stores non-first category product pages in the URL", () => {
    expect(
      writeCategoryProductPageSearch(
        {
          categorySlug: "pos-pending-checkout",
          o: "/wigclub/store/wigclub/products",
        },
        2,
      ),
    ).toEqual({
      categorySlug: "pos-pending-checkout",
      o: "/wigclub/store/wigclub/products",
      page: 3,
    });
  });

  it("removes the category product page param for the first page", () => {
    expect(
      writeCategoryProductPageSearch(
        {
          categorySlug: "pos-pending-checkout",
          page: 2,
        },
        0,
      ),
    ).toEqual({
      categorySlug: "pos-pending-checkout",
    });
  });
});
