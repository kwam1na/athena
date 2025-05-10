import {
  AlertOctagonIcon,
  AlertTriangle,
  EyeClosed,
  EyeOff,
} from "lucide-react";
import { capitalizeFirstLetter, slugToWords } from "~/src/lib/utils";
import { Product } from "~/types";
import { Badge } from "../ui/badge";

export const ProductStatus = ({ product }: { product: Product }) => {
  const getBadgeStyles = () => {
    if (product.inventoryCount === 0)
      return {
        bg: "bg-red-100 text-red-700",
        text: "text-red-700",
      };
    if (product.inventoryCount <= 2)
      return {
        bg: "bg-amber-100 text-amber-700",
        text: "text-amber-700",
      };

    if (product.isVisible) {
      return {
        bg: "bg-green-100 text-green-700",
        text: "text-green-700",
      };
    } else {
      return {
        bg: "bg-zinc-100 text-zinc-700",
        text: "text-zinc-700",
      };
    }
  };

  const { bg, text } = getBadgeStyles();

  const visibility = product.isVisible ? "Live" : "Hidden";

  return (
    <Badge variant="outline" className={`${bg}`}>
      <div className="flex items-center text-xs">
        {product.inventoryCount === 0 ? (
          <>
            <AlertTriangle className="w-3.5 h-3.5 mr-2 text-red-700" />
            <p className={text}>Out of stock</p>
          </>
        ) : product.inventoryCount <= 2 ? (
          <>
            <AlertOctagonIcon className="w-3.5 h-3.5 mr-2 text-amber-700" />
            <p className={text}>Low stock</p>
          </>
        ) : (
          <>
            {product.isVisible && (
              <div className={`h-2 w-2 mr-2 rounded bg-green-700`} />
            )}

            {!product.isVisible && (
              <EyeOff className="w-3.5 h-3.5 mr-2 text-zinc-700" />
            )}
            <p className={text}>{visibility}</p>
          </>
        )}
      </div>
    </Badge>
  );
};
