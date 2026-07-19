import { AlertOctagonIcon, AlertTriangle, Archive, EyeOff } from "lucide-react";
import { Product } from "~/types";
import { ProductVariant } from "../add-product/ProductStock";
import { Badge } from "../ui/badge";
import { cn } from "~/src/lib/utils";

type ProductStatusProps = {
  className?: string;
  product: Product;
  productVariant?: ProductVariant;
};

export const ProductStatus = ({
  className,
  product,
  productVariant,
}: ProductStatusProps) => {
  const isVisible =
    product.isVisible !== false && productVariant?.isVisible !== false;
  const inventoryCount = productVariant?.stock ?? product.inventoryCount;
  const quantityAvailable = productVariant?.quantityAvailable ?? inventoryCount;
  const isArchived = product.availability === "archived";
  const isDraft = product.availability === "draft";

  const getBadgeStyles = () => {
    if (isArchived) {
      return "border-border/80 bg-muted/60 text-muted-foreground";
    }

    if (isDraft) {
      return "border-warning/30 bg-warning/10 text-warning";
    }

    if (!isVisible) {
      return "border-border/80 bg-muted/60 text-muted-foreground";
    }

    if (inventoryCount === 0 || quantityAvailable === 0) {
      return "border-danger/30 bg-danger/10 text-danger";
    }

    if (
      (inventoryCount !== undefined && inventoryCount <= 2) ||
      (quantityAvailable !== undefined && quantityAvailable <= 2)
    ) {
      return "border-warning/30 bg-warning/10 text-warning";
    }

    return "border-success/30 bg-success/10 text-success";
  };

  const badgeStyles = getBadgeStyles();
  const badgeClassName = cn(badgeStyles, className);

  const visibility = isVisible ? "Live" : "Hidden";

  if (isArchived) {
    return (
      <Badge variant="outline" className={badgeClassName}>
        <div className="flex items-center text-xs">
          <Archive className="mr-2 h-3.5 w-3.5" />
          <p>Archived</p>
        </div>
      </Badge>
    );
  }

  if (isDraft) {
    return (
      <Badge variant="outline" className={badgeClassName}>
        <div className="flex items-center text-xs">
          <div className="mr-2 h-2 w-2 rounded bg-current" />
          <p>Draft</p>
        </div>
      </Badge>
    );
  }

  if (!isVisible) {
    return (
      <Badge variant="outline" className={badgeClassName}>
        <div className="flex items-center text-xs">
          <EyeOff className="mr-2 h-3.5 w-3.5" />
          <p>Hidden online</p>
        </div>
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={badgeClassName}>
      <div className="flex items-center text-xs">
        {inventoryCount === 0 || quantityAvailable === 0 ? (
          <>
            <AlertTriangle className="mr-2 h-3.5 w-3.5" />
            <p>Out of stock</p>
          </>
        ) : inventoryCount <= 2 || quantityAvailable <= 2 ? (
          <>
            <AlertOctagonIcon className="mr-2 h-3.5 w-3.5" />
            <p>Low stock</p>
          </>
        ) : (
          <>
            <div className="mr-2 h-2 w-2 rounded bg-current" />
            <p>{visibility}</p>
          </>
        )}
      </div>
    </Badge>
  );
};
