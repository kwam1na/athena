import { describe, expect, it } from "vitest";

import {
  buildVariantSkuMoneyPayload,
  resolveLegacyTaxonomySaveGate,
  getArchivedProductRedirect,
} from "./ProductView";

describe("ProductView SKU money payloads", () => {
  it("persists decimal net price and unit cost as minor units when fees are absorbed", () => {
    expect(
      buildVariantSkuMoneyPayload(
        {
          cost: 12.34,
          netPrice: 45.67,
        },
        true,
      ),
    ).toEqual({
      netPrice: 4567,
      price: 4567,
      unitCost: 1234,
    });
  });

  it("persists a fee-inclusive price as minor units when fees are not absorbed", () => {
    expect(
      buildVariantSkuMoneyPayload(
        {
          cost: 9.99,
          netPrice: 100,
        },
        false,
      ),
    ).toEqual({
      netPrice: 10000,
      price: 10200,
      unitCost: 999,
    });
  });
});

describe("ProductView archived product redirects", () => {
  it("prefers the origin search param after archiving", () => {
    expect(
      getArchivedProductRedirect({
        categorySlug: "makeup",
        origin: "/wigclub/store/wigclub/products/ks753/edit?o=%2Freturn",
      }),
    ).toEqual({
      kind: "origin",
      to: "/wigclub/store/wigclub/products/ks753/edit?o=/return",
    });
  });

  it("unwraps same-product origins to avoid returning to an archived product page", () => {
    expect(
      getArchivedProductRedirect({
        categorySlug: "makeup",
        origin:
          "%2Fwigclub%2Fstore%2Fwigclub%2Fproducts%2Fks753%3Fo%3D%25252Fwigclub%25252Fstore%25252Fwigclub%25252Fproducts%25253FcategorySlug%25253Dmakeup",
        productId: "ks753",
      }),
    ).toEqual({
      kind: "origin",
      to: "/wigclub/store/wigclub/products?categorySlug=makeup",
    });
  });

  it("falls back to the product category when no origin is present", () => {
    expect(
      getArchivedProductRedirect({
        categorySlug: "makeup",
        origin: "",
      }),
    ).toEqual({
      categorySlug: "makeup",
      kind: "category",
    });
  });
});

describe("ProductView legacy taxonomy save gate", () => {
  it("blocks save after trusted inventory finalization while legacy taxonomy remains selected", () => {
    expect(
      resolveLegacyTaxonomySaveGate({
        activeProduct: {
          categorySlug: "legacy-import",
          subcategorySlug: "872",
        },
        hasTrustedInventoryFinalized: true,
        productData: {
          categorySlug: "legacy-import",
          subcategorySlug: "872",
        },
      }),
    ).toEqual({
      blocked: true,
      message:
        "Catalog setup required. Assign an Athena category and subcategory before saving.",
    });
  });

  it("allows save after trusted inventory finalization once Athena taxonomy is selected", () => {
    expect(
      resolveLegacyTaxonomySaveGate({
        activeProduct: {
          categorySlug: "legacy-import",
          subcategorySlug: "872",
        },
        hasTrustedInventoryFinalized: true,
        productData: {
          categorySlug: "hair-care",
          subcategorySlug: "heat-protectant",
        },
      }),
    ).toEqual({ blocked: false });
  });

  it("does not block non-finalized legacy products", () => {
    expect(
      resolveLegacyTaxonomySaveGate({
        activeProduct: {
          categorySlug: "legacy-import",
          subcategorySlug: "872",
        },
        hasTrustedInventoryFinalized: false,
        productData: {
          categorySlug: "legacy-import",
          subcategorySlug: "872",
        },
      }),
    ).toEqual({ blocked: false });
  });
});
