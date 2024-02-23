'use client';

import { ColumnDef } from '@tanstack/react-table';
import { ViewDataTableCellAction } from './view-data-table-cell-action';
import {
   InStockBadge,
   InStockIndicator,
   LowStockBadge,
   LowStockIndicator,
   SoldOutBadge,
   SoldOutIndicator,
} from '@/components/ui/stock-status-badge';

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
      cell: ({ row }) => {
         let BadgeComponent;
         switch (row.original.stockStatus) {
            case 'In stock':
               BadgeComponent = InStockIndicator;
               break;
            case 'Low in stock':
               BadgeComponent = LowStockIndicator;
               break;
            case 'Out of stock':
               BadgeComponent = SoldOutIndicator;
               break;
            default:
               BadgeComponent = null;
         }

         return (
            <div className="flex items-center gap-x-2">
               {BadgeComponent ? <BadgeComponent /> : row.original.stockStatus}
            </div>
         );
      },
   },
   {
      id: 'actions',
      cell: ({ row }) => <ViewDataTableCellAction data={row.original} />,
   },
];
