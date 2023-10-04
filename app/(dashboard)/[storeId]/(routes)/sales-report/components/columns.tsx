'use client';

import { ColumnDef } from '@tanstack/react-table';

export type TransactionItemColumn = {
   id: string;
   sku: string;
   productName: string;
   price: string;
   costPerItem: string;
   margin: string;
   unitsSold: number;
};

export const columns: ColumnDef<TransactionItemColumn>[] = [
   {
      accessorKey: 'productName',
      header: 'Product',
   },
   {
      accessorKey: 'sku',
      header: 'SKU',
   },
   {
      accessorKey: 'price',
      header: 'List price',
   },
   {
      accessorKey: 'costPerItem',
      header: 'Cost',
   },
   {
      accessorKey: 'unitsSold',
      header: 'Units sold',
   },
   {
      accessorKey: 'margin',
      header: 'Margin',
   },
];
