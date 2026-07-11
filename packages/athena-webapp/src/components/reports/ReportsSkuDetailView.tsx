import { useEffect } from "react";
import { ReportStatusBand } from "./ReportStatusBand";
import { formatMinorUnits, getReportStatusKind } from "./reportPresentation";
import {
  ReportsSkuEvidenceList,
  type ReportEvidenceRow,
} from "./ReportsSkuEvidenceList";

export type ReportItemDetail = {
  identity?: {
    product?: { name?: string } | null;
    sku?: { sku?: string } | null;
  };
  inventory?: {
    metrics?: Record<string, number | null>;
    valuationCurrencyCode?: string | null;
    valuationCurrencyMinorUnitScale?: number | null;
  } | null;
  inventoryLimitingReason?: string | null;
  movement?: { metrics?: Record<string, number | null> } | null;
  periodSummary?: {
    metrics?: Record<string, number | null>;
    revenueCurrencyCode?: string | null;
    revenueCurrencyMinorUnitScale?: number | null;
    rangeEndDate?: string;
    rangeStartDate?: string;
  } | null;
  status: string;
  trust?: { completeness?: string; limitingReason?: string | null };
  period?: { endOperatingDate: string; startOperatingDate: string };
  periodEnd?: number;
  periodStart?: number;
};

function metric(value: number | null | undefined) {
  return value ?? "Unavailable";
}

function money(
  value: number | null | undefined,
  currency?: string | null,
  minorUnitScale?: number | null,
) {
  if (value == null || !currency || minorUnitScale == null)
    return "Amount unavailable";
  return formatMinorUnits({ amountMinor: value, currency, minorUnitScale });
}

export function ReportsSkuDetailView({
  detail,
  evidence,
  loadEvidence,
  productSkuId,
  title,
}: {
  detail?: ReportItemDetail | null;
  evidence: { isDone: boolean; page: ReportEvidenceRow[] } | null | undefined;
  loadEvidence: () => void;
  productSkuId: string;
  title?: string;
}) {
  const detailStatus = detail?.status;
  useEffect(() => {
    if (
      detailStatus &&
      !["materializing", "pre_cutover", "unavailable"].includes(detailStatus)
    )
      loadEvidence();
  }, [detailStatus, loadEvidence, productSkuId]);
  if (detail === undefined)
    return (
      <p aria-live="polite" className="py-layout-lg" role="status">
        Loading item report…
      </p>
    );
  if (
    detail === null ||
    detail.status === "pre_cutover" ||
    detail.status === "unavailable" ||
    detail.status === "materializing"
  )
    return (
      <div className="py-layout-lg">
        <ReportStatusBand
          kind={getReportStatusKind({
            status: detail?.status ?? "unavailable",
          })}
        />
      </div>
    );
  const itemTitle =
    detail.identity?.product?.name ?? title ?? "Historical item";
  const sku = detail.identity?.sku?.sku ?? productSkuId;
  const period = detail.periodSummary?.metrics ?? {};
  const inventory = detail.inventory?.metrics ?? {};
  const movement = detail.movement?.metrics ?? {};
  const revenueCurrency = detail.periodSummary?.revenueCurrencyCode;
  const revenueScale = detail.periodSummary?.revenueCurrencyMinorUnitScale;
  const statusKind = getReportStatusKind({
    completeness: detail.trust?.completeness,
    inventoryLimitingReason: detail.inventoryLimitingReason,
    limitingReason: detail.trust?.limitingReason,
    status: detail.status,
  });
  return (
    <section
      aria-labelledby="reports-item-detail-heading"
      className="space-y-layout-lg py-layout-lg"
    >
      <ReportStatusBand kind={statusKind} />
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          SKU report
        </p>
        <h2
          className="mt-2 text-balance font-display text-3xl"
          id="reports-item-detail-heading"
        >
          {itemTitle}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{sku}</p>
      </div>
      <section aria-labelledby="item-period-heading">
        <h3 className="font-display text-xl" id="item-period-heading">
          Selected-period performance
        </h3>
        <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric
            label="Net sales"
            value={money(period.netRevenueMinor, revenueCurrency, revenueScale)}
          />
          <Metric label="Net units" value={metric(period.netSoldUnits)} />
          <Metric
            label="Known gross profit"
            value={money(
              period.knownGrossProfitMinor,
              revenueCurrency,
              revenueScale,
            )}
          />
          <Metric
            label="Cost coverage"
            value={
              period.costCoverageBasisPoints == null
                ? "Unavailable"
                : `${Math.round(period.costCoverageBasisPoints / 100)}%`
            }
          />
        </dl>
      </section>
      <section aria-labelledby="item-inventory-heading">
        <h3 className="font-display text-xl" id="item-inventory-heading">
          Inventory position
        </h3>
        {detail.inventory ? (
          <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="On hand" value={metric(inventory.onHandQuantity)} />
            <Metric
              label="Sellable"
              value={metric(inventory.sellableQuantity)}
            />
            <Metric
              label="Known value"
              value={money(
                inventory.knownInventoryValueMinor,
                detail.inventory.valuationCurrencyCode,
                detail.inventory.valuationCurrencyMinorUnitScale,
              )}
            />
            <Metric
              label="Sales movement"
              value={metric(movement.salesQuantity)}
            />
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Current inventory is unavailable for this item. Period performance
            remains available.
          </p>
        )}
      </section>
      <section aria-labelledby="item-evidence-heading">
        <h3 className="font-display text-xl" id="item-evidence-heading">
          Source evidence
        </h3>
        <div className="mt-3">
          {evidence === undefined ? (
            <p aria-live="polite" role="status">
              Loading item evidence…
            </p>
          ) : evidence === null ? (
            <p className="text-sm text-muted-foreground">
              Item evidence is unavailable.
            </p>
          ) : (
            <ReportsSkuEvidenceList rows={evidence.page} />
          )}
        </div>
      </section>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-numeric text-lg tabular-nums">{value}</dd>
    </div>
  );
}
