import type { ReportingMetricName } from "../../../shared/reportingContract";

export type FactContributionInput = {
  adjustmentKind?: "deficit_cogs_revaluation";
  amountMinor?: number;
  cogsKnownMinor?: number;
  coveredRevenueMinor?: number;
  costStatus?: "known" | "partial" | "unknown" | "not_applicable";
  factType:
    | "sale"
    | "discount"
    | "refund"
    | "void"
    | "correction"
    | "payment"
    | "return"
    | "inventory_receipt"
    | "inventory_issue"
    | "inventory_adjustment"
    | "procurement_commitment"
    | "procurement_receipt"
    | "close_snapshot"
    | "post_close_adjustment";
  linkedBusinessEventKey?: string;
  inventoryContributionKind?:
    | "sellable_return_cogs_reversal"
    | "exchange_replacement_cogs"
    | "inventory_consumed"
    | "inventory_consumed_reversal";
  quantity?: number;
  revenueCurrencyCode?: string;
  revenueKind?: "merchandise" | "service" | "delivery" | "tax" | "refund";
  valuationCurrencyCode?: string;
};

export type FactMetricContribution = {
  metric: ReportingMetricName;
  value: number;
};

function merchandiseCostContributions(input: {
  amountMinor: number;
  cogsKnownMinor?: number;
  costStatus?: FactContributionInput["costStatus"];
  coveredRevenueMinor?: number;
  currenciesCompatible: boolean;
}) {
  if (input.cogsKnownMinor === undefined) {
    return input.costStatus === "unknown"
      ? [
          {
            metric: "uncosted_revenue" as const,
            value: input.amountMinor,
          },
        ]
      : [];
  }
  if (input.costStatus === "partial") {
    const coveredRevenue = input.coveredRevenueMinor ?? 0;
    const uncoveredRevenue = input.amountMinor - coveredRevenue;
    return [
      { metric: "known_cogs" as const, value: input.cogsKnownMinor },
      ...(input.currenciesCompatible
        ? [
            {
              metric: "gross_profit" as const,
              value: coveredRevenue - input.cogsKnownMinor,
            },
          ]
        : []),
      ...(uncoveredRevenue === 0
        ? []
        : [
            {
              metric: "uncosted_revenue" as const,
              value: uncoveredRevenue,
            },
          ]),
    ];
  }
  return [
    { metric: "known_cogs" as const, value: input.cogsKnownMinor },
    ...(input.currenciesCompatible
      ? [
          {
            metric: "gross_profit" as const,
            value: input.amountMinor - input.cogsKnownMinor,
          },
        ]
      : []),
  ];
}

