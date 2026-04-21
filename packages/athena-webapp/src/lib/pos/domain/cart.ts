import type { PosCartLineInput, PosMoneyTotals } from "./types";

export function calculatePosCartTotals(
  items: PosCartLineInput[],
  taxRate: number = 0,
): PosMoneyTotals {
  if (!items.length) {
    return {
      subtotal: 0,
      tax: 0,
      total: 0,
    };
  }

  const subtotal = items.reduce(
    (sum, item) => sum + getPosEffectivePrice(item.price, item.areProcessingFeesAbsorbed) * item.quantity,
    0,
  );
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  return {
    subtotal: roundPosAmount(subtotal),
    tax: roundPosAmount(tax),
    total: roundPosAmount(total),
  };
}

export function calculatePosItemTotal(price: number, quantity: number): number {
  return roundPosAmount(price * quantity);
}

export function getPosEffectivePrice(
  price: number,
  _areProcessingFeesAbsorbed?: boolean,
): number {
  return price;
}

function roundPosAmount(amount: number): number {
  return Number(amount.toFixed(2));
}
