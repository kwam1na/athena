'use client';

import { ColumnDef } from '@tanstack/react-table';
import { CellAction } from './cell-action';

export type UserColumn = {
   id: string;
   name: string;
   email: string;
   createdAt: string;
   updatedAt: string;
};

export const columns: ColumnDef<UserColumn>[] = [
   {
      accessorKey: 'name',
      header: 'Name',
   },
   {
      accessorKey: 'email',
      header: 'Email',
   },
   {
      accessorKey: 'createdAt',
      header: 'Created at',
   },
   {
      accessorKey: 'updatedAt',
      header: 'Updated at',
   },
   {
      id: 'actions',
      cell: ({ row }) => <CellAction data={row.original} />,
   },
];
