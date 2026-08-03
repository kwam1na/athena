// Client-side stand-in for `api.inventory.skuSearch.searchProductSkus` while a
// visitor is inside the shared demo. The demo catalog is the eight fixed
// products in `shared/sharedDemoStory`, so every keystroke that would otherwise
// open a live Convex subscription can be answered locally.

import {
  SHARED_DEMO_CATEGORY,
  SHARED_DEMO_PRODUCTS,
  SHARED_DEMO_SUBCATEGORIES,
  type SharedDemoProductStory,
} from "~/shared/sharedDemoStory";
import type { Id } from "~/convex/_generated/dataModel";
import type { ProductSkuSearchResultLike } from "@/lib/skuSearch/productSkuSearchAdapters";

/**
 * Must stay in sync with `SHARED_DEMO_REPORTS_SKU_ID_PREFIX` in
 * `sharedDemoReportsFixture.ts`: a search hit navigates to the reports SKU
 * detail route, which resolves its fixture row by this id.
 */
const SHARED_DEMO_SKU_ID_PREFIX = "shared-demo-sku-";
const SHARED_DEMO_PRODUCT_ID_PREFIX = "shared-demo-product-";

/** Mirrors `DEFAULT_LIMIT` / `MAX_LIMIT` in `convex/inventory/skuSearch.ts`. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

/** Mirrors the server's exact-SKU and free-text rank bands. */
const EXACT_SKU_RANK = 1;
const TEXT_RANK_BASE = 3;

export type SharedDemoCatalogSearchResponse = {
  candidateOverflow: boolean;
  limit: number;
  results: ProductSkuSearchResultLike[];
  truncated: boolean;
};

export function sharedDemoCatalogSearchSkuId(slug: string) {
  return `${SHARED_DEMO_SKU_ID_PREFIX}${slug}` as Id<"productSku">;
}

export function sharedDemoCatalogSearchProductId(slug: string) {
  return `${SHARED_DEMO_PRODUCT_ID_PREFIX}${slug}` as Id<"product">;
}

function subcategoryFor(product: SharedDemoProductStory) {
  return SHARED_DEMO_SUBCATEGORIES.find(
    (entry) => entry.key === product.subcategoryKey,
  );
}

/**
 * Every haystack a query is matched against. The server indexes product name,
 * sku, barcode, slug, category and subcategory into one `searchText` blob, so
 * the demo matches the same fields it can supply. Demo SKUs carry no barcode,
 * colour, size or length, so those stay null.
 */
function searchableValues(product: SharedDemoProductStory) {
  const subcategory = subcategoryFor(product);

  return [
    product.name,
    product.sku,
    product.slug,
    SHARED_DEMO_CATEGORY.name,
    SHARED_DEMO_CATEGORY.slug,
    subcategory?.name,
    subcategory?.slug,
  ].filter((value): value is string => Boolean(value));
}

function toResult({
  product,
  match,
  storeId,
}: {
  match: ProductSkuSearchResultLike["match"];
  product: SharedDemoProductStory;
  storeId: Id<"store">;
}): ProductSkuSearchResultLike {
  const subcategory = subcategoryFor(product);

  return {
    barcode: null,
    categoryName: SHARED_DEMO_CATEGORY.name,
    categorySlug: SHARED_DEMO_CATEGORY.slug,
    colorName: null,
    // The lookup surface renders no imagery, so the demo does not ship image
    // bytes it would immediately discard.
    images: [],
    inventoryCount: product.inventoryCount,
    isVisible: true,
    length: null,
    match,
    // Story prices are minor units, matching the live projection.
    netPrice: product.price,
    price: product.price,
    productAvailability: "live",
    productId: sharedDemoCatalogSearchProductId(product.slug),
    productIsVisible: true,
    productName: product.name,
    productSkuId: sharedDemoCatalogSearchSkuId(product.slug),
    productSlug: product.slug,
    quantityAvailable: product.inventoryCount,
    size: null,
    sku: product.sku,
    skuIsVisible: true,
    storeId,
    subcategoryName: subcategory?.name ?? null,
    subcategorySlug: subcategory?.slug ?? null,
  };
}

/**
 * Case-insensitive substring search over the demo catalog.
 *
 * Ranking mirrors `searchProductSkus`: an exact SKU match sorts ahead of free
 * text, and free-text hits keep catalog order. `truncated` reports that more
 * products matched than `limit` returned. `candidateOverflow` is always false
 * because the demo catalog is enumerated in full — there is never an unread
 * candidate page the way there is behind the server's search index.
 */
export function createSharedDemoCatalogSearchResults({
  limit,
  query,
  storeId,
}: {
  limit?: number;
  query: string;
  storeId: Id<"store">;
}): SharedDemoCatalogSearchResponse {
  const normalizedLimit = Math.min(
    Math.max(1, limit ?? DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return {
      candidateOverflow: false,
      limit: normalizedLimit,
      results: [],
      truncated: false,
    };
  }

  const exactSkuMatches: ProductSkuSearchResultLike[] = [];
  const textMatches: ProductSkuSearchResultLike[] = [];

  for (const product of SHARED_DEMO_PRODUCTS) {
    if (product.sku.toLowerCase() === normalizedQuery) {
      exactSkuMatches.push(
        toResult({
          match: {
            kind: "sku",
            matchedValue: product.sku,
            rank: EXACT_SKU_RANK,
          },
          product,
          storeId,
        }),
      );
      continue;
    }

    const matches = searchableValues(product).some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    );
    if (!matches) continue;

    textMatches.push(
      toResult({
        match: {
          kind: "text",
          matchedValue: query.trim(),
          rank: TEXT_RANK_BASE + textMatches.length,
        },
        product,
        storeId,
      }),
    );
  }

  const results = [...exactSkuMatches, ...textMatches];

  return {
    candidateOverflow: false,
    limit: normalizedLimit,
    results: results.slice(0, normalizedLimit),
    truncated: results.length > normalizedLimit,
  };
}
