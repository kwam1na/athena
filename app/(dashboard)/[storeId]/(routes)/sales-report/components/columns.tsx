'use client';
import * as React from 'react';

import { ColumnDef } from '@tanstack/react-table';
import { CellAction } from './cell-action';
import {
   AlertMessage,
   AutoSavedTransaction,
   ReportEntryAction,
   TransactionItem,
} from './client';

export interface TransactionItemColumn extends TransactionItem {
   reportEntryAction: ReportEntryAction;
   setAlertMessages: React.Dispatch<React.SetStateAction<AlertMessage[]>>;
   setTransactionItems: React.Dispatch<React.SetStateAction<TransactionItem[]>>;
   setFormattedItems: React.Dispatch<
      React.SetStateAction<TransactionItemColumn[]>
   >;
   setAutoSavedTransactions: React.Dispatch<
      React.SetStateAction<AutoSavedTransaction[]>
   >;
}

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
      header: 'Margin (%)',
   },
   {
      id: 'actions',
      cell: ({ row }) => <CellAction data={row.original} />,
   },
];
