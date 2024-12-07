import { useParams } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { SlidersHorizontal } from "lucide-react";
import { capitalizeFirstLetter, slugToWords } from "@/lib/utils";

export default function ProductFilterBar({
  showFilters,
  setShowFilters,
}: {
  showFilters: boolean;
  setShowFilters: (show: boolean) => void;
}) {
  const { categorySlug, subcategorySlug } = useParams({ strict: false });

  return (
    <div className="flex justify-between bg-background w-full sticky p-4 lg:px-12">
      <div className="flex items-center">
        <p className="pl-4 text-sm">{`Shop all ${capitalizeFirstLetter(slugToWords(subcategorySlug || categorySlug || ""))}`}</p>
      </div>
      <Button
        variant="clear"
        onClick={() => setShowFilters(!showFilters)}
        className="ml-auto"
      >
        <p>{showFilters ? "Hide filters" : "Show filters"}</p>
        <SlidersHorizontal className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
}
