type FormatStoredAmount = (amount: number) => string;

export function formatStoredReviewReason(
  reason: string | null | undefined,
  formatStoredAmount: FormatStoredAmount,
) {
  if (!reason) {
    return undefined;
  }

  return reason
    .replace(
      /Variance of (-?\d+) exceeded the closeout approval threshold\./,
      (_match, rawVariance) =>
        `Variance of ${formatStoredAmount(Number(rawVariance))} exceeded the closeout approval threshold`,
    )
    .replace(
      /Manager signoff is required for any register variance \((-?\d+)\)\./,
      (_match, rawVariance) =>
        `Manager signoff is required for any register variance (${formatStoredAmount(Number(rawVariance))})`,
    );
}
