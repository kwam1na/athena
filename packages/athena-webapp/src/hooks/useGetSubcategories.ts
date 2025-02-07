import { useQuery } from "convex/react";
import useGetActiveStore from "./useGetActiveStore";
import { api } from "~/convex/_generated/api";

export const useGetSubcategories = () => {
  const { activeStore } = useGetActiveStore();

  const subcategories = useQuery(
    api.inventory.subcategories.getAll,
    activeStore?._id
      ? {
          storeId: activeStore._id,
        }
      : "skip"
  );

  return subcategories;
};
