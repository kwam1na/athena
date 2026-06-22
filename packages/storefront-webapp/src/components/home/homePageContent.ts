import { Product, ProductSku } from "@athena/webapp";
import { sortHomepageRankedItems } from "@athena/webapp/shared/homepageRanking";
import type {
  HomepageSnapshotHighlightedItemV1,
  HomepageSnapshotSkuV1,
  HomepageSnapshotV1,
} from "@/api/homepageSnapshot";

export type HomepageDisplaySku = {
  _id: string;
  productId: string;
  sku?: string;
  productName: string;
  images: string[];
  price: number;
  netPrice?: number;
  quantityAvailable: number;
  colorName?: string | null;
  size?: string;
  length?: number;
};

export type HomepageDisplayProduct = {
  _id: string;
  name: string;
  skus: HomepageDisplaySku[];
};

type FeaturedItem = {
  _id?: string;
  rank?: number;
  type?: string;
  product?: Product | HomepageDisplayProduct;
  category?: {
    name: string;
    products: Array<Product | HomepageDisplayProduct>;
    slug: string;
  };
  subcategory?: {
    categorySlug?: string;
    name: string;
    products: Array<Product | HomepageDisplayProduct>;
    slug: string;
  };
  productId?: string;
};

type BestSellerItem = {
  _id?: string;
  rank?: number;
  productSku: ProductSku | HomepageDisplaySku;
};

function toDisplaySku(sku: HomepageSnapshotSkuV1): HomepageDisplaySku {
  return {
    _id: sku.skuId,
    productId: sku.productSlug,
    sku: sku.sku ?? undefined,
    productName: sku.productName,
    images: sku.imageUrls,
    price: sku.priceAmountMinor,
    netPrice: sku.netPriceAmountMinor ?? undefined,
    quantityAvailable: 0,
    colorName: sku.colorName,
    size: sku.size ?? undefined,
    length: sku.length ?? undefined,
  };
}

function toDisplayProduct(productSku: HomepageSnapshotSkuV1): HomepageDisplayProduct {
  return {
    _id: productSku.productSlug,
    name: productSku.productName,
    skus: [toDisplaySku(productSku)],
  };
}

function toFeaturedItem(item: HomepageSnapshotHighlightedItemV1): FeaturedItem {
  return {
    _id: item.id,
    rank: item.rank,
    type: item.type,
    product: item.product ? toDisplayProduct(item.product) : undefined,
    category: item.category
      ? {
          name: item.category.name,
          slug: item.category.slug,
          products: item.category.products.map(toDisplayProduct),
        }
      : undefined,
    subcategory: item.subcategory
      ? {
          categorySlug: item.subcategory.categorySlug,
          name: item.subcategory.name,
          slug: item.subcategory.slug,
          products: item.subcategory.products.map(toDisplayProduct),
        }
      : undefined,
  };
}

export function resolveHomepageContent({
  snapshot,
  bestSellers,
  featured,
}: {
  snapshot?: HomepageSnapshotV1;
  bestSellers?: Array<{ rank?: number; productSku: ProductSku }>;
  featured?: FeaturedItem[];
}) {
  const snapshotBestSellers: BestSellerItem[] | undefined =
    snapshot?.bestSellers?.map((item) => ({
      _id: item.id,
      rank: item.rank,
      productSku: toDisplaySku(item.productSku),
    }));
  const legacyBestSellers: BestSellerItem[] | undefined = bestSellers;

  const snapshotFeatured = snapshot
    ? [
        ...(snapshot.featuredItems ?? []),
        ...(snapshot.shopLook ? [snapshot.shopLook] : []),
      ].map(toFeaturedItem)
    : undefined;

  const bestSellersSorted = sortHomepageRankedItems(
    snapshotBestSellers ?? legacyBestSellers ?? [],
  );

  const bestSellersProducts = bestSellersSorted.map(
    (bestSeller) => bestSeller.productSku,
  );

  const featuredSorted = sortHomepageRankedItems(
    snapshotFeatured ?? featured ?? [],
  );

  const featuredSectionSorted = featuredSorted.filter(
    (item) => item.type === "regular",
  );

  const shopLookProduct =
    snapshot
      ? snapshot.shopLook?.product
        ? {
            _id: snapshot.shopLook.id,
            productId:
              snapshot.shopLook.product.productSlug ??
              snapshot.shopLook.product.productId,
          }
        : undefined
      : featuredSorted.find((item) => item.type === "shop_look");

  return {
    bestSellersProducts,
    featuredSectionSorted,
    shopLookProduct,
    hasHomepageData:
      bestSellersProducts.length > 0 || featuredSectionSorted.length > 0,
  };
}
