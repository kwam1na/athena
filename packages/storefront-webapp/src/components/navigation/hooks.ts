import { getAllCategoriesWithSubcategories } from "@/api/category";
import { getAllSubcategories } from "@/api/subcategory";
import { useStoreContext } from "@/contexts/StoreContext";
import { useInventoryQueries } from "@/lib/queries/inventory";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

// value=id and label=name
export function useGetStoreSubcategories() {
  const { data } = useQuery(useInventoryQueries().subcategories());

  const subcategories: Array<{ value: string; label: string }> | undefined =
    data
      ?.map((s) => ({ value: s.slug, label: s.name }))
      .sort((a, b) => a.label.localeCompare(b.label));

  return subcategories;
}

export function useGetStoreCategories() {
  const { data } = useQuery(useInventoryQueries().categories());

  const categories: Array<{ value: string; label: string }> | undefined = data
    ?.map((category) => ({ value: category.slug, label: category.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const categoryToSubcategoriesMap:
    | Record<string, Array<{ value: string; label: string }>>
    | undefined = data?.reduce(
    (map, category) => {
      if (!map[category.slug]) {
        map[category.slug] = [];
      }

      const transformedSubcategories = (category as any)?.subcategories
        .map((subcategory: any) => ({
          value: subcategory.slug,
          label: subcategory.name,
        }))
        .sort((a: any, b: any) => a.label.localeCompare(b.label));

      map[category.slug].push(...transformedSubcategories);

      return map;
    },
    {} as Record<string, Array<{ value: string; label: string }>>
  );

  return { categories, categoryToSubcategoriesMap };
}

const routeApi = getRouteApi("/_layout/_shopLayout");

export const useGetShopSearchParams = () => {
  return routeApi.useSearch();
};
