import { AlertOctagonIcon, AlertTriangle } from "lucide-react";
import { capitalizeFirstLetter, slugToWords } from "~/src/lib/utils";
import { Product } from "~/types";
import { Badge } from "../ui/badge";

export const ProductStatus = ({ product }: { product: Product }) => {
  const getBadgeStyles = () => {
    if (product.inventoryCount === 0)
      return { bg: "bg-red-50", text: "text-red-600" };
    if (product.inventoryCount <= 2)
      return { bg: "bg-yellow-50", text: "text-yellow-600" };

    switch (product.availability) {
      case "live":
        return { bg: "bg-green-50", text: "text-green-600" };
      case "draft":
        return { bg: "bg-yellow-50", text: "text-yellow-600" };
      default:
        return { bg: "bg-zinc-50", text: "text-zinc-600" };
    }
  };

  const { bg, text } = getBadgeStyles();

  return (
    <Badge variant="outline" className={`${bg}`}>
      <div className="flex items-center text-xs">
        {product.inventoryCount === 0 ? (
          <>
            <AlertTriangle className="w-3.5 h-3.5 mr-2 text-red-600" />
            <p className={text}>Out of stock</p>
          </>
        ) : product.inventoryCount <= 2 ? (
          <>
            <AlertOctagonIcon className="w-3.5 h-3.5 mr-2 text-yellow-600" />
            <p className={text}>Low stock</p>
          </>
        ) : (
          <>
            <div
              className={`h-2 w-2 mr-2 rounded ${text.replace("text", "bg")}`}
            />
            <p className={text}>
              {capitalizeFirstLetter(slugToWords(product.availability))}
            </p>
          </>
        )}
      </div>
    </Badge>
  );
};
