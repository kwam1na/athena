'use client';

import { Key } from 'react';

import { ColumnDef, flexRender } from '@tanstack/react-table';

import {
   Table,
   TableBody,
   TableCell,
   TableHead,
   TableHeader,
   TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { DataTablePagination } from './data-table-pagination';

interface DataTableProps<TData, TValue> {
   columns: ColumnDef<TData, TValue>[];
   table: any;
}

export function DataTable<TData, TValue>({
   columns,
   table,
}: DataTableProps<TData, TValue>) {
   return (
      <div className="space-y-4">
         <div className="rounded-md border">
            <Table>
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
                                               header.column.columnDef.header,
                                               header.getContext(),
                                            )}
                                    </TableHead>
                                 );
                              })}
                           </TableRow>
                        ),
                     )}
               </TableHeader>
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
                                 data-state={row.getIsSelected() && 'selected'}
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
            </Table>
         </div>
         <DataTablePagination table={table} />
      </div>
   );
}
