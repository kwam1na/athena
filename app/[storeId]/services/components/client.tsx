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
import { Service } from '@/lib/types';

interface ServiceClientProps {
   data: Service[];
}

export const ServicesClient: React.FC<ServiceClientProps> = ({ data }) => {
   const [sorting, setSorting] = useState<SortingState>([]);
   const [rowSelection, setRowSelection] = useState({});
   const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
      {},
   );
   const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

   const table = useReactTable({
      data,
      columns,
      state: {
         sorting,
         rowSelection,
         columnVisibility,
         columnFilters,
      },
      // initialState: {
      //    pagination: {
      //       pageSize: 5,
      //    },
      // },
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
         <DataTableToolbar
            hideDataTableViewOptions
            searchKey="service"
            tableKey="services"
            table={table}
            placeholder="Filter services..."
         />
         <DataTable
            table={table}
            columns={columns}
            tableKey="services"
            showHeader={false}
            showRowsPerPageSelector={false}
         />
      </>
   );
};
