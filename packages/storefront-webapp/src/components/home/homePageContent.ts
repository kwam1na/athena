import { Product, ProductSku } from "@athena/webapp";

type FeaturedItem = {
  _id?: string;
  rank?: number;
  type?: string;
  product?: Product;
  category?: { name: string; products: Product[]; slug: string };
  subcategory?: { name: string; products: Product[]; slug: string };
  productId?: string;
};

export function resolveHomepageContent({
  bestSellers,
  featured,
}: {
  bestSellers?: Array<{ rank?: number; productSku: ProductSku }>;
  featured?: FeaturedItem[];
}) {
  const bestSellersSorted = [...(bestSellers ?? [])].sort(
    (a, b) => (a.rank ?? 0) - (b.rank ?? 0),
  );

  const bestSellersProducts = bestSellersSorted.map(
    (bestSeller) => bestSeller.productSku,
  );

  const featuredSorted = [...(featured ?? [])].sort(
    (a, b) => (a.rank ?? 0) - (b.rank ?? 0),
  );

  const featuredSectionSorted = featuredSorted.filter(
    (item) => item.type === "regular",
  );

  const shopLookProduct = featuredSorted.find((item) => item.type === "shop_look");

  return {
    bestSellersProducts,
    featuredSectionSorted,
    shopLookProduct,
    hasHomepageData:
      bestSellersProducts.length > 0 || featuredSectionSorted.length > 0,
  };
}

