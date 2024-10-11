import { useState, useEffect } from "react";
import { useProduct } from "@/contexts/ProductContext";
import { getErrorForField } from "@/lib/utils";
import { Skeleton } from "../ui/skeleton";
import DefaultAttributesToggleGroup from "./DefaultAttributesToggleGroup";
import AttributesTable from "./AttributesTable";
import useGetActiveProduct from "@/hooks/useGetActiveProduct";

// Define the allowed attributes
type AllowedAttribute = "color" | "length" | "size";

// Type guard to check if a string is an AllowedAttribute
function isAllowedAttribute(attr: string): attr is AllowedAttribute {
  return ["color", "length", "size"].includes(attr);
}

function ProductAttributes() {
  const {
    error,
    isLoading,
    activeProductVariant,
    updateProductVariants,
    appState,
    updateAppState,
  } = useProduct();

  const [selectedAttributes, setSelectedAttributes] = useState<string[]>([]);

  const { activeProduct } = useGetActiveProduct();

  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    const hasAttr =
      activeProductVariant?.color ||
      activeProductVariant?.length ||
      activeProductVariant?.size;

    // console.log("[attributes]:", appState);

    if (
      (hasAttr && selectedAttributes.length == 0 && initialLoad) ||
      appState.didRevertChanges
    ) {
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

      if (appState.didRevertChanges) {
        updateAppState({ didRevertChanges: false });
      }

      setInitialLoad(false);
      setSelectedAttributes(attr);
    }
  }, [
    activeProductVariant,
    selectedAttributes,
    initialLoad,
    appState.didRevertChanges,
  ]);

  // console.log("active ->", activeProduct);

  useEffect(() => {
    if (activeProduct) {
      const hasLength = selectedAttributes.includes("length");
      const hasColor = selectedAttributes.includes("color");
      const hasSize = selectedAttributes.includes("size");

      updateProductVariants((prev) =>
        prev.map((v) => ({
          ...v,
          length: hasLength ? v.length : undefined,
          color: hasColor ? v.color : undefined,
          size: hasSize ? v.size : undefined,
        }))
      );
    }
  }, [activeProduct, selectedAttributes]);

  const availabilityValidationError = getErrorForField(error, "availability");

  return (
    <div className="flex flex-col gap-8 py-4">
      {isLoading && <Skeleton className="h-[40px] w-full" />}

      <div className="flex w-full px-4">
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
