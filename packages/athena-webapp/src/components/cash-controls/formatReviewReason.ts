import { formatStoredAmount } from "@/lib/pos/displayAmounts";

export function formatReviewReason(
  formatter: Intl.NumberFormat,
  reason?: string | null,
) {
  if (!reason) {
    return undefined;
  }

  return reason
    .replace(
      /Variance of (-?\d+) exceeded the closeout approval threshold\./,
      (_match, rawVariance) =>
        `Variance of ${formatStoredAmount(formatter, Number(rawVariance))} exceeded the closeout approval threshold`,
    )
    .replace(
      /Manager signoff is required for any register variance \((-?\d+)\)\./,
      (_match, rawVariance) =>
        `Manager signoff is required for any register variance (${formatStoredAmount(formatter, Number(rawVariance))})`,
    );
}
