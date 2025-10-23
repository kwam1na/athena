import { useStoreContext } from "@/contexts/StoreContext";
import { useProductDiscount } from "@/hooks/useProductDiscount";
import { cn } from "@/lib/utils";
import { ProductSku } from "@athena/webapp";
import { motion } from "framer-motion";

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
    <motion.span
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: "easeInOut" }}
      exit={{ opacity: 0, y: -4 }}
      //   key={productSkuId}
      className={cn(
        "absolute top-2 left-2 font-bold bg-accent4/60 w-fit text-accent5 px-2 py-0.5 rounded z-10",
        className,
        size === "xs" && "text-xs",
        size === "sm" && "text-sm",
        size === "md" && "text-md",
        size === "lg" && "text-lg"
      )}
    >
      {discountInfo.discount.type === "percentage"
        ? `${discountInfo.discount.value}% OFF`
        : `${formatter.format(discountInfo.discount.value)} OFF`}
    </motion.span>
  );
};
