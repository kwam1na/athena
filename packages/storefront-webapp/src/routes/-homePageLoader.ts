import { getBestSellers, getFeatured } from "@/api/product";

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
}: {
  bestSellersRequest?: typeof getBestSellers;
  featuredRequest?: typeof getFeatured;
} = {}): Promise<HomePageLoaderData> {
  const updatedAt = Date.now();
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
