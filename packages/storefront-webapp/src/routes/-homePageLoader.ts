import { getBestSellers, getFeatured } from "@/api/product";
import { getStore } from "@/api/storefront";

type LoaderData<T> = {
  data?: T;
  updatedAt?: number;
};

export type HomePageLoaderData = {
  bestSellers?: LoaderData<any[]>;
  featured?: LoaderData<any[]>;
};

export async function loadHomePageData({
  bestSellersRequest = getBestSellers,
  featuredRequest = getFeatured,
  storeRequest = getStore,
}: {
  bestSellersRequest?: typeof getBestSellers;
  featuredRequest?: typeof getFeatured;
  storeRequest?: typeof getStore;
} = {}): Promise<HomePageLoaderData> {
  const updatedAt = Date.now();

  await storeRequest(false);

  const [bestSellersResult, featuredResult] = await Promise.allSettled([
    bestSellersRequest(),
    featuredRequest(),
  ]);

  return {
    bestSellers:
      bestSellersResult.status === "fulfilled"
        ? {
            data: bestSellersResult.value,
            updatedAt,
          }
        : undefined,
    featured:
      featuredResult.status === "fulfilled"
        ? {
            data: featuredResult.value,
            updatedAt,
          }
        : undefined,
  };
}
