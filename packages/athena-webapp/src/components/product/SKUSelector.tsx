import { GenericComboBox } from "../GenericComboBox";
import { useProduct } from "~/src/contexts/ProductContext";
import { useEffect } from "react";
import { ProductVariant } from "../add-product/ProductStock";
import { useSearch } from "@tanstack/react-router";
import { FadeIn } from "../common/FadeIn";

export const SKUSelector = () => {
  const {
    activeProductVariant,
    productVariants,
    setActiveProductVariant,
    activeProduct,
  } = useProduct();

  const { variant } = useSearch({ strict: false });

  useEffect(() => {
    // Ensure there's always an active variant if variants exist
    if (productVariants.length > 0 && !activeProductVariant && !variant) {
      setActiveProductVariant(productVariants[0]);
    }
  }, [productVariants, activeProductVariant, setActiveProductVariant, variant]);

  useEffect(() => {
    if (variant) {
      const selectedVariant = productVariants.find((v) => v.sku === variant);

      if (selectedVariant) {
        setActiveProductVariant(selectedVariant);
      }
    }
  }, [variant, productVariants, setActiveProductVariant]);

  const handleVariantChange = (value: ProductVariant) => {
    const selectedVariant = productVariants.find((v) => v.id === value.id);

    if (selectedVariant) {
      setActiveProductVariant(selectedVariant);
    }
  };

  const comboBoxValues = productVariants.map((v) => ({
    value: v,
    label: v.sku || "",
  }));

  const variantEqualityFn = (a: ProductVariant, b: ProductVariant) =>
    a.id === b.id;

  if (activeProduct === undefined) return null;

  if (activeProduct === null) return null;

  return (
    <FadeIn className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-8 lg:py-8">
      <p className="text-xs text-muted-foreground sm:text-foreground">SKU</p>

      {productVariants.length > 0 && (
        <div className="w-full min-w-0 sm:w-auto">
          <GenericComboBox<ProductVariant>
            activeItem={activeProductVariant}
            items={comboBoxValues}
            onValueChange={handleVariantChange}
            equalityFn={variantEqualityFn}
          />
        </div>
      )}
    </FadeIn>
  );
};
