import { ProductSku } from "@athena/webapp";
import { getProductName } from "@/lib/productUtils";
import { SellingFastSignal, SoldOutBadge } from "./InventoryLevelBadge";

interface ProductInfoProps {
  selectedSku: ProductSku;
  formatter: Intl.NumberFormat;
  isSoldOut: boolean;
  isLowStock: boolean;
  className?: string;
}

export function ProductInfo({
  selectedSku,
  formatter,
  isSoldOut,
  isLowStock,
  className = "",
}: ProductInfoProps) {
  return (
    <div className={`space-y-6 ${className}`}>
      <p className="text-2xl md:text-3xl">{getProductName(selectedSku)}</p>

      <div className="flex items-center gap-2 md:gap-8 flex-wrap">
        {isSoldOut && <SoldOutBadge />}

        {isLowStock && !isSoldOut && (
          <SellingFastSignal
            message={`Only ${selectedSku.quantityAvailable} left`}
          />
        )}

        <p>{formatter.format(selectedSku.price)}</p>
      </div>
    </div>
  );
}
