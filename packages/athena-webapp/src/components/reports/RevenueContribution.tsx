import { formatMinorUnits } from "./reportPresentation";

export function RevenueContribution({
  currency = "USD",
  minorUnitScale = 2,
  metrics,
  withholdMoney = false,
}: {
  currency?: string;
  minorUnitScale?: number;
  metrics: Record<string, number | null | undefined>;
  withholdMoney?: boolean;
}) {
  const rows = [
    ["POS merchandise", metrics.pos_merchandise_revenue],
    ["Storefront merchandise", metrics.storefront_merchandise_revenue],
    ["Services", metrics.service_revenue],
    ["Refunds", metrics.refunds],
  ] as const;
  if (withholdMoney || !rows.some(([, value]) => value != null)) return null;
  return (
    <section
      aria-labelledby="revenue-contribution-title"
      className="rounded-lg border border-border bg-surface p-layout-md"
    >
      <h2 className="font-semibold" id="revenue-contribution-title">
        Revenue contribution
      </h2>
      <dl className="mt-layout-sm divide-y divide-border text-sm">
        {rows.map(([label, value]) => (
          <div
            className="flex items-center justify-between gap-layout-md py-2"
            key={label}
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">
              {value == null
                ? "—"
                : formatMinorUnits({
                    amountMinor: value,
                    currency,
                    minorUnitScale,
                  })}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
