import { useQuery } from "convex/react";
import useGetActiveStore from "./useGetActiveStore";
import { api } from "~/convex/_generated/api";

export const useGetCategories = () => {
  const { activeStore } = useGetActiveStore();

  const categories = useQuery(
    api.inventory.categories.getAll,
    activeStore?._id
      ? {
          storeId: activeStore._id,
        }
      : "skip"
  );

  return categories?.sort((a, b) => a.name.localeCompare(b.name));
};
