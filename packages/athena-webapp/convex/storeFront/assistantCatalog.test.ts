/// <reference types="vite/client" />

/**
 * `assistant_catalog.v1` against a seeded store.
 *
 * The contract has two halves and both are pinned here. The SHAPE: exactly
 * these keys, nothing a shopper could not read off the storefront, and a body
 * that fits the wire protocol's budget. The BEHAVIOUR: nothing the shop keeps
 * to itself can change an answer — a real barcode ranks exactly as a made-up
 * one, a hidden SKU's code answers exactly as a code that never existed, and
 * a question made of nothing but stop words is not a search at all.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import { upsertProductSkuSearchProjection } from "../inventory/skuSearch";
import schema from "../schema";
import {
  ASSISTANT_CATALOG_BODY_MAX_BYTES,
  ASSISTANT_CATALOG_CONTRACT_VERSION,
  assistantProductUrlOf,
  fitAssistantCatalogBody,
  search,
  toPlainDescription,
  type AssistantCatalogBody,
} from "./assistantCatalog";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./storeFront/"),
    loader,
  ]),
);

const REAL_BARCODE = "5901234123457";
const FAKE_BARCODE = "5901234123999";
const IMPORTED_BARCODE = "5901234123458";
// Both codes tokenize to "bob", so the text search finds the same visible
// products for either one. The only difference between them is that one names
// a hidden SKU, which is exactly the difference that must not be readable.
const HIDDEN_SKU_CODE = "BOB-HID-1";
const NONEXISTENT_SKU_CODE = "BOB-NON-1";

type Seeded = {
  otherStoreId: Id<"store">;
  storeId: Id<"store">;
};

/**
 * A small shop with everything the contract has to be careful about: a
 * visible product with two options, a second visible product, a hidden SKU, a
 * draft product, a category that is off the storefront, and an imported SKU
 * whose code is really its barcode.
 */
