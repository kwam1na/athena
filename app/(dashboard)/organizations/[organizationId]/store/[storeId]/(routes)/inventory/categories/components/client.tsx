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

import { columns, CategoryColumn } from './columns';
import { useState } from 'react';
import { DataTableToolbar } from '@/components/ui/data-table-toolbar/products-table-toolbar';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import { motion } from 'framer-motion';
import { mainContainerVariants, widgetVariants } from '@/lib/constants';

interface CategoriesClientProps {
   data: CategoryColumn[];
   storeName: string;
}

export const CategoriesClient: React.FC<CategoriesClientProps> = ({
   data,
   storeName,
}) => {
   const params = useParams();
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

   const defaultHiddenColumns = ['createdAt', 'updatedAt'];

   return (
      <div className="space-y-8">
         <motion.div
            className="flex items-center justify-between"
            variants={widgetVariants}
            initial="hidden"
            animate="visible"
         >
            <Heading
               title={`Categories`}
               description={`Manage categories for ${storeName}`}
            />
            <Button
               onClick={() =>
                  router.push(`${baseStoreURL}/inventory/categories/new`)
               }
            >
               <Plus className="mr-2 h-4 w-4" /> Add new
            </Button>
         </motion.div>

         <Separator />

         <motion.div
            className="space-y-8"
            variants={mainContainerVariants}
            initial="hidden"
            animate="visible"
         >
            <DataTableToolbar
               searchKey="name"
               tableKey="categories"
               table={table}
            />
            <DataTable
               columns={columns}
               table={table}
               tableKey="categories"
               defaultHiddenColumns={defaultHiddenColumns}
            />
         </motion.div>
      </div>
   );
};
