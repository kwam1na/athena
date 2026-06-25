import type { Id } from "../../../convex/_generated/dataModel";

export type ProductSkuSearchMatchKind = "productSkuId" | "sku" | "barcode" | "text";

export type ProductSkuSearchResultLike = {
  barcode: string | null;
  categoryName: string | null;
  categoryId?: Id<"category"> | null;
  categorySlug?: string | null;
  colorName: string | null;
  images: string[];
  inventoryCount: number;
  isVisible: boolean | null;
  length: number | null;
  match: {
    kind: ProductSkuSearchMatchKind;
    matchedValue: string | null;
    rank: number;
  };
  price: number;
  productAvailability: "archived" | "draft" | "live";
  productId: Id<"product">;
  productIsVisible: boolean | null;
  productName: string;
  productSkuId: Id<"productSku">;
  productSlug: string | null;
  quantityAvailable: number;
  size: string | null;
  sku: string | null;
  skuIsVisible: boolean | null;
  storeId: Id<"store">;
  subcategoryName: string | null;
  subcategoryId?: Id<"subcategory"> | null;
  subcategorySlug?: string | null;
};

export type AdminSkuSearchOption = {
  barcode: string | null;
  categoryName: string | null;
  colorName: string | null;
  disabled: boolean;
  imageUrl: string | null;
  label: string;
  matchKind: ProductSkuSearchMatchKind;
  matchRank: number;
  metadata: string;
  productId: Id<"product">;
  productName: string;
  productSkuId: Id<"productSku">;
  quantityAvailable: number;
  searchResult: ProductSkuSearchResultLike;
  sizeLabel: string | null;
  sku: string | null;
  subtitle: string;
};

export type ProductGroupedSkuSearchResult = {
  bestMatchRank: number;
  productId: Id<"product">;
  productName: string;
  productSlug: string | null;
  skus: AdminSkuSearchOption[];
};

function compactJoin(parts: Array<string | null | undefined>, separator = " · ") {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(separator);
}

export function buildAdminSkuSearchOption(
  result: ProductSkuSearchResultLike,
): AdminSkuSearchOption {
  const skuLabel = result.sku?.trim() || String(result.productSkuId);
  const variantLabel = compactJoin([
    result.size,
    result.length === null ? null : `${result.length}"`,
    result.colorName,
  ]);
  const metadata = compactJoin([
    result.categoryName,
    result.subcategoryName,
    result.barcode ? `Barcode ${result.barcode}` : null,
  ]);
  const visibility =
    result.productAvailability === "live" && result.productIsVisible !== false
      ? result.skuIsVisible === false
        ? "Hidden SKU"
        : "Visible"
      : result.productAvailability === "archived"
        ? "Archived"
        : "Draft";

  return {
    barcode: result.barcode,
    categoryName: result.categoryName,
    colorName: result.colorName,
    disabled: false,
    imageUrl: result.images[0] ?? null,
    label: compactJoin([result.productName, skuLabel], " / "),
    matchKind: result.match.kind,
    matchRank: result.match.rank,
    metadata,
    productId: result.productId,
    productName: result.productName,
    productSkuId: result.productSkuId,
    quantityAvailable: result.quantityAvailable,
    searchResult: result,
    sizeLabel: variantLabel || null,
    sku: result.sku,
    subtitle: compactJoin([variantLabel, visibility, metadata]),
  };
}

export function buildAdminSkuSearchOptions(
  results: readonly ProductSkuSearchResultLike[],
) {
  return results.map(buildAdminSkuSearchOption);
}

export function groupAdminSkuSearchOptionsByProduct(
  options: readonly AdminSkuSearchOption[],
): ProductGroupedSkuSearchResult[] {
  const groups = new Map<string, ProductGroupedSkuSearchResult>();

  for (const option of options) {
    const key = String(option.productId);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        bestMatchRank: option.matchRank,
        productId: option.productId,
        productName: option.productName,
        productSlug: option.searchResult.productSlug,
        skus: [option],
      });
      continue;
    }

    existing.bestMatchRank = Math.min(existing.bestMatchRank, option.matchRank);
    existing.skus.push(option);
    existing.skus.sort((left, right) => left.matchRank - right.matchRank);
  }

  return Array.from(groups.values()).sort(
    (left, right) =>
      left.bestMatchRank - right.bestMatchRank ||
      left.productName.localeCompare(right.productName),
  );
}
