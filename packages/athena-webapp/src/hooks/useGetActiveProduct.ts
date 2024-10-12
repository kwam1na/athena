import { useParams } from "@tanstack/react-router";
import useGetActiveStore from "./useGetActiveStore";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

export default function useGetActiveProduct() {
  const { productSlug } = useParams({ strict: false });

  const { activeStore } = useGetActiveStore();

  const product = useQuery(
    api.inventory.products.getBySlug,
    activeStore?._id && productSlug
      ? { storeId: activeStore._id, slug: productSlug }
      : "skip"
  );

  return {
    activeProduct: product,
    isLoadingStores: false,
  };
}