import {
  getAllCategories,
  getAllCategoriesWithSubcategories,
} from "@/api/category";
import { getAllSubcategories } from "@/api/subcategory";
import { OG_ORGANIZATION_ID, OG_STORE_ID } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

// value=id and label=name
export function useGetStoreSubcategories() {
  const { data } = useQuery({
    queryKey: ["subcategories"],
    queryFn: () =>
      getAllSubcategories({
        organizationId: OG_ORGANIZATION_ID,
        storeId: OG_STORE_ID,
      }),
  });

  const subcategories: Array<{ value: string; label: string }> | undefined =
    data
      ?.map((s) => ({ value: s.slug, label: s.name }))
      .sort((a, b) => a.label.localeCompare(b.label));

  return subcategories;
}

export function useGetStoreCategories() {
  const { data } = useQuery({
    queryKey: ["categories"],
    queryFn: () =>
      getAllCategoriesWithSubcategories({
        organizationId: OG_ORGANIZATION_ID,
        storeId: OG_STORE_ID,
      }),
  });

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
