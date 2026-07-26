import { Product, ProductSku } from "@athena/webapp";
import { Button } from "../ui/button";
import { capitalizeWords } from "@/lib/utils";
import { useId } from "react";

export function ProductAttribute({
  product,
  selectedSku,
  setSelectedSku,
  density = "default",
  className = "",
}: {
  product: Product;
  selectedSku: ProductSku;
  setSelectedSku: (sku: ProductSku) => void;
  density?: "default" | "compact";
  className?: string;
}) {
  const isCompact = density === "compact";
  const colorLabelId = useId();
  const lengthLabelId = useId();
  const sizeLabelId = useId();
  const containerClassName = isCompact ? "space-y-7" : "space-y-8";
  const groupClassName = isCompact ? "space-y-2.5" : "space-y-4";
  const labelClassName = isCompact
    ? "text-xs font-medium text-muted-foreground"
    : "text-sm";
  const optionsClassName = isCompact
    ? "flex flex-wrap gap-2"
    : "flex flex-wrap gap-4";
  const optionClassName = (isSelected: boolean) =>
    `${isCompact ? "h-10 min-w-16 px-4 text-sm" : ""} ${
      isSelected
        ? "border-selection-foreground bg-selection text-selection-foreground shadow-surface"
        : "border-border bg-surface"
    } hover:border-selection-foreground hover:bg-selection hover:shadow-surface`;

  const colors: string[] = Array.from(
    new Set(
      product.skus
        .map((sku: any) => sku.colorName)
        .filter((color: any): color is string => color != null)
        .sort((a: string, b: string) => a.localeCompare(b)),
    ),
  );

  const lengths: number[] = Array.from(
    new Set(
      product.skus
        .filter((sk: any) => sk.colorName == selectedSku.colorName)
        .map((sku: any) => parseInt(sku.length))
        .filter((length: any) => !isNaN(length))
        .sort((a: number, b: number) => a - b),
    ),
  );

  const allSizes = Array.from(
    new Set(
      product.skus
        .map((sku: any) => sku.size)
        .filter((size: any) => size != null && size !== ""),
    ),
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

  const findSize = (sku: any, value: string) => {
    const skuSize = String(sku.size ?? "");
    return skuSize == value || skuSize.split(" ")[0] == value;
  };

  const handleClick = (
    attribute: "color" | "length" | "size",
    value: string,
  ) => {
    let variant;

    if (attribute == "color") {
      variant =
        product.skus.find(
          (sk: any) => sk.colorName == value && sk.length == selectedSku.length,
        ) || product.skus.find((sk: any) => sk.colorName == value);
    } else if (attribute == "length") {
      variant =
        product.skus.find(
          (sk: any) =>
            sk.length == value && sk.colorName == selectedSku.colorName,
        ) || product.skus.find((sk: any) => sk.length == value);
    } else {
      variant =
        product.skus.find(
          (sk: any) =>
            sk.size == value && sk.colorName == selectedSku.colorName,
        ) || product.skus.find((sk: any) => findSize(sk, value));
    }

    variant && setSelectedSku(variant);
  };

  return (
    <div className={`${containerClassName} ${className}`}>
      {Boolean(colors.length) && (
        <div className={groupClassName}>
          <p className={labelClassName} id={colorLabelId}>Color</p>

          <div
            aria-labelledby={colorLabelId}
            className={optionsClassName}
            role="group"
          >
            {colors.map((color, index) => {
              return (
                <Button
                  variant={"ghost"}
                  key={index}
                  aria-pressed={selectedSku?.colorName == color}
                  className={optionClassName(selectedSku?.colorName == color)}
                  onClick={() => handleClick("color", color)}
                  type="button"
                >
                  {capitalizeWords(color)}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {Boolean(lengths.length) && (
        <div className={groupClassName}>
          <p className={labelClassName} id={lengthLabelId}>Length</p>

          <div
            aria-labelledby={lengthLabelId}
            className={optionsClassName}
            role="group"
          >
            {lengths.map((length, index) => {
              return (
                <Button
                  variant={"ghost"}
                  key={index}
                  aria-pressed={selectedSku?.length == length}
                  className={optionClassName(selectedSku?.length == length)}
                  onClick={() => handleClick("length", length.toString())}
                  type="button"
                >
                  {`${length}"`}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {selectedSku.productCategory !== "Hair" && Boolean(sizes.length) && (
        <div className={groupClassName}>
          <p className={labelClassName} id={sizeLabelId}>Size</p>

          <div
            aria-labelledby={sizeLabelId}
            className={optionsClassName}
            role="group"
          >
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
                  aria-pressed={findSize(selectedSku, sizeStr)}
                  className={optionClassName(findSize(selectedSku, sizeStr))}
                  onClick={() => handleClick("size", sizeStr)}
                  type="button"
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
