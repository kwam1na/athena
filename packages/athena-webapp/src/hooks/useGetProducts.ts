import { useQuery } from "convex/react";
import useGetActiveStore from "./useGetActiveStore";
import { api } from "~/convex/_generated/api";

type ProductAvailability = "archived" | "draft" | "live";

export const useGetProducts = ({
  subcategorySlug,
  categorySlug,
  availability,
}: {
  subcategorySlug?: string;
  categorySlug?: string;
  availability?: ProductAvailability;
} = {}) => {
  const { activeStore } = useGetActiveStore();

  const products = useQuery(
    api.inventory.products.getAll,
    activeStore?._id
      ? {
          storeId: activeStore._id,
          subcategory: subcategorySlug ? [subcategorySlug] : undefined,
          category: categorySlug ? [categorySlug] : undefined,
          availability,
          filters: {
            isPriceZero: true,
          },
        }
      : "skip"
  );

  return products?.sort((a: any, b: any) => a.name.localeCompare(b.name));
};

export const useGetArchivedProducts = () => {
  return useGetProducts({ availability: "archived" });
};

export const useGetUnresolvedProducts = () => {
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
