import {
  REPORTING_FACT_CONTRACT_VERSION,
  type ReportingMetricName,
} from "../../shared/reportingContract";

export type MetricContract = {
  metric: ReportingMetricName;
  version: 1;
  inclusion: string;
  exclusion: string;
  recognition:
    "owning_financial_effect" | "physical_effect" | "current_position";
  signHandling: "signed_effect" | "non_negative_position";
  unknownData:
    | "withhold_when_required_source_is_incomplete"
    | "publish_known_component_with_coverage"
    | "unavailable_without_trustworthy_basis";
  comparison: "same_elapsed_operating_time" | "point_in_time";
  requiredSourceDomains: string[];
  evidence: "canonical_facts" | "inventory_effects" | "valuation_position";
};

const FINANCIAL_BASE = {
  recognition: "owning_financial_effect" as const,
  signHandling: "signed_effect" as const,
  unknownData: "withhold_when_required_source_is_incomplete" as const,
  comparison: "same_elapsed_operating_time" as const,
  requiredSourceDomains: ["pos", "storefront", "service"],
  evidence: "canonical_facts" as const,
};

const SETTLEMENT_BASE = {
  recognition: "owning_financial_effect" as const,
  signHandling: "signed_effect" as const,
  unknownData: "withhold_when_required_source_is_incomplete" as const,
  comparison: "same_elapsed_operating_time" as const,
  requiredSourceDomains: ["payments"],
  evidence: "canonical_facts" as const,
};

