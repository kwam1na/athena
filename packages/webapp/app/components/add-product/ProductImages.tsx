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

const Header = () => {
  const { activeProductVariant, productVariants, setActiveProductVariant } =
    useProduct();

  useEffect(() => {
    // Ensure there's always an active variant if variants exist
    if (productVariants.length > 0 && !activeProductVariant) {
      setActiveProductVariant(productVariants[0]);
    }
  }, [productVariants, activeProductVariant, setActiveProductVariant]);

  const handleVariantChange = (value: string) => {
    const selectedVariant = productVariants.find(
      (v) => v.id.toString() === value
    );
    if (selectedVariant) {
      setActiveProductVariant(selectedVariant);
    }
  };

  return (
    <div className="flex items-center w-full justify-between">
      <p className="text-sm text-sm text-muted-foreground">Images</p>
      {productVariants.length > 1 && (
        <Select
          onValueChange={handleVariantChange}
          value={activeProductVariant?.id.toString() || ""}
        >
          <SelectTrigger className="w-auto px-4">
            <SelectValue placeholder="Select product variant" />
          </SelectTrigger>
          <SelectContent>
            {productVariants.map((variant, index) => (
              <SelectItem key={variant.id} value={variant.id.toString()}>
                {`Variant ${index + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
