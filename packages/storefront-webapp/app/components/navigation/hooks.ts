import {
  getAllCategories,
  getAllCategoriesWithSubcategories,
} from "@/api/category";
import { getAllSubcategories } from "@/api/subcategory";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";

// value=id and label=name
export function useGetStoreSubcategories() {
  const { data } = useQuery({
    queryKey: ["subcategories"],
    queryFn: () =>
      getAllSubcategories({
        organizationId: OG_ORGANIZTION_ID,
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
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
      }),
  });

  const categories: Array<{ value: string; label: string }> | undefined = data
    ?.map((category) => ({ value: category.slug, label: category.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const categoryToSubcategoriesMap: Record<
    string,
    Array<{ value: string; label: string }>
  > = data?.reduce(
    (map, category) => {
      if (!map[category.slug]) {
        map[category.slug] = [];
      }

      const transformedSubcategories = category?.subcategories
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
