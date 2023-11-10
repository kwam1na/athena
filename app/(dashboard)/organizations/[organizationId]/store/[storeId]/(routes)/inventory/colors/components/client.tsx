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

import { columns, ColorColumn } from './columns';
import { useState } from 'react';
import { DataTableToolbar } from '@/components/ui/data-table-toolbar/products-table-toolbar';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import { motion } from 'framer-motion';
import { mainContainerVariants } from '@/lib/constants';

interface ColorClientProps {
   data: ColorColumn[];
}

export const ColorClient: React.FC<ColorClientProps> = ({ data }) => {
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

   return (
      <motion.div
         variants={mainContainerVariants}
         initial="hidden"
         animate="visible"
         className="space-y-8"
      >
         <div className="flex items-center justify-between">
            <Heading
               title={`Colors`}
               description="Manage colors for your products"
            />
            <Button
               onClick={() =>
                  router.push(`${baseStoreURL}/inventory/colors/new`)
               }
            >
               <Plus className="mr-2 h-4 w-4" /> Add new
            </Button>
         </div>
         <Separator />
         <DataTableToolbar searchKey="name" tableKey="colors" table={table} />
         <DataTable columns={columns} table={table} />
      </motion.div>
   );
};
