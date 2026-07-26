import { useParams } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { SlidersHorizontal } from "lucide-react";
import { capitalizeWords, slugToWords } from "@/lib/utils";

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

  const showFilterButton = ["hair"].includes(categorySlug || "");

  return (
    <div
      className="sticky mx-auto flex max-w-content items-center justify-between bg-surface px-gutter"
    >
      <div className="flex items-center py-4">
        <h1 className="text-xl font-semibold">{`${capitalizeWords(slugToWords(subcategorySlug || categorySlug || ""))}`}</h1>
      </div>
      {showFilterButton && (
        <>
          <Button
            variant="clear"
            aria-expanded={showFilters}
            onClick={() => setShowFilters(!showFilters)}
            className="ml-auto hidden text-xs lg:flex"
          >
            <span>{showFilters ? "Hide filters" : showFiltersText}</span>
            <SlidersHorizontal className="w-4 h-4 ml-2" />
          </Button>

          <Button
            variant="clear"
            aria-haspopup="dialog"
            onClick={onFilterClickOnMobile}
            className="ml-auto lg:hidden"
          >
            <span>{showFilters ? "Hide filters" : showFiltersText}</span>
            <SlidersHorizontal className="w-4 h-4 ml-2" />
          </Button>
        </>
      )}
    </div>
  );
}