async function seedStore(
  t: ReturnType<typeof convexTest>,
  extraVisibleBobProducts = 0,
  visibleSkusBesideTheHiddenOne = 0,
  hiddenSkusSharingTheHiddenCode = 0,
  skusHiddenAfterProjection = 0,
): Promise<Seeded> {
  return await t.run(async (ctx) => {
    const createdByUserId = await ctx.db.insert("athenaUser", {
      email: "operator@example.com",
    } as never);
    const organizationId = await ctx.db.insert("organization", {
      name: "Wig Club Ltd",
      slug: "wig-club-ltd",
      createdByUserId,
    } as never);
    const storeId = await ctx.db.insert("store", {
      name: "Wig Club",
      slug: "wig-club",
      currency: "GHS",
      organizationId,
      createdByUserId,
    } as never);
    const otherStoreId = await ctx.db.insert("store", {
      name: "Other shop",
      slug: "other-shop",
      currency: "GHS",
      organizationId,
      createdByUserId,
    } as never);

    const categoryId = await ctx.db.insert("category", {
      name: "Wigs",
      slug: "wigs",
      showOnStorefront: true,
      storeId,
    } as never);
    const hiddenCategoryId = await ctx.db.insert("category", {
      name: "Legacy import",
      slug: "legacy-import",
      showOnStorefront: false,
      storeId,
    } as never);
    const subcategoryId = await ctx.db.insert("subcategory", {
      categoryId,
      name: "Bob wigs",
      slug: "bob-wigs",
      storeId,
    } as never);
    const hiddenSubcategoryId = await ctx.db.insert("subcategory", {
      categoryId: hiddenCategoryId,
      name: "Uncategorized",
      slug: "uncategorized",
      storeId,
    } as never);
    const colorId = await ctx.db.insert("color", {
      name: "Burgundy",
      hexCode: "#7b1f2b",
      storeId,
    } as never);

    const product = async (
      overrides: Record<string, unknown>,
    ): Promise<Id<"product">> =>
      await ctx.db.insert("product", {
        availability: "live",
        categoryId,
        subcategoryId,
        currency: "GHS",
        description: "<p>A short, glossy <b>bob</b> wig.</p>",
        inventoryCount: 10,
        isVisible: true,
        name: "Burgundy bob wig",
        organizationId,
        quantityAvailable: 10,
        slug: "burgundy-bob-wig",
        storeId,
        createdByUserId,
        ...overrides,
      } as never);

    const sku = async (
      productId: Id<"product">,
      overrides: Record<string, unknown>,
    ): Promise<Id<"productSku">> =>
      await ctx.db.insert("productSku", {
        color: colorId,
        images: ["https://images.test/a.webp", "https://images.test/b.webp"],
        inventoryCount: 10,
        isVisible: true,
        length: 14,
        netPrice: 40_000,
        price: 45_000,
        productId,
        productName: "Burgundy bob wig",
        quantityAvailable: 10,
        size: "M",
        storeId,
        unitCost: 20_000,
        ...overrides,
      } as never);

    const bob = await product({});
    const skus: Id<"productSku">[] = [
      await sku(bob, {
        barcode: REAL_BARCODE,
        length: 14,
        sku: "BOB-14",
      }),
      await sku(bob, {
        barcode: IMPORTED_BARCODE,
        length: 16,
        price: 55_000,
        // The importer default: a code that is really the barcode.
        sku: IMPORTED_BARCODE,
      }),
    ];

    const lace = await product({
      description: "A blonde lace front, 20 inches.",
      name: "Blonde lace front",
      slug: "blonde-lace-front",
    });
    skus.push(
      await sku(lace, {
        barcode: "5901234123460",
        length: 20,
        productName: "Blonde lace front",
        sku: "LACE-20",
      }),
    );

    const hiddenSkuProduct = await product({
      name: "Hidden bob wig",
      slug: "hidden-bob-wig",
    });
    skus.push(
      await sku(hiddenSkuProduct, {
        barcode: "5901234123461",
        isVisible: false,
        productName: "Hidden bob wig",
        sku: HIDDEN_SKU_CODE,
      }),
    );
    // Several hidden SKUs can carry the same code, so one code can produce
    // more candidate rows than a product is allowed to show options.
    for (let index = 0; index < hiddenSkusSharingTheHiddenCode; index += 1) {
      skus.push(
        await sku(hiddenSkuProduct, {
          barcode: `590123412348${index}`,
          isVisible: false,
          length: 30 + index,
          productName: "Hidden bob wig",
          sku: HIDDEN_SKU_CODE,
        }),
      );
    }
    // The hidden SKU can share a product with visible ones. That is the shape
    // in which a per-product option slot is worth something to a caller.
    for (let index = 0; index < visibleSkusBesideTheHiddenOne; index += 1) {
      skus.push(
        await sku(hiddenSkuProduct, {
          barcode: `590123412347${index}`,
          length: 10 + index,
          productName: "Hidden bob wig",
          sku: `HID-SIB-${index}`,
        }),
      );
    }

    const draft = await product({
      availability: "draft",
      name: "Draft bob wig",
      slug: "draft-bob-wig",
    });
    skus.push(
      await sku(draft, { barcode: "5901234123462", sku: "DRAFT-1" }),
    );

    const offStorefront = await product({
      categoryId: hiddenCategoryId,
      name: "Imported bob wig",
      slug: "imported-bob-wig",
      subcategoryId: hiddenSubcategoryId,
    });
    skus.push(
      await sku(offStorefront, { barcode: "5901234123463", sku: "IMP-1" }),
    );

    for (let index = 0; index < extraVisibleBobProducts; index += 1) {
      const extra = await product({
        name: `Spare bob wig ${index}`,
        slug: `spare-bob-wig-${index}`,
      });
      skus.push(
        await sku(extra, {
          productName: `Spare bob wig ${index}`,
          sku: `SPARE-${index}`,
        }),
      );
    }

    // Rows the index still calls visible because the projection has not
    // caught up with the hide yet. They are real candidates that hydrate to
    // nothing, which is the only way a stale row reaches the option limit.
    const stale: Id<"productSku">[] = [];
    if (skusHiddenAfterProjection > 0) {
      const staleProduct = await product({
        name: "Stale bob wig",
        slug: "stale-bob-wig",
      });
      for (let index = 0; index < skusHiddenAfterProjection; index += 1) {
        stale.push(
          await sku(staleProduct, {
            barcode: `590123412349${index}`,
            length: 40 + index,
            productName: "Stale bob wig",
            sku: `STALE-${index}`,
          }),
        );
      }
      skus.push(...stale);
    }

    for (const productSkuId of skus) {
      await upsertProductSkuSearchProjection(ctx, productSkuId, {
        advanceRevision: false,
      });
    }

    // The hide lands after the projection is written, so the index keeps
    // saying `assistantVisible: true` until the next write.
    for (const productSkuId of stale) {
      await ctx.db.patch("productSku", productSkuId, { isVisible: false });
    }

    return { otherStoreId, storeId };
  });
}

