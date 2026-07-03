import * as React from "react";
import {
  ColumnDef,
  ColumnFiltersState,
  Row,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/table";

import { DataTablePagination } from "./data-table-pagination";
import { usePaginationPersistence } from "~/src/hooks/use-pagination-persistence";
import { cn } from "@/lib/utils";

interface DataTableProps<TData, TValue> {
  autoResetPageIndex?: boolean;
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  emptyState?: React.ReactNode;
  getRowClassName?: (row: Row<TData>) => string | undefined;
  isLoadingMore?: boolean;
  renderMobileCard?: (row: TData, tableRow: Row<TData>) => React.ReactNode;
  pageIndex?: number;
  onLoadMore?: () => void;
  onPageIndexChange?: (pageIndex: number) => void;
  onRowClick?: (row: Row<TData>) => void;
  paginationRangeItemLabel?: string;
  paginationRangeItemPluralLabel?: string;
  showPagination?: boolean;
  tableId: string; // Unique identifier for localStorage keys
}

export function GenericDataTable<TData, TValue>({
  autoResetPageIndex,
  columns,
  data,
  emptyState,
  getRowClassName,
  isLoadingMore,
  renderMobileCard,
  pageIndex,
  onLoadMore,
  onPageIndexChange,
  onRowClick,
  paginationRangeItemLabel,
  paginationRangeItemPluralLabel,
  showPagination = true,
  tableId,
}: DataTableProps<TData, TValue>) {
  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [sorting, setSorting] = React.useState<SortingState>([]);

  // Use the pagination persistence hook
  const { pagination, setPagination } = usePaginationPersistence({
    controlledPageIndex: pageIndex,
    tableId,
    defaultPageSize: 10,
    onPageIndexChange,
  });

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    autoResetPageIndex,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  return (
    <div className="space-y-4">
      {/* {showToolbar && <DataTableToolbar table={table} />} */}
      {renderMobileCard ? (
        <div
          className="grid gap-layout-sm md:hidden"
          data-testid={`${tableId}-mobile-cards`}
        >
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <React.Fragment key={row.id}>
                {renderMobileCard(row.original, row)}
              </React.Fragment>
            ))
          ) : (
            <div className="rounded-md border border-border p-layout-md text-center text-sm text-muted-foreground">
              {emptyState ?? "No results."}
            </div>
          )}
        </div>
      ) : null}
      <div
        className={cn(
          "rounded-md border",
          renderMobileCard && "hidden md:block",
        )}
      >
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  className={cn(
                    onRowClick ? "cursor-pointer" : undefined,
                    getRowClassName?.(row)
                  )}
                  key={row.id}
                  onClick={() => onRowClick?.(row)}
                  data-state={row.getIsSelected() && "selected"}
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
                  {emptyState ?? "No results."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {showPagination ? (
        <DataTablePagination
          isLoadingMore={isLoadingMore}
          onLoadMore={onLoadMore}
          rangeItemLabel={paginationRangeItemLabel}
          rangeItemPluralLabel={paginationRangeItemPluralLabel}
          table={table}
        />
      ) : null}
    </div>
  );
}
