'use client';

import { ColumnDef } from '@tanstack/react-table';

import { CellAction } from './cell-action';

export type CategoryColumn = {
   id: string;
   name: string;
   productsCount: number;
   createdAt: string;
   updatedAt: string;
};

export const columns: ColumnDef<CategoryColumn>[] = [
   {
      accessorKey: 'name',
      header: 'Name',
   },
   {
      accessorKey: 'productsCount',
      header: 'Products count',
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
