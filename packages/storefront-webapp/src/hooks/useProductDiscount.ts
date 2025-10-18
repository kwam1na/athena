import { useQuery } from "@tanstack/react-query";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";

type ProductDiscount = {
  hasDiscount: boolean;
  discountedPrice: number;
  originalPrice: number;
  discount?: {
    type: "percentage" | "amount";
    value: number;
    code: string;
  };
};

type ProductDiscountsResult = ProductDiscount & {
  discountedSkuId?: string; // ID of the SKU that has the discount
};

/**
 * Hook to check if any of the product SKUs has an active auto-apply discount
 * Returns the discount info for the first SKU that has a discount, or the first SKU's price info
 * Also returns the ID of the SKU that has the discount for display purposes
 * Uses promoCodeItems to check eligibility (matching BagSummary pattern)
 */
export function useProductDiscounts(
  skus: Array<{ _id: string; price: number }>
): ProductDiscountsResult {
  const promoCodeQueries = usePromoCodesQueries();
  const { data: promoCodeItems } = useQuery(promoCodeQueries.getAllItems());
  const { data: promoCodes } = useQuery(promoCodeQueries.getAll());
  const { data: redeemedPromoCodes } = useQuery(promoCodeQueries.getRedeemed());

  // Default return value when no discount applies
  if (!skus?.length || !promoCodeItems?.length || !promoCodes?.length) {
    return {
      hasDiscount: false,
      discountedPrice: skus?.[0]?.price || 0,
      originalPrice: skus?.[0]?.price || 0,
      discountedSkuId: skus?.[0]?._id,
    };
  }

  // Find the first SKU that has a discount from promoCodeItems
  for (const sku of skus) {
    const promoCodeItem = promoCodeItems.find(
      (item) => item.productSkuId === sku._id
    );

    if (promoCodeItem) {
      // Find the associated promo code
      const promoCode = promoCodes.find(
        (code) => code._id === promoCodeItem.promoCodeId
      );

      // Check if promo code has been redeemed
      const isRedeemed = redeemedPromoCodes?.some(
        (redeemedPromoCode) => redeemedPromoCode.promoCodeId === promoCode?._id
      );

      // Only show discount if promo code is active, auto-apply, and not redeemed
      if (promoCode && promoCode.active && promoCode.autoApply && !isRedeemed) {
        const calculateDiscountedPrice = (
          originalPrice: number,
          discountType: "percentage" | "amount",
          discountValue: number
        ): number => {
          if (discountType === "percentage") {
            return originalPrice * (1 - discountValue / 100);
          }
          return Math.max(0, originalPrice - discountValue);
        };

        const discountedPrice = calculateDiscountedPrice(
          sku.price,
          promoCode.discountType as "percentage" | "amount",
          promoCode.discountValue
        );

        return {
          hasDiscount: true,
          discountedPrice,
          originalPrice: sku.price,
          discountedSkuId: sku._id,
          discount: {
            type: promoCode.discountType as "percentage" | "amount",
            value: promoCode.discountValue,
            code: promoCode.code,
          },
        };
      }
    }
  }

  // No discount found, return first SKU's price
  return {
    hasDiscount: false,
    discountedPrice: skus[0].price,
    originalPrice: skus[0].price,
    discountedSkuId: skus[0]._id,
  };
}

/**
 * Hook to check if a product SKU has an active auto-apply discount
 * Uses promoCodeItems to check eligibility (matching BagSummary pattern)
 */
export function useProductDiscount(
  productSkuId?: string,
  price?: number
): ProductDiscount {
  const promoCodeQueries = usePromoCodesQueries();
  const { data: promoCodeItems } = useQuery(promoCodeQueries.getAllItems());
  const { data: promoCodes } = useQuery(promoCodeQueries.getAll());
  const { data: redeemedPromoCodes } = useQuery(promoCodeQueries.getRedeemed());

  // Default return value when no discount applies
  if (
    !productSkuId ||
    !price ||
    !promoCodeItems?.length ||
    !promoCodes?.length
  ) {
    return {
      hasDiscount: false,
      discountedPrice: price || 0,
      originalPrice: price || 0,
    };
  }

  // Find if this SKU has a promo code item
  const promoCodeItem = promoCodeItems.find(
    (item) => item.productSkuId === productSkuId
  );

  if (!promoCodeItem) {
    return {
      hasDiscount: false,
      discountedPrice: price,
      originalPrice: price,
    };
  }

  // Find the associated promo code
  const promoCode = promoCodes.find(
    (code) => code._id === promoCodeItem.promoCodeId
  );

  // Check if promo code has been redeemed
  const isRedeemed = redeemedPromoCodes?.some(
    (redeemedPromoCode) => redeemedPromoCode.promoCodeId === promoCode?._id
  );

  // Only show discount if promo code is active, auto-apply, and not redeemed
  if (!promoCode || !promoCode.active || !promoCode.autoApply || isRedeemed) {
    return {
      hasDiscount: false,
      discountedPrice: price,
      originalPrice: price,
    };
  }

  // Calculate discounted price
  const calculateDiscountedPrice = (
    originalPrice: number,
    discountType: "percentage" | "amount",
    discountValue: number
  ): number => {
    if (discountType === "percentage") {
      return originalPrice * (1 - discountValue / 100);
    }
    return Math.max(0, originalPrice - discountValue);
  };

  const discountedPrice = calculateDiscountedPrice(
    price,
    promoCode.discountType as "percentage" | "amount",
    promoCode.discountValue
  );

  return {
    hasDiscount: true,
    discountedPrice,
    originalPrice: price,
    discount: {
      type: promoCode.discountType as "percentage" | "amount",
      value: promoCode.discountValue,
      code: promoCode.code,
    },
  };
}