export function deriveFactMetricContributions(
  fact: FactContributionInput,
): FactMetricContribution[] {
  const amount = fact.amountMinor ?? 0;
  const quantity = fact.quantity ?? 0;
  const currenciesCompatible =
    fact.revenueCurrencyCode === undefined &&
    fact.valuationCurrencyCode === undefined
      ? true
      : fact.revenueCurrencyCode !== undefined &&
        fact.revenueCurrencyCode === fact.valuationCurrencyCode;
  if (fact.factType === "payment") {
    const settlementMetric = fact.linkedBusinessEventKey
      ? "payments_reversed"
      : amount < 0
        ? "payments_refunded"
        : "payments_collected";
    return [
      { metric: settlementMetric, value: amount },
      { metric: "payment_allocated", value: amount },
    ];
  }
  if (fact.factType === "close_snapshot") {
    return [];
  }
  if (fact.factType === "procurement_commitment") {
    return [
      { metric: "purchase_commitment_units", value: quantity },
      { metric: "purchase_commitment_value", value: amount },
    ];
  }
  if (fact.factType === "procurement_receipt") {
    return [
      { metric: "purchase_commitment_units", value: -Math.abs(quantity) },
      { metric: "purchase_commitment_value", value: -Math.abs(amount) },
    ];
  }
  if (fact.factType === "inventory_issue") {
    if (fact.inventoryContributionKind === "exchange_replacement_cogs") {
      const cogs = Math.abs(fact.cogsKnownMinor ?? 0);
      return cogs === 0
        ? []
        : [
            { metric: "known_cogs", value: cogs },
            { metric: "gross_profit", value: -cogs },
          ];
    }
    if (fact.inventoryContributionKind === "inventory_consumed_reversal") {
      return [
        {
          metric: "inventory_consumed_units",
          value: -Math.abs(quantity),
        },
        ...(fact.cogsKnownMinor === undefined
          ? []
          : [
              {
                metric: "inventory_consumed_value" as const,
                value: -Math.abs(fact.cogsKnownMinor),
              },
            ]),
      ];
    }
    return [
      { metric: "inventory_consumed_units", value: Math.abs(quantity) },
      ...(fact.cogsKnownMinor === undefined
        ? []
        : [
            {
              metric: "inventory_consumed_value" as const,
              value: Math.abs(fact.cogsKnownMinor),
            },
          ]),
    ];
  }
  if (fact.factType === "discount") {
    return [
      { metric: "discounts", value: Math.abs(amount) },
      { metric: "net_sales", value: -Math.abs(amount) },
      ...(fact.revenueKind === "merchandise"
        ? [{ metric: "gross_profit" as const, value: -Math.abs(amount) }]
        : []),
    ];
  }
  if (fact.factType === "refund" || fact.factType === "return") {
    const signedAmount = amount > 0 ? -amount : amount;
    const signedQuantity = quantity > 0 ? -quantity : quantity;
    if (fact.inventoryContributionKind === "sellable_return_cogs_reversal") {
      const cogsReversal = -Math.abs(fact.cogsKnownMinor ?? 0);
      return [
        ...(signedQuantity === 0
          ? []
          : [
              {
                metric: "units_returned" as const,
                value: Math.abs(signedQuantity),
              },
              { metric: "units_sold" as const, value: signedQuantity },
            ]),
        ...(cogsReversal === 0
          ? []
          : [
              { metric: "known_cogs" as const, value: cogsReversal },
              { metric: "gross_profit" as const, value: -cogsReversal },
            ]),
      ];
    }
    return [
      { metric: "refunds", value: Math.abs(signedAmount) },
      { metric: "net_sales", value: signedAmount },
      ...(signedQuantity === 0
        ? []
        : [
            {
              metric: "units_returned" as const,
              value: Math.abs(signedQuantity),
            },
            { metric: "units_sold" as const, value: signedQuantity },
          ]),
      ...(fact.cogsKnownMinor === undefined
        ? fact.revenueKind === "refund" && signedAmount !== 0
          ? [{ metric: "gross_profit" as const, value: signedAmount }]
          : []
        : merchandiseCostContributions({
            amountMinor: signedAmount,
            cogsKnownMinor: fact.cogsKnownMinor,
            costStatus: fact.costStatus,
            coveredRevenueMinor: fact.coveredRevenueMinor,
            currenciesCompatible,
          })),
    ];
  }
  if (fact.factType === "void" || fact.factType === "correction") {
    if (fact.revenueKind === "tax") return [];
    const result: FactMetricContribution[] =
      amount === 0
        ? []
        : [
            { metric: "gross_sales", value: amount },
            { metric: "net_sales", value: amount },
          ];
    if (fact.revenueKind === "merchandise") {
      if (quantity !== 0) {
        result.push({ metric: "units_sold", value: quantity });
      }
      result.push(
        ...(fact.costStatus === "not_applicable" &&
        fact.cogsKnownMinor === undefined
          ? amount === 0
            ? []
            : [{ metric: "gross_profit" as const, value: amount }]
          : merchandiseCostContributions({
              amountMinor: amount,
              cogsKnownMinor: fact.cogsKnownMinor,
              costStatus: fact.costStatus,
              coveredRevenueMinor: fact.coveredRevenueMinor,
              currenciesCompatible,
            })),
      );
    }
    return result;
  }
  if (fact.factType === "post_close_adjustment") {
    if (fact.adjustmentKind === "deficit_cogs_revaluation") {
      const cogs = fact.cogsKnownMinor ?? 0;
      const coveredRevenue = fact.coveredRevenueMinor ?? 0;
      return [
        ...(cogs === 0 ? [] : [{ metric: "known_cogs" as const, value: cogs }]),
        ...(!currenciesCompatible || coveredRevenue - cogs === 0
          ? []
          : [
              {
                metric: "gross_profit" as const,
                value: coveredRevenue - cogs,
              },
            ]),
        ...(coveredRevenue === 0
          ? []
          : [
              {
                metric: "uncosted_revenue" as const,
                value: -coveredRevenue,
              },
            ]),
      ];
    }
    return amount === 0 ? [] : [{ metric: "net_sales", value: amount }];
  }
  if (fact.factType !== "sale") {
    return [];
  }
  if (fact.revenueKind === "tax") return [];
  const result: FactMetricContribution[] = [
    { metric: "gross_sales", value: amount },
    { metric: "net_sales", value: amount },
  ];
  if (fact.revenueKind === "merchandise") {
    result.push({ metric: "units_sold", value: quantity });
    result.push(
      ...merchandiseCostContributions({
        amountMinor: amount,
        cogsKnownMinor: fact.cogsKnownMinor,
        costStatus: fact.costStatus,
        coveredRevenueMinor: fact.coveredRevenueMinor,
        currenciesCompatible,
      }),
    );
  }
  return result;
}
