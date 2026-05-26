import { ProductVariant } from "../add-product/ProductStock";
import {
  AlertOctagonIcon,
  AlertTriangle,
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
      <Badge
        variant={"outline"}
        className="flex bg-yellow-50 border-none items-center"
      >
        <AlertOctagonIcon className="w-3.5 h-3.5 text-yellow-600 mr-2" />
        <p className="text-yellow-700">Low stock</p>
      </Badge>
    );
  }

  return (
    <Badge
      variant={"outline"}
      className="flex bg-green-100 border-none items-center"
    >
      <CheckCircle2 className="w-3.5 h-3.5 text-green-700 mr-2" />
      <p className="text-green-800">In stock</p>
    </Badge>
  );
};

export const OutOfStockStatus = () => {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-red-700">
      <AlertTriangle className="h-3.5 w-3.5" />
      Out of stock
    </span>
  );
};

export const LowStockStatus = () => {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-amber-700">
      <AlertOctagonIcon className="h-3.5 w-3.5" />
      Low stock
    </span>
  );
};
