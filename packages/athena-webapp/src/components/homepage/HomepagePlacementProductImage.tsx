import { useState } from "react";
import { ImageIcon } from "lucide-react";

import type { Product, ProductSku } from "~/types";

export function HomepagePlacementProductImage({
  alt,
  className = "h-16 w-16",
  product,
  sku,
}: {
  alt: string;
  className?: string;
  product?: Product | null;
  sku?: ProductSku | null;
}) {
  const [failed, setFailed] = useState(false);
  const imageUrl = sku ? getSkuImageUrl(sku) : getProductImageUrl(product);

  if (!imageUrl || failed) {
    return (
      <div
        aria-label={alt}
        className={`${className} flex aspect-square shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground`}
        role="img"
      >
        <ImageIcon className="h-5 w-5" />
      </div>
    );
  }

  return (
    <img
      alt={alt}
      className={`${className} aspect-square shrink-0 rounded-md object-cover`}
      onError={() => setFailed(true)}
      src={imageUrl}
    />
  );
}

export function getProductImageUrl(product?: Product | null) {
  return product?.skus
    .flatMap((sku) => sku.images)
    .find((image): image is string => typeof image === "string" && image !== "");
}

function getSkuImageUrl(sku?: ProductSku | null) {
  return sku?.images.find(
    (image): image is string => typeof image === "string" && image !== "",
  );
}
