import { toDisplayAmount, toPesewas } from "~/convex/lib/currency";

export function formatStoredAmount(
  formatter: Intl.NumberFormat,
  amount: number
): string {
  return formatter.format(toDisplayAmount(amount));
}

export function parseDisplayAmountInput(
  rawValue: string
): number | undefined {
  const numericValue = rawValue.replace(/[^\d.]/g, "");

  if (numericValue === "" || numericValue === ".") {
    return undefined;
  }

  const displayAmount = Number.parseFloat(numericValue);

  if (!Number.isFinite(displayAmount) || displayAmount < 0) {
    return undefined;
  }

  return toPesewas(displayAmount);
}
