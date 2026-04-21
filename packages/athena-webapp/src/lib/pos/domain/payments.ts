import type { PosPayment } from "./types";

export function calculatePosChange(amountPaid: number, total: number): number {
  return roundPosAmount(amountPaid - total);
}

export function isPosPaymentSufficient(
  amountPaid: number,
  total: number,
): boolean {
  return amountPaid >= total;
}

export function calculatePosTotalPaid(payments: PosPayment[]): number {
  return roundPosAmount(
    payments.reduce((sum, payment) => sum + payment.amount, 0),
  );
}

export function calculatePosRemainingDue(
  amountPaid: number,
  total: number,
): number {
  return roundPosAmount(Math.max(0, total - amountPaid));
}

function roundPosAmount(amount: number): number {
  return Number(amount.toFixed(2));
}
