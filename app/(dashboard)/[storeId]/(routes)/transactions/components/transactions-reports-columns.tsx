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
      header: 'Date',
   },
   {
      accessorKey: 'grossSales',
      header: 'Gross Sales',
   },
   {
      accessorKey: 'netRevenue',
      header: 'Net Revenue',
   },
   {
      accessorKey: 'unitsSold',
      header: 'Total Units Sold',
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
