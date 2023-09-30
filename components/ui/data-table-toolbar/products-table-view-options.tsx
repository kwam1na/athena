'use client';

import { DropdownMenuTrigger } from '@radix-ui/react-dropdown-menu';
import { Table } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuCheckboxItem,
   DropdownMenuContent,
   DropdownMenuLabel,
   DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Settings2 } from 'lucide-react';
import { useEffect } from 'react';
import { useParams } from 'next/navigation';

interface DataTableViewOptionsProps<TData> {
   table: Table<TData>;
   tableKey: string;
}

export function DataTableViewOptions<TData>({
   table,
   tableKey,
}: DataTableViewOptionsProps<TData>) {
   const params = useParams();
   const visibilityMapKey = `${params.storeId}-table-${tableKey}-column-visibility`;

   useEffect(() => {
      const savedColumns = localStorage.getItem(visibilityMapKey);
      if (savedColumns) {
         const parsedColumns = JSON.parse(savedColumns);
         table.getAllColumns().forEach((column) => {
            if (parsedColumns[column.id] !== undefined) {
               column.toggleVisibility(parsedColumns[column.id]);
            }
         });
      }
   }, []);

   const handleCheckedChange = (columnId: string, value: boolean) => {
      const savedColumns = localStorage.getItem('columnVisibility') || '{}';
      const parsedColumns = JSON.parse(savedColumns);
      parsedColumns[columnId] = value;

      localStorage.setItem(visibilityMapKey, JSON.stringify(parsedColumns));
   };

   return (
      <DropdownMenu>
         <DropdownMenuTrigger asChild>
            <Button
               variant="outline"
               size="sm"
               className="ml-auto hidden h-8 lg:flex"
            >
               <Settings2 className="mr-2 h-4 w-4" />
               View
            </Button>
         </DropdownMenuTrigger>
         <DropdownMenuContent align="end" className="w-[150px]">
            <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
               .getAllColumns()
               .filter(
                  (column) =>
                     typeof column.accessorFn !== 'undefined' &&
                     column.getCanHide(),
               )
               .map((column) => {
                  return (
                     <DropdownMenuCheckboxItem
                        key={column.id}
                        className="capitalize"
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) => {
                           column.toggleVisibility(!!value);
                           handleCheckedChange(column.id, value);
                        }}
                     >
                        {column.id}
                     </DropdownMenuCheckboxItem>
                  );
               })}
         </DropdownMenuContent>
      </DropdownMenu>
   );
}
