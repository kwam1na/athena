import { Product, ProductSku } from "@athena/webapp";
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
    new Set(
      product.skus
        .map((sku: any) => sku.colorName)
        .filter((color: any): color is string => color != null)
        .sort((a: string, b: string) => a.localeCompare(b))
    )
  );

  const lengths: number[] = Array.from(
    new Set(
      product.skus
        .filter((sk: any) => sk.colorName == selectedSku.colorName)
        .map((sku: any) => parseInt(sku.length))
        .filter((length: any) => !isNaN(length))
        .sort((a: number, b: number) => a - b)
    )
  );

  const sizes: number[] = Array.from(
    new Set(
      product.skus
        .map((sku: any) => parseInt(sku.size))
        .filter((size: any) => !isNaN(size))
        .sort((a: number, b: number) => a - b)
    )
  );

  const handleClick = (
    attribute: "color" | "length" | "size",
    value: string
  ) => {
    let variant;

    if (attribute == "color") {
      variant =
        product.skus.find(
          (sk: any) => sk.colorName == value && sk.length == selectedSku.length
        ) || product.skus.find((sk: any) => sk.colorName == value);
    } else if (attribute == "length") {
      variant =
        product.skus.find(
          (sk: any) =>
            sk.length == value && sk.colorName == selectedSku.colorName
        ) || product.skus.find((sk: any) => sk.length == value);
    } else {
      variant =
        product.skus.find(
          (sk: any) => sk.size == value && sk.colorName == selectedSku.colorName
        ) || product.skus.find((sk: any) => sk.size == value);
    }

    variant && setSelectedSku(variant);
  };

  return (
    <div className="space-y-8">
      {Boolean(colors.length) && (
        <div className="space-y-4">
          <p className="text-sm">Color</p>

          <div className="flex flex-wrap gap-4">
            {colors.map((color, index) => {
              return (
                <Button
                  variant={"ghost"}
                  key={index}
                  className={`${selectedSku?.colorName == color ? "border text-[#EC4683] border-[#EC4683] shadow-md" : "border border-background-muted"} hover:shadow-md hover:border-[#EC4683]`}
                  onClick={() => handleClick("color", color)}
                >
                  {capitalizeWords(color)}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {Boolean(lengths.length) && (
        <div className="space-y-4">
          <p className="text-sm">Length</p>

          <div className="flex flex-wrap gap-4">
            {lengths.map((length, index) => {
              return (
                <Button
                  variant={"ghost"}
                  key={index}
                  className={`${selectedSku?.length == length ? "border text-[#EC4683] border-[#EC4683] shadow-md" : "border border-background-muted"} hover:shadow-md hover:border-[#EC4683]`}
                  onClick={() => handleClick("length", length.toString())}
                >
                  {`${length}"`}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {selectedSku.productCategory !== "Hair" && Boolean(sizes.length) && (
        <div className="space-y-4">
          <p className="text-sm">Size</p>

          <div className="flex flex-wrap gap-4">
            {sizes.map((size, index) => {
              return (
                <Button
                  variant={"ghost"}
                  key={index}
                  className={`${selectedSku?.size == size.toString() ? "border text-[#EC4683] border-[#EC4683] shadow-md" : "border border-background-muted"} hover:shadow-md hover:border-[#EC4683]`}
                  onClick={() => handleClick("size", size.toString())}
                >
                  {`${size}"`}
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
