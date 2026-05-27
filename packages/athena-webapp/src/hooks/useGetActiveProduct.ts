import { useParams } from "@tanstack/react-router";
import useGetActiveStore from "./useGetActiveStore";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

type UseGetActiveProductOptions = {
  includeArchived?: boolean;
};

export default function useGetActiveProduct(
  options: UseGetActiveProductOptions = {},
) {
  const { productSlug } = useParams({ strict: false });

  const { activeStore } = useGetActiveStore();

  const product = useQuery(
    api.inventory.products.getByIdOrSlug,
    activeStore?._id && productSlug
      ? {
          storeId: activeStore._id,
          identifier: productSlug,
          filters: options.includeArchived
            ? { includeArchived: true, isVisible: false }
            : undefined,
        }
      : "skip",
  );

  return {
    activeProduct: product,
    isLoadingStores: false,
  };
}
