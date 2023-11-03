'use client';

import { ColumnDef } from '@tanstack/react-table';
import { SalesReportCellAction } from './transactions-report-cell-action';

export type TransactionsReportColumn = {
   id: string;
   title: string | null;
   grossSales: string;
   netRevenue: string;
   transactionDate: string;
   unitsSold: number;
   createdAt: string;
   updatedAt: string;
};

export const columns: ColumnDef<TransactionsReportColumn>[] = [
   {
      accessorKey: 'title',
      header: 'Report title',
   },
   {
      accessorKey: 'transactionDate',
      header: 'Report date',
   },
   {
      accessorKey: 'grossSales',
      header: 'Gross sales',
   },
   {
      accessorKey: 'netRevenue',
      header: 'Net revenue',
   },
   {
      accessorKey: 'unitsSold',
      header: 'Total units sold',
   },
   {
      accessorKey: 'createdAt',
      header: 'Created',
   },
   {
      accessorKey: 'updatedAt',
      header: 'Updated',
   },
   {
      id: 'actions',
      cell: ({ row }) => <SalesReportCellAction data={row.original} />,
   },
];
