import ImageWithFallback from "../ui/image-with-fallback";
import { getProductName } from "@/lib/productUtils";
import placeholder from "@/assets/placeholder.png";
import { useStoreContext } from "@/contexts/StoreContext";

interface OrderItemProps {
  item: any;
  formatter: Intl.NumberFormat;
}

export const OrderItem = ({ item, formatter }: OrderItemProps) => {
  const priceLabel = item.price
    ? formatter.format(item.price * item.quantity)
    : "Free";

  const { store } = useStoreContext();

  return (
    <div className="flex gap-8 text-sm">
      <ImageWithFallback
        src={
          item.productImage ||
          store?.config?.ui?.fallbackImageUrl ||
          placeholder
        }
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