const ask = async (
  t: ReturnType<typeof convexTest>,
  storeId: Id<"store">,
  q: string,
  limit = 5,
) =>
  (await t.query(internal.storeFront.assistantCatalog.search, {
    limit,
    q,
    storeId,
  })) as AssistantCatalogBody;

/* ------------------------------------------------------- the shape */

const STORE_URL = "https://shop.wigclub.test";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assistant catalogue contract", () => {
  it("answers a natural-language question with exactly the contract's keys", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    const body = await ask(t, storeId, "do you have a burgundy bob wig?");

    expect(Object.keys(body).sort()).toEqual([
      "contractVersion",
      "exhaustive",
      "fetchedAt",
      "hasMore",
      "matches",
      "source",
    ]);
    expect(body.contractVersion).toBe(ASSISTANT_CATALOG_CONTRACT_VERSION);
    expect(Object.keys(body.source).sort()).toEqual(["currency", "name"]);
    expect(body.source).toEqual({ currency: "GHS", name: "Wig Club" });
    expect(body.fetchedAt.length).toBeLessThanOrEqual(40);
    expect(new Date(body.fetchedAt).toISOString()).toBe(body.fetchedAt);
    expect(body.exhaustive).toBe(true);
    expect(body.matches.length).toBeGreaterThan(0);

    for (const match of body.matches) {
      expect(Object.keys(match).sort()).toEqual([
        "categoryName",
        "description",
        "options",
        "productName",
        "productSlug",
        "productUrl",
        "subcategoryName",
      ]);
      expect(match.options.length).toBeGreaterThan(0);
      expect(match.options.length).toBeLessThanOrEqual(8);
      for (const option of match.options) {
        expect(Object.keys(option).sort()).toEqual(
          option.sku === undefined
            ? [
                "colorName",
                "imageUrls",
                "length",
                "priceAmountMinor",
                "priceFormatted",
                "size",
                "stock",
              ]
            : [
                "colorName",
                "imageUrls",
                "length",
                "priceAmountMinor",
                "priceFormatted",
                "size",
                "sku",
                "stock",
              ],
        );
        expect(option.imageUrls.length).toBeLessThanOrEqual(3);
        expect(["in_stock", "low", "out"]).toContain(option.stock);
      }
    }

    const bob = body.matches.find(
      (match) => match.productSlug === "burgundy-bob-wig",
    );
    expect(bob).toBeDefined();
    expect(bob?.productName).toBe("Burgundy bob wig");
    expect(bob?.categoryName).toBe("Wigs");
    expect(bob?.subcategoryName).toBe("Bob wigs");
    // Markup is stripped: the assistant quotes text, not tags.
    expect(bob?.description).toBe("A short, glossy bob wig.");
    expect(bob?.options[0]).toMatchObject({
      colorName: "Burgundy",
      priceAmountMinor: 45_000,
      priceFormatted: "GH₵450",
      sku: "BOB-14",
      stock: "in_stock",
    });
  });

  it("carries no forbidden field anywhere in the body", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    const body = await ask(t, storeId, "burgundy bob wig lace front");
    const serialized = JSON.stringify(body);

    for (const forbidden of [
      "unitCost",
      "netPrice",
      "netPriceAmountMinor",
      "barcode",
      "barcodeAutoGenerated",
      "inventoryCount",
      "quantityAvailable",
      "reservedQuantity",
      "durableQuantityAvailable",
      "productId",
      "skuId",
      "organizationId",
      "createdByUserId",
      "posVisible",
      "attributes",
    ]) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
    // Not just the key: the values are gone too.
    expect(serialized).not.toContain(REAL_BARCODE);
    expect(serialized).not.toContain("20000");
  });

  it("keeps the internal query's return value inside its declared validator", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    const body = await ask(t, storeId, "burgundy bob wig");

    assertConformsToExportedReturns(search, body);
  });

  it("drops trailing matches until the body fits the budget, and says so", () => {
    const match = {
      categoryName: "Wigs",
      description: "x".repeat(400),
      options: [
        {
          colorName: "Burgundy",
          imageUrls: ["https://images.test/".concat("a".repeat(300))],
          length: 14,
          priceAmountMinor: 45_000,
          priceFormatted: "GH₵450",
          size: "M",
          sku: "BOB-14",
          stock: "in_stock" as const,
        },
      ],
      productName: "Burgundy bob wig",
      productSlug: "burgundy-bob-wig",
      // A full-length page link, so the budget is proven with the field in it.
      productUrl: `${STORE_URL}/shop/product/k17f3m2x9q8w7e6r5t4y3u2i1o0p9a8s`,
      subcategoryName: "Bob wigs",
    };
    const oversized: AssistantCatalogBody = {
      contractVersion: ASSISTANT_CATALOG_CONTRACT_VERSION,
      exhaustive: true,
      fetchedAt: "2026-09-22T10:00:00.000Z",
      hasMore: false,
      matches: Array.from({ length: 60 }, () => match),
      source: { currency: "GHS", name: "Wig Club" },
    };

    const fitted = fitAssistantCatalogBody(oversized);

    expect(fitted.matches.length).toBeLessThan(60);
    expect(fitted.hasMore).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(fitted)).length)
      .toBeLessThanOrEqual(ASSISTANT_CATALOG_BODY_MAX_BYTES);
    // A body that already fits is returned untouched.
    expect(fitAssistantCatalogBody({ ...oversized, matches: [match] })).toEqual(
      { ...oversized, matches: [match] },
    );
  });

  it("states stock with the store's own low threshold, holds included", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    await t.run(async (ctx) => {
      const skus = await ctx.db
        .query("productSku")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .take(20);
      const bobSkus = skus.filter((sku) => sku.sku === "BOB-14");
      await ctx.db.patch("productSku", bobSkus[0]._id, {
        quantityAvailable: 5,
      });
      const lace = skus.filter((sku) => sku.sku === "LACE-20");
      await ctx.db.patch("productSku", lace[0]._id, { quantityAvailable: 0 });
    });

    const body = await ask(t, storeId, "burgundy bob wig blonde lace front");
    const stockBySlug = Object.fromEntries(
      body.matches.map((match) => [
        match.productSlug,
        match.options.map((option) => option.stock),
      ]),
    );

    // Five is the shared low-stock line; the next unit above it is in stock.
    expect(stockBySlug["burgundy-bob-wig"]).toContain("low");
    expect(stockBySlug["burgundy-bob-wig"]).toContain("in_stock");
    expect(stockBySlug["blonde-lace-front"]).toEqual(["out"]);
  });

  it("links each match to the storefront page that resolves it", async () => {
    vi.stubEnv("STORE_URL", STORE_URL);
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const productIdBySlug = await t.run(async (ctx) => {
      const products = await ctx.db
        .query("product")
        .filter((q) => q.eq(q.field("storeId"), storeId))
        .take(20);
      return Object.fromEntries(
        products.map((product) => [product.slug, String(product._id)]),
      );
    });

    const body = await ask(t, storeId, "burgundy bob wig blonde lace front");

    expect(body.matches.length).toBeGreaterThan(1);
    for (const match of body.matches) {
      expect(match.productUrl).toBe(
        `${STORE_URL}/shop/product/${productIdBySlug[match.productSlug!]}`,
      );
    }
    assertConformsToExportedReturns(search, body);
  });

  it("gives every match a null link when the store has no storefront url", async () => {
    vi.stubEnv("STORE_URL", "");
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    const body = await ask(t, storeId, "burgundy bob wig");

    expect(body.matches.length).toBeGreaterThan(0);
    for (const match of body.matches) {
      expect(match).toHaveProperty("productUrl", null);
    }
    assertConformsToExportedReturns(search, body);
  });

  it("builds a product link only from a storefront url and a product", () => {
    expect(assistantProductUrlOf(STORE_URL, "prod123")).toBe(
      `${STORE_URL}/shop/product/prod123`,
    );
    // No query string: the link names the page, not a variant or a campaign.
    expect(assistantProductUrlOf(STORE_URL, "prod123")).not.toContain("?");
    expect(assistantProductUrlOf(`${STORE_URL}/`, "prod123")).toBe(
      `${STORE_URL}/shop/product/prod123`,
    );
    expect(assistantProductUrlOf(`${STORE_URL}//`, "prod123")).toBe(
      `${STORE_URL}/shop/product/prod123`,
    );
    expect(assistantProductUrlOf(STORE_URL, null)).toBeNull();
    expect(assistantProductUrlOf(STORE_URL, "")).toBeNull();
    expect(assistantProductUrlOf(undefined, "prod123")).toBeNull();
    expect(assistantProductUrlOf("", "prod123")).toBeNull();
    expect(assistantProductUrlOf("  /  ", "prod123")).toBeNull();
  });

  it("reduces product copy to bounded plain text", () => {
    expect(toPlainDescription(undefined)).toBeNull();
    expect(toPlainDescription("   ")).toBeNull();
    expect(toPlainDescription("<p>Hello&nbsp;&amp; welcome</p>")).toBe(
      "Hello & welcome",
    );
    expect(toPlainDescription("x".repeat(500))).toHaveLength(400);
  });
});

