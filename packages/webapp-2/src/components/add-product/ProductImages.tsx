import ImageUploader from "../ui/image-uploader";
import View from "../View";
import { Skeleton } from "../ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useProduct } from "@/contexts/ProductContext";
import { useEffect } from "react";
import { GenericComboBox } from "../GenericComboBox";
import { ProductVariant } from "./ProductStock";

const Header = () => {
  const { activeProductVariant, productVariants, setActiveProductVariant } =
    useProduct();

  useEffect(() => {
    // Ensure there's always an active variant if variants exist
    if (productVariants.length > 0 && !activeProductVariant) {
      setActiveProductVariant(productVariants[0]);
    }
  }, [productVariants, activeProductVariant, setActiveProductVariant]);

  const handleVariantChange = (value: ProductVariant) => {
    const selectedVariant = productVariants.find((v) => v.id === value.id);

    if (selectedVariant) {
      setActiveProductVariant(selectedVariant);
    }
  };

  const comboBoxValues = productVariants.map((v, i) => ({
    value: v,
    label: `Variant ${i + 1}`,
  }));

  const variantEqualityFn = (a: ProductVariant, b: ProductVariant) =>
    a.id === b.id;

  return (
    <div className="flex items-center w-full justify-between">
      <p className="text-sm text-sm text-muted-foreground">Images</p>
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
  const { activeProductVariant, isLoading, updateVariantImages } = useProduct();

  return (
    <View className="h-auto" header={<Header />}>
      {!isLoading && (
        <ImageUploader
          images={activeProductVariant.images}
          variantMarkedForDeletion={activeProductVariant.markedForDeletion}
          updateImages={(newImages) =>
            updateVariantImages(activeProductVariant.id, newImages)
          }
        />
      )}
      {isLoading && (
        <div className="flex gap-2 p-4">
          <Skeleton className="w-[50%] h-[280px]" />
          <Skeleton className="w-[50%] h-[280px]" />
        </div>
      )}
    </View>
  );
}
