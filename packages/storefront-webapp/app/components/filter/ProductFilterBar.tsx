import { useParams } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { SlidersHorizontal } from "lucide-react";
import { capitalizeFirstLetter, slugToWords } from "@/lib/utils";

export default function ProductFilterBar({
  showFilters,
  setShowFilters,
  selectedFiltersCount,
  onFilterClickOnMobile,
}: {
  showFilters: boolean;
  selectedFiltersCount: number;
  setShowFilters: (show: boolean) => void;
  onFilterClickOnMobile: () => void;
}) {
  const { categorySlug, subcategorySlug } = useParams({ strict: false });

  const showFiltersText =
    selectedFiltersCount == 0
      ? "Show filters"
      : `Show filters (${selectedFiltersCount})`;

  return (
    <div className="flex justify-between container mx-auto max-w-[1024px] sticky">
      <div className="flex items-center py-4">
        <p className="text-md font-medium">{`${capitalizeFirstLetter(slugToWords(subcategorySlug || categorySlug || ""))}`}</p>
      </div>
      {/* <Button
        variant="clear"
        onClick={() => setShowFilters(!showFilters)}
        className="hidden text-xs lg:flex ml-auto p-0"
      >
        <p>{showFilters ? "Hide filters" : showFiltersText}</p>
        <SlidersHorizontal className="w-4 h-4 ml-2" />
      </Button> */}

      <Button
        variant="clear"
        onClick={onFilterClickOnMobile}
        className="lg:hidden ml-auto"
      >
        <p>{showFilters ? "Hide filters" : showFiltersText}</p>
        <SlidersHorizontal className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
}
