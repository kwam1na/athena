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
import { useEffect, useState } from 'react';
import { DataTableToolbar } from '@/components/ui/data-table-toolbar/products-table-toolbar';
import { Input } from '@/components/ui/input';
import {
   Card,
   CardContent,
   CardDescription,
   CardHeader,
   CardTitle,
} from '@/components/ui/card';
import {
   AlertCircle,
   ArrowLeft,
   Calendar,
   DollarSign,
   PackageCheck,
   Plus,
   PlusCircle,
   Save,
   Search,
   Send,
   Trash,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Control, FieldValues, useForm } from 'react-hook-form';
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
import { formatter, keysToCamelCase, keysToSnakeCase } from '@/lib/utils';
import { format, isFuture, isSameDay } from 'date-fns';
import { ActionModal } from '@/components/modals/action-modal';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertModal } from '@/components/modals/alert-modal';
import { LoadingButton } from '@/components/ui/loading-button';
import {
   autoSaveIsInSync,
   getAutoSavedTransactions,
   getAutosavedReportTitle,
   getCategorySalesAndUnits,
   getDraftTransactions,
   getLocalStorageKey,
   getTotalSales,
   getTotalUnitsSold,
   removeDraftTransaction,
   saveItemInLocalStorage,
   updateDraftTransactions,
} from '../utils';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import {
   Tooltip,
   TooltipContent,
   TooltipTrigger,
} from '@/components/ui/tooltip';

interface SalesReportClientProps {
   data: TransactionItemColumn[];
}

enum ProductQueryResultType {
   OK,
   NO_RESULTS,
}

interface ProductQueryResult {
   category_id?: string;
   category?: Record<string, any>;
   cost?: string;
   inventoryCount?: number;
   price?: string;
   product_id?: string;
   product_name?: string;
   sku?: string;
   subcategory?: Record<string, any>;
   subcategory_id?: string;
   type: ProductQueryResultType;
}

export interface Transaction {
   id: string;
   reportTitle?: string;
   transactionDate?: Date;
}

export interface TransactionItem {
   category?: string;
   categoryId?: string;
   createdAt?: string;
   cost?: string;
   id?: string;
   price?: string;
   productId?: string;
   productName?: string;
   subcategory?: string;
   subcategoryId?: string;
   sku?: string;
   storeId?: string;
   transactionDate?: Date;
   transactionId?: string;
   transactionReportTitle?: string;
   unitsSold?: number;
   updatedAt?: number;
}

export interface TransactionItemBody {
   category?: string;
   category_id?: string;
   cost?: string;
   price?: string;
   product_id?: string;
   product_name?: string;
   sku?: string;
   store_id?: string;
   subcategory?: string;
   subcategory_id?: string;
   transaction_date?: Date;
   transaction_id?: string;
   transaction_report_title?: string;
   units_sold?: number;
}

export interface AutoSavedTransaction {
   id: string;
   reportTitle?: string;
   transactionDate?: Date;
   transactionItems: TransactionItem[];
}

interface AlertMessage {
   description?: string;
   key: string;
   title: string;
}

const formSchema = z.object({
   query: z.string().min(1),
});

const transactionItemFormSchema = z.object({
   unitsSold: z.coerce.number().min(1),
});

type ProductQueryFormValues = z.infer<typeof formSchema>;
type TransactionItemFormValues = z.infer<typeof transactionItemFormSchema>;

