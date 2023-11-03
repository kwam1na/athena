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

import { DataTable } from '@/components/ui/data-table';
import { useEffect, useState } from 'react';

interface ViewDataTableClient {
   additionalData?: Record<string, any>;
   columns: any[];
   data: any[];
   type: 'low-stock-products' | 'top-selling-products';
}

export const ViewDataTableClient: React.FC<ViewDataTableClient> = ({
   additionalData,
   columns,
   data,
   type,
}) => {
   const [sorting, setSorting] = useState<SortingState>([]);
   const [rowSelection, setRowSelection] = useState({});
   const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
      {},
   );
   const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
   const [formattedItems, setFormattedItems] = useState<any[]>([]);

   const getFormattedItems = () => {
      switch (type) {
         case 'low-stock-products':
            const { low_stock_threshold } = additionalData || {};
            const items = data?.map((product) => {
               return {
                  id: product.id,
                  name: product.name,
                  sku: product.sku,
                  inventoryCount: product.inventory_count,
                  lowStockThreshold: low_stock_threshold,
                  stockStatus:
                     product.inventory_count === 0
                        ? 'Out of stock'
                        : product.inventory_count <= low_stock_threshold
                        ? 'Low in stock'
                        : 'In stock',
                  setFormattedItems: setFormattedItems,
               };
            });
            setFormattedItems(items);
            break;

         case 'top-selling-products':
            setFormattedItems(data);
            break;

         default:
            return;
      }
   };

   useEffect(() => {
      getFormattedItems();
   }, []);

   const table = useReactTable({
      data: formattedItems,
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
         <DataTable
            columns={columns}
            table={table}
            showHeader={false}
            showPagination={false}
         />
      </>
   );
};
