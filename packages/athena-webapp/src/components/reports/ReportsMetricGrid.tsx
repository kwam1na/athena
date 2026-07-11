import { OperationsSummaryMetric } from "@/components/operations/OperationsSummaryMetric";
import { formatMinorUnits } from "./reportPresentation";

type Metrics = Record<string, number | null | undefined>;

function comparisonText(
  current: number | null | undefined,
  comparison: number | null | undefined,
  format: (value: number) => string,
) {
  if (current == null || comparison == null) return "Comparison unavailable";
  const difference = current - comparison;
  if (comparison <= 0) {
    return `${difference >= 0 ? "+" : ""}${format(difference)} vs prior period`;
  }
  const percent = (difference / Math.abs(comparison)) * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

export function ReportsMetricGrid({
  currency = "USD",
  minorUnitScale = 2,
  metrics,
  withholdMoney = false,
}: {
  currency?: string;
  minorUnitScale?: number;
  metrics: Metrics;
  withholdMoney?: boolean;
}) {
  const money = (value: number) =>
    formatMinorUnits({ amountMinor: value, currency, minorUnitScale });
  const coverage = metrics.cost_coverage_basis_points;
  const cards = [
    {
      comparison: metrics.comparison_net_sales,
      key: "net_sales",
      label: "Net sales",
      value: metrics.net_sales,
      formatter: money,
      money: true,
    },
    {
      comparison: metrics.comparison_units_sold,
      key: "units_sold",
      label: "Units sold",
      value: metrics.units_sold,
      formatter: (value: number) => value.toLocaleString(),
      money: false,
    },
    {
      comparison: metrics.comparison_known_gross_profit,
      key: "known_gross_profit",
      label: "Known merchandise profit",
      value: metrics.known_gross_profit,
      formatter: money,
      money: true,
      helper:
        coverage == null
          ? "Cost coverage unavailable"
          : `${(coverage / 100).toFixed(0)}% cost coverage`,
    },
    {
      comparison: null,
      key: "inventory_value",
      label: "Current inventory value",
      value: metrics.inventory_value,
      formatter: money,
      money: true,
      helper:
        metrics.uncosted_on_hand_quantity &&
        metrics.uncosted_on_hand_quantity > 0
          ? `${metrics.uncosted_on_hand_quantity.toLocaleString()} units uncosted`
          : "Current as of the latest inventory projection",
    },
  ];

  return (
    <section aria-labelledby="reports-pulse-title">
      <h2 className="text-lg font-semibold" id="reports-pulse-title">
        Store pulse
      </h2>
      <div className="mt-layout-sm grid grid-cols-1 gap-layout-sm sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <OperationsSummaryMetric
            helper={
              withholdMoney && card.money
                ? "Currencies cannot be combined"
                : (card.helper ??
                  comparisonText(card.value, card.comparison, card.formatter))
            }
            key={card.key}
            label={card.label}
            value={
              card.value == null || (withholdMoney && card.money)
                ? "—"
                : card.formatter(card.value)
            }
          />
        ))}
      </div>
    </section>
  );
}
