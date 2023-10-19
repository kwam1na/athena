'use client';

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

import { DollarSign, Package, PackageCheck, Plus } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Heading } from '@/components/ui/heading';
import { Separator } from '@/components/ui/separator';

import {
   columns,
   TransactionsReportColumn,
} from './transactions-reports-columns';
import { useState } from 'react';
import { DataTableToolbar } from '@/components/ui/data-table-toolbar/products-table-toolbar';
import { useStoreCurrency } from '@/providers/currency-provider';
import { formatter, keysToCamelCase } from '@/lib/utils';
import { Transaction, TransactionItem } from '@prisma/client';
import { useWrappedUser } from '@/providers/wrapped-user-provider';
import { MetricCard } from '@/components/ui/metric-card';
import { ProgressList } from '@/components/ui/progress-list';

type TransactionsReport = Transaction & {
   transaction_items: TransactionItem[];
};
interface TransactionsReportsClientProps {
   data: TransactionsReportColumn[];
   transactionReports: TransactionsReport[];
   salesData?: {
      averageTransactionValue: number;
      averageUnitsPerTransaction: number;
      grossRevenue: number;
      netRevenue: number;
      totalUnitsSold: number;
      grossRevenuePercentageChange: number;
      netRevenuePercentageChange: number;
      totalUnitsSoldPercentageChange: number;
      categoriesMetrics: Record<
         string,
         {
            revenue: number;
            units_sold: number;
         }
      >;
   };
   store?: string;
}

export const TransactionsReportsClient: React.FC<
   TransactionsReportsClientProps
> = ({ data, transactionReports, salesData, store }) => {
   const params = useParams();
   const router = useRouter();

   const { wrappedUser, isLoading: isLoadingUser } = useWrappedUser();

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

   const { storeCurrency } = useStoreCurrency();
   const fmt = formatter(storeCurrency);

   const {
      averageTransactionValue,
      averageUnitsPerTransaction,
      grossRevenue,
      netRevenue,
      totalUnitsSold,
      grossRevenuePercentageChange,
      netRevenuePercentageChange,
      totalUnitsSoldPercentageChange,
      categoriesMetrics,
   } = salesData || {};

   const formattedCategoryMetrics =
      categoriesMetrics &&
      Object.keys(categoriesMetrics).map((category) => {
         const percentage = (
            (categoriesMetrics[category].units_sold / (totalUnitsSold || 1)) *
            100
         ).toFixed(2);
         return {
            title: category,
            percentage: parseFloat(percentage),
         };
      });

   return (
      <div className="flex flex-col gap-4">
         <div className="flex items-center justify-between">
            <Heading
               title={
                  isLoadingUser ? `Sales reports` : `Hi, ${wrappedUser?.name}`
               }
               description={
                  store
                     ? `Manage the sales operations of ${store}`
                     : 'Manage the sales operations of your store'
               }
            />
            <Button
               onClick={() =>
                  router.push(`/${params.storeId}/transactions/new`)
               }
            >
               <Plus className="mr-2 h-4 w-4" /> Add new
            </Button>
         </div>

         {/* <Separator /> */}

         <div className="grid grid-cols-3 space-x-8 pt-8">
            <MetricCard
               title={'Gross revenue'}
               value={fmt.format(grossRevenue || 0)}
               icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
               percentageChange={grossRevenuePercentageChange}
            />
            <MetricCard
               title={'Net revenue'}
               value={fmt.format(netRevenue || 0)}
               icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
               percentageChange={netRevenuePercentageChange}
            />
            <MetricCard
               title={'Total units sold'}
               value={totalUnitsSold?.toString() || '0'}
               icon={<PackageCheck className="h-4 w-4 text-muted-foreground" />}
               percentageChange={totalUnitsSoldPercentageChange}
            />
         </div>

         <div className="flex gap-16">
            <div className="flex flex-col gap-4 pt-4 w-[70%]">
               <span className="text-muted-foreground">Reports</span>
               <DataTableToolbar
                  searchKey="title"
                  tableKey="transactions"
                  table={table}
               />
               <DataTable columns={columns} table={table} />
            </div>

            <div className="flex flex-col gap-4 pt-4 w-[30%] px-4 py-8 mt-14">
               <div className="flex w-full gap-8 justify-between">
                  <div className="w-[50%]">
                     <MetricCard
                        title={'Avg transaction value (gross)'}
                        value={fmt.format(averageTransactionValue || 0)}
                        // icon={
                        //    <DollarSign className="h-4 w-4 text-muted-foreground" />
                        // }
                     />
                  </div>
                  <div className="w-[50%]">
                     <MetricCard
                        title={'Avg units per transaction'}
                        value={
                           (averageUnitsPerTransaction &&
                              isNaN(averageUnitsPerTransaction)) ||
                           !averageUnitsPerTransaction
                              ? '0'
                              : averageUnitsPerTransaction?.toString()
                        }
                        // icon={
                        //    <Package className="h-4 w-4 text-muted-foreground" />
                        // }
                     />
                  </div>
               </div>

               {formattedCategoryMetrics &&
                  formattedCategoryMetrics.length > 0 && (
                     <div className="flex flex-col gap-4 pt-4 border rounded-lg px-4 py-8 mt-14">
                        <ProgressList
                           data={formattedCategoryMetrics}
                           header="Sales percentage by category"
                        />
                     </div>
                  )}
            </div>
         </div>
      </div>
   );
};
