import { AlertOctagonIcon, AlertTriangle } from "lucide-react";
import { capitalizeFirstLetter, slugToWords } from "~/src/lib/utils";
import { Product } from "~/types";

export const ProductStatus = ({ product }: { product: Product }) => {
  let textClassname = "";
  if (product.availability === "live") {
    textClassname = "text-green-800";
  }

  if (product.availability === "draft") {
    textClassname = "text-yellow-800";
  }

  if (product.inventoryCount == 0) {
    return (
      <div className="flex items-center">
        <AlertTriangle className="w-3.5 h-3.5 text-red-600 mr-2" />
        <p className="text-red-700">Out of stock</p>
      </div>
    );
  }

  if (product.inventoryCount <= 2) {
    return (
      <div className="flex items-center">
        <AlertOctagonIcon className="w-3.5 h-3.5 text-yellow-600 mr-2" />
        <p className="text-yellow-700">Low stock</p>
      </div>
    );
  }

  return (
    <div className="flex items-center">
      {product.availability === "live" && (
        <div className="h-2 w-2 mr-2 rounded bg-green-700" />
      )}
      {product.availability === "draft" && (
        <div className="h-2 w-2 mr-2 rounded bg-yellow-500" />
      )}

      {product.availability === "archived" && (
        <div className="h-2 w-2 mr-2 rounded bg-zinc-300" />
      )}
      <p className={textClassname}>
        {capitalizeFirstLetter(slugToWords(product.availability))}
      </p>
    </div>
  );
};
