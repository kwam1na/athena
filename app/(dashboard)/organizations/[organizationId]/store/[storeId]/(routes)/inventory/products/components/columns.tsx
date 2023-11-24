'use client';

import { ColumnDef } from '@tanstack/react-table';
import { CellAction } from './cell-action';
import {
   InStockBadge,
   LowStockBadge,
   SoldOutBadge,
} from '@/components/ui/stock-status-badge';

export type ProductColumn = {
   id: string;
   name: string;
   stockStatus: string;
   price: string;
   costPerItem: string;
   margin: string;
   category: string;
   subcategory: string;
   sku: string;
   size: string;
   inventoryCount: number;
   color: string;
   createdAt: string;
   updatedAt: string;
   isFeatured: boolean;
   isArchived: boolean;
};

export const columns: ColumnDef<ProductColumn>[] = [
   {
      accessorKey: 'sku',
      header: 'SKU',
   },
   {
      accessorKey: 'name',
      header: 'Name',
   },
   {
      accessorKey: 'isArchived',
      header: 'Archived',
   },
   {
      accessorKey: 'price',
      header: 'Price',
   },
   {
      accessorKey: 'costPerItem',
      header: 'Cost',
   },
   {
      accessorKey: 'margin',
      header: 'Margin (%)',
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
               BadgeComponent = InStockBadge;
               break;
            case 'Low in stock':
               BadgeComponent = LowStockBadge;
               break;
            case 'Out of stock':
               BadgeComponent = SoldOutBadge;
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
      accessorKey: 'category',
      header: 'Category',
      filterFn: (row, id, value) => {
         return value.includes(row.getValue(id));
      },
   },
   {
      accessorKey: 'subcategory',
      header: 'Subategory',
      filterFn: (row, id, value) => {
         return value.includes(row.getValue(id));
      },
   },
   {
      accessorKey: 'size',
      header: 'Size',
   },
   {
      accessorKey: 'color',
      header: 'Color',
      cell: ({ row }) => (
         <div className="flex items-center gap-x-2">
            {row.original.color}
            {row.original.color !== 'N/A' && (
               <div
                  className="h-6 w-6 rounded-full border"
                  style={{ backgroundColor: row.original.color }}
               />
            )}
         </div>
      ),
   },
   {
      accessorKey: 'createdAt',
      header: 'Added',
   },
   {
      accessorKey: 'updatedAt',
      header: 'Updated',
   },
   {
      id: 'actions',
      cell: ({ row }) => <CellAction data={row.original} />,
   },
];