/* -------------------------------------------------- what cannot be probed */

describe("nothing private can change the answer", () => {
  it("ranks a real barcode exactly as a made-up one", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    const withReal = await ask(t, storeId, `wig ${REAL_BARCODE}`);
    const withFake = await ask(t, storeId, `wig ${FAKE_BARCODE}`);

    expect(withReal.matches).toEqual(withFake.matches);
    expect(withReal.exhaustive).toBe(withFake.exhaustive);
    expect(withReal.hasMore).toBe(withFake.hasMore);
  });

  it("answers a hidden SKU's code exactly as a code that never existed", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    const hidden = await ask(t, storeId, HIDDEN_SKU_CODE);
    const nonexistent = await ask(t, storeId, NONEXISTENT_SKU_CODE);

    expect(
      hidden.matches.map((match) => match.productSlug),
    ).not.toContain("hidden-bob-wig");
    expect(hidden.matches).toEqual(nonexistent.matches);
    expect(hidden.exhaustive).toBe(nonexistent.exhaustive);
    expect(hidden.hasMore).toBe(nonexistent.hasMore);
  });

  it("answers a hidden SKU's code the same way at the match limit", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    // At `limit: 1` the hidden row is the first candidate, so a match slot
    // spent on it — rather than on a product that can be answered — would
    // show up as a shorter answer and a different `hasMore`.
    const hidden = await ask(t, storeId, HIDDEN_SKU_CODE, 1);
    const nonexistent = await ask(t, storeId, NONEXISTENT_SKU_CODE, 1);

    expect(hidden.matches).toHaveLength(1);
    expect(hidden.matches).toEqual(nonexistent.matches);
    expect(hidden.hasMore).toBe(nonexistent.hasMore);
    expect(hidden.exhaustive).toBe(nonexistent.exhaustive);
  });

  it("answers a hidden SKU's code the same way at the option limit", async () => {
    const t = convexTest(schema, modules);
    // Eight visible SKUs beside the hidden one fills the per-product option
    // limit exactly, so an option slot spent on the hidden row would push a
    // visible option out of the answer and set `hasMore`.
    const { storeId } = await seedStore(t, 0, 8);

    const hidden = await ask(t, storeId, HIDDEN_SKU_CODE);
    const nonexistent = await ask(t, storeId, NONEXISTENT_SKU_CODE);

    const crowded = hidden.matches.find(
      (match) => match.productSlug === "hidden-bob-wig",
    );
    expect(crowded?.options).toHaveLength(8);
    expect(hidden.matches).toEqual(nonexistent.matches);
    expect(hidden.hasMore).toBe(nonexistent.hasMore);
    expect(hidden.exhaustive).toBe(nonexistent.exhaustive);
  });

  it("caps a crowded product at eight options and says the answer was cut", async () => {
    const t = convexTest(schema, modules);
    // Nine visible SKUs under one product: one more than a product may show.
    const { storeId } = await seedStore(t, 0, 9);

    const body = await ask(t, storeId, HIDDEN_SKU_CODE);

    const crowded = body.matches.find(
      (match) => match.productSlug === "hidden-bob-wig",
    );
    expect(crowded?.options).toHaveLength(8);
    expect(body.hasMore).toBe(true);
  });

  it("answers a hidden SKU's code the same way when it overflows the option limit", async () => {
    const t = convexTest(schema, modules);
    // Nine hidden SKUs share the one code, so the code alone produces more
    // candidate rows for that product than the option limit allows. None of
    // them can be shown, so none of them may be counted either.
    const { storeId } = await seedStore(t, 0, 0, 9);

    const hidden = await ask(t, storeId, HIDDEN_SKU_CODE);
    const nonexistent = await ask(t, storeId, NONEXISTENT_SKU_CODE);

    expect(
      hidden.matches.map((match) => match.productSlug),
    ).not.toContain("hidden-bob-wig");
    expect(hidden.matches).toEqual(nonexistent.matches);
    expect(hidden.hasMore).toBe(nonexistent.hasMore);
    expect(hidden.exhaustive).toBe(nonexistent.exhaustive);
  });

  it("does not claim more matches for rows the index has not caught up with", async () => {
    const t = convexTest(schema, modules);
    // Nine SKUs hidden after their projection was written: the text index
    // still offers them, hydration drops every one. A product that shows
    // nothing must not report that something was left out.
    const { storeId } = await seedStore(t, 0, 0, 0, 9);

    const body = await ask(t, storeId, "bob", 10);

    expect(
      body.matches.map((match) => match.productSlug),
    ).not.toContain("stale-bob-wig");
    expect(body.hasMore).toBe(false);
  });

  it("omits the code of a SKU whose code is really its barcode", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    const byCode = await ask(t, storeId, IMPORTED_BARCODE);
    expect(byCode.matches).toEqual([]);

    const bob = (await ask(t, storeId, "burgundy bob wig")).matches.find(
      (match) => match.productSlug === "burgundy-bob-wig",
    );
    const imported = bob?.options.find(
      (option) => option.priceAmountMinor === 55_000,
    );
    expect(imported).toBeDefined();
    expect(imported).not.toHaveProperty("sku");
  });

  it("never answers for a draft product, a hidden SKU or an off-storefront category", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    const body = await ask(t, storeId, "bob wig", 10);
    const slugs = body.matches.map((match) => match.productSlug);

    expect(slugs).toContain("burgundy-bob-wig");
    expect(slugs).not.toContain("draft-bob-wig");
    expect(slugs).not.toContain("hidden-bob-wig");
    expect(slugs).not.toContain("imported-bob-wig");
  });

  it("answers another store's catalogue with nothing", async () => {
    const t = convexTest(schema, modules);
    const { otherStoreId } = await seedStore(t);

    const body = await ask(t, otherStoreId, "burgundy bob wig");

    expect(body.matches).toEqual([]);
    expect(body.source.name).toBe("Other shop");
  });
});

