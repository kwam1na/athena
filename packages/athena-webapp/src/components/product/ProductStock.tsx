import { ProductVariant } from "../add-product/ProductStock";
import { AlertOctagonIcon, AlertTriangle, Check } from "lucide-react";

export const ProductStockStatus = ({
  productVariant,
}: {
  productVariant: ProductVariant;
}) => {
  if (!productVariant.stock) {
    return (
      <div className="flex items-center">
        <AlertTriangle className="w-3.5 h-3.5 text-red-600 mr-2" />
        <p className="text-red-700">Out of stock</p>
      </div>
    );
  }

  if (
    productVariant.stock <= 2 ||
    (productVariant.quantityAvailable || 0) <= 2
  ) {
    return (
      <div className="flex items-center">
        <AlertOctagonIcon className="w-3.5 h-3.5 text-yellow-600 mr-2" />
        <p className="text-yellow-700">Low stock</p>
      </div>
    );
  }

  return (
    <div className="flex items-center">
      <Check className="w-3.5 h-3.5 text-green-700 mr-2" />
      <p className="text-green-800">Stocked</p>
    </div>
  );
};

export const OutOfStockStatus = () => {
  return (
    <div className="flex items-center w-fit text-red-700 rounded-md px-2 py-1 text-xs">
      <AlertTriangle className="w-3.5 h-3.5 text-red-600 mr-2" />
      <p className="text-red-700">Out of stock</p>
    </div>
  );
};

export const LowStockStatus = () => {
  return (
    <div className="flex items-center w-fit text-yellow-700 rounded-md px-2 py-1 text-xs">
      <AlertOctagonIcon className="w-3.5 h-3.5 text-yellow-600 mr-2" />
      <p className="text-yellow-700">Low stock</p>
    </div>
  );
};
