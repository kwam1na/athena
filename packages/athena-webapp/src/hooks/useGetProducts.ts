import { useQuery } from "convex/react";
import useGetActiveStore from "./useGetActiveStore";
import { api } from "~/convex/_generated/api";

export const useGetProducts = () => {
  const { activeStore } = useGetActiveStore();

  const products = useQuery(
    api.inventory.products.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  return products;
};
