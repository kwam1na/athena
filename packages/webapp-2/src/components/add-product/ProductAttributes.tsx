import { useState, useEffect } from "react";
import { useProduct } from "@/contexts/ProductContext";
import { getErrorForField } from "@/lib/utils";
import { Skeleton } from "../ui/skeleton";
import DefaultAttributesToggleGroup from "./DefaultAttributesToggleGroup";
import AttributesTable from "./AttributesTable";

// Define the allowed attributes
type AllowedAttribute = "color" | "length" | "size";

// Type guard to check if a string is an AllowedAttribute
function isAllowedAttribute(attr: string): attr is AllowedAttribute {
  return ["color", "length", "size"].includes(attr);
}

function ProductAttributes() {
  const { error, isLoading, activeProductVariant } = useProduct();

  const [selectedAttributes, setSelectedAttributes] = useState<string[]>([]);

  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    const hasAttr =
      activeProductVariant.color ||
      activeProductVariant.length ||
      activeProductVariant.size;

    if (hasAttr && selectedAttributes.length == 0 && initialLoad) {
      const attr = [];

      if (activeProductVariant.color) {
        attr.push("color");
      }

      if (activeProductVariant.length) {
        attr.push("length");
      }

      if (activeProductVariant.size) {
        attr.push("size");
      }

      setInitialLoad(false);
      setSelectedAttributes(attr);
    }
  }, [activeProductVariant, selectedAttributes, initialLoad]);

  const availabilityValidationError = getErrorForField(error, "availability");

  return (
    <div className="flex flex-col gap-8 p-4">
      {isLoading && <Skeleton className="h-[40px] w-full" />}

      <div className="flex w-full">
        <DefaultAttributesToggleGroup
          selectedAttributes={selectedAttributes}
          setSelectedAttributes={setSelectedAttributes}
        />
      </div>

      {selectedAttributes.length > 0 && (
        <AttributesTable selectedAttributes={selectedAttributes} />
      )}

      {availabilityValidationError && (
        <p className="text-red-500 text-sm font-medium">
          {availabilityValidationError.message}
        </p>
      )}
    </div>
  );
}

export default ProductAttributes;
