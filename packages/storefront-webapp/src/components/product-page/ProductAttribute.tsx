import { Product, ProductSku } from "@athena/webapp";
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

  const allSizes = Array.from(
    new Set(
      product.skus
        .map((sku: any) => sku.size)
        .filter((size: any) => size != null && size !== "")
    )
  );

  // Separate numeric and string sizes
  const numericSizes: number[] = allSizes
    .map((size) => {
      const parsed = typeof size === "string" ? parseInt(size) : size;
      return typeof parsed === "number" && !isNaN(parsed) ? parsed : null;
    })
    .filter((size): size is number => size !== null)
    .sort((a, b) => a - b);

  const stringSizes: string[] = allSizes
    .filter((size) => {
      const parsed = typeof size === "string" ? parseInt(size) : size;
      return !(typeof parsed === "number" && !isNaN(parsed));
    })
    .map((size) => String(size))
    .sort((a, b) => a.localeCompare(b));

  // Combine: numeric sizes first, then string sizes
  const sizes: Array<number | string> = [...numericSizes, ...stringSizes];

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
              const sizeStr = String(size);
              const isNumeric = typeof size === "number";
              const displayText = isNumeric
                ? `${size}"`
                : capitalizeWords(sizeStr);

              return (
                <Button
                  variant={"ghost"}
                  key={index}
                  className={`${selectedSku?.size == sizeStr ? "border text-[#EC4683] border-[#EC4683] shadow-md" : "border border-background-muted"} hover:shadow-md hover:border-[#EC4683]`}
                  onClick={() => handleClick("size", sizeStr)}
                >
                  {displayText}
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
