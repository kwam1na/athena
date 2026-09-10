import { describe, expect, it } from "vitest";
import { SHARED_DEMO_PRODUCTS } from "~/shared/sharedDemoStory";
import { resolveSharedDemoStockSearch } from "./sharedDemoStockNavigation";

describe("demo report to stock navigation", () => {
  it.each(SHARED_DEMO_PRODUCTS)("resolves $slug through its SKU code", (product) => {
    expect(resolveSharedDemoStockSearch({ sku: `shared-demo-sku-${product.slug}`, mode: "cycle_count" }))
      .toEqual({ sku: undefined, query: product.sku, mode: "cycle_count" });
  });

  it("unwraps live demo report IDs for quick-added catalog rows", () => {
    const id = "ks79cgmfens33ajr28mvyya9xn8b25sw";
    expect(resolveSharedDemoStockSearch({ sku: `shared-demo-live-sku-${id}` }))
      .toEqual({ sku: id });
  });

  it.each(["shared-demo-sku-missing", "shared-demo-live-sku-invalid"])(
    "keeps unknown fixture references away from ID-validated reads: %s", (sku) => {
      expect(resolveSharedDemoStockSearch({ sku })).toEqual({ sku: undefined, query: sku });
    },
  );

  it("preserves ordinary stock navigation", () => {
    const search = { sku: "normal-id", query: "filter", page: 2 };
    expect(resolveSharedDemoStockSearch(search)).toEqual(search);
  });
});
