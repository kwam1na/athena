'use client';

import { Key, useEffect, useState } from 'react';

import { ColumnDef, flexRender } from '@tanstack/react-table';

import {
   Table,
   TableBody,
   TableCell,
   TableHead,
   TableHeader,
   TableRow,
} from '@/components/ui/table';
import { DataTablePagination } from './data-table-pagination';
import { useParams } from 'next/navigation';

interface DataTableProps<TData, TValue> {
   columns: ColumnDef<TData, TValue>[];
   table: any;
   tableKey: string;
   showHeader?: boolean;
   showPagination?: boolean;
   defaultHiddenColumns?: string[];
}

export function DataTable<TData, TValue>({
   columns,
   showHeader = true,
   showPagination = true,
   table,
   tableKey,
   defaultHiddenColumns,
}: DataTableProps<TData, TValue>) {
   const params = useParams();
   const visibilityMapKey = `${params.storeId}-table-${tableKey}-column-visibility`;
   const [showTable, setShowTable] = useState(false);

   useEffect(() => {
      const savedColumns = localStorage.getItem(visibilityMapKey);
      if (savedColumns) {
         const parsedColumns = JSON.parse(savedColumns);
         table.getAllColumns().forEach((column: any) => {
            if (parsedColumns[column.id] !== undefined) {
               column.toggleVisibility(parsedColumns[column.id]);
            }
         });
      } else if (defaultHiddenColumns) {
         defaultHiddenColumns.forEach((columnId) => {
            table.getColumn(columnId)?.toggleVisibility(false);
         });
      }
      setShowTable(true);
   }, []);

   return (
      <div className="space-y-4">
         <div className="rounded-md border">
            <Table>
               {showHeader && (
                  <TableHeader>
                     {table
                        .getHeaderGroups()
                        .map(
                           (headerGroup: {
                              id: Key | null | undefined;
                              headers: any[];
                           }) => (
                              <TableRow key={headerGroup.id}>
                                 {headerGroup.headers.map((header) => {
                                    return (
                                       <TableHead key={header.id}>
                                          {header.isPlaceholder
                                             ? null
                                             : flexRender(
                                                  header.column.columnDef
                                                     .header,
                                                  header.getContext(),
                                               )}
                                       </TableHead>
                                    );
                                 })}
                              </TableRow>
                           ),
                        )}
                  </TableHeader>
               )}
               {showTable && (
                  <TableBody>
                     {table.getRowModel().rows?.length ? (
                        table
                           .getRowModel()
                           .rows.map(
                              (row: {
                                 id: Key | null | undefined;
                                 getIsSelected: () => any;
                                 getVisibleCells: () => any[];
                              }) => (
                                 <TableRow
                                    key={row.id}
                                    data-state={
                                       row.getIsSelected() && 'selected'
                                    }
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
                              ),
                           )
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
               )}
            </Table>
         </div>
         {showPagination && <DataTablePagination table={table} />}
      </div>
   );
}
