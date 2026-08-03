import { describe, expect, it } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import { SHARED_DEMO_PRODUCTS } from "~/shared/sharedDemoStory";
import { createSharedDemoCatalogSearchResults } from "./sharedDemoCatalogSearchFixture";

const storeId = "shared-demo-store" as Id<"store">;

function search(query: string, limit?: number) {
  return createSharedDemoCatalogSearchResults({ limit, query, storeId });
}

describe("createSharedDemoCatalogSearchResults", () => {
  it("matches product names case-insensitively", () => {
    const response = search("KENTE");

    expect(response.results.map((result) => result.productName)).toEqual([
      "Kente Scarf",
    ]);
    expect(response.results[0]?.match.kind).toBe("text");
    expect(response.results[0]?.storeId).toBe(storeId);
  });

  it("matches a partial product name across several products", () => {
    const response = search("ba");

    expect(response.results.length).toBeGreaterThan(1);
    expect(response.results.map((result) => result.productName)).toContain(
      "Batik Tote Bag",
    );
  });

  it("ranks an exact SKU match ahead of free text and marks it as a sku hit", () => {
    const [first] = SHARED_DEMO_PRODUCTS;
    const response = search(first.sku.toLowerCase());

    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.sku).toBe(first.sku);
    expect(response.results[0]?.match).toEqual({
      kind: "sku",
      matchedValue: first.sku,
      rank: 1,
    });
  });

  it("matches a SKU fragment as free text", () => {
    const [first] = SHARED_DEMO_PRODUCTS;
    const fragment = first.sku.slice(0, 4);
    const response = search(fragment);

    // The demo SKUs share a prefix, so a fragment fans out across the catalog.
    expect(response.results.length).toBeGreaterThan(1);
    expect(
      response.results.every((result) => result.match.kind === "text"),
    ).toBe(true);
  });

  it("matches slug and subcategory text", () => {
    expect(search("demo-clay-mug").results.map((r) => r.productSlug)).toEqual([
      "demo-clay-mug",
    ]);
    expect(
      search("Bath & Body").results.map((result) => result.subcategoryName),
    ).toEqual(["Bath & Body", "Bath & Body"]);
  });

  it("returns nothing for an empty or whitespace query", () => {
    for (const query of ["", "   ", "\t\n"]) {
      expect(search(query)).toEqual({
        candidateOverflow: false,
        limit: 25,
        results: [],
        truncated: false,
      });
    }
  });

  it("returns an empty result set for an unknown query without throwing", () => {
    const response = search("zzz-not-a-product");

    expect(response.results).toEqual([]);
    expect(response.truncated).toBe(false);
    expect(response.candidateOverflow).toBe(false);
  });

  it("respects the limit and reports truncation only beyond it", () => {
    // "demo-" is in every product slug, so all eight products match.
    const all = search("demo-");
    expect(all.results).toHaveLength(SHARED_DEMO_PRODUCTS.length);
    expect(all.truncated).toBe(false);

    const atLimit = search("demo-", SHARED_DEMO_PRODUCTS.length);
    expect(atLimit.limit).toBe(SHARED_DEMO_PRODUCTS.length);
    expect(atLimit.results).toHaveLength(SHARED_DEMO_PRODUCTS.length);
    expect(atLimit.truncated).toBe(false);

    const beyondLimit = search("demo-", SHARED_DEMO_PRODUCTS.length - 1);
    expect(beyondLimit.results).toHaveLength(SHARED_DEMO_PRODUCTS.length - 1);
    expect(beyondLimit.truncated).toBe(true);
    expect(beyondLimit.candidateOverflow).toBe(false);
  });

  it("clamps the limit to the server's bounds", () => {
    expect(search("demo-", 0).limit).toBe(1);
    expect(search("demo-", 500).limit).toBe(50);
  });

  it("issues shared-demo ids for every result", () => {
    const response = search("demo-");

    for (const result of response.results) {
      expect(String(result.productSkuId)).toBe(
        `shared-demo-sku-${result.productSlug}`,
      );
      expect(String(result.productId)).toBe(
        `shared-demo-product-${result.productSlug}`,
      );
    }
  });

  it("keeps prices in minor units and marks demo SKUs live and visible", () => {
    const [first] = SHARED_DEMO_PRODUCTS;
    const [result] = search(first.sku).results;

    expect(result?.price).toBe(first.price);
    expect(result?.netPrice).toBe(first.price);
    expect(result?.inventoryCount).toBe(first.inventoryCount);
    expect(result?.productAvailability).toBe("live");
    expect(result?.productIsVisible).toBe(true);
    expect(result?.skuIsVisible).toBe(true);
    expect(result?.barcode).toBeNull();
  });
});
