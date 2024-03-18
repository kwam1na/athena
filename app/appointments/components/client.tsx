'use client';

import { DataTable } from '@/components/ui/data-table';
import {
   ColumnFiltersState,
   SortingState,
   VisibilityState,
   getCoreRowModel,
   getFacetedRowModel,
   getFacetedUniqueValues,
   getFilteredRowModel,
   getPaginationRowModel,
   getSortedRowModel,
   useReactTable,
} from '@tanstack/react-table';
import { columns } from './columns';
import { useState } from 'react';
import { DataTableToolbar } from '@/components/ui/data-table-toolbar/products-table-toolbar';
import { Appointment } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { RotateCcwIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface AppointmentsClientProps {
   data: Appointment[];
}

export const AppointmentsClient: React.FC<AppointmentsClientProps> = ({
   data,
}) => {
   const [sorting, setSorting] = useState<SortingState>([]);
   const [rowSelection, setRowSelection] = useState({});
   const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
      {},
   );
   const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
   const router = useRouter();

   const table = useReactTable({
      data,
      columns,
      state: {
         sorting,
         rowSelection,
         columnVisibility,
         columnFilters,
      },
      initialState: {
         pagination: {
            pageSize: 4,
         },
      },
      enableRowSelection: true,
      onRowSelectionChange: setRowSelection,
      onSortingChange: setSorting,
      onColumnFiltersChange: setColumnFilters,
      onColumnVisibilityChange: setColumnVisibility,
      getCoreRowModel: getCoreRowModel(),
      getFilteredRowModel: getFilteredRowModel(),
      getPaginationRowModel: getPaginationRowModel(),
      getSortedRowModel: getSortedRowModel(),
      getFacetedRowModel: getFacetedRowModel(),
      getFacetedUniqueValues: getFacetedUniqueValues(),
   });

   return (
      <>
         <div className="flex justify-between">
            <DataTableToolbar
               hideDataTableViewOptions
               placeholder="Filter appointments..."
               searchKey="appointment"
               tableKey="appointments"
               table={table}
            />
            <Button variant={'ghost'} onClick={() => router.refresh()}>
               <RotateCcwIcon className="w-4 h-4" />
            </Button>
         </div>
         <DataTable
            table={table}
            columns={columns}
            showHeader={false}
            tableKey="appointments"
            showRowsPerPageSelector={false}
         />
      </>
   );
};
