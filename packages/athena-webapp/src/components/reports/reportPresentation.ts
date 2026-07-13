export type ReportStatusKind =
  | "complete"
  | "materializing"
  | "pre_cutover"
  | "uncosted_partial"
  | "stale_last_good"
  | "unsynchronized"
  | "truncated"
  | "mixed_currency"
  | "failed";

type ReportStatusPresentation = {
  description: string;
  title: string;
  tone: "neutral" | "notice" | "warning";
};

const REPORT_STATUS_PRESENTATION: Record<
  ReportStatusKind,
  ReportStatusPresentation
> = {
  complete: {
    title: "Reports are current",
    description: "Verified reporting data is available for this period.",
    tone: "neutral",
  },
  materializing: {
    title: "Preparing reports",
    description:
      "Verified report data will appear when preparation is complete.",
    tone: "notice",
  },
  pre_cutover: {
    title: "Rebuilding reports",
    description:
      "Completed sales will appear when the reporting rebuild is finished.",
    tone: "notice",
  },
  uncosted_partial: {
    title: "Some costs are not available",
    description:
      "Sales remain available. Profit is limited to the reported cost coverage.",
    tone: "notice",
  },
  stale_last_good: {
    title: "Refresh is delayed",
    description:
      "Showing the last verified report while newer activity is processed.",
    tone: "notice",
  },
  unsynchronized: {
    title: "Some activity is still syncing",
    description:
      "Some terminal activity is still syncing. Affected dates and metrics may change.",
    tone: "warning",
  },
  truncated: {
    title: "Some detail is not shown",
    description:
      "The summary is available, but this view reached its detail limit.",
    tone: "notice",
  },
  mixed_currency: {
    title: "Currencies cannot be combined",
    description:
      "Money totals are limited where activity uses more than one currency.",
    tone: "notice",
  },
  failed: {
    title: "Reports are temporarily unavailable",
    description: "Verified report data could not be loaded. Try again shortly.",
    tone: "warning",
  },
};

export function getReportStatusPresentation({
  kind,
}: {
  kind: ReportStatusKind;
}) {
  return REPORT_STATUS_PRESENTATION[kind];
}

export function getReportStatusKind(input: {
  completeness?: string | null;
  inventoryLimitingReason?: string | null;
  limitingReason?: string | null;
  status?: string | null;
}): ReportStatusKind {
  if (input.status === "pre_cutover") return "pre_cutover";
  if (input.status === "materializing") return "materializing";
  if (
    input.status === "failed" ||
    input.status === "unavailable" ||
    input.status === "schedule_unavailable"
  )
    return "failed";
  if (input.limitingReason === "mixed_currency") return "mixed_currency";
  if (input.limitingReason === "evidence_truncated") return "truncated";
  if (input.limitingReason === "uncosted") return "uncosted_partial";
  if (
    input.completeness === "stale" ||
    input.limitingReason === "projection_stale"
  )
    return "stale_last_good";
  if (
    input.completeness === "partial" ||
    input.inventoryLimitingReason ||
    input.limitingReason
  )
    return "unsynchronized";
  return "complete";
}

export function formatMinorUnits({
  amountMinor,
  currency,
  minorUnitScale,
}: {
  amountMinor: number;
  currency: string;
  minorUnitScale: number;
}) {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: minorUnitScale,
    minimumFractionDigits: minorUnitScale,
    style: "currency",
  }).format(amountMinor / 10 ** minorUnitScale);
}
