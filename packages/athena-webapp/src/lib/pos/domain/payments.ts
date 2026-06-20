import type { PosPayment } from "./types";

export type PosPaymentAdjustment = {
  adjustedPayments: PosPayment[];
  changed: boolean;
};

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

export function normalizeNonCashOverpayment(
  payments: PosPayment[],
  total: number,
): PosPaymentAdjustment {
  const normalizedTotal = roundPosAmount(Math.max(0, total));
  let totalPaid = calculatePosTotalPaid(payments);
  let overpayment = roundPosAmount(totalPaid - normalizedTotal);

  if (overpayment <= 0) {
    return { adjustedPayments: payments, changed: false };
  }

  const cashPaid = roundPosAmount(
    payments
      .filter((payment) => payment.method === "cash")
      .reduce((sum, payment) => sum + payment.amount, 0),
  );
  overpayment = roundPosAmount(overpayment - cashPaid);

  if (overpayment <= 0) {
    return { adjustedPayments: payments, changed: false };
  }

  let changed = false;
  const adjustedPayments = payments.map((payment) => ({ ...payment }));

  for (let index = adjustedPayments.length - 1; index >= 0; index -= 1) {
    const payment = adjustedPayments[index];
    if (payment.method === "cash") continue;

    const reduction = Math.min(payment.amount, overpayment);
    if (reduction <= 0) continue;

    payment.amount = roundPosAmount(payment.amount - reduction);
    overpayment = roundPosAmount(overpayment - reduction);
    changed = true;

    if (overpayment <= 0) break;
  }

  if (!changed) {
    return { adjustedPayments: payments, changed: false };
  }

  totalPaid = calculatePosTotalPaid(adjustedPayments);
  return {
    adjustedPayments: adjustedPayments.filter((payment) => payment.amount > 0),
    changed: totalPaid !== calculatePosTotalPaid(payments),
  };
}

function roundPosAmount(amount: number): number {
  return Number(amount.toFixed(2));
}
