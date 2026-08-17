import config from "@/config";

export type HomepageSnapshotSkuV1 = {
  productId: string;
  productSlug: string;
  productName: string;
  skuId: string;
  sku: string | null;
  imageUrls: string[];
  currency: string;
  priceAmountMinor: number;
  netPriceAmountMinor: number | null;
  quantityAvailable: number;
  colorName?: string | null;
  size?: string | null;
  length?: number | null;
};

export type HomepageSnapshotCollectionV1 = {
  categoryId?: string;
  categorySlug?: string;
  subcategoryId?: string;
  name: string;
  slug: string;
  products: HomepageSnapshotSkuV1[];
};

export type HomepageSnapshotBestSellerV1 = {
  id: string;
  rank: number;
  productSku: HomepageSnapshotSkuV1;
};

export type HomepageSnapshotHighlightedItemV1 = {
  id: string;
  rank: number;
  type: "regular" | "shop_look";
  targetKind: "product" | "category" | "subcategory";
  product: HomepageSnapshotSkuV1 | null;
  category: HomepageSnapshotCollectionV1 | null;
  subcategory: HomepageSnapshotCollectionV1 | null;
};

export type HomepageSnapshotStoreV1 = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  currency: string;
};

export type HomepageSnapshotHeroV1 = {
  displayType: "reel" | "image";
  headerImageUrl: string | null;
  showOverlay: boolean;
  showText: boolean;
  activeReelVersion: number | null;
  activeReelHlsUrl: string | null;
  fallbackImageUrl: string | null;
  shopTheLookImageUrl: string | null;
};

export type HomepageSnapshotBannerV1 = {
  heading?: string;
  message?: string;
  countdownEndsAt?: number;
} | null;

export type HomepageSnapshotV1 = {
  contractVersion: "homepage_snapshot.v1";
  generatedAtMs: number;
  store: HomepageSnapshotStoreV1;
  hero: HomepageSnapshotHeroV1;
  bannerMessage: HomepageSnapshotBannerV1;
  bestSellers: HomepageSnapshotBestSellerV1[];
  featuredItems: HomepageSnapshotHighlightedItemV1[];
  shopLook: HomepageSnapshotHighlightedItemV1 | null;
};

type HomepageSnapshotResponse =
  | HomepageSnapshotV1
  | { snapshot: HomepageSnapshotV1 };

/**
 * Public homepage read. It carries no shopper identity: guest sessions are
 * bootstrapped by `getStore` / `getGuest` (the two signed mint points), and
 * this route neither looks a guest up nor mints one, so no marker travels.
 */
export async function getHomepageSnapshot(): Promise<HomepageSnapshotV1> {
  const search = new URLSearchParams({
    storeName: config.storefront.storeName,
  });

  const response = await fetch(
    `${config.apiGateway.URL}/homepage-snapshot?${search.toString()}`,
    {
      credentials: "include",
    },
  );

  const body = (await response.json()) as HomepageSnapshotResponse & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(body.error || "Error loading homepage snapshot.");
  }

  return "snapshot" in body ? body.snapshot : body;
}
