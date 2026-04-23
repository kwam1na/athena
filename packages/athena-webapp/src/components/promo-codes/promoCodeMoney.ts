import { toDisplayAmount } from "~/convex/lib/currency";
import { parseDisplayAmountInput } from "~/src/lib/pos/displayAmounts";
import type { DiscountType } from "./types";

export function parsePromoDiscountInput(
  discount: string | null | undefined,
  discountType: DiscountType
): number | undefined {
  if (!discount?.trim()) {
    return undefined;
  }

  if (discountType === "percentage") {
    const value = Number.parseFloat(discount);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  return parseDisplayAmountInput(discount);
}

export function promoDiscountInputValue(
  storedDiscountValue: number,
  discountType: DiscountType
): string {
  return discountType === "amount"
    ? toDisplayAmount(storedDiscountValue).toString()
    : storedDiscountValue.toString();
}

export function promoDiscountDisplayText(
  discountValue: number,
  discountType: DiscountType,
  formatter: Intl.NumberFormat
): string {
  return discountType === "amount"
    ? formatter.format(toDisplayAmount(discountValue))
    : `${discountValue}%`;
}
