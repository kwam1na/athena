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

import { columns, TransactionItemColumn } from './columns';
import { useState } from 'react';
import { DataTableToolbar } from '@/components/ui/data-table-toolbar/products-table-toolbar';
import { CalendarDateRangePicker } from '@/components/ui/date-range-picker';
import { CardContainer } from '@/components/ui/card-container';
import { Input } from '@/components/ui/input';
import {
   Card,
   CardContent,
   CardDescription,
   CardHeader,
   CardTitle,
} from '@/components/ui/card';
import { ArrowLeft, LineChart, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
   Form,
   FormControl,
   FormDescription,
   FormField,
   FormItem,
   FormMessage,
} from '@/components/ui/form';
import axios from 'axios';
import { useParams, useRouter } from 'next/navigation';
import { CalendarDatePicker } from '@/components/ui/date-picker';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoreCurrency } from '@/providers/currency-provider';
import { formatter } from '@/lib/utils';
import { format } from 'date-fns';

interface SalesReportClientProps {
   data: TransactionItemColumn[];
}

enum ProductQueryResultType {
   OK,
   NO_RESULTS,
}

interface ProductQueryResult {
   product_id?: string;
   category_id?: string;
   subcategory_id?: string;
   product_name?: string;
   sku?: string;
   price?: string;
   cost?: string;
   type: ProductQueryResultType;
}

interface Transaction {
   id: string;
   transaction_date: Date;
}

interface TransactionItem {
   id: string;
   categoryId: string;
   subcategoryId: string;
   cost: string;
   createdAt: string;
   price: string;
   productId: string;
   sku: string;
   productName: string;
   storeId: string;
   transactionDate: Date;
   unitsSold: number;
   updatedAt: number;
}

const formSchema = z.object({
   query: z.string(),
});

const transactionItemFormSchema = z.object({
   unitsSold: z.coerce.number().min(1),
});

type ProductQueryFormValues = z.infer<typeof formSchema>;
type TransactionItemFormValues = z.infer<typeof transactionItemFormSchema>;

