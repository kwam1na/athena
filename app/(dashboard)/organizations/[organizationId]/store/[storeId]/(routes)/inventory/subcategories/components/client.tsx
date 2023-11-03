'use client';

import {
   ColumnFiltersState,
   SortingState,
   VisibilityState,
   getCoreRowModel,
   getFacetedRowModel,
   getFacetedUniqueValues,
   getFilteredRowModel,
   getPaginationRowModel,
   getSortedRowModel,
   useReactTable,
} from '@tanstack/react-table';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Heading } from '@/components/ui/heading';
import { Separator } from '@/components/ui/separator';

import { columns, SubcategoryColumn } from './columns';
import { useState } from 'react';
import { DataTableToolbar } from '@/components/ui/data-table-toolbar/products-table-toolbar';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';

interface SubcategoriesClientProps {
   data: SubcategoryColumn[];
   categoryOptions?: {
      label: string;
      value: string;
      icon?: React.ComponentType<{ className?: string }>;
   }[];
   storeName: string;
}

export const SubcategoriesClient: React.FC<SubcategoriesClientProps> = ({
   data,
   categoryOptions,
   storeName,
}) => {
   const router = useRouter();
   const baseStoreURL = useGetBaseStoreUrl();

   const [sorting, setSorting] = useState<SortingState>([]);
   const [rowSelection, setRowSelection] = useState({});
   const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
      {},
   );
   const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

   const table = useReactTable({
      data,
      columns,
      state: {
         sorting,
         rowSelection,
         columnVisibility,
         columnFilters,
      },
      enableRowSelection: true,
      onRowSelectionChange: setRowSelection,
      onSortingChange: setSorting,
      onColumnFiltersChange: setColumnFilters,
      onColumnVisibilityChange: setColumnVisibility,
      getCoreRowModel: getCoreRowModel(),
      getFilteredRowModel: getFilteredRowModel(),
      getPaginationRowModel: getPaginationRowModel(),
      getSortedRowModel: getSortedRowModel(),
      getFacetedRowModel: getFacetedRowModel(),
      getFacetedUniqueValues: getFacetedUniqueValues(),
   });

   return (
      <>
         <div className="flex items-center justify-between">
            <Heading
               title={`Subcategories`}
               description={`Manage subcategories for ${storeName}`}
            />
            <Button
               onClick={() =>
                  router.push(`${baseStoreURL}/inventory/subcategories/new`)
               }
            >
               <Plus className="mr-2 h-4 w-4" /> Add new
            </Button>
         </div>
         <Separator />
         <DataTableToolbar
            searchKey="name"
            tableKey="subcategories"
            table={table}
            categoryOptions={categoryOptions}
         />
         <DataTable table={table} columns={columns} />
      </>
   );
};
