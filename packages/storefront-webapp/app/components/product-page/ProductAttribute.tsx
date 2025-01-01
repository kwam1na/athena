import { Product, ProductSku } from "@athena/webapp-2";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { capitalizeWords } from "@/lib/utils";

export function ProductAttribute({
  product,
  selectedSku,
  setSelectedSku,
}: {
  product: Product;
  selectedSku: ProductSku;
  setSelectedSku: (sku: ProductSku) => void;
}) {
  const colors: string[] = Array.from(
    new Set(product.skus.map((sku: ProductSku) => sku.colorName))
  );

  const lengths: number[] = Array.from(
    new Set(
      product.skus
        .filter((sk: ProductSku) => sk.colorName == selectedSku.colorName)
        .map((sku: ProductSku) => parseInt(sku.length))
        .sort((a: number, b: number) => a - b)
    )
  );

  const handleClick = (attribute: "color" | "length", value: string) => {
    let variant;

    if (attribute == "color") {
      variant =
        product.skus.find(
          (sk: ProductSku) =>
            sk.colorName == value && sk.length == selectedSku.length
        ) || product.skus.find((sk: ProductSku) => sk.colorName == value);
    } else {
      variant =
        product.skus.find(
          (sk: ProductSku) =>
            sk.length == value && sk.colorName == selectedSku.colorName
        ) || product.skus.find((sk: ProductSku) => sk.length == value);
    }

    setSelectedSku(variant);
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <p className="text-sm">Color</p>

        <div className="grid grid-cols-5 gap-4">
          {colors.map((color, index) => {
            return (
              <Button
                variant={"ghost"}
                key={index}
                className={`${selectedSku?.colorName == color ? "border border-black" : "border border-background-muted"}`}
                onClick={() => handleClick("color", color)}
              >
                {capitalizeWords(color)}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-sm">Length</p>

        <div className="grid grid-cols-5 gap-4">
          {lengths.map((length, index) => {
            return (
              <Button
                variant={"ghost"}
                key={index}
                className={`${selectedSku?.length == length ? "border border-black" : "border border-background-muted"}`}
                onClick={() => handleClick("length", length.toString())}
              >
                {`${length}"`}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
