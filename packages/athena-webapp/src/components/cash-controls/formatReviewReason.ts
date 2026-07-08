import { formatStoredAmount } from "@/lib/pos/displayAmounts";
import { formatStoredReviewReason } from "~/shared/reviewReasonFormatter";

export function formatReviewReason(
  formatter: Intl.NumberFormat,
  reason?: string | null,
) {
  return formatStoredReviewReason(reason, (amount) =>
    formatStoredAmount(formatter, amount),
  );
}
