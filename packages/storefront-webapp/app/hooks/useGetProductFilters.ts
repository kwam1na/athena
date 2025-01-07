import { useGetShopSearchParams } from "@/components/navigation/hooks";

export const useGetProductFilters = () => {
  const searchParams = useGetShopSearchParams();

  const getSelectedFiltersCount = () => {
    return (
      (searchParams?.color?.split(",")?.length || 0) +
      (searchParams?.length?.split(",")?.length || 0)
    );
  };

  return {
    filtersCount: getSelectedFiltersCount(),
  };
};
