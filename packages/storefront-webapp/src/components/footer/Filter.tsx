import { getRouteApi, useNavigate, useParams } from "@tanstack/react-router";
import { Checkbox } from "../ui/checkbox";
import { capitalizeWords } from "@/lib/utils";

type FilterItem = {
  label: string;
  value: string;
};

const routeApi = getRouteApi("/_layout/_shopLayout");

function FilterComponent({
  filters,
  type,
  setSelectedCount,
}: {
  filters: FilterItem[];
  type: "color" | "length";
  setSelectedCount: (selected: number) => void;
}) {
  const searchParams = routeApi.useSearch();

  const { subcategorySlug } = useParams({ strict: false });

  const navigate = useNavigate();

  const handleCheckboxChange = (value: string) => {
    const currentFilters = searchParams[type]?.split(",") || [];
    const isAlreadySelected = currentFilters.includes(value);

    // Update search params
    const updatedFilters = isAlreadySelected
      ? currentFilters.filter((item: string) => item !== value) // Remove if already selected
      : [...currentFilters, value]; // Add if not selected

    const queryValue =
      updatedFilters.length > 0 ? updatedFilters.join(",") : undefined; // Join with comma or remove if empty

    setSelectedCount(updatedFilters.length);

    if (subcategorySlug) {
      navigate({
        to: "/shop/$categorySlug/$subcategorySlug",
        search: (prev) => ({
          ...prev,
          [type]: queryValue,
        }),
        params: (prev) => ({
          ...prev,
          categorySlug: prev.categorySlug!,
          subcategorySlug,
        }),
      });
    } else {
      navigate({
        to: "/shop/$categorySlug",
        params: (p) => ({ ...p, categorySlug: p.categorySlug! }),
        search: (prev) => ({
          ...prev,
          [type]: queryValue,
        }),
      });
    }
  };

  return (
    filters.length > 0 && (
      <div className="space-y-2">
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
                className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
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
