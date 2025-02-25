import { getAllCategoriesWithSubcategories } from "@/api/category";
import { getAllSubcategories } from "@/api/subcategory";
import { queryOptions } from "@tanstack/react-query";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";

export const useInventoryQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    categories: () =>
      queryOptions({
        queryKey: ["categories"],
        queryFn: () => getAllCategoriesWithSubcategories(),
        enabled: queryEnabled,
      }),
    subcategories: () =>
      queryOptions({
        queryKey: ["subcategories"],
        queryFn: () => getAllSubcategories(),
        enabled: queryEnabled,
      }),
  };
};
