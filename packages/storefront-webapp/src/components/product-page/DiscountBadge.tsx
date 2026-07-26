import { useStoreContext } from "@/contexts/StoreContext";
import { useProductDiscount } from "@/hooks/useProductDiscount";
import { formatStoredAmount } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { ProductSku } from "@athena/webapp";

export const DiscountBadge = ({
  size = "lg",
  className,
  productPrice,
  productSkuId,
}: {
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  productPrice?: number;
  productSkuId?: string;
}) => {
  const discountInfo = useProductDiscount(productSkuId, productPrice);

  const { formatter } = useStoreContext();

  if (!discountInfo.discount) return null;

  return (
    <span
      className={cn(
        "absolute left-2 top-2 z-10 w-fit rounded-pill bg-offer px-layout-xs py-layout-2xs font-bold text-offer-foreground shadow-surface",
        className,
        size === "xs" && "text-xs",
        size === "sm" && "text-sm",
        size === "md" && "text-md",
        size === "lg" && "text-lg",
      )}
    >
      {discountInfo.discount.type === "percentage"
        ? `${discountInfo.discount.value}% OFF`
        : `${formatStoredAmount(formatter, discountInfo.discount.value)} OFF`}
    </span>
  );
};