export const METRIC_CONTRACTS: Record<ReportingMetricName, MetricContract> = {
  gross_sales: {
    metric: "gross_sales",
    version: 1,
    inclusion:
      "Recognized sale value before discounts, refunds, and corrections.",
    exclusion: "Settlement-only activity and cancelled or unfulfilled sales.",
    ...FINANCIAL_BASE,
  },
  discounts: {
    metric: "discounts",
    version: 1,
    inclusion: "Discount effects linked to recognized sales.",
    exclusion: "Payment differences and unaccepted offers.",
    ...FINANCIAL_BASE,
  },
  net_sales: {
    metric: "net_sales",
    version: 1,
    inclusion:
      "Recognized sales less linked discounts, refunds, voids, and corrections.",
    exclusion: "Settlement-only activity and taxes collected.",
    ...FINANCIAL_BASE,
  },
  refunds: {
    metric: "refunds",
    version: 1,
    inclusion:
      "Accepted refund and reversal effects in their own recognition period.",
    exclusion: "Refund requests without an accepted financial effect.",
    ...FINANCIAL_BASE,
  },
  units_sold: {
    metric: "units_sold",
    version: 1,
    inclusion: "Merchandise quantity from recognized sale and return facts.",
    exclusion: "Service lines and settlement-only activity.",
    recognition: "physical_effect",
    signHandling: "signed_effect",
    unknownData: "publish_known_component_with_coverage",
    comparison: "same_elapsed_operating_time",
    requiredSourceDomains: ["pos", "storefront"],
    evidence: "canonical_facts",
  },
  units_returned: {
    metric: "units_returned",
    version: 1,
    inclusion:
      "Merchandise quantity from accepted return and refund disposition facts.",
    exclusion:
      "Financial-only refunds and damaged or missing items not restored to stock.",
    recognition: "physical_effect",
    signHandling: "signed_effect",
    unknownData: "publish_known_component_with_coverage",
    comparison: "same_elapsed_operating_time",
    requiredSourceDomains: ["pos", "storefront", "inventory"],
    evidence: "canonical_facts",
  },
  known_cogs: {
    metric: "known_cogs",
    version: 1,
    inclusion:
      "Immutable outbound merchandise basis and linked deficit resolution adjustments.",
    exclusion: "Uncosted quantity and service or labor cost.",
    recognition: "physical_effect",
    signHandling: "signed_effect",
    unknownData: "publish_known_component_with_coverage",
    comparison: "same_elapsed_operating_time",
    requiredSourceDomains: ["inventory", "pos", "storefront"],
    evidence: "inventory_effects",
  },
  uncosted_revenue: {
    metric: "uncosted_revenue",
    version: 1,
    inclusion:
      "Eligible merchandise revenue whose outbound cost basis is unknown.",
    exclusion:
      "Service revenue and merchandise revenue with immutable known basis.",
    recognition: "owning_financial_effect",
    signHandling: "signed_effect",
    unknownData: "publish_known_component_with_coverage",
    comparison: "same_elapsed_operating_time",
    requiredSourceDomains: ["pos", "storefront", "inventory"],
    evidence: "canonical_facts",
  },
  gross_profit: {
    metric: "gross_profit",
    version: 1,
    inclusion: "Eligible merchandise revenue less known merchandise COGS.",
    exclusion: "Service revenue and revenue without trustworthy cost coverage.",
    ...FINANCIAL_BASE,
    unknownData: "publish_known_component_with_coverage",
    requiredSourceDomains: ["pos", "storefront", "inventory"],
  },
  purchase_commitment_units: {
    metric: "purchase_commitment_units",
    version: 1,
    inclusion:
      "Outstanding confirmed purchase-order quantity not yet received or cancelled.",
    exclusion:
      "Draft demand, cancelled quantity, and already received quantity.",
    recognition: "owning_financial_effect",
    signHandling: "signed_effect",
    unknownData: "publish_known_component_with_coverage",
    comparison: "point_in_time",
    requiredSourceDomains: ["procurement"],
    evidence: "canonical_facts",
  },
  purchase_commitment_value: {
    metric: "purchase_commitment_value",
    version: 1,
    inclusion:
      "Known planned value of outstanding confirmed purchase-order quantity.",
    exclusion: "Unknown-cost and cancelled or already received quantity.",
    recognition: "owning_financial_effect",
    signHandling: "signed_effect",
    unknownData: "publish_known_component_with_coverage",
    comparison: "point_in_time",
    requiredSourceDomains: ["procurement"],
    evidence: "canonical_facts",
  },
  inventory_consumed_units: {
    metric: "inventory_consumed_units",
    version: 1,
    inclusion:
      "Accepted non-sale inventory issues, service material use, loss, and expense consumption.",
    exclusion: "Merchandise COGS and availability-only holds.",
    recognition: "physical_effect",
    signHandling: "signed_effect",
    unknownData: "publish_known_component_with_coverage",
    comparison: "same_elapsed_operating_time",
    requiredSourceDomains: ["inventory", "service"],
    evidence: "inventory_effects",
  },
  inventory_consumed_value: {
    metric: "inventory_consumed_value",
    version: 1,
    inclusion:
      "Known immutable basis of accepted non-sale inventory consumption.",
    exclusion:
      "Uncosted consumption, merchandise COGS, and availability-only holds.",
    recognition: "physical_effect",
    signHandling: "signed_effect",
    unknownData: "publish_known_component_with_coverage",
    comparison: "same_elapsed_operating_time",
    requiredSourceDomains: ["inventory", "service"],
    evidence: "inventory_effects",
  },
  payments_collected: {
    metric: "payments_collected",
    version: 1,
    inclusion: "Accepted positive settlement and collection effects.",
    exclusion:
      "Revenue recognition, refunds, reversals, and pending payment attempts.",
    ...SETTLEMENT_BASE,
  },
  payments_refunded: {
    metric: "payments_refunded",
    version: 1,
    inclusion:
      "Accepted outbound settlement effects not classified as reversals.",
    exclusion:
      "Revenue refunds without completed settlement and linked payment reversals.",
    ...SETTLEMENT_BASE,
  },
  payments_reversed: {
    metric: "payments_reversed",
    version: 1,
    inclusion:
      "Accepted settlement effects linked to the payment they reverse.",
    exclusion:
      "Revenue reversal until a refund or void financial fact is accepted.",
    ...SETTLEMENT_BASE,
  },
  payment_allocated: {
    metric: "payment_allocated",
    version: 1,
    inclusion: "Signed value assigned by accepted payment-allocation evidence.",
    exclusion: "Unallocated attempts and revenue recognition.",
    ...SETTLEMENT_BASE,
  },
  on_hand_units: {
    metric: "on_hand_units",
    version: 1,
    inclusion: "Accepted cutover quantity plus committed physical effects.",
    exclusion: "Availability holds and expected inbound stock.",
    recognition: "current_position",
    signHandling: "non_negative_position",
    unknownData: "unavailable_without_trustworthy_basis",
    comparison: "point_in_time",
    requiredSourceDomains: ["inventory"],
    evidence: "valuation_position",
  },
  sellable_units: {
    metric: "sellable_units",
    version: 1,
    inclusion: "On-hand quantity currently eligible for sale.",
    exclusion: "Held, damaged, quarantined, and unresolved deficit quantity.",
    recognition: "current_position",
    signHandling: "non_negative_position",
    unknownData: "unavailable_without_trustworthy_basis",
    comparison: "point_in_time",
    requiredSourceDomains: ["inventory"],
    evidence: "valuation_position",
  },
  inventory_value: {
    metric: "inventory_value",
    version: 1,
    inclusion: "Known cost pool for costed on-hand quantity.",
    exclusion: "Uncosted quantity and unresolved deficit quantity.",
    recognition: "current_position",
    signHandling: "non_negative_position",
    unknownData: "publish_known_component_with_coverage",
    comparison: "point_in_time",
    requiredSourceDomains: ["inventory"],
    evidence: "valuation_position",
  },
};

export function validateFactContractVersion(version: number) {
  if (version !== REPORTING_FACT_CONTRACT_VERSION) {
    throw new Error("Unsupported reporting fact contract version.");
  }
  return version;
}

export function getMetricContract(
  metric: ReportingMetricName,
  version: number,
) {
  validateMetricContractVersion(metric, version);
  return METRIC_CONTRACTS[metric];
}

export function validateMetricContractVersion(
  metric: ReportingMetricName,
  version: number,
) {
  const contract = METRIC_CONTRACTS[metric];
  if (!contract || contract.version !== version) {
    throw new Error("Unsupported reporting metric contract version.");
  }
  return version;
}
