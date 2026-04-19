import { ProductVariant } from "../add-product/ProductStock";
import {
  AlertOctagonIcon,
  AlertTriangle,
  Check,
  CheckCircle,
  CheckCircle2,
} from "lucide-react";
import { Badge } from "../ui/badge";

export const ProductStockStatus = ({
  productVariant,
}: {
  productVariant: ProductVariant;
}) => {
  if (!productVariant.stock) {
    return (
      <Badge
        variant={"outline"}
        className="flex bg-red-100 border-none items-center"
      >
        <AlertTriangle className="w-3.5 h-3.5 text-red-600 mr-2" />
        <p className="text-red-700">Out of stock</p>
      </Badge>
    );
  }

  if (
    productVariant.stock <= 2 ||
    (productVariant.quantityAvailable || 0) <= 2
  ) {
    return (
      <Badge variant={"outline"} className="flex bg-yellow-50 items-center">
        <AlertOctagonIcon className="w-3.5 h-3.5 text-yellow-600 mr-2" />
        <p className="text-yellow-700">Low stock</p>
      </Badge>
    );
  }

  return (
    <Badge variant={"outline"} className="flex bg-green-100 items-center">
      <CheckCircle2 className="w-3.5 h-3.5 text-green-700 mr-2" />
      <p className="text-green-800">In stock</p>
    </Badge>
  );
};

export const OutOfStockStatus = () => {
  return (
    <Badge className="flex items-center w-fit text-red-700 rounded-md px-2 py-1 text-xs">
      <AlertTriangle className="w-3.5 h-3.5 text-red-600 mr-2" />
      <p className="text-red-700">Out of stock</p>
    </Badge>
  );
};

export const LowStockStatus = () => {
  return (
    <Badge className="flex items-center w-fit text-yellow-700 rounded-md px-2 py-1 text-xs">
      <AlertOctagonIcon className="w-3.5 h-3.5 text-yellow-600 mr-2" />
      <p className="text-yellow-700">Low stock</p>
    </Badge>
  );
};
