import { getProductName } from "@/lib/productUtils";
import placeholder from "@/assets/placeholder.png";
import { useStoreContext } from "@/contexts/StoreContext";
import { getStoreFallbackImageUrl } from "@/lib/storeConfig";
import { formatStoredAmount } from "@/lib/currency";
import { StorefrontImage } from "../ui/storefront-image";

interface OrderItemProps {
  item: any;
  formatter: Intl.NumberFormat;
}

export const OrderItem = ({ item, formatter }: OrderItemProps) => {
  const priceLabel = item.price
    ? formatStoredAmount(formatter, item.price * item.quantity)
    : "Free";

  const { store } = useStoreContext();
  const fallbackImageUrl = getStoreFallbackImageUrl(store);
  const productName = getProductName(item);

  return (
    <div className="flex gap-8 text-sm">
      <StorefrontImage
        src={item.productImage || placeholder}
        fallbackSrc={fallbackImageUrl}
        alt={productName}
        aspectRatio="1 / 1"
        wrapperClassName="h-32 w-32 shrink-0 rounded-sm"
      />

      <div className="space-y-8">
        <div className="space-y-2 text-sm">
          <p className="text-sm font-medium">{productName}</p>
          <p className="text-xs text-muted-foreground">{priceLabel}</p>
        </div>
      </div>
    </div>
  );
};