/* ------------------------------------------------------ what was searched */

describe("exhaustive and hasMore", () => {
  it("does not call a question of stop words a search", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    for (const q of [
      "",
      "do you have any of the",
      "is it in?",
      "Which ones do you have in stock?",
    ]) {
      const body = await ask(t, storeId, q);
      expect([q, body.matches, body.exhaustive, body.hasMore]).toEqual([
        q,
        [],
        false,
        false,
      ]);
    }
  });

  it("finds a length asked for as a bare number", async () => {
    const t = convexTest(schema, modules);
    const { otherStoreId: storeId } = await seedStore(t);
    await t.run(async (ctx) => {
      const store = await ctx.db.get("store", storeId);
      const categoryId = await ctx.db.insert("category", {
        name: "Wigs",
        slug: "wigs",
        showOnStorefront: true,
        storeId,
      } as never);
      const subcategoryId = await ctx.db.insert("subcategory", {
        categoryId,
        name: "Bob wigs",
        slug: "bob-wigs",
        storeId,
      } as never);
      for (const [length, name] of [
        [8, "Short bob wig"],
        [10, "Classic bob wig"],
        [14, "Long bob wig"],
      ] as const) {
        const productId = await ctx.db.insert("product", {
          availability: "live",
          categoryId,
          subcategoryId,
          currency: "GHS",
          description: "A short bob wig.",
          inventoryCount: 10,
          isVisible: true,
          name,
          organizationId: store!.organizationId,
          quantityAvailable: 10,
          slug: `bob-wig-${length}`,
          storeId,
          createdByUserId: store!.createdByUserId,
        } as never);
        const productSkuId = await ctx.db.insert("productSku", {
          images: [],
          inventoryCount: 10,
          isVisible: true,
          length,
          netPrice: 40_000,
          price: 45_000,
          productId,
          productName: name,
          quantityAvailable: 10,
          storeId,
          unitCost: 20_000,
        } as never);
        await upsertProductSkuSearchProjection(ctx, productSkuId, {
          advanceRevision: false,
        });
      }
    });

    // The number alone reaches the index and matches only the 14-inch wig.
    const byLength = await ask(t, storeId, "14 inch", 10);
    expect(byLength.matches.map((match) => match.productSlug)).toEqual([
      "bob-wig-14",
    ]);

    // Beside product words it adds a matching term without narrowing the OR.
    // convex-test does not rank text matches, so relevance order is not
    // asserted here; only that the 14-inch wig is among the answers.
    const asked = await ask(t, storeId, "bob wig 14 inch", 10);
    expect(asked.matches.map((match) => match.productSlug)).toEqual(
      expect.arrayContaining(["bob-wig-8", "bob-wig-10", "bob-wig-14"]),
    );
  });

  it("reports an exhaustive search over the visible catalogue", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    const body = await ask(t, storeId, "what burgundy wigs do you have");

    expect(body.exhaustive).toBe(true);
    expect(body.hasMore).toBe(false);
  });

  it("says there is more when matches were dropped for the limit", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    const body = await ask(t, storeId, "burgundy bob wig lace front", 1);

    expect(body.matches).toHaveLength(1);
    expect(body.hasMore).toBe(true);
    expect(body.exhaustive).toBe(true);
  });

  it("stops claiming coverage once the text index fills its read window", async () => {
    const t = convexTest(schema, modules);
    // 61 is the candidate read window; the seed's own bob rows push the
    // question past it, so the search cannot have seen the whole shop.
    const { storeId } = await seedStore(t, 61);

    const body = await ask(t, storeId, "bob");

    expect(body.exhaustive).toBe(false);
    expect(body.matches.length).toBeGreaterThan(0);
  });
});
