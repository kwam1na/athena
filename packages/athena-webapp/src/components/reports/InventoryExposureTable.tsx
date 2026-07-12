import type { ColumnDef } from "@tanstack/react-table";
import { GenericDataTable } from "@/components/base/table/data-table";
import type { InventoryMovement } from "./InventoryMovementSummary";
import { formatMinorUnits } from "./reportPresentation";

export type InventoryExposureRow = {
  productSkuId: string;
  asOf: number;
  completeness: string;
  limitingReason?: string;
  identity?: {
    product?: { name?: string } | null;
    sku?: { sku?: string } | null;
  };
  metrics: Record<string, number | null>;
  movement?: InventoryMovement | null;
  valuationCurrencyCode?: string | null;
  valuationCurrencyMinorUnitScale?: number | null;
};
const name = (row: InventoryExposureRow) =>
  row.identity?.product?.name ?? "Historical item";
const coverage = (row: InventoryExposureRow) =>
  `${row.metrics.uncostedOnHandQuantity ?? 0} units uncosted`;
const value = (row: InventoryExposureRow) => {
  const amountMinor = row.metrics.knownInventoryValueMinor;
  if (row.limitingReason === "mixed_currency") return "Mixed currencies";
  if (
    amountMinor === null ||
    !row.valuationCurrencyCode ||
    row.valuationCurrencyMinorUnitScale === null ||
    row.valuationCurrencyMinorUnitScale === undefined
  )
    return "Value unavailable";
  return formatMinorUnits({
    amountMinor,
    currency: row.valuationCurrencyCode,
    minorUnitScale: row.valuationCurrencyMinorUnitScale,
  });
};
const columns: ColumnDef<InventoryExposureRow>[] = [
  {
    id: "item",
    header: "Item",
    cell: ({ row }) => (
      <div>
        <p className="font-medium">{name(row.original)}</p>
        <p className="text-xs text-muted-foreground">
          {row.original.identity?.sku?.sku ?? "SKU unavailable"}
        </p>
      </div>
    ),
  },
  {
    id: "position",
    header: "Current position",
    cell: ({ row }) =>
      `${row.original.metrics.onHandQuantity ?? "—"} on hand · ${row.original.metrics.sellableQuantity ?? "—"} sellable`,
  },
  {
    id: "value",
    header: "Known value",
    cell: ({ row }) => value(row.original),
  },
  {
    id: "coverage",
    header: "Coverage",
    cell: ({ row }) => coverage(row.original),
  },
];
export function InventoryExposureTable({
  rows,
}: {
  rows: InventoryExposureRow[];
}) {
  return (
    <GenericDataTable
      columns={columns}
      data={rows}
      paginationRangeItemLabel="item"
      paginationRangeItemPluralLabel="items"
      renderMobileCard={(row) => (
        <article className="rounded-lg border border-border bg-surface p-layout-md">
          <p className="font-medium">{name(row)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {row.identity?.sku?.sku ?? "SKU unavailable"}
          </p>
          <p className="mt-3 text-sm">
            {row.metrics.onHandQuantity ?? "—"} on hand ·{" "}
            {row.metrics.sellableQuantity ?? "—"} sellable
          </p>
          <p className="mt-1 text-sm">{value(row)} known value</p>
          <p className="mt-1 text-xs text-muted-foreground">{coverage(row)}</p>
        </article>
      )}
      showPagination={false}
      tableId="reports-inventory-table"
    />
  );
}
