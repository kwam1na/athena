import { AlertOctagonIcon, AlertTriangle, Archive, EyeOff } from "lucide-react";
import { Product } from "~/types";
import { ProductVariant } from "../add-product/ProductStock";
import { Badge } from "../ui/badge";

type ProductStatusProps = {
  product: Product;
  productVariant?: ProductVariant;
};

export const ProductStatus = ({
  product,
  productVariant,
}: ProductStatusProps) => {
  const isVisible =
    product.isVisible !== false && productVariant?.isVisible !== false;
  const inventoryCount = productVariant?.stock ?? product.inventoryCount;
  const quantityAvailable = productVariant?.quantityAvailable ?? inventoryCount;
  const isArchived = product.availability === "archived";

  const getBadgeStyles = () => {
    if (isArchived) {
      return {
        bg: "bg-zinc-100 text-zinc-700",
        text: "text-zinc-700",
      };
    }

    if (!isVisible) {
      return {
        bg: "bg-zinc-100 text-zinc-700",
        text: "text-zinc-700",
      };
    }

    if (inventoryCount === 0 || quantityAvailable === 0) {
      return {
        bg: "bg-red-100 text-red-700",
        text: "text-red-700",
      };
    }

    if (
      (inventoryCount !== undefined && inventoryCount <= 2) ||
      (quantityAvailable !== undefined && quantityAvailable <= 2)
    ) {
      return {
        bg: "bg-amber-100 text-amber-700",
        text: "text-amber-700",
      };
    }

    return {
      bg: "bg-green-100 text-green-700",
      text: "text-green-700",
    };
  };

  const { bg, text } = getBadgeStyles();

  const visibility = isVisible ? "Live" : "Hidden";

  if (isArchived) {
    return (
      <Badge variant="outline" className={`${bg}`}>
        <div className="flex items-center text-xs">
          <Archive className="w-3.5 h-3.5 mr-2 text-zinc-700" />
          <p className={text}>Archived</p>
        </div>
      </Badge>
    );
  }

  if (!isVisible) {
    return (
      <Badge variant="outline" className={`${bg}`}>
        <div className="flex items-center text-xs">
          <EyeOff className="w-3.5 h-3.5 mr-2 text-zinc-700" />
          <p className={text}>Hidden</p>
        </div>
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={`${bg}`}>
      <div className="flex items-center text-xs">
        {inventoryCount === 0 || quantityAvailable === 0 ? (
          <>
            <AlertTriangle className="w-3.5 h-3.5 mr-2 text-red-700" />
            <p className={text}>Out of stock</p>
          </>
        ) : inventoryCount <= 2 || quantityAvailable <= 2 ? (
          <>
            <AlertOctagonIcon className="w-3.5 h-3.5 mr-2 text-amber-700" />
            <p className={text}>Low stock</p>
          </>
        ) : (
          <>
            <div className={`h-2 w-2 mr-2 rounded bg-green-700`} />
            <p className={text}>{visibility}</p>
          </>
        )}
      </div>
    </Badge>
  );
};
