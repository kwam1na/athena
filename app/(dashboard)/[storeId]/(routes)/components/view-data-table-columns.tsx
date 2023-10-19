'use client';

import { ColumnDef } from '@tanstack/react-table';
import { ViewDataTableCellAction } from './view-data-table-cell-action';

export type UnitsSoldColumn = {
   name: string;
   unitsSold: string;
};

export type LowStockProductsColumn = {
   id: string;
   name: string;
   sku: string;
   inventoryCount: number;
   stockStatus: string;
   lowStockThreshold: number;
   setFormattedItems: React.Dispatch<React.SetStateAction<any[]>>;
};

export const unitsSoldColumns: ColumnDef<UnitsSoldColumn>[] = [
   {
      accessorKey: 'name',
      header: 'Product',
   },
   {
      accessorKey: 'unitsSold',
      header: 'Units sold',
   },
];

export const lowStockProductsColumns: ColumnDef<LowStockProductsColumn>[] = [
   {
      accessorKey: 'sku',
      header: 'SKU',
   },
   {
      accessorKey: 'name',
      header: 'Product',
   },
   {
      accessorKey: 'inventoryCount',
      header: 'Inventory count',
   },
   {
      accessorKey: 'stockStatus',
      header: 'Stock status',
      cell: ({ row }) => (
         <div className="flex items-center gap-x-2">
            <div
               className="h-2 w-2 rounded-full"
               style={{
                  backgroundColor:
                     row.original.stockStatus === 'Out of stock'
                        ? 'darkred'
                        : row.original.stockStatus === 'Low in stock'
                        ? 'darkorange'
                        : 'darkgreen',
               }}
            />
            {row.original.stockStatus}
         </div>
      ),
   },
   {
      id: 'actions',
      cell: ({ row }) => <ViewDataTableCellAction data={row.original} />,
   },
];
