'use client';

import { ColumnDef } from '@tanstack/react-table';

import { CellAction } from './cell-action';

export type SubcategoryColumn = {
   id: string;
   name: string;
   category: string;
   productsCount: number;
   createdAt: string;
   updatedAt: string;
};

export const columns: ColumnDef<SubcategoryColumn>[] = [
   {
      accessorKey: 'name',
      header: 'Name',
   },
   {
      accessorKey: 'category',
      header: 'Category',
      cell: ({ row }) => row.original.category,
      filterFn: (row, id, value) => {
         return value.includes(row.getValue(id));
      },
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
