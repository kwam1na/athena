import ImageWithFallback from "../ui/image-with-fallback";
import { getProductName } from "@/lib/productUtils";
import placeholder from "@/assets/placeholder.png";

interface OrderItemProps {
  item: any;
  formatter: Intl.NumberFormat;
}

export const OrderItem = ({ item, formatter }: OrderItemProps) => {
  const priceLabel = item.price
    ? formatter.format(item.price * item.quantity)
    : "Free";

  return (
    <div className="flex gap-8 text-sm">
      <ImageWithFallback
        src={item.productImage || placeholder}
        alt={"product image"}
        className="w-32 h-32 aspect-square object-cover rounded-sm"
      />

      <div className="space-y-8">
        <div className="space-y-2 text-sm">
          <p className="text-sm font-medium">{getProductName(item)}</p>
          <p className="text-xs text-muted-foreground">{priceLabel}</p>
        </div>
      </div>
    </div>
  );
};
