import type { ColumnDef } from "@tanstack/react-table";
import { GenericDataTable } from "@/components/base/table/data-table";
import { formatMinorUnits } from "./reportPresentation";

export type ReportItemRow = {
  productSkuId: string;
  identity?: {
    product?: { name?: string; slug?: string } | null;
    sku?: { sku?: string } | null;
  };
  classifications: string[];
  completeness: string;
  limitingReason?: string;
  metrics: Record<string, number | null>;
  revenueCurrencyCode?: string | null;
  revenueCurrencyMinorUnitScale?: number | null;
  valuationCurrencyCode?: string | null;
  valuationCurrencyMinorUnitScale?: number | null;
  revenueSort: number;
  marginSort: number;
  unitsSort: number;
  coverSort: number;
  inventoryValueSort: number;
  attentionSort: number;
};

function identity(row: ReportItemRow) {
  return {
    name: row.identity?.product?.name ?? "Historical item",
    sku: row.identity?.sku?.sku ?? "SKU unavailable",
  };
}

function coverage(row: ReportItemRow) {
  const basisPoints = row.metrics.costCoverageBasisPoints;
  return basisPoints === null || basisPoints === undefined
    ? "Cost coverage unavailable"
    : `${Math.round(basisPoints / 100)}% cost coverage`;
}

function revenue(row: ReportItemRow) {
  const amountMinor = row.metrics.netRevenueMinor;
  if (row.limitingReason === "mixed_currency") return "Mixed currencies";
  if (
    amountMinor === null ||
    !row.revenueCurrencyCode ||
    row.revenueCurrencyMinorUnitScale === null ||
    row.revenueCurrencyMinorUnitScale === undefined
  )
    return "Amount unavailable";
  return formatMinorUnits({
    amountMinor,
    currency: row.revenueCurrencyCode,
    minorUnitScale: row.revenueCurrencyMinorUnitScale,
  });
}

function itemColumns(
  onOpenItem: (row: ReportItemRow) => void,
): ColumnDef<ReportItemRow>[] {
  return [
    {
      id: "item",
      header: "Item",
      cell: ({ row }) => (
        <button
          className="min-h-10 text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpenItem(row.original)}
          type="button"
        >
          <span className="block font-medium">
            {identity(row.original).name}
          </span>
          <span className="block text-xs text-muted-foreground">
            {identity(row.original).sku}
          </span>
        </button>
      ),
    },
    {
      id: "netSales",
      header: "Net sales",
      cell: ({ row }) => (
        <span className="font-numeric tabular-nums">
          {revenue(row.original)}
        </span>
      ),
    },
    {
      id: "units",
      header: "Net units",
      cell: ({ row }) => row.original.metrics.netSoldUnits ?? "—",
    },
    {
      id: "stock",
      header: "Stock / cover",
      cell: ({ row }) => (
        <span>
          {row.original.metrics.onHandQuantity ?? "—"} on hand ·{" "}
          {row.original.metrics.projectedDaysOfCover ?? "—"} days
        </span>
      ),
    },
    {
      id: "coverage",
      header: "Coverage",
      cell: ({ row }) => coverage(row.original),
    },
  ];
}

export function ReportsItemsTable({
  onOpenItem,
  rows,
}: {
  onOpenItem: (row: ReportItemRow) => void;
  rows: ReportItemRow[];
}) {
  return (
    <GenericDataTable
      columns={itemColumns(onOpenItem)}
      data={rows}
      paginationRangeItemLabel="item"
      paginationRangeItemPluralLabel="items"
      renderMobileCard={(row) => {
        const item = identity(row);
        return (
          <button
            className="min-h-10 w-full rounded-lg border border-border bg-surface p-layout-md text-left transition-transform active:scale-[0.96]"
            onClick={() => onOpenItem(row)}
            type="button"
          >
            <span className="font-medium">{item.name}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {item.sku}
            </span>
            <span className="mt-3 block text-sm">
              {revenue(row)} · {row.metrics.netSoldUnits ?? 0} net units
            </span>
            <span className="mt-1 block text-sm">
              {row.metrics.onHandQuantity ?? "—"} on hand ·{" "}
              {row.metrics.projectedDaysOfCover ?? "—"} days cover
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {coverage(row)}
            </span>
          </button>
        );
      }}
      showPagination={false}
      tableId="reports-items-table"
    />
  );
}
