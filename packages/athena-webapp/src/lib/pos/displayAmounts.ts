import { toDisplayAmount, toPesewas } from "~/convex/lib/currency";
import { currencyFormatter } from "~/shared/currencyFormatter";

type FormatStoredCurrencyAmountOptions = {
  revealMinorUnits?: boolean;
};

export function formatStoredAmount(
  formatter: Intl.NumberFormat,
  amount: number
): string {
  return formatter.format(toDisplayAmount(amount));
}

export function formatStoredCurrencyAmount(
  currency: string,
  amount: number,
  options: FormatStoredCurrencyAmountOptions = {},
): string {
  const hasMinorUnits = Math.abs(amount) % 100 !== 0;
  const fractionDigits = options.revealMinorUnits && hasMinorUnits ? 2 : 0;

  return formatStoredAmount(
    currencyFormatter(currency, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }),
    amount,
  );
}

export function parseDisplayAmountInput(
  rawValue: string
): number | undefined {
  if (rawValue.includes("-")) {
    return undefined;
  }

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
