/**
 * A day's completed POS transaction count lives on the register close summary,
 * which is the settled record for that operating day. Days with no close have
 * no settled count; callers that need one for an open day derive it live from
 * facts, which is deliberately not done anywhere on the overview read path.
 */
export function transactionCountFromCloseSummary(
  summary: Record<string, unknown>,
): number {
  const transactionCount = summary.transactionCount;
  return typeof transactionCount === "number" &&
    Number.isFinite(transactionCount) &&
    transactionCount >= 0
    ? Math.trunc(transactionCount)
    : 0;
}
