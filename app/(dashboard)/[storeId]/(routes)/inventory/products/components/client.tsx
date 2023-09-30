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
import { useParams, useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Heading } from '@/components/ui/heading';
import { Separator } from '@/components/ui/separator';

import { ProductColumn, columns } from './columns';
import { useState } from 'react';
import { DataTableToolbar } from '@/components/ui/data-table-toolbar/products-table-toolbar';

interface ProductsClientProps {
   data: ProductColumn[];
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
}

export const ProductsClient: React.FC<ProductsClientProps> = ({
   data,
   categoryOptions,
   subcategoryOptions,
}) => {
   const params = useParams();
   const router = useRouter();

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
               title={`Products`}
               description="Manage products for your store"
            />
            <Button
               onClick={() =>
                  router.push(`/${params.storeId}/inventory/products/new`)
               }
            >
               <Plus className="mr-2 h-4 w-4" /> Add New
            </Button>
         </div>
         <Separator />
         <DataTableToolbar
            searchKey="name"
            tableKey="products"
            table={table}
            categoryOptions={categoryOptions}
            subcategoryOptions={subcategoryOptions}
         />
         <DataTable columns={columns} table={table} />
      </>
   );
};
