import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import useGetActiveStore from "./useGetActiveStore";

export function useGetComplimentaryProducts() {
  const { activeStore } = useGetActiveStore();
  return useQuery(
    api.inventory.complimentaryProduct.getAllComplimentaryProducts,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );
}
