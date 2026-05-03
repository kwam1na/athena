import { Table } from "@tanstack/react-table";

import { Button } from "../../ui/button";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
} from "lucide-react";
import { useTableKeyboardPagination } from "~/src/hooks/use-table-keyboard-pagination";

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  itemLabel?: string;
  rangeItemLabel?: string;
  rangeItemPluralLabel?: string;
  onLoadMore?: () => void;
}

export function DataTablePagination<TData>({
  table,
  itemLabel,
  rangeItemLabel,
  rangeItemPluralLabel,
  onLoadMore,
}: DataTablePaginationProps<TData>) {
  useTableKeyboardPagination(table);

  const rowCount = table.getRowCount();
  const { pageIndex, pageSize } = table.getState().pagination;
  const visibleStart = rowCount === 0 ? 0 : pageIndex * pageSize + 1;
  const visibleEnd = Math.min(rowCount, (pageIndex + 1) * pageSize);
  const rangeLabel =
    rowCount === 1
      ? rangeItemLabel
      : (rangeItemPluralLabel ?? (rangeItemLabel ? `${rangeItemLabel}s` : ""));

  return (
    <div className="flex items-center justify-between px-2">
      {itemLabel && (
        <div className="flex-1 text-sm text-muted-foreground">
          {rowCount} {rowCount === 1 ? itemLabel : `${itemLabel}s`}
        </div>
      )}
      <div className="flex items-center ml-auto space-x-6 lg:space-x-8">
        {rangeItemLabel ? (
          <div className="flex items-center justify-center text-sm font-medium">
            Showing {visibleStart}-{visibleEnd} of {rowCount} {rangeLabel}
          </div>
        ) : (
          Boolean(table.getPageCount()) && (
            <div className="flex w-[100px] items-center justify-center text-sm font-medium">
              Page {table.getState().pagination.pageIndex + 1} of{" "}
              {table.getPageCount()}
            </div>
          )
        )}
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to first page</span>
            <ChevronsLeft />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to last page</span>
            <ChevronsRight />
          </Button>
          {onLoadMore && (
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              onClick={onLoadMore}
            >
              <span className="sr-only">Load more</span>
              <RefreshCw />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
