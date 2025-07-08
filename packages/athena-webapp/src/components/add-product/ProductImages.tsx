import ImageUploader from "../ui/image-uploader";
import View from "../View";

import { useProduct } from "@/contexts/ProductContext";
import { useEffect } from "react";
import { GenericComboBox } from "../GenericComboBox";
import { ProductVariant } from "./ProductStock";
import { useSearch } from "@tanstack/react-router";
import { Button } from "../ui/button";
import useGetActiveProduct from "~/src/hooks/useGetActiveProduct";
import config from "~/src/config";
import { EyeIcon } from "lucide-react";

const Header = () => {
  const { activeProductVariant, productVariants, setActiveProductVariant } =
    useProduct();

  const { variant } = useSearch({ strict: false });

  useEffect(() => {
    // Ensure there's always an active variant if variants exist
    if (productVariants.length > 0 && !activeProductVariant && !variant) {
      setActiveProductVariant(productVariants[0]);
    }
  }, [productVariants, activeProductVariant, setActiveProductVariant, variant]);

  const handleVariantChange = (value: ProductVariant) => {
    const selectedVariant = productVariants.find((v) => v.id === value.id);

    if (selectedVariant) {
      setActiveProductVariant(selectedVariant);
    }
  };

  useEffect(() => {
    if (variant) {
      const selectedVariant = productVariants.find((v) => v.sku === variant);

      if (selectedVariant) {
        setActiveProductVariant(selectedVariant);
      }
    }
  }, [variant, productVariants]);

  const comboBoxValues = productVariants.map((v, i) => ({
    value: v,
    label: `Variant ${i + 1}`,
  }));

  const variantEqualityFn = (a: ProductVariant, b: ProductVariant) =>
    a.id === b.id;

  return (
    <div className="flex items-center w-full justify-between">
      <p className="text-sm text-sm">Images</p>
      {productVariants.length > 1 && (
        <GenericComboBox<ProductVariant>
          activeItem={activeProductVariant}
          items={comboBoxValues}
          onValueChange={handleVariantChange}
          equalityFn={variantEqualityFn}
        />
      )}
    </div>
  );
};

export default function ProductImagesView() {
  const { activeProductVariant, updateVariantImages } = useProduct();
  const { activeProduct } = useGetActiveProduct();

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto"
      header={<Header />}
    >
      <ImageUploader
        images={activeProductVariant?.images}
        variantMarkedForDeletion={activeProductVariant?.markedForDeletion}
        updateImages={(newImages) =>
          updateVariantImages(activeProductVariant.id, newImages)
        }
      />

      {activeProduct && (
        <div className="w-full flex">
          <Button
            variant={"outline"}
            className="ml-auto flex items-center gap-2"
            onClick={() => {
              window.open(
                `${config.storeFrontUrl}/shop/product/${activeProduct?._id}?variant=${activeProductVariant?.sku}`,
                "_blank"
              );
            }}
          >
            View on store
            <EyeIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </View>
  );
}
