import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Archive, Circle, CircleDashed } from "lucide-react";
import { useProduct } from "~/src/contexts/ProductContext";

function ProductAvailabilityToggleGroup() {
  const { productData, updateProductData } = useProduct();

  return (
    <ToggleGroup
      type="single"
      value={productData.availability}
      onValueChange={(value) => {
        updateProductData({
          availability: value as "archived" | "draft" | "live" | undefined,
        });
      }}
    >
      <ToggleGroupItem
        value="draft"
        className="text-yellow-700"
        aria-label="Toggle color"
      >
        <CircleDashed className="w-4 h-4 mr-2" />
        Draft
      </ToggleGroupItem>
      <ToggleGroupItem
        value="live"
        className="text-green-700"
        aria-label="Toggle length"
      >
        <Circle className="w-4 h-4 mr-2" />
        Live
      </ToggleGroupItem>

      <ToggleGroupItem
        value="archived"
        className="text-muted-foreground"
        aria-label="Toggle length"
      >
        <Archive className="w-4 h-4 mr-2" />
        Archived
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export default ProductAvailabilityToggleGroup;
