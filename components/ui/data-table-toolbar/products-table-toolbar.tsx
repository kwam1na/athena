'use client';

import { Table } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTableViewOptions } from './products-table-view-options';

import { DataTableFacetedFilter } from './products-table-faceted-filter';
import { X } from 'lucide-react';

interface DataTableToolbarProps<TData> {
   searchKey: string;
   table: Table<TData>;
   tableKey: string;
   placeholder?: string;
   categoryOptions?: {
      label: string;
      value: string;
      icon?: React.ComponentType<{ className?: string }>;
   }[];
   subcategoryOptions?: {
      label: string;
      value: string;
      icon?: React.ComponentType<{ className?: string }>;
   }[];
   defaultHiddenColumns?: string[];
}

export function DataTableToolbar<TData>({
   defaultHiddenColumns,
   searchKey,
   table,
   tableKey,
   placeholder,
   categoryOptions,
   subcategoryOptions,
}: DataTableToolbarProps<TData>) {
   const isFiltered = table.getState().columnFilters.length > 0;

   return (
      <div className="flex items-center justify-between">
         <div className="flex flex-1 items-center space-x-2">
            <Input
               placeholder={placeholder || 'Filter items...'}
               value={
                  (table.getColumn(searchKey)?.getFilterValue() as string) ?? ''
               }
               onChange={(event: any) =>
                  table.getColumn(searchKey)?.setFilterValue(event.target.value)
               }
               className="h-8 w-[150px] lg:w-[250px]"
            />
            {table.getColumn('category') && (
               <DataTableFacetedFilter
                  column={table.getColumn('category')}
                  title="Category"
                  options={categoryOptions || []}
               />
            )}
            {table.getColumn('subcategory') && (
               <DataTableFacetedFilter
                  column={table.getColumn('subcategory')}
                  title="Subcategory"
                  options={subcategoryOptions || []}
               />
            )}
            {isFiltered && (
               <Button
                  variant="ghost"
                  onClick={() => table.resetColumnFilters()}
                  className="h-8 px-2 lg:px-3"
               >
                  Reset
                  <X className="ml-2 h-4 w-4" />
               </Button>
            )}
         </div>
         <DataTableViewOptions table={table} tableKey={tableKey} />
      </div>
   );
}
