import { useQuery } from "convex/react";
import useGetActiveStore from "./useGetActiveStore";
import { api } from "~/convex/_generated/api";

export const useGetProducts = ({
  subcategorySlug,
  categorySlug,
}: {
  subcategorySlug?: string;
  categorySlug?: string;
} = {}) => {
  const { activeStore } = useGetActiveStore();

  const products = useQuery(
    api.inventory.products.getAll,
    activeStore?._id
      ? {
          storeId: activeStore._id,
          subcategory: subcategorySlug ? [subcategorySlug] : undefined,
          category: categorySlug ? [categorySlug] : undefined,
          filters: {
            isPriceZero: true,
          },
        }
      : "skip"
  );

  return products?.sort((a: any, b: any) => a.name.localeCompare(b.name));
};

export const useGetProductsWithNoImages = () => {
  const { activeStore } = useGetActiveStore();

  const products = useQuery(
    api.inventory.products.getAll,
    activeStore?._id
      ? {
          storeId: activeStore._id,
          filters: {
            isMissingImages: true,
            isMissingPrice: true,
          },
        }
      : "skip"
  );

  return products?.sort((a: any, b: any) => a.name.localeCompare(b.name));
};
