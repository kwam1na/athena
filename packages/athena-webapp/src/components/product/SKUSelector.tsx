import useGetActiveProduct from "~/src/hooks/useGetActiveProduct";
import { GenericComboBox } from "../GenericComboBox";
import { useProduct } from "~/src/contexts/ProductContext";
import { useEffect } from "react";
import { ProductVariant } from "../add-product/ProductStock";
import { Link, useSearch } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";
import { Button } from "../ui/button";
import { PenIcon } from "lucide-react";

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
  }, [variant, productVariants]);

  const handleVariantChange = (value: ProductVariant) => {
    const selectedVariant = productVariants.find((v) => v.id === value.id);

    if (selectedVariant) {
      setActiveProductVariant(selectedVariant);
    }
  };

  const comboBoxValues = productVariants.map((v, i) => ({
    value: v,
    label: v.sku || "",
  }));

  const variantEqualityFn = (a: ProductVariant, b: ProductVariant) =>
    a.id === b.id;

  return (
    <div className="py-8 flex items-center gap-8">
      <p className="text-xs">SKU</p>

      {productVariants.length > 0 && (
        <GenericComboBox<ProductVariant>
          activeItem={activeProductVariant}
          items={comboBoxValues}
          onValueChange={handleVariantChange}
          equalityFn={variantEqualityFn}
        />
      )}

      {/* <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          productSlug: activeProduct?._id!,
        })}
        search={{
          o: getOrigin(),
          variant: activeProductVariant?.sku,
        }}
      >
        <Button variant="outline" className="flex items-center gap-2">
          Edit
          <PenIcon className="h-3.5 w-3.5" />
        </Button>
      </Link> */}
    </div>
  );
};
