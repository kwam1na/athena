import { useMemo, useState } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { toDisplayAmount } from "~/convex/lib/currency";
import { useGetCurrencyFormatter } from "~/src/hooks/useGetCurrencyFormatter";
import { getProductName } from "~/src/lib/productUtils";
import type { PreviewRow } from "~/src/hooks/useBulkOperations";

interface BulkOperationsPreviewProps {
  previewRows: PreviewRow[];
  excludedSkuIds: Set<string>;
  selectedCount: number;
  validSelectedCount: number;
  isApplying: boolean;
  onToggleExclusion: (skuId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onApply: () => void;
}

export function BulkOperationsPreview({
  previewRows,
  excludedSkuIds,
  selectedCount,
  validSelectedCount,
  isApplying,
  onToggleExclusion,
  onSelectAll,
  onDeselectAll,
  onApply,
}: BulkOperationsPreviewProps) {
  const currencyFormatter = useGetCurrencyFormatter();

  const formatPrice = (pesewas: number): string => {
    const displayAmount = toDisplayAmount(pesewas);
    return currencyFormatter.format(displayAmount);
  };

  const allSelected = excludedSkuIds.size === 0;
  const noneSelected = excludedSkuIds.size === previewRows.length;

  const columns = useMemo<ColumnDef<PreviewRow>[]>(
    () => [
      {
        id: "select",
        header: () => (
          <Checkbox
            checked={allSelected}
            onCheckedChange={() => {
              if (allSelected) {
                onDeselectAll();
              } else {
                onSelectAll();
              }
            }}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={!excludedSkuIds.has(row.original.skuId)}
            onCheckedChange={() => onToggleExclusion(row.original.skuId)}
            aria-label={`Select ${row.original.productName}`}
          />
        ),
        size: 40,
      },
      {
        id: "productName",
        header: "Product",
        cell: ({ row }) =>
          getProductName({
            productName: row.original.productName,
            productCategory: row.original.productCategory,
            colorName: row.original.colorName,
            length: row.original.length,
          }),
      },
      {
        accessorKey: "sku",
        header: "SKU",
      },
      {
        id: "variant",
        header: "Variant",
        cell: ({ row }) => {
          const parts = [row.original.colorName, row.original.size].filter(
            Boolean
          );
          return parts.length > 0 ? parts.join(" / ") : "-";
        },
      },
      {
        id: "currentPrice",
        header: "Current Price",
        cell: ({ row }) => formatPrice(row.original.currentNetPricePesewas),
      },
      {
        id: "arrow",
        header: "",
        cell: () => <ArrowRight className="w-4 h-4 text-muted-foreground" />,
        size: 40,
      },
      {
        id: "newPrice",
        header: "New Price",
        cell: ({ row }) => {
          const { newNetPricePesewas, hasWarning } = row.original;
          return (
            <div className="flex items-center gap-2">
              <span className={hasWarning ? "text-destructive font-medium" : ""}>
                {formatPrice(newNetPricePesewas)}
              </span>
              {hasWarning && (
                <AlertTriangle className="w-4 h-4 text-destructive" />
              )}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [excludedSkuIds, allSelected, onSelectAll, onDeselectAll, onToggleExclusion, currencyFormatter]
  );

  const table = useReactTable({
    data: previewRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: 20 },
    },
  });

  if (previewRows.length === 0) return null;

  const warningCount = previewRows.filter((r) => r.hasWarning).length;

  return (
    <div className="space-y-4 border rounded-lg">
      <div className="rounded-md">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={
                    excludedSkuIds.has(row.original.skuId) ? "opacity-50" : ""
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between px-6 py-2">
          <p className="text-sm text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Summary Bar */}
      <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/50 rounded-b-lg">
        <div className="flex items-center gap-4">
          <p className="text-sm font-medium">
            {selectedCount} of {previewRows.length} SKU
            {previewRows.length !== 1 ? "s" : ""} selected
          </p>
          {warningCount > 0 && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" />
              {warningCount} with invalid price (will be skipped)
            </p>
          )}
        </div>
        <Button
          onClick={onApply}
          disabled={validSelectedCount === 0 || isApplying}
        >
          {isApplying ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Applying...
            </>
          ) : (
            `Apply Changes (${validSelectedCount})`
          )}
        </Button>
      </div>
    </div>
  );
}
