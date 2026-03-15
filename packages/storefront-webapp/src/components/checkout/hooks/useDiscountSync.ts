import { useEffect } from "react";
import { CheckoutActions, CheckoutState } from "../types";

export function useDiscountSync(
  sessionData: any,
  checkoutState: CheckoutState,
  actionsState: CheckoutActions,
  updateState: (updates: Partial<CheckoutState>) => void
): void {
  useEffect(() => {
    if (actionsState.isApplyingDiscount) {
      return;
    }

    const discount =
      sessionData?.discount || (sessionData as any)?.session?.discount;

    if (discount && !checkoutState.discount) {
      updateState({
        discount: {
          id: discount.promoCodeId || discount._id || discount.id,
          code: discount.code,
          value: discount.value ?? discount.discountValue,
          type: discount.type ?? discount.discountType,
          span: discount.span,
          productSkus: discount.productSkus,
          totalDiscount: discount.totalDiscount,
          isMultipleUses: discount.isMultipleUses,
          autoApply: discount.autoApply,
        },
      });
    } else if (!discount && checkoutState.discount?.autoApply === true) {
      updateState({
        discount: null,
      });
    }
  }, [sessionData, checkoutState.discount, actionsState.isApplyingDiscount]);
}
