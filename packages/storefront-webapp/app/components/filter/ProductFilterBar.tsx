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
    <div className="flex justify-between bg-background w-full sticky p-4 lg:px-12">
      <div className="flex items-center">
        <p className="pl-4 text-sm">{`Shop all ${capitalizeFirstLetter(slugToWords(subcategorySlug || categorySlug || ""))}`}</p>
      </div>
      <Button
        variant="clear"
        onClick={() => setShowFilters(!showFilters)}
        className="hidden lg:flex ml-auto"
      >
        <p>{showFilters ? "Hide filters" : showFiltersText}</p>
        <SlidersHorizontal className="w-4 h-4 ml-2" />
      </Button>

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
