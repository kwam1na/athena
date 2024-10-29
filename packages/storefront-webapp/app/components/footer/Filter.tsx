import { useNavigate, useSearch } from "@tanstack/react-router";
import { Checkbox } from "../ui/checkbox";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllProducts } from "@/api/product";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { capitalizeFirstLetter, capitalizeWords } from "@/lib/utils";

type FilterItem = {
  label: string;
  value: string;
};

function FilterComponent({
  filters,
  type,
}: {
  filters: FilterItem[];
  type: "color" | "length";
}) {
  const searchParams = useSearch({ from: "/" });
  const [query, setQuery] = useState<string | undefined>(searchParams[type]);

  const navigate = useNavigate();

  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["products", "filter"],
    queryFn: () =>
      getAllProducts({
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
        filters: { [type]: query },
      }),
  });

  useEffect(() => {
    refetch();
  }, [query]);

  const handleCheckboxChange = (value: string) => {
    const currentFilters = searchParams[type]?.split(",") || [];
    const isAlreadySelected = currentFilters.includes(value);

    // Update search params
    const updatedFilters = isAlreadySelected
      ? currentFilters.filter((item: string) => item !== value) // Remove if already selected
      : [...currentFilters, value]; // Add if not selected

    const queryValue =
      updatedFilters.length > 0 ? updatedFilters.join(",") : undefined; // Join with comma or remove if empty

    // queryClient.invalidateQueries({ queryKey: ["products"] });

    // console.log("setting ->", queryValue);

    setQuery(queryValue);

    navigate({
      to: "/",
      search: (prev) => ({
        ...prev,
        [type]: queryValue,
      }),
    });

    // queryClient.refetchQueries({ queryKey: ["products", "filter"] });
  };

  return (
    filters.length > 0 && (
      <div className="space-y-2">
        <p className="text-lg">{capitalizeFirstLetter(type)}</p>
        {filters.map((item, index) => {
          return (
            <div className="flex items-center space-x-2" key={index}>
              <Checkbox
                id={item.value}
                checked={(searchParams[type]?.split(",") || []).includes(
                  item.value
                )}
                onCheckedChange={() => handleCheckboxChange(item.value)}
              />
              <label
                htmlFor={item.value}
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {capitalizeWords(item.label)}
              </label>
            </div>
          );
        })}
      </div>
    )
  );
}

export default FilterComponent;
