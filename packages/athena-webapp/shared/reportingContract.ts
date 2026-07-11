export const REPORTING_FACT_CONTRACT_VERSION = 1 as const;
export const REPORTING_PROJECTION_CONTRACT_VERSION = 1 as const;
export const REPORTING_LINE_ATTRIBUTION_VERSION = 1 as const;

export const REPORTING_SOURCE_DOMAINS = [
  "pos",
  "storefront",
  "service",
  "payments",
  "inventory",
  "procurement",
  "daily_close",
] as const;

export type ReportingSourceDomain = (typeof REPORTING_SOURCE_DOMAINS)[number];

export const REPORTING_FACT_TYPES = [
  "sale",
  "discount",
  "refund",
  "void",
  "correction",
  "payment",
  "return",
  "inventory_receipt",
  "inventory_issue",
  "inventory_adjustment",
  "procurement_commitment",
  "procurement_receipt",
  "close_snapshot",
  "post_close_adjustment",
] as const;

export type ReportingFactType = (typeof REPORTING_FACT_TYPES)[number];

export type ReportingCompleteness =
  "complete" | "provisional" | "partial" | "stale" | "unavailable";

export type ReportingLimitingReason =
  | "unauthorized"
  | "cross_store_reference"
  | "duplicate_conflict"
  | "source_incomplete"
  | "source_unsynchronized"
  | "pre_cutover_unknown"
  | "uncosted"
  | "processing_delayed"
  | "processing_failed"
  | "reconciliation_drift"
  | "rebuild_in_progress"
  | "rebuild_failed"
  | "version_incompatible"
  | "mixed_currency"
  | "projection_stale"
  | "evidence_truncated";

export type ReportingCurrency = {
  code: string;
  minorUnitScale: number;
};

export type ReportingMoneyCurrencies = {
  revenue?: ReportingCurrency;
  valuation?: ReportingCurrency;
};

export type ReportingSourceIdentity = {
  sourceDomain: ReportingSourceDomain;
  sourceEventType: string;
  businessEventKey: string;
  adapterVersion: number;
};

export type SafeReportingSourceReference = {
  sourceType: string;
  sourceId: string;
  relation: "owns" | "supports" | "corrects" | "reverses" | "supersedes";
};

export type ReportingPeriodAssignment = {
  operatingDate: string;
  recognitionAt: number;
  scheduleVersionId?: string;
  historicalInterpretationPolicyId?: string;
  historicalInterpretationPolicyHash?: string;
  timezone: string;
};

export type ReportingPeriodLineage =
  | { kind: "store_schedule"; id: string }
  | { kind: "historical_policy"; id: string; hash: string };

export type ReportingRecognitionChannel = "pos" | "storefront" | "service";

export type ReportingSkuAttributionKind =
  | "direct"
  | "pending_checkout"
  | "inventory_import";

export type ReportingMetricName =
  | "gross_sales"
  | "discounts"
  | "net_sales"
  | "refunds"
  | "units_sold"
  | "units_returned"
  | "known_cogs"
  | "uncosted_revenue"
  | "gross_profit"
  | "purchase_commitment_units"
  | "purchase_commitment_value"
  | "inventory_consumed_units"
  | "inventory_consumed_value"
  | "payments_collected"
  | "payments_refunded"
  | "payments_reversed"
  | "payment_allocated"
  | "on_hand_units"
  | "sellable_units"
  | "inventory_value";

export type ReportingMetricVersion = {
  metric: ReportingMetricName;
  version: number;
};