export const SalesReportClient: React.FC<SalesReportClientProps> = ({
   data,
}) => {
   // table state
   const [sorting, setSorting] = useState<SortingState>([]);
   const [rowSelection, setRowSelection] = useState({});
   const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
      {},
   );
   const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
   const [formattedItems, setFormattedItems] = useState<
      TransactionItemColumn[]
   >([]);

   // booleans
   const [searching, setIsSearching] = useState(false);
   const [showDatePicker, setShowDatePicker] = useState(false);
   const [isAutoSaveModalOpen, setIsAutoSaveModalOpen] = useState(false);
   const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
   const [isDeletingReport, setIsDeletingReport] = useState(false);
   const [isEditingReportTitle, setIsEditingReportTitle] = useState(false);
   const [isAddingTransactionItem, setIsAddingTransactionItem] =
      useState(false);
   const [isPublishingReport, setIsPublishingReport] = useState(false);

   const [searchResult, setSearchResult] = useState<
      ProductQueryResult | undefined
   >(undefined);

   const [date, setDate] = useState<Date | undefined>(new Date());
   const [transaction, setTransaction] = useState<Transaction | undefined>(
      undefined,
   );
   const [transactionItems, setTransactionItems] = useState<TransactionItem[]>(
      [],
   );

   const [enteredReportTitle, setEnteredReportTitle] = useState<
      string | undefined
   >(undefined);

   const [autoSavedTransactions, setAutoSavedTransactions] = useState<
      AutoSavedTransaction[]
   >([]);

   const [alertMessages, setAlertMessages] = useState<AlertMessage[]>([]);
   const [dateButtonVariant, setDateButtonVariant] = useState<
      'outline' | 'destructive'
   >('outline');

   const params = useParams();
   const router = useRouter();
   const { toast } = useToast();

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

   /**
    * Resets the state variables related to adding a new transaction item.
    */
   const cleanup = () => {
      setIsAddingTransactionItem(false);
      setSearchResult(undefined);
      transactionItemForm.reset();
   };

   /**
    * Creates a transaction item body using form values, date, and an optional search result.
    * @param data - Form values for the transaction item.
    * @param date - Transaction date.
    * @param searchResult - Optional product information.
    * @returns A TransactionItemBody object.
    */
   const createBody = (
      data: TransactionItemFormValues,
      date: Date,
      searchResult?: ProductQueryResult,
   ): TransactionItemBody => ({
      units_sold: data.unitsSold,
      product_name: searchResult?.product_name,
      product_id: searchResult?.product_id,
      sku: searchResult?.sku,
      category: searchResult?.category?.name,
      category_id: searchResult?.category_id,
      subcategory: searchResult?.subcategory?.name,
      subcategory_id: searchResult?.subcategory_id,
      price: searchResult?.price,
      cost: searchResult?.cost,
      transaction_date: date,
   });

   /**
    * Generates a new item for inclusion in a transaction.
    * @param draftTransactionItem - Draft transaction item information.
    * @param transactionId - ID of the transaction.
    * @param reportTitle - Title of the transaction report.
    * @returns An object representing the new item.
    */
   const createNewItem = (
      draftTransactionItem: any,
      transactionId: string,
      reportTitle: string,
   ) => {
      return {
         category: draftTransactionItem.category,
         categoryId: draftTransactionItem.category_id,
         subcategory: draftTransactionItem.subcategory,
         subcategoryId: draftTransactionItem.subcategory_id,
         cost: draftTransactionItem.cost,
         price: draftTransactionItem.price,
         productId: draftTransactionItem.product_id,
         sku: draftTransactionItem.sku,
         productName: draftTransactionItem.product_name,
         storeId: params.storeId,
         unitsSold: draftTransactionItem.units_sold,
         transactionDate: draftTransactionItem.transaction_date,
         transactionId,
         transactionReportTitle: reportTitle,
      };
   };

   /**
    * Resets the form and local state for creating a new report.
    */
   const createNewReport = () => {
      setTransaction(undefined);
      setTransactionItems([]);
      setFormattedItems([]);
      setSearchResult(undefined);
      setIsSearching(false);
      setEnteredReportTitle(undefined);
      setDate(new Date());
      form.reset();

      const autoSavedTransactionsInLocalStorage = getAutoSavedTransactions(
         params.storeId,
      );
      if (
         !autoSaveIsInSync(
            autoSavedTransactions,
            autoSavedTransactionsInLocalStorage,
         )
      ) {
         toast({
            title: 'Autosaved',
         });
      }
      setAutoSavedTransactions(autoSavedTransactionsInLocalStorage);
   };

   /**
    * Transforms a draft transaction into an array of table items.
    * @param draftTransaction - Draft transaction information.
    * @returns An array of TransactionItem objects.
    */
   const createTableItemsFromDraftTransaction = (
      draftTransaction: Record<string, any>,
   ): TransactionItem[] => {
      return Object.keys(draftTransaction).map((key) => {
         return keysToCamelCase(draftTransaction[key]);
      });
   };

   /**
    * Deletes the current transaction report.
    */
   const deleteReport = async () => {
      if (!transaction) return;

      try {
         setIsDeletingReport(true);
         await axios.delete(
            `/api/${params.storeId}/transactions/${transaction.id}`,
         );
         removeDraftTransaction(params.storeId, transaction.id);
         setIsAlertModalOpen(false);
         toast({
            title: 'Report deleted successfully.',
         });
         router.refresh();
         createNewReport();
      } catch (error) {
         console.error(
            '[ADD_NEW_SALES_REPORT_ERROR] Error deleting transaction:',
            error,
         );
         toast({
            title: 'An error occured deleting this report. Try again.',
         });
      } finally {
         setIsDeletingReport(false);
      }
   };

   /**
    * Formats a list of transaction items for table display.
    * @param transactionItems - List of transaction items.
    * @returns An array of formatted transaction items.
    */
   const getFormattedItemsForTable = (transactionItems: TransactionItem[]) => {
      return transactionItems.map((item) => ({
         categoryId: item.categoryId,
         subcategoryId: item.subcategoryId,
         costPerItem: fmt.format(parseInt(item.cost || '0')),
         price: fmt.format(parseInt(item.price || '0')),
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
         setTransactionItems,
         setFormattedItems,
         setAutoSavedTransactions,
      }));
   };

   /**
    * Handle an existing transaction by updating the draft with the new item,
    * saving it in local storage, and updating the state.
    *
    * @param body - The body data for the transaction item
    * @param transaction - The existing transaction
    * @param draftTransactions - Existing draft transactions
    * @param draftTransactionKey - The local storage key for saving draft transactions
    */
   const handleExistingTransaction = (
      body: TransactionItemBody,
      transaction: Transaction,
      draftTransactions: Record<string, any>,
      draftTransactionKey: string,
   ) => {
      const updatedDraft = updateDraft(body, transaction, draftTransactions);
      draftTransactions[transaction.id] = updatedDraft;

      saveItemInLocalStorage(draftTransactionKey, draftTransactions);

      const tableItems = createTableItemsFromDraftTransaction(updatedDraft);
      setTransactionItems(tableItems);
      setFormattedItems(getFormattedItemsForTable(tableItems));
   };

   /**
    * Handle a new transaction by making an API call, updating the state,
    * and saving the transaction as a draft in local storage.
    *
    * @param body - The body data for the transaction item
    * @param date - The transaction date
    * @param draftTransactions - Existing draft transactions
    * @param draftTransactionKey - The local storage key for saving draft transactions
    */
   const handleNewTransaction = async (
      body: TransactionItemBody,
      date: Date,
      draftTransactions: any,
      draftTransactionKey: string,
   ) => {
      const transactionRequest = await axios.post(
         `/api/${params.storeId}/transactions`,
         { transaction_date: date },
      );

      const reportTitle = getAutosavedReportTitle(
         transactionRequest.data.id,
         date,
      );

      updateStateAfterTransaction({ transactionRequest, reportTitle });
      saveDraftTransaction({
         draftTransactions,
         draftTransactionKey,
         transactionId: transactionRequest.data.id,
         body,
         reportTitle,
      });
   };

   /**
    * Handles the submission of a new or existing transaction item.
    * @param data - Form values for the transaction item.
    */
   const handleSubmitTransactionItem = async (
      data: TransactionItemFormValues,
   ) => {
      if (!date) return;

      const draftTransactionKey = getLocalStorageKey(params.storeId);
      const draftTransactions = getDraftTransactions(params.storeId);

      const body = createBody(data, date, searchResult);

      try {
         setIsAddingTransactionItem(true);

         if (!transaction) {
            await handleNewTransaction(
               body,
               date,
               draftTransactions,
               draftTransactionKey,
            );
         } else {
            handleExistingTransaction(
               body,
               transaction,
               draftTransactions,
               draftTransactionKey,
            );
         }
      } catch (error: any) {
         console.log('error:', error);
      } finally {
         cleanup();
      }
   };

   /**
    * Sets the form to use an autosaved transaction.
    * @param transaction - The autosaved transaction to be used.
    */
   const handleUseAutoSavedTransaction = (
      transaction: AutoSavedTransaction,
   ) => {
      const { transactionItems } = transaction;

      setIsSearching(false);
      setSearchResult(undefined);
      setTransaction(transaction);
      setDate(transaction.transactionDate || new Date());
      setEnteredReportTitle(transaction.reportTitle);
      setTransactionItems(transactionItems);

      const tableItems = getFormattedItemsForTable(transactionItems);
      setFormattedItems(tableItems);
      setIsAutoSaveModalOpen(false);
      form.reset();

      // if switching from a current edit to an autosaved report, autosave the current edit
      const actualAutoSavedTransactions = getAutoSavedTransactions(
         params.storeId,
      );
      if (
         !autoSaveIsInSync(actualAutoSavedTransactions, autoSavedTransactions)
      ) {
         setAutoSavedTransactions(actualAutoSavedTransactions);
         toast({
            title: 'Autosaved',
         });
      }
   };

   /**
    * Navigate back to the previous page, triggering autosave if needed.
    */
   const onGoBack = () => {
      if (autoSavedTransactions.length > 0) {
         toast({
            title: 'Autosaved',
         });
      }

      router.back();
   };

   /**
    * Handles the submission for product search.
    * @param data - Form values for product query.
    */
   const onSubmit = async (data: ProductQueryFormValues) => {
      try {
         setIsSearching(true);
         const res = await axios.get(
            `/api/${params.storeId}/search?query=${data.query}`,
         );
         if (res.data.length) {
            const product = res.data[0];
            setSearchResult({
               category_id: product.category_id,
               product_name: product.name,
               product_id: product.id,
               sku: product.sku,
               price: product.price,
               cost: product.cost_per_item,
               inventoryCount: product.count,
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

   /**
    * Saves a draft transaction into local storage and updates state.
    * @param params - Object containing body, draftTransactions, draftTransactionKey, reportTitle, and transactionId.
    */
   const saveDraftTransaction = ({
      body,
      draftTransactionKey,
      draftTransactions,
      reportTitle,
      transactionId,
   }: {
      body: TransactionItemBody;
      draftTransactions: Record<string, any>;
      draftTransactionKey: string;
      reportTitle: string;
      transactionId: string;
   }) => {
      const draftTransactionItem = {
         ...body,
         transaction_id: transactionId,
         store_id: params.storeId,
         transaction_report_title: reportTitle,
      };

      draftTransactions[transactionId] = {
         [body.product_id as string]: draftTransactionItem,
      };
      saveItemInLocalStorage(draftTransactionKey, draftTransactions);
      updateItemsState({ draftTransactionItem, transactionId, reportTitle });
   };

   /**
    * Saves the report title and updates the local state.
    */
   const saveReportTitle = () => {
      if (!enteredReportTitle) return;
      const trimmedTitle = enteredReportTitle.trim();
      setEnteredReportTitle(trimmedTitle);
      setIsEditingReportTitle(false);
      updateTransactionAndItems({ transactionReportTitle: trimmedTitle });
   };

   /**
    * Toggles the visibility of the date picker.
    */
   const toggleDatePicker = () => {
      setShowDatePicker(true);
   };

   /**
    * Updates the alert messages state. If the key doesn't exist, adds a new alert message.
    * @param key - Unique identifier for the alert message.
    * @param title - Title of the alert message.
    * @param description - Optional description for the alert message.
    */
   const updateAlertMessages = (
      key: string,
      title: string,
      description: string = '',
   ) => {
      const hasAlert = alertMessages.find((message) => message.key === key);

      if (!hasAlert) {
         setAlertMessages([...alertMessages, { title, description, key }]);
      }
   };

   /**
    * Updates the state variables related to a new transaction.
    * @param params - Object containing the report title and the transaction request data.
    */
   const updateStateAfterTransaction = ({
      reportTitle,
      transactionRequest,
   }: {
      reportTitle: string;
      transactionRequest: any;
   }) => {
      setEnteredReportTitle(reportTitle);
      setTransaction({
         id: transactionRequest.data.id,
         reportTitle,
         transactionDate: transactionRequest.data.transaction_date,
      });
   };

   /**
    * Updates the state for transaction items and their formatted counterparts.
    * @param params - Object containing the draft transaction item, report title, and transaction ID.
    */
   const updateItemsState = ({
      draftTransactionItem,
      reportTitle,
      transactionId,
   }: {
      draftTransactionItem: any;
      reportTitle: string;
      transactionId: string;
   }) => {
      const newItem = createNewItem(
         draftTransactionItem,
         transactionId,
         reportTitle,
      );
      setTransactionItems([...transactionItems, newItem]);
      setFormattedItems(
         getFormattedItemsForTable([...transactionItems, newItem]),
      );
   };

   /**
    * Updates a draft transaction or adds a new one if it doesn't already exist.
    * @param body - Body of the transaction item.
    * @param transaction - Existing transaction information.
    * @param draftTransactions - Current draft transactions.
    * @returns An updated draft transaction.
    */
   const updateDraft = (
      body: TransactionItemBody,
      transaction: Transaction,
      draftTransactions: Record<string, any>,
   ) => {
      const draftTransaction = draftTransactions[transaction.id];
      const draftTransactionItem = {
         ...body,
         transaction_id: transaction.id,
         transaction_report_title: transaction.reportTitle,
      };
      if (draftTransaction[body.product_id as string]) {
         draftTransaction[body.product_id as string].units_sold +=
            body.units_sold;
      } else {
         draftTransaction[body.product_id as string] = draftTransactionItem;
      }
      return draftTransaction;
   };

   /**
    * Updates the date on all current transaction items.
    * @param date - The new date to set.
    */
   const updateDateOnTransactionItems = (date: Date) => {
      updateTransactionAndItems({ transactionDate: date });
   };

   /**
    * Updates the current transaction and its associated items.
    * @param updateObj - Object containing fields to update.
    */
   const updateTransactionAndItems = (updateObj: any) => {
      const { id = 'n/a', reportTitle, transactionDate } = transaction || {};
      setTransaction({
         id,
         reportTitle: updateObj.transactionReportTitle || reportTitle,
         transactionDate: updateObj.transactionDate || transactionDate,
      });

      const updatedItems = transactionItems.map((item) => ({
         ...item,
         ...updateObj,
      }));
      setTransactionItems(updatedItems);

      const updatedDraftItems = updatedItems.map(keysToSnakeCase);
      const updatedDraftTransaction = updatedDraftItems.reduce((acc, curr) => {
         acc[curr.product_id] = curr;
         return acc;
      }, {});

      updateDraftTransactions(params.storeId, id, updatedDraftTransaction);
      setAutoSavedTransactions(getAutoSavedTransactions(params.storeId));
   };

   /**
    * useEffect hook for managing alert messages and state based on the selected date.
    */
   useEffect(() => {
      setShowDatePicker(false);

      if (!date) {
         updateAlertMessages(
            'select-date',
            'Please select a date for this report.',
         );
         setDateButtonVariant('destructive');
         return;
      }

      let filteredAlerts = alertMessages.filter(
         (message) =>
            message.key !== 'invalid-date' && message.key !== 'select-date',
      );

      if (isFuture(date)) {
         updateAlertMessages(
            'invalid-date',
            'Date for report cannot be in the future.',
            'Please select a valid date (Today or a past date)',
         );
         setDateButtonVariant('destructive');
      } else {
         setAlertMessages(filteredAlerts);
         setDateButtonVariant('outline');

         if (
            transaction?.transactionDate &&
            !isSameDay(date, transaction.transactionDate)
         ) {
            updateDateOnTransactionItems(date);
         }
      }
   }, [date]);

   /**
    * useEffect hook for retrieving auto-saved transactions from local storage on component mount.
    */
   useEffect(() => {
      const autoSavedTransactions = getAutoSavedTransactions(params.storeId);
      if (autoSavedTransactions.length > 0) {
         setAutoSavedTransactions(autoSavedTransactions);
         setIsAutoSaveModalOpen(true);
      }
   }, []);

   const displayProductInfo =
      !searching && searchResult?.type === ProductQueryResultType.OK;

   const categorySales = getCategorySalesAndUnits(transactionItems);

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

   const AutoSavedReports = () =>
      autoSavedTransactions.map((item) => {
         return (
            <Button
               className="space-x-2 flex items-center justify-start"
               variant={'outline'}
               onClick={() => handleUseAutoSavedTransaction(item)}
            >
               <p>
                  {item.reportTitle ||
                     getAutosavedReportTitle('unpublished-unsaved')}
               </p>
            </Button>
         );
      });

   const ProductInfoLabel = ({
      title,
      value,
   }: {
      title?: string;
      value?: string;
   }) => (
      <Label htmlFor="gross-sales" className="flex flex-col space-y-1">
         <span className="text-sm">{value}</span>
         <span className="font-normal leading-snug text-muted-foreground">
            {title}
         </span>
      </Label>
   );

   const ReportActionButtons = () => {
      return (
         <div className="space-x-4 flex items-center">
            {autoSavedTransactions.length > 0 && (
               <Button
                  variant={'outline'}
                  onClick={() => setIsAutoSaveModalOpen(true)}
                  disabled={isPublishingReport}
               >
                  <Save className="mr-2 h-4 w-4" />{' '}
                  {`Autosaved reports (${autoSavedTransactions.length})`}
               </Button>
            )}

            {transaction && (
               <Button
                  variant={'destructive'}
                  onClick={() => setIsAlertModalOpen(true)}
                  disabled={isPublishingReport}
               >
                  <Trash className="mr-2 h-4 w-4" /> Discard
               </Button>
            )}

            <LoadingButton
               variant={'outline'}
               onClick={() => setIsPublishingReport(true)}
               disabled={alertMessages.length != 0 || isPublishingReport}
               isLoading={isPublishingReport}
            >
               {!isPublishingReport && <Send className="mr-2 h-4 w-4" />}
               Publish
            </LoadingButton>
            <Button
               variant={'outline'}
               onClick={createNewReport}
               disabled={isPublishingReport}
            >
               <PlusCircle className="mr-2 h-4 w-4" />
               New
            </Button>
         </div>
      );
   };

   const ReportTitleActionButtons = () => {
      return (
         <>
            {!isEditingReportTitle && (
               <Button
                  variant={'outline'}
                  onClick={() => setIsEditingReportTitle(true)}
                  disabled={isPublishingReport}
               >
                  Edit
               </Button>
            )}

            {isEditingReportTitle && (
               <>
                  <Button
                     onClick={saveReportTitle}
                     disabled={
                        !enteredReportTitle || !enteredReportTitle.trim()
                     }
                  >
                     Save
                  </Button>
                  <Button
                     variant={'outline'}
                     onClick={() => setIsEditingReportTitle(false)}
                  >
                     Cancel
                  </Button>
               </>
            )}
         </>
      );
   };

   return (
      <>
         <Alerts />
         <ActionModal
            isOpen={isAutoSaveModalOpen}
            title="Autosaved reports"
            description="Continue working on an unpublished report"
            onClose={() => setIsAutoSaveModalOpen(false)}
         >
            <div className="flex flex-col space-y-4">
               <AutoSavedReports />
            </div>
         </ActionModal>
         <AlertModal
            isOpen={isAlertModalOpen}
            onClose={() => {
               setIsAlertModalOpen(false);
            }}
            onConfirm={deleteReport}
            title={'Delete this report?'}
            description={'This action cannot be undone.'}
            loading={isDeletingReport}
         />
         <div className="flex">
            <Button
               variant={'outline'}
               onClick={onGoBack}
               disabled={isPublishingReport}
            >
               <ArrowLeft className="mr-2 h-4 w-4" />
            </Button>
         </div>
         <div className="flex items-center justify-between space-y-2">
            <Heading
               title={`Add new sales report`}
               description="Track the daily sales operations of your store"
            />

            <ReportActionButtons />
         </div>
         <Separator />

         <div className="flex py-4 gap-16">
            <div className="flex flex-col w-[50%] gap-16">
               <Form {...form}>
                  <form
                     onSubmit={form.handleSubmit(onSubmit)}
                     className="flex-col space-y-8 pt-8"
                  >
                     <div className="flex gap-8 justify-center">
                        <div className="w-full">
                           <FormField
                              control={form.control}
                              name="query"
                              render={({ field }) => (
                                 <FormItem>
                                    <FormControl>
                                       <Input
                                          disabled={
                                             searching ||
                                             isAddingTransactionItem ||
                                             isPublishingReport
                                          }
                                          placeholder="Enter product SKU..."
                                          {...field}
                                       />
                                    </FormControl>
                                    <FormMessage />
                                 </FormItem>
                              )}
                           />
                        </div>

                        <Button
                           type="submit"
                           disabled={
                              searching ||
                              isAddingTransactionItem ||
                              isPublishingReport
                           }
                        >
                           <Search className="mr-2 h-4 w-4" /> Search
                        </Button>
                     </div>
                  </form>
               </Form>

               <div className="w-full">
                  {(searching || searchResult) && (
                     <Card className="bg-background w-full">
                        <CardHeader>
                           <CardDescription className="flex items-center">
                              {!searching && searchResult
                                 ? 'Search result'
                                 : 'Searching...'}
                           </CardDescription>
                        </CardHeader>
                        <CardContent>
                           <div className="flex justify-between">
                              {searching ? (
                                 <div className="flex w-full flex-col gap-2">
                                    <Skeleton className="w-[80%] h-[32px]" />
                                    <Skeleton className="w-[40%] h-[32px]" />
                                 </div>
                              ) : (
                                 <>
                                    {displayProductInfo && (
                                       <div className="flex items-center gap-16 space-x-2">
                                          <ProductInfoLabel
                                             title="Product name"
                                             value={searchResult?.product_name}
                                          />
                                          <ProductInfoLabel
                                             title="List price"
                                             value={fmt.format(
                                                parseFloat(
                                                   String(searchResult.price),
                                                ),
                                             )}
                                          />
                                       </div>
                                    )}
                                    {displayProductInfo && (
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
                                                            className="w-[80px]"
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
                                             <LoadingButton
                                                variant={'outline'}
                                                type="submit"
                                                disabled={
                                                   isAddingTransactionItem ||
                                                   date == undefined ||
                                                   isPublishingReport
                                                }
                                                isLoading={
                                                   isAddingTransactionItem
                                                }
                                             >
                                                {!isAddingTransactionItem && (
                                                   <Plus className="mr-2 h-4 w-4" />
                                                )}
                                                Add
                                             </LoadingButton>
                                          </form>
                                       </Form>
                                    )}
                                 </>
                              )}
                           </div>

                           {!searching &&
                              searchResult?.type ===
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

            {!showDatePicker && (
               <TooltipProvider>
                  <Tooltip>
                     <TooltipTrigger asChild>
                        <Button
                           className="mt-8 space-x-2"
                           variant={dateButtonVariant}
                           onClick={toggleDatePicker}
                           disabled={isPublishingReport}
                        >
                           <Calendar className="w-4 h-4 text-muted-foreground" />
                           <p>{date && `${format(date, 'MMMM dd, yyyy')}`}</p>
                        </Button>
                     </TooltipTrigger>
                     <TooltipContent>
                        <p>Report date</p>
                     </TooltipContent>
                  </Tooltip>
               </TooltipProvider>
            )}
            {showDatePicker && (
               <div className="flex flex-col">
                  <CalendarDatePicker date={date} setDate={setDate} />
                  <Button
                     className="mt-8 space-x-2"
                     variant={'outline'}
                     onClick={() => setShowDatePicker(false)}
                     disabled={isPublishingReport}
                  >
                     Cancel
                  </Button>
               </div>
            )}
         </div>

         <div className="flex justify-between gap-24 pt-4 w-full">
            {transaction && (
               <div className="w-full space-y-4">
                  <div className="flex gap-4 items-center">
                     <TooltipProvider>
                        <Tooltip>
                           <TooltipTrigger asChild>
                              <div className="flex">
                                 {!isEditingReportTitle && (
                                    <span className="text-xl font-bold">
                                       {transaction.reportTitle ||
                                          getAutosavedReportTitle(
                                             transaction.id,
                                             transaction.transactionDate,
                                          )}
                                    </span>
                                 )}

                                 {isEditingReportTitle && (
                                    <Input
                                       placeholder="Enter report title..."
                                       disabled={isPublishingReport}
                                       onChange={(e) =>
                                          setEnteredReportTitle(e.target.value)
                                       }
                                       value={enteredReportTitle}
                                    />
                                 )}
                              </div>
                           </TooltipTrigger>
                           <TooltipContent>
                              <p>Report title</p>
                           </TooltipContent>
                        </Tooltip>
                     </TooltipProvider>

                     <ReportTitleActionButtons />
                  </div>

                  <Separator />

                  <div className="flex w-full gap-24">
                     <div
                        className={`w-[60%] space-y-4 ${
                           isPublishingReport
                              ? 'pointer-events-none opacity-50'
                              : ''
                        }`}
                     >
                        <span className="text-muted-foreground">
                           Transactions
                        </span>
                        <DataTableToolbar
                           searchKey="productName"
                           tableKey="subcategories"
                           placeholder="Filter transactions..."
                           table={table}
                        />
                        <DataTable table={table} columns={columns} />
                     </div>

                     <div
                        className={`space-y-8 w-[40%] pt-2 ${
                           isPublishingReport
                              ? 'pointer-events-none opacity-50'
                              : ''
                        }`}
                     >
                        <span className="text-muted-foreground">
                           Report summary
                        </span>
                        <div className="grid grid-cols-2 space-x-8 pt-6">
                           <Card>
                              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                 <CardTitle className="text-sm font-medium">
                                    Gross Sales
                                 </CardTitle>
                                 <DollarSign className="h-4 w-4 text-muted-foreground" />
                              </CardHeader>
                              <CardContent>
                                 <div className="text-2xl font-bold">
                                    {fmt.format(
                                       getTotalSales(transactionItems),
                                    )}
                                 </div>
                              </CardContent>
                           </Card>

                           <Card>
                              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                 <CardTitle className="text-sm font-medium">
                                    Total Units Sold
                                 </CardTitle>
                                 <PackageCheck className="h-4 w-4 text-muted-foreground" />
                              </CardHeader>
                              <CardContent>
                                 <div className="text-2xl font-bold">
                                    {getTotalUnitsSold(transactionItems)}
                                 </div>
                              </CardContent>
                           </Card>
                        </div>

                        {Object.keys(categorySales).length > 0 && (
                           <div className="flex flex-col space-y-4">
                              <span className="text-muted-foreground mb-4">
                                 Breakdown by categories
                              </span>
                              {Object.keys(categorySales).map((item) => {
                                 return (
                                    <>
                                       <div className="flex justify-between">
                                          <div className="w-1/3">
                                             <span>{item}</span>
                                          </div>
                                          <div className="w-1/3 text-center">
                                             <span>
                                                {categorySales[item].unitsSold >
                                                1
                                                   ? `${categorySales[item].unitsSold} units`
                                                   : `${categorySales[item].unitsSold} unit`}
                                             </span>
                                          </div>
                                          <div className="w-1/3 text-right">
                                             <span>
                                                {fmt.format(
                                                   categorySales[item]
                                                      .totalSales,
                                                )}
                                             </span>
                                          </div>
                                       </div>
                                       <Separator />
                                    </>
                                 );
                              })}
                           </div>
                        )}
                     </div>
                  </div>
               </div>
            )}
         </div>
      </>
   );
};
