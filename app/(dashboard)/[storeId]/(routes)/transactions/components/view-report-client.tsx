'use client';

import * as z from 'zod';
import { DataTable } from '@/components/ui/data-table';
import { Heading } from '@/components/ui/heading';
import { Separator } from '@/components/ui/separator';

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

import { ViewTransactionItemColumn, viewReportColumns } from './columns';
import { useEffect, useState } from 'react';
import { DataTableToolbar } from '@/components/ui/data-table-toolbar/products-table-toolbar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
   AlertCircle,
   ArrowLeft,
   Calendar,
   DollarSign,
   PackageCheck,
   Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import { useParams, useRouter } from 'next/navigation';
import { useStoreCurrency } from '@/providers/currency-provider';
import { formatter } from '@/lib/utils';
import { format } from 'date-fns';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
   getCategorySalesAndUnits,
   getNetRevenue,
   getTotalSales,
   getTotalUnitsSold,
} from '../utils';
import {
   Table,
   TableBody,
   TableCell,
   TableHead,
   TableHeader,
   TableRow,
} from '@/components/ui/table';
import {
   AlertMessage,
   Transaction,
   TransactionItem,
} from '@/types/transactions';

interface TransactionsReportClientProps {
   fetchedTransaction?: Transaction;
}

export const ViewReportClient: React.FC<TransactionsReportClientProps> = ({
   fetchedTransaction,
}) => {
   // table state
   const [sorting, setSorting] = useState<SortingState>([]);
   const [rowSelection, setRowSelection] = useState({});
   const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
      {},
   );
   const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
   const [formattedItems, setFormattedItems] = useState<
      ViewTransactionItemColumn[]
   >([]);

   // booleans
   const [date, setDate] = useState<Date | undefined>(
      fetchedTransaction?.transactionDate || new Date(),
   );
   const [transaction, setTransaction] = useState<Transaction | undefined>(
      fetchedTransaction || undefined,
   );
   const [transactionItems, setTransactionItems] = useState<TransactionItem[]>(
      [],
   );

   const [alertMessages, setAlertMessages] = useState<AlertMessage[]>([]);

   const params = useParams();
   const router = useRouter();

   const { storeCurrency } = useStoreCurrency();
   const fmt = formatter(storeCurrency);

   const table = useReactTable({
      data: formattedItems,
      columns: viewReportColumns,
      state: {
         sorting,
         rowSelection,
         columnVisibility,
         columnFilters,
      },
      sortDescFirst: true,
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

   /**
    * Formats a list of transaction items for table display.
    * @param transactionItems - List of transaction items.
    * @returns An array of formatted transaction items.
    */
   const getFormattedItemsForTable = (transactionItems: TransactionItem[]) => {
      return transactionItems.map((item) => ({
         categoryId: item.categoryId,
         subcategoryId: item.subcategoryId,
         costPerItem: fmt.format(parseFloat(item.cost || '0')),
         price: fmt.format(parseFloat(item.price || '0')),
         productId: item.productId,
         productName: item.productName,
         sku: item.sku,
         storeId: item.storeId,
         unitsSold: item.unitsSold,
         transactionDate: item.transactionDate,
         transactionId: item.transactionId,
         margin: (
            ((parseInt(item.price || '0') - parseInt(item.cost || '0')) /
               parseInt(item.price || '0')) *
            100
         ).toFixed(2),
      }));
   };

   /**
    * Initializes state from a fetched transaction.
    * @param {Transaction} fetchedTransaction - The transaction fetched from the server.
    */
   const setupFromFetchedTransaction = (fetchedTransaction: Transaction) => {
      setDate(fetchedTransaction.transactionDate || new Date());
      setTransactionItems(fetchedTransaction.transactionItems || []);
      setFormattedItems(
         getFormattedItemsForTable(fetchedTransaction.transactionItems || []),
      );
   };

   /**
    * useEffect hook for setting up the form with the fetched transaction on component mount.
    */
   useEffect(() => {
      if (fetchedTransaction) {
         setupFromFetchedTransaction(fetchedTransaction);
      }
   }, []);

   const categorySales = getCategorySalesAndUnits(transactionItems);
   const grossSales = getTotalSales(transactionItems);
   const netSales = getNetRevenue(transactionItems);
   const unitsSold = getTotalUnitsSold(transactionItems);

   const Alerts = () => {
      return (
         <>
            {alertMessages.map((message) => {
               return (
                  <Alert className="flex justify-between">
                     <div className="flex gap-2 pt-4 pb-4">
                        <AlertCircle className="h-4 w-4" />
                        <div className="grid grid-rows-2 gap-2">
                           <AlertTitle>{message.title}</AlertTitle>
                           {message.description && (
                              <AlertDescription>
                                 {message.description}
                              </AlertDescription>
                           )}
                        </div>
                     </div>
                  </Alert>
               );
            })}
         </>
      );
   };

   const CategoriesTable = () => {
      return (
         <Table className="bg-card rounded-md">
            <TableHeader>
               <TableRow>
                  <TableHead className="w-[100px]">Category</TableHead>
                  <TableHead>Units sold</TableHead>
                  <TableHead>Total sales</TableHead>
               </TableRow>
            </TableHeader>
            <TableBody>
               {Object.keys(categorySales).map((item, index) => (
                  <TableRow key={index}>
                     <TableCell className="font-medium">{item}</TableCell>
                     <TableCell>{categorySales[item].unitsSold}</TableCell>
                     <TableCell>
                        {fmt.format(categorySales[item].totalSales)}
                     </TableCell>
                  </TableRow>
               ))}
            </TableBody>
         </Table>
      );
   };

   const ReportActionButtons = () => {
      return (
         <div className="space-x-4 flex items-center">
            {transaction && (
               <Button
                  variant={'outline'}
                  onClick={() =>
                     router.push(
                        `/${params.storeId}/transactions/${transaction.id}/edit`,
                     )
                  }
               >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
               </Button>
            )}
         </div>
      );
   };

   return (
      <>
         <Alerts />

         <div className="flex">
            <Button variant={'outline'} onClick={() => router.back()}>
               <ArrowLeft className="mr-2 h-4 w-4" />
            </Button>
         </div>
         <div className="flex items-center justify-between space-y-2">
            <Heading
               title={transaction?.reportTitle || 'Transaction report'}
               description="Insights and sales performance"
            />

            <ReportActionButtons />
         </div>
         <Separator />

         <div className="flex items-center gap-4">
            <span className="text-muted-foreground">Report date</span>
            <div className="flex items-center space-x-2 border rounded-md p-2 bg-card">
               <Calendar className="w-4 h-4 text-muted-foreground" />
               <p className="text-sm">
                  {date && `${format(date, 'MMMM dd, yyyy')}`}
               </p>
            </div>
         </div>

         <div className="grid grid-cols-3 space-x-8 pt-6">
            <Card className="space-y-4">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                     Gross Sales
                  </CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
               </CardHeader>
               <CardContent>
                  <div className="text-2xl font-bold">
                     {fmt.format(grossSales)}
                  </div>
               </CardContent>
            </Card>

            <Card className="space-y-4">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                     Net Revenue
                  </CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
               </CardHeader>
               <CardContent>
                  <div className="text-2xl font-bold">
                     {fmt.format(netSales)}
                  </div>
               </CardContent>
            </Card>

            <Card className="space-y-4">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                     Units sold
                  </CardTitle>
                  <PackageCheck className="h-4 w-4 text-muted-foreground" />
               </CardHeader>
               <CardContent>
                  <div className="text-2xl font-bold">{unitsSold}</div>
               </CardContent>
            </Card>
         </div>

         <div className="flex justify-between gap-24 pt-4 w-full">
            {transaction && (
               <div className="w-full space-y-4">
                  <div className="flex w-full gap-24">
                     <div className={`w-[60%] space-y-4`}>
                        <span className="text-muted-foreground">
                           Transactions
                        </span>
                        {/* <DataTableToolbar
                           searchKey="productName"
                           tableKey="transactions-transaction-items"
                           placeholder="Filter transactions..."
                           table={table}
                        /> */}
                        <DataTable table={table} columns={viewReportColumns} />
                     </div>

                     <div className="w-[40%] space-y-4">
                        <span className="text-muted-foreground">
                           Breakdown by category
                        </span>
                        <CategoriesTable />
                     </div>
                  </div>
               </div>
            )}
         </div>
      </>
   );
};