export const SalesReportClient: React.FC<SalesReportClientProps> = ({
   data,
}) => {
   const [sorting, setSorting] = useState<SortingState>([]);
   const [rowSelection, setRowSelection] = useState({});
   const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
      {},
   );
   const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
   const [searching, setIsSearching] = useState(false);
   const [searchResult, setSearchResult] = useState<ProductQueryResult | null>(
      null,
   );
   const [isAddingTransactionItem, setIsAddingTransactionItem] =
      useState(false);
   const [date, setDate] = useState<Date | undefined>(new Date());
   const [transaction, setTransaction] = useState<Transaction | undefined>(
      undefined,
   );
   const [transactionItems, setTransactionItems] = useState<TransactionItem[]>(
      [],
   );
   const [formattedItems, setFormattedItems] = useState<
      TransactionItemColumn[]
   >([]);

   const params = useParams();
   const router = useRouter();

   const { storeCurrency } = useStoreCurrency();
   const fmt = formatter(storeCurrency);

   const table = useReactTable({
      data: data.length > 0 ? data : formattedItems,
      columns,
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

   const form = useForm<ProductQueryFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: {
         query: '',
      },
   });

   const transactionItemForm = useForm<TransactionItemFormValues>({
      resolver: zodResolver(transactionItemFormSchema),
      defaultValues: {
         unitsSold: 1,
      },
   });

   const handleSubmitTransactionItem = async (
      data: TransactionItemFormValues,
   ) => {
      const body = {
         units_sold: data.unitsSold,
         product_name: searchResult?.product_name,
         product_id: searchResult?.product_id,
         sku: searchResult?.sku,
         category_id: searchResult?.category_id,
         subcategory_id: searchResult?.subcategory_id,
         price: searchResult?.price,
         cost: searchResult?.cost,
         transaction_date: date,
      };
      try {
         setIsAddingTransactionItem(true);

         if (!transaction) {
            const transactionRequest = await axios.post(
               `/api/${params.storeId}/transactions`,
               { transaction_date: date },
            );

            const transactionItemRequest = await axios.post(
               `/api/${params.storeId}/transactions/${transactionRequest.data.id}`,
               { ...body, transaction_id: transactionRequest.data.id },
            );

            const transactionItem = transactionItemRequest.data;

            setTransaction({
               id: transactionRequest.data.id,
               transaction_date: transactionRequest.data.transaction_date,
            });

            setTransactionItems([
               ...transactionItems,
               {
                  id: transactionItem.id,
                  categoryId: transactionItem.category_id,
                  subcategoryId: transactionItem.subcategory_id,
                  cost: transactionItem.cost,
                  createdAt: transactionItem.created_at,
                  price: transactionItem.price,
                  productId: transactionItem.product_id,
                  sku: transactionItem.sku,
                  productName: transactionItem.product_name,
                  storeId: transactionItem.store_id,
                  unitsSold: transactionItem.units_sold,
                  transactionDate: transactionItem.transaction_date,
                  updatedAt: transactionItem.updated_at,
               },
            ]);

            const items = [
               ...transactionItems,
               {
                  id: transactionItem.id,
                  categoryId: transactionItem.category_id,
                  subcategoryId: transactionItem.subcategory_id,
                  cost: transactionItem.cost,
                  createdAt: transactionItem.created_at,
                  price: transactionItem.price,
                  productId: transactionItem.product_id,
                  sku: transactionItem.sku,
                  productName: transactionItem.product_name,
                  storeId: transactionItem.store_id,
                  unitsSold: transactionItem.units_sold,
                  transactionDate: transactionItem.transaction_date,
                  updatedAt: transactionItem.updated_at,
               },
            ].map((item) => ({
               id: item.id,
               productName: item.productName,
               price: fmt.format(parseInt(item.price)),
               costPerItem: fmt.format(parseInt(item.cost)),
               margin: (
                  ((parseInt(item.price) - parseInt(item.cost)) /
                     parseInt(item.price)) *
                  100
               ).toFixed(2),
               unitsSold: item.unitsSold,
               sku: item.sku,
               createdAt: format(new Date(item.createdAt), 'MMM d, yyyy'),
               updatedAt: format(new Date(item.updatedAt), 'MMM d, yyyy'),
            }));

            setFormattedItems(items);
         } else {
            const transactionItemRequest = await axios.post(
               `/api/${params.storeId}/transactions/${transaction.id}`,
               { ...body, transaction_id: transaction.id },
            );

            const transactionItem = transactionItemRequest.data;

            setTransactionItems([
               ...transactionItems,
               {
                  id: transactionItem.id,
                  categoryId: transactionItem.category_id,
                  subcategoryId: transactionItem.subcategory_id,
                  cost: transactionItem.cost,
                  createdAt: transactionItem.created_at,
                  price: transactionItem.price,
                  productId: transactionItem.product_id,
                  sku: transactionItem.sku,
                  productName: transactionItem.product_name,
                  storeId: transactionItem.store_id,
                  unitsSold: transactionItem.units_sold,
                  transactionDate: transactionItem.transaction_date,
                  updatedAt: transactionItem.updated_at,
               },
            ]);

            const items = [
               ...transactionItems,
               {
                  id: transactionItem.id,
                  categoryId: transactionItem.category_id,
                  subcategoryId: transactionItem.subcategory_id,
                  cost: transactionItem.cost,
                  createdAt: transactionItem.created_at,
                  price: transactionItem.price,
                  productId: transactionItem.product_id,
                  sku: transactionItem.sku,
                  productName: transactionItem.product_name,
                  storeId: transactionItem.store_id,
                  unitsSold: transactionItem.units_sold,
                  transactionDate: transactionItem.transaction_date,
                  updatedAt: transactionItem.updated_at,
               },
            ]
               .reverse()
               .filter(
                  (item, index, self) =>
                     self.findIndex((t) => t.productId === item.productId) ===
                     index,
               )
               .reverse()
               .map((item) => ({
                  id: item.id,
                  productName: item.productName,
                  price: fmt.format(parseInt(item.price)),
                  costPerItem: fmt.format(parseInt(item.cost)),
                  margin: (
                     ((parseInt(item.price) - parseInt(item.cost)) /
                        parseInt(item.price)) *
                     100
                  ).toFixed(2),
                  sku: item.sku,
                  unitsSold: item.unitsSold,
                  createdAt: format(new Date(item.createdAt), 'MMM d, yyyy'),
                  updatedAt: format(new Date(item.updatedAt), 'MMM d, yyyy'),
               }));

            setFormattedItems(items);
         }
      } catch (error: any) {
         console.log('error:', error);
      } finally {
         setIsAddingTransactionItem(false);
         setSearchResult(null);
         transactionItemForm.reset();
      }
   };

   const onSubmit = async (data: ProductQueryFormValues) => {
      try {
         setIsSearching(true);
         const res = await axios.get(
            `/api/${params.storeId}/search?query=${data.query}`,
         );
         console.log('search results:', res.data);
         if (res.data.length) {
            const product = res.data[0];
            setSearchResult({
               category_id: product.category_id,
               product_name: product.name,
               product_id: product.id,
               sku: product.sku,
               price: product.price,
               cost: product.cost_per_item,
               type: ProductQueryResultType.OK,
               ...product,
            });
         } else {
            setSearchResult({
               type: ProductQueryResultType.NO_RESULTS,
            });
         }
      } catch (error: any) {
         console.log('error:', error);
      } finally {
         setIsSearching(false);
      }
   };

   const Loader = () => {
      return <Skeleton className="w-full h-[180px]" />;
   };

   return (
      <>
         <div className="flex">
            <Button variant={'outline'} onClick={() => router.back()}>
               <ArrowLeft className="mr-2 h-4 w-4" />
            </Button>
         </div>
         <div className="flex items-center justify-between space-y-2">
            <Heading
               title={`Add new sales report`}
               description="Track the daily sales operations of your store"
            />
         </div>
         <Separator />

         <p>{date && `${format(date, 'MMMM dd, yyyy')}`}</p>

         <div className="flex justify-center py-4 gap-16">
            <div className="flex flex-col w-full gap-16">
               <Form {...form}>
                  <form
                     onSubmit={form.handleSubmit(onSubmit)}
                     className="flex-col space-y-8 pt-8"
                  >
                     <div className="flex gap-8 justify-center">
                        <Label>
                           <span className="h-full flex items-center justify-center text-md text-muted-foreground">
                              SKU
                           </span>
                        </Label>
                        <div className="w-[30%]">
                           <FormField
                              control={form.control}
                              name="query"
                              render={({ field }) => (
                                 <FormItem>
                                    <FormControl>
                                       <Input
                                          disabled={searching}
                                          placeholder="Enter product SKU..."
                                          {...field}
                                       />
                                    </FormControl>
                                    <FormMessage />
                                 </FormItem>
                              )}
                           />
                        </div>

                        <Button type="submit">
                           <Search className="mr-2 h-4 w-4" /> Search
                        </Button>
                     </div>
                  </form>
               </Form>

               <div>
                  {searching && <Loader />}
                  {!searching && searchResult && (
                     <Card className="bg-background w-full">
                        <CardHeader>
                           <CardDescription className="flex items-center">
                              Search results
                           </CardDescription>
                        </CardHeader>
                        <CardContent>
                           {searchResult.type === ProductQueryResultType.OK && (
                              <div className="flex justify-between">
                                 <div className="flex items-center gap-16 space-x-2">
                                    <Label
                                       htmlFor="gross-sales"
                                       className="flex flex-col space-y-1"
                                    >
                                       <span className="text-lg">
                                          {searchResult?.product_name}
                                       </span>
                                       <span className="font-normal leading-snug text-muted-foreground">
                                          {'Product'}
                                       </span>
                                    </Label>

                                    <Label
                                       htmlFor="gross-sales"
                                       className="flex flex-col space-y-1"
                                    >
                                       <span className="text-lg">
                                          {fmt.format(
                                             parseFloat(
                                                String(searchResult.price),
                                             ),
                                          )}
                                       </span>
                                       <span className="font-normal leading-snug text-muted-foreground">
                                          {'List price'}
                                       </span>
                                    </Label>
                                 </div>

                                 <div>
                                    <Form {...transactionItemForm}>
                                       <form
                                          onSubmit={transactionItemForm.handleSubmit(
                                             handleSubmitTransactionItem,
                                          )}
                                          className="flex gap-4"
                                       >
                                          <FormField
                                             control={
                                                transactionItemForm.control
                                             }
                                             name="unitsSold"
                                             render={({ field }) => (
                                                <FormItem>
                                                   <FormControl>
                                                      <Input
                                                         className="w-[180px]"
                                                         type="number"
                                                         disabled={
                                                            isAddingTransactionItem
                                                         }
                                                         placeholder="0"
                                                         {...field}
                                                      />
                                                   </FormControl>
                                                   <FormDescription>
                                                      Units sold
                                                   </FormDescription>
                                                   <FormMessage />
                                                </FormItem>
                                             )}
                                          />
                                          <Button
                                             variant={'outline'}
                                             type="submit"
                                             disabled={
                                                isAddingTransactionItem ||
                                                date == undefined
                                             }
                                          >
                                             <Plus className="mr-2 h-4 w-4" />{' '}
                                             Add
                                          </Button>
                                       </form>
                                    </Form>
                                 </div>
                              </div>
                           )}

                           {searchResult.type ===
                              ProductQueryResultType.NO_RESULTS && (
                              <span className="flex justify-center">
                                 No results found.
                              </span>
                           )}
                        </CardContent>
                     </Card>
                  )}
               </div>
            </div>

            <CalendarDatePicker date={date} setDate={setDate} />
         </div>

         <div className="flex justify-between gap-24 pt-16">
            {transactionItems.length > 0 && (
               <div className="w-[70%] space-y-4">
                  <DataTableToolbar
                     searchKey="productName"
                     tableKey="subcategories"
                     table={table}
                  />
                  <DataTable table={table} columns={columns} />
               </div>
            )}
         </div>
      </>
   );
};
