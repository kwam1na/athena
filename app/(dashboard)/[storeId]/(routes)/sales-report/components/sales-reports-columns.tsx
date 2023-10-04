'use client';

import { ColumnDef } from '@tanstack/react-table';

export type SalesReportColumn = {
   id: string;
   grossSales: number;
   createdAt: Date;
   updatedAt: Date;
};

export const columns: ColumnDef<SalesReportColumn>[] = [
   {
      accessorKey: 'date',
      header: 'Date',
   },
   {
      accessorKey: 'grossSales',
      header: 'Gross Sales',
   },
   {
      accessorKey: 'updatedAt',
      header: 'Updated',
   },
];
