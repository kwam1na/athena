import { useEffect } from "react";
import { CheckoutSession } from "@athena/webapp";
import { CheckoutActions, CheckoutState } from "../types";

export function useDiscountSync(
  sessionData: CheckoutSession | null | undefined,
  checkoutState: CheckoutState,
  actionsState: CheckoutActions,
  updateState: (updates: Partial<CheckoutState>) => void
): void {
  useEffect(() => {
    if (actionsState.isApplyingDiscount) {
      return;
    }

    const sessionWithDiscount = sessionData as
      | (CheckoutSession & { session?: { discount?: Record<string, unknown> } })
      | null
      | undefined;
    const discount =
      sessionData?.discount || sessionWithDiscount?.session?.discount;

    if (discount && !checkoutState.discount) {
      const d = discount as Record<string, unknown>;
      updateState({
        discount: {
          id: (d.promoCodeId || d._id || d.id) as string,
          code: d.code as string,
          value: (d.value ?? d.discountValue) as number,
          type: (d.type ?? d.discountType) as "percentage" | "amount",
          span: d.span as "entire-order" | "selected-products",
          productSkus: d.productSkus as string[] | undefined,
          totalDiscount: d.totalDiscount as number | undefined,
          isMultipleUses: d.isMultipleUses as boolean,
          autoApply: d.autoApply as boolean | undefined,
        },
      });
    } else if (!discount && checkoutState.discount?.autoApply === true) {
      updateState({
        discount: null,
      });
    }
  }, [sessionData, checkoutState.discount, actionsState.isApplyingDiscount]);
}
