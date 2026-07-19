import {
  ColumnDef,
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
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
} from "../../../ui/table";

import { DataTablePagination } from "./data-table-pagination";
import { DataTableToolbar } from "./data-table-toolbar";
import { AddProductCommand } from "./add-product-command";
import { KeyboardEvent, MouseEvent, useEffect, useState } from "react";
import { cn } from "~/src/lib/utils";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  onPageIndexChange?: (pageIndex: number) => void;
  onRowClick?: (row: Row<TData>) => void;
  pageIndex?: number;
  showToolbar?: boolean;
}

const PRODUCT_TABLE_PAGE_SIZE = 10;

export function DataTable<TData, TValue>({
  columns,
  data,
  onPageIndexChange,
  onRowClick,
  pageIndex,
  showToolbar = true,
}: DataTableProps<TData, TValue>) {
  const [rowSelection, setRowSelection] = useState({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: pageIndex ?? 0,
    pageSize: PRODUCT_TABLE_PAGE_SIZE,
  });

  useEffect(() => {
    if (pageIndex === undefined) return;

    setPagination((current) => {
      if (
        current.pageIndex === pageIndex &&
        current.pageSize === PRODUCT_TABLE_PAGE_SIZE
      ) {
        return current;
      }

      return {
        pageIndex,
        pageSize: PRODUCT_TABLE_PAGE_SIZE,
      };
    });
  }, [pageIndex]);

  const handlePaginationChange: OnChangeFn<PaginationState> = (updater) => {
    setPagination((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      const normalized = {
        pageIndex: next.pageIndex,
        pageSize: PRODUCT_TABLE_PAGE_SIZE,
      };

      if (normalized.pageIndex !== current.pageIndex) {
        onPageIndexChange?.(normalized.pageIndex);
      }

      return normalized;
    });
  };

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
    onPaginationChange: handlePaginationChange,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  const handleRowClick = (
    event: MouseEvent<HTMLTableRowElement>,
    row: Row<TData>,
  ) => {
    const target = event.target;

    if (target instanceof Element) {
      const interactiveAncestor = target.closest(
        "a, button, input, select, textarea, [role='button'], [role='link'], [role='menuitem'], [contenteditable='true']",
      );

      if (interactiveAncestor && interactiveAncestor !== event.currentTarget) {
        return;
      }
    }

    onRowClick?.(row);
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    row: Row<TData>,
  ) => {
    if (event.target !== event.currentTarget || event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    onRowClick?.(row);
  };

  // React.useEffect(() => {
  //   table.getColumn("subcategoryId")?.toggleVisibility(false);
  // }, [table]);

  return (
    <div className="space-y-4">
      <AddProductCommand table={table} />
      {showToolbar && <DataTableToolbar table={table} />}
      {/* <div className="flex">
        <ProductSubcategoryToggleGroup />
      </div> */}
      <div className="rounded-md border">
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
                            header.getContext(),
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
                    onRowClick &&
                      "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  )}
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  onClick={
                    onRowClick
                      ? (event) => handleRowClick(event, row)
                      : undefined
                  }
                  onKeyDown={
                    onRowClick
                      ? (event) => handleRowKeyDown(event, row)
                      : undefined
                  }
                  role={onRowClick ? "link" : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
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
      <DataTablePagination table={table} itemLabel="product" />
    </div>
  );
}
