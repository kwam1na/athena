'use client';

import * as z from 'zod';
import { captureException } from '@sentry/nextjs';
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
   Banknote,
   Calendar,
   DollarSign,
   PackageCheck,
   PackageMinus,
   Plus,
   PlusCircle,
   Save,
   Search,
   Send,
   Trash,
   X,
   XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
   Form,
   FormControl,
   FormDescription,
   FormField,
   FormItem,
   FormLabel,
   FormMessage,
} from '@/components/ui/form';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { CalendarDatePicker } from '@/components/ui/date-picker';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoreCurrency } from '@/providers/currency-provider';
import { formatter, keysToCamelCase, keysToSnakeCase } from '@/lib/utils';
import { format, isFuture, isSameDay, set } from 'date-fns';
import { ActionModal } from '@/components/modals/action-modal';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertModal } from '@/components/modals/alert-modal';
import { LoadingButton } from '@/components/ui/loading-button';
import {
   autoSaveIsInSync,
   getAutosavedReportTitle,
   getCategorySalesAndUnits,
   getNetRevenue,
   getTotalSales,
   getTotalUnitsSold,
   areTransactionItemsInSync,
} from '../utils';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import {
   Tooltip,
   TooltipContent,
   TooltipTrigger,
} from '@/components/ui/tooltip';
import {
   Table,
   TableBody,
   TableCell,
   TableHead,
   TableHeader,
   TableRow,
} from '@/components/ui/table';
import {
   apiCreateTransaction,
   apiDeleteTransaction,
} from '@/lib/api/transactions';

import { apiRestockAndDeleteTransactionItem } from '@/lib/api/restock';
import { Switch } from '@/components/ui/switch';
import {
   AlertMessage,
   AutoSavedTransaction,
   ReportEntryAction,
   Transaction,
   TransactionItem,
   TransactionItemBody,
} from '@/types/transactions';
import {
   apiPublishReport,
   apiQueryForProduct,
} from '@/lib/api/store-functions';
import { ServiceError } from '@/lib/error';
import { MetricCard } from '@/components/ui/metric-card';
import { apiUpdateProduct } from '@/lib/api/products';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import { TransactionsAutosaver } from '../utils/transactions-autosaver';
import { motion } from 'framer-motion';
import { widgetVariants } from '@/lib/constants';
import logger from '@/lib/logger/console-logger';

interface IndividualSearchResultProps {
   index: number;
   result: ProductQueryResult;
}

interface TransactionsReportClientProps {
   fetchedTransaction?: Transaction;
}

enum ProductQueryResultType {
   OK,
   NO_RESULTS,
}

interface ProductQueryResult {
   category_id?: string;
   category?: Record<string, any>;
   cost?: string;
   inventory_count?: number;
   organization_id?: number;
   price?: string;
   product_id?: string;
   product_name?: string;
   store_id?: number;
   sku?: string;
   subcategory?: Record<string, any>;
   subcategory_id?: string;
   type: ProductQueryResultType;
}

const formSchema = z.object({
   query: z.string().min(1),
});

const inventoryCountFormSchema = z.object({
   count: z.coerce.number().min(1),
});

const transactionItemFormSchema = z.object({
   unitsSold: z.coerce.number().min(1),
});

type ProductQueryFormValues = z.infer<typeof formSchema>;
type TransactionItemFormValues = z.infer<typeof transactionItemFormSchema>;
type InventoryCountFormValues = z.infer<typeof inventoryCountFormSchema>;

export const TransactionsReportClient: React.FC<
   TransactionsReportClientProps
> = ({ fetchedTransaction }) => {
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
   const [isUseSavedEditModalOpen, setIsUseSavedEditModalOpen] =
      useState(false);
   const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
   const [
      isDeletePublishedReportModalOpen,
      setIsDeletePublishedReportModalOpen,
   ] = useState(false);
   const [isDeletingReport, setIsDeletingReport] = useState(false);
   const [isDeletingReportWithRestock, setIsDeletingReportWithRestock] =
      useState(false);

   // set delete report with restock to true by default
   const [deleteReportWithRestock, setDeleteReportWithRestock] = useState(true);
   const [isEditingReportTitle, setIsEditingReportTitle] = useState(false);
   const [isAddingTransactionItem, setIsAddingTransactionItem] =
      useState(false);
   const [isPublishingReport, setIsPublishingReport] = useState(false);
   const [allowForceDelete, setAllowForceDelete] = useState(false);
   const [isUsingSavedEditedReport, setIsUsingSavedEditedReport] =
      useState(false);

   const [addingItemButtonStates, setAddingItemButtonStates] = useState<
      Record<number, boolean>
   >({});
   const [searchResult, setSearchResult] = useState<
      ProductQueryResult | undefined
   >(undefined);
   const [searchResults, setSearchResults] = useState<
      ProductQueryResult[] | undefined
   >(undefined);

   const [savedEditedTransaction, setSavedEditedTransaction] = useState<
      Transaction | undefined
   >(undefined);
   const [date, setDate] = useState<Date | undefined>(
      fetchedTransaction?.transactionDate || new Date(),
   );
   const [transaction, setTransaction] = useState<Transaction | undefined>(
      fetchedTransaction || undefined,
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
   const [alertModalCTAText, setAlertModalCTAText] = useState('Continue');
   const [headerText, setHeaderText] = useState(
      fetchedTransaction ? 'Edit sales report' : 'Create new sales report',
   );
   const [reportEntryAction, setReportEntryAction] =
      useState<ReportEntryAction>(fetchedTransaction ? 'editing' : 'new');

   const params = useParams();
   const pathName = usePathname();
   const router = useRouter();
   const baseStoreURL = useGetBaseStoreUrl();
   const { toast } = useToast();

   const entryAction = fetchedTransaction ? 'editing' : 'new';
   const transactionsAutosaver = new TransactionsAutosaver(
      params.storeId,
      entryAction,
   );

   const { storeCurrency, loading: isLoadingCurrency } = useStoreCurrency();
   const fmt = formatter(storeCurrency);

   // const [reportFormatCurrency, setReportFormatCurrency] =
   //    useState(storeCurrency);
   // const { exchangeRate } = useExchangeRate();

   const table = useReactTable({
      data: formattedItems,
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

   const searchQueryForm = useForm<ProductQueryFormValues>({
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
    * Check if there is a saved edit and populate the form with it if it exists.
    * @param {Transaction} fetchedTransaction - The transaction fetched from the server.
    * @return {boolean} - True if a saved edit exists, there are changes made and the saved transaction state was set up to be used,
    * otherwise false.
    */
   const checkForSavedEdit = (fetchedTransaction: Transaction): boolean => {
      const savedEditedTransactions =
         transactionsAutosaver.getEditedTransactions(params.storeId);
      const savedEdit = savedEditedTransactions[fetchedTransaction.id];

      const searchParams = new URLSearchParams(window.location.search);
      const retrievedReportEntryAction = searchParams.get(
         'report_entry_action',
      );

      searchParams.delete('report_entry_action');

      const urlWithoutParams = window.location.pathname;
      if (searchParams.toString()) {
         window.history.replaceState(null, '', `?${searchParams.toString()}`);
      } else {
         window.history.replaceState(null, '', urlWithoutParams);
      }

      if (savedEdit && Object.keys(savedEdit).length > 0) {
         const savedItems = Object.keys(savedEdit).map((item) =>
            keysToCamelCase(savedEdit[item]),
         );

         if (
            !areTransactionItemsInSync(
               savedItems,
               fetchedTransaction.transactionItems || [],
            )
         ) {
            const savedEditedTransactionReport =
               setupSavedEditedTransaction(savedItems);

            // if the user is navigated back to this page via the return_url, don't show the modal.
            // automatically use the saved edited transaction report.
            if (retrievedReportEntryAction === 'editing') {
               useSavedEditedTransactionReport(savedEditedTransactionReport);
            } else setIsUseSavedEditModalOpen(true);

            return true;
         }
      }

      return false;
   };

   /**
    * Resets the state variables related to adding a new transaction item.
    */
   const cleanup = (index: number) => {
      setAddingItemButtonStates({
         ...addingItemButtonStates,
         [index]: false,
      });
      setSearchResults(undefined);
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
      category: searchResult?.category?.name,
      category_id: searchResult?.category_id,
      cost: searchResult?.cost,
      organization_id: searchResult?.organization_id,
      price: searchResult?.price,
      product_name: searchResult?.product_name,
      product_id: searchResult?.product_id,
      store_id: searchResult?.store_id,
      subcategory: searchResult?.subcategory?.name,
      sku: searchResult?.sku,
      units_sold: data.unitsSold,
      subcategory_id: searchResult?.subcategory_id,
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
         organizationId: parseInt(params.organizationId),
         price: draftTransactionItem.price,
         productId: draftTransactionItem.product_id,
         sku: draftTransactionItem.sku,
         productName: draftTransactionItem.product_name,
         storeId: parseInt(params.storeId),
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
      setSearchResults(undefined);
      setIsSearching(false);
      setAllowForceDelete(false);
      setEnteredReportTitle(undefined);
      setDate(new Date());
      setHeaderText('Add new sales report');
      setReportEntryAction('new');
      searchQueryForm.reset();

      const autoSavedTransactionsInLocalStorage =
         transactionsAutosaver.getAutosavedTransactions();

      // if editing, don't autosave as edits are saved under their own local storage key
      if (!fetchedTransaction) {
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
      }
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
         logger.info('action: began deleteReport', {
            storeId: params.storeId,
            transactionId: transaction?.id,
         });
         if (deleteReportWithRestock && fetchedTransaction) {
            setIsDeletingReportWithRestock(true);
         } else setIsDeletingReport(true);

         await apiDeleteTransaction(
            transaction.id,
            params.storeId,
            deleteReportWithRestock,
         );
         transactionsAutosaver.remove(transaction.id);

         handleDoneDeletingReport();

         toast({
            title: 'Report deleted successfully.',
         });
         router.refresh();
         router.push(`${baseStoreURL}/transactions`);
         createNewReport();
      } catch (error) {
         console.log(
            '[ADD_NEW_SALES_REPORT_ERROR] Error deleting transaction:',
            error,
         );
         captureException(error);

         const { data } = (error as any).response;
         const { errorCode } = data;

         let errorMessage = 'An error occured deleting this report. Try again.';
         if (errorCode === 'P2025') {
            errorMessage =
               'An error occured deleting this report. You can try again by force-deleting it.';
            setAllowForceDelete(true);
            setAlertModalCTAText('Force delete');
         }

         toast({
            title: errorMessage,
            description: (error as Error).message,
         });

         logger.info('action: deleteReport', {
            storeId: params.storeId,
            transactionId: transaction?.id,
            error: (error as Error).message,
         });
      } finally {
         if (deleteReportWithRestock) {
            setIsDeletingReportWithRestock(false);
         } else setIsDeletingReport(false);
         logger.info('action: deleteReport', {
            storeId: params.storeId,
            transactionId: transaction?.id,
         });
      }
   };

   /**
    * Deletes a list of TransactionItems from the database by their IDs.
    *
    * @param itemIDs - The array of IDs for the TransactionItems to be deleted.
    */
   const deleteTransactionItems = async (itemIDs: string[]) => {
      await Promise.all(
         itemIDs.map((id) =>
            apiRestockAndDeleteTransactionItem(id, params.storeId),
         ),
      );
   };

   /**
    * Discards the saved edited report and sets up state to use the fetched transaction.
    */
   const discardSavedEditedReport = () => {
      if (!fetchedTransaction) return;

      transactionsAutosaver.removeEditedTransactions(
         fetchedTransaction.id,
         params.storeId,
      );

      setIsUseSavedEditModalOpen(false);
      setIsUsingSavedEditedReport(false);

      setDate(fetchedTransaction.transactionDate || new Date());
      setTransactionItems(fetchedTransaction.transactionItems || []);
      setEnteredReportTitle(fetchedTransaction.reportTitle);
      const tableItems = getFormattedItemsForTable(
         fetchedTransaction.transactionItems || [],
      );
      setFormattedItems(tableItems);

      // set up a local copy for this edit
      const draftItems = fetchedTransaction.transactionItems?.map((item) =>
         keysToSnakeCase(item),
      );

      const products: Record<string, any> = {};
      draftItems?.forEach((item) => {
         products[item.product_id] = item;
      });

      const savedEditedTransactions =
         transactionsAutosaver.getEditedTransactions(params.storeId);
      savedEditedTransactions[fetchedTransaction.id] = products;

      transactionsAutosaver.save(savedEditedTransactions);
   };

   /**
    * Identifies TransactionItems that are present in the fetched transaction but missing in the current state.
    * These are the items to be removed.
    *
    * @param fetchedTransactionItems - The list of TransactionItems fetched from the database
    * @param currentTransactionItems - The current list of TransactionItems being edited
    * @returns An array of IDs that identifies which items should be removed from the database
    */
   const findTransactionItemsToRemove = (
      fetchedTransactionItems: TransactionItem[] | undefined,
      currentTransactionItems: TransactionItem[],
   ): string[] => {
      const currentIds = new Set(
         currentTransactionItems.map((item) => item.id),
      );
      const itemsToRemove: string[] = [];

      fetchedTransactionItems?.forEach((fetchedItem) => {
         if (!currentIds.has(fetchedItem.id)) {
            itemsToRemove.push(fetchedItem.id || '');
         }
      });

      return itemsToRemove;
   };

   /**
    * Removes the draft transaction stored in local storage for the current transaction report.
    */
   const forceDeleteReport = () => {
      if (!transaction) return;
      transactionsAutosaver.remove(transaction.id);
      setIsAlertModalOpen(false);
      setAllowForceDelete(false);
      toast({
         title: 'Report deleted successfully.',
      });
      router.refresh();
      createNewReport();
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
         reportEntryAction,
         setAlertMessages,
         setTransactionItems,
         setFormattedItems,
         setAutoSavedTransactions,
         transactionsAutosaver,
      }));
   };

   /**
    * Puts the transaction id and report entry action in the url to be used when navigating back to this page.
    * @returns a string containing the transaction id and report entry action if the report entry action is 'new',
    * otherwise just the report entry action.
    */
   const getTransactionAndReportActionInUrl = () => {
      if (reportEntryAction === 'new') {
         return `transaction_id=${transaction?.id}&report_entry_action=${reportEntryAction}`;
      } else {
         return `report_entry_action=${reportEntryAction}`;
      }
   };

   /**
    * Handles showing the appropriate alert modal when the user attempts to delete a report
    */
   const handleDeleteReport = () => {
      if (fetchedTransaction) {
         setIsDeletePublishedReportModalOpen(true);
      } else {
         setIsAlertModalOpen(true);
      }
   };

   /**
    * Handles hiding the appropriate alert modal when the user attempts to delete a report
    */
   const handleDoneDeletingReport = () => {
      if (fetchedTransaction) {
         setIsDeletePublishedReportModalOpen(false);
      } else {
         setIsAlertModalOpen(false);
      }
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
   ) => {
      const updatedDraft = updateDraft(body, transaction, draftTransactions);
      draftTransactions[transaction.id] = updatedDraft;
      transactionsAutosaver.save(draftTransactions);

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
   ) => {
      const transactionRequest = await apiCreateTransaction(params.storeId, {
         transaction_date: date,
         organization_id: params.organizationId,
      });

      const reportTitle = getAutosavedReportTitle(transactionRequest.id, date);

      updateStateAfterTransaction({ transactionRequest, reportTitle });
      saveDraftTransaction({
         draftTransactions,
         transactionId: transactionRequest.id,
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
      result: ProductQueryResult,
      index: number,
   ) => {
      if (!date) return;

      const draftTransactions = transactionsAutosaver.getAll();
      const body = createBody(data, date, result);

      try {
         logger.info('action: began addTransactionItem', {
            storeId: params.storeId,
            transactionId: transaction?.id,
            item: {
               unitsSold: data.unitsSold,
               product: result.product_name,
               productId: result.product_id,
            },
         });
         setAddingItemButtonStates({
            ...addingItemButtonStates,
            [index]: true,
         });

         if (!transaction) {
            await handleNewTransaction(body, date, draftTransactions);
         } else {
            handleExistingTransaction(body, transaction, draftTransactions);
         }
      } catch (error: any) {
         logger.error('action: addTransactionItem', {
            storeId: params.storeId,
            transactionId: transaction?.id,
            error: (error as Error).message,
         });
         captureException(error);
         toast({
            title: 'An error occurred performing this operation',
            description: `Error: ${(error as Error).message}`,
         });
      } finally {
         searchQueryForm.reset();
         cleanup(index);
         logger.info('action: addTransactionItem', {
            storeId: params.storeId,
            transactionId: transaction?.id,
            item: {
               unitsSold: data.unitsSold,
               product: result.product_name,
               productId: result.product_id,
            },
         });
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
      searchQueryForm.reset();

      // if switching from a current edit to an autosaved report, autosave the current edit
      const actualAutoSavedTransactions =
         transactionsAutosaver.getAutosavedTransactions();

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
      if (
         (transaction && !fetchedTransaction) ||
         autoSavedTransactions.length > 0
      ) {
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
   const onSubmitSearchQuery = async (data: ProductQueryFormValues) => {
      try {
         setIsSearching(true);
         const res = await apiQueryForProduct(params.storeId, data.query);
         if (res.length) {
            const products = res.map((product: any) => ({
               category_id: product.category_id,
               product_name: product.name,
               product_id: product.id,
               sku: product.sku,
               price: product.price,
               cost: product.cost_per_item,
               inventory_count: product.inventory_count,
               type: ProductQueryResultType.OK,
               ...product,
            }));
            setSearchResults(products);
         } else {
            setSearchResults([]);
         }
      } catch (error: any) {
         captureException(error);
      } finally {
         setIsSearching(false);
      }
   };

   /**
    * Publishes the report.
    *
    * This is called when the user creates a new report or edits a published one.
    */
   const publishReport = async () => {
      if (!transaction) return;

      const itemsToRemove = findTransactionItemsToRemove(
         fetchedTransaction?.transactionItems,
         transactionItems,
      );

      try {
         logger.info('action: began publishing Report', {
            storeId: params.storeId,
            transactionId: transaction?.id,
         });

         setIsPublishingReport(true);

         const payload = transactionItems.map((item) => keysToSnakeCase(item));

         await apiPublishReport(params.storeId, {
            transaction_items: payload,
            transaction,
            transaction_details: {
               gross_sales: getTotalSales(transactionItems),
               net_revenue: getNetRevenue(transactionItems),
               transaction_date: date,
               units_sold: getTotalUnitsSold(transactionItems),
            },
         });

         if (itemsToRemove.length > 0)
            await deleteTransactionItems(itemsToRemove);

         transactionsAutosaver.remove(transaction.id);
         router.refresh();
         router.push(`${baseStoreURL}/transactions`);
         toast({
            title: `Report "${transaction.reportTitle}" published successfully.`,
         });
      } catch (error) {
         captureException(error);
         const { details } = error as ServiceError;
         const { offendingItems } = details;

         const messages = offendingItems?.map((item: any) => ({
            title: `Inventory shortage for ${item.product_name}`,
            description: item.existing_units_sold
               ? `Originally reported: ${item.existing_units_sold} units sold. Now reporting: ${item.updated_provided_units_sold}. Available stock: ${item.inventory_count}. Update exceeds stock.`
               : `Only ${item.inventory_count} units available. Cannot report ${item.provided_units_sold} units sold.`,
            key: item.product_id,
         }));

         if (messages) setAlertMessages(messages);

         toast({
            title: 'An error occurred publishing this report',
            description: `Error: ${(error as ServiceError).message}`,
         });

         logger.error('action: publishReport', {
            storeId: params.storeId,
            transactionId: transaction?.id,
            error: (error as Error).message,
         });
      } finally {
         setIsPublishingReport(false);
         logger.info('action: publishReport', {
            storeId: params.storeId,
            transactionId: transaction?.id,
         });
      }
   };

   /**
    * Saves a draft transaction into local storage and updates state.
    * @param params - Object containing body, draftTransactions, draftTransactionKey, reportTitle, and transactionId.
    */
   const saveDraftTransaction = ({
      body,
      draftTransactions,
      reportTitle,
      transactionId,
   }: {
      body: TransactionItemBody;
      draftTransactions: Record<string, any>;
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
      transactionsAutosaver.save(draftTransactions);
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
    * Save the fetched transaction locally for future editing.
    */
   const saveFetchedTransaction = () => {
      if (!fetchedTransaction) return;
      // set up a local copy for this edit
      const savedEditedTransactions =
         transactionsAutosaver.getEditedTransactions(params.storeId);
      const draftItems = fetchedTransaction.transactionItems?.map((item) =>
         keysToSnakeCase(item),
      );
      const products: Record<string, any> = {};
      draftItems?.forEach((item) => {
         products[item.product_id] = item;
      });
      savedEditedTransactions[fetchedTransaction.id] = products;
      transactionsAutosaver.saveEditedTransactions(
         params.storeId,
         savedEditedTransactions,
      );
   };

   /**
    * Initializes state from a fetched transaction.
    * @param {Transaction} fetchedTransaction - The transaction fetched from the server.
    */
   const setupFromFetchedTransaction = (fetchedTransaction: Transaction) => {
      setDate(fetchedTransaction.transactionDate || new Date());
      setTransactionItems(fetchedTransaction.transactionItems || []);
      setEnteredReportTitle(fetchedTransaction.reportTitle);
      setFormattedItems(
         getFormattedItemsForTable(fetchedTransaction.transactionItems || []),
      );
      saveFetchedTransaction();
   };

   /**
    * Sets up the saved edited transaction state to be used if user confirms.
    * @param {TransactionItem[]} savedItems - Array of saved transaction items.
    */
   const setupSavedEditedTransaction = (savedItems: TransactionItem[]) => {
      if (!fetchedTransaction) return;
      const savedEditedReport: Transaction = {
         id: fetchedTransaction.id,
         transactionDate: new Date(savedItems[0].transactionDate || new Date()),
         transactionItems: savedItems,
         reportTitle: savedItems[0].transactionReportTitle,
      };
      setSavedEditedTransaction(savedEditedReport);
      return savedEditedReport;
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
         id: transactionRequest.id,
         reportTitle,
         transactionDate: transactionRequest.transaction_date,
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

      transactionsAutosaver.update(id, updatedDraftTransaction);

      // only update local auto saved transactions if working on new reports
      if (reportEntryAction === 'new') {
         setAutoSavedTransactions(
            transactionsAutosaver.getAutosavedTransactions(),
         );
      }
   };

   /**
    * Uses the saved edited report
    */
   const useSavedEditedTransactionReport = (
      savedTransactionReport?: Transaction,
   ) => {
      const report = savedTransactionReport || savedEditedTransaction;
      if (!report) return;

      const { transactionDate, transactionItems, reportTitle } = report;
      setDate(transactionDate);
      setTransactionItems(transactionItems || []);
      setEnteredReportTitle(reportTitle);
      setTransaction(report);
      const tableItems = getFormattedItemsForTable(transactionItems || []);
      setFormattedItems(tableItems);
      setIsUsingSavedEditedReport(true);
      setIsUseSavedEditModalOpen(false);
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

         // check for when the date for the report is updated
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
      // if editing, don't get autosaved transactions
      if (!fetchedTransaction) {
         const autoSavedTransactions =
            transactionsAutosaver.getAutosavedTransactions();

         if (autoSavedTransactions.length > 0) {
            setAutoSavedTransactions(autoSavedTransactions);

            // check if the user was navigated back here from a different page.
            // if so, use the transaction id to automatically fetch the autosaved transaction
            // and don't show the modal
            const searchParams = new URLSearchParams(window.location.search);
            const retrievedReportEntryAction = searchParams.get(
               'report_entry_action',
            );
            const retrievedTransactionId = searchParams.get('transaction_id');

            // Remove params after they're used
            searchParams.delete('report_entry_action');
            searchParams.delete('transaction_id');

            const urlWithoutParams = window.location.pathname;
            if (searchParams.toString()) {
               window.history.replaceState(
                  null,
                  '',
                  `?${searchParams.toString()}`,
               );
            } else {
               window.history.replaceState(null, '', urlWithoutParams);
            }

            if (
               retrievedReportEntryAction === 'new' &&
               retrievedTransactionId
            ) {
               const autoSavedTransaction = autoSavedTransactions.find(
                  (item) => item.id === retrievedTransactionId,
               );
               if (autoSavedTransaction) {
                  handleUseAutoSavedTransaction(autoSavedTransaction);
               }
            } else {
               setIsAutoSaveModalOpen(true);
            }
         }
      }
   }, []);

   /**
    * useEffect hook for setting up the form with the fetched transaction on component mount.
    */
   useEffect(() => {
      // const searchParams = new URLSearchParams(window.location.search);
      // const retrievedReportEntryAction = searchParams.get(
      //    'report_entry_action',
      // );
      // const retrievedTransactionId = searchParams.get('transaction_id');
      // console.log('retrievedReportEntryAction', retrievedReportEntryAction);
      // console.log('retrievedTransactionId', retrievedTransactionId);

      if (fetchedTransaction) {
         if (!checkForSavedEdit(fetchedTransaction)) {
            setupFromFetchedTransaction(fetchedTransaction);
         }
      }
   }, []);

   useEffect(() => {
      const performSearch = async () => {
         const searchParams = new URLSearchParams(window.location.search);
         const query = searchParams.get('query');

         if (query) {
            await onSubmitSearchQuery({ query });

            // Remove 'query' param after it's used
            searchParams.delete('query');

            const urlWithoutParams = window.location.pathname;
            if (searchParams.toString()) {
               window.history.replaceState(
                  null,
                  '',
                  `?${searchParams.toString()}`,
               );
            } else {
               window.history.replaceState(null, '', urlWithoutParams);
            }
         }
      };

      performSearch();
   }, []);

   const displayProductInfo =
      !searching && searchResults && searchResults.length > 0;

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

   const AutoSavedReports = () =>
      autoSavedTransactions.map((item) => {
         return (
            <Button
               className="space-x-2 flex items-center justify-start"
               variant={'outline'}
               key={item.id}
               onClick={() => handleUseAutoSavedTransaction(item)}
            >
               <p>
                  {item.reportTitle ||
                     getAutosavedReportTitle('unpublished-unsaved')}
               </p>
            </Button>
         );
      });

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

   const IndividualSearchResult: React.FC<IndividualSearchResultProps> = ({
      index,
      result,
   }) => {
      const [isOverStockCount, setIsOverStockCount] = useState(false);

      const [isUpdatingProduct, setIsUpdatingProduct] = useState(false);
      const [isEditInventoryCountModalOpen, setIsEditInventoryCountModalOpen] =
         useState(false);
      const [invalidUpdatedInventoryCount, setInvalidUpdatedInventoryCount] =
         useState(false);
      const [updatedInventoryCount, setUpdatedInventoryCount] = useState<
         number | undefined
      >(undefined);

      const { handleSubmit, control } = useForm<TransactionItemFormValues>({
         resolver: zodResolver(transactionItemFormSchema),
         defaultValues: {
            unitsSold: 1,
         },
      });

      const onSubmit: SubmitHandler<TransactionItemFormValues> = (data) => {
         const { unitsSold } = data;
         const productInventoryCount = result.inventory_count || 0;

         if (productInventoryCount < 1 || unitsSold > productInventoryCount) {
            setIsOverStockCount(true);
         } else handleSubmitTransactionItem(data, result, index);
      };

      const searchFormValues = searchQueryForm.watch();
      const { query } = searchFormValues;

      const onClose = () => {
         setIsEditInventoryCountModalOpen(false);
      };

      const updateInventoryCount = async () => {
         setIsUpdatingProduct(true);
         try {
            await apiUpdateProduct(result.product_id || 'n/a', params.storeId, {
               inventory_count: updatedInventoryCount,
            });
            toast({
               title: `Inventory for ${result.product_name} updated successfully.`,
            });
            setIsEditInventoryCountModalOpen(false);
            setUpdatedInventoryCount(undefined);
            await onSubmitSearchQuery({ query });
         } catch (error) {
            console.log('error:', error);
            toast({
               title: 'An error occured updating the inventory count of this product.',
            });
         } finally {
            setIsUpdatingProduct(false);
         }
      };

      useEffect(() => {
         const isInvalid =
            updatedInventoryCount !== undefined &&
            (isNaN(updatedInventoryCount) || updatedInventoryCount < 1);
         setInvalidUpdatedInventoryCount(isInvalid);
      }, [updatedInventoryCount]);

      // useEffect(() => {
      //    setInvalidUpdatedInventoryCount(
      //       parseInt(data?.inventoryCount) < lowStockThreshold,
      //    );
      // }, []);

      return (
         <>
            <ActionModal
               isOpen={isEditInventoryCountModalOpen}
               title="Update inventory count"
               description={`Update the inventory count for ${result.product_name}`}
               confirmText="Update"
               confirmButtonDisabled={invalidUpdatedInventoryCount}
               onConfirm={updateInventoryCount}
               loading={isUpdatingProduct}
               onClose={onClose}
            >
               <div className="flex flex-col gap-4">
                  <Input
                     type="number"
                     placeholder="Enter inventory count..."
                     onChange={(e) =>
                        setUpdatedInventoryCount(parseInt(e.target.value))
                     }
                     value={updatedInventoryCount}
                     defaultValue={result.inventory_count}
                  />
                  {invalidUpdatedInventoryCount && (
                     <span className="text-destructive text-xs ml-1">
                        {`Number must be greater than or equal to 1`}
                     </span>
                  )}
               </div>
            </ActionModal>

            <div className="w-full flex flex-row justify-between">
               <div className="flex flex-col gap-8">
                  <div className="flex items-center gap-16 space-x-2">
                     <ProductInfoLabel
                        title="Product name"
                        value={result.product_name}
                     />
                     <ProductInfoLabel
                        title="List price"
                        value={fmt.format(parseFloat(String(result.price)))}
                     />
                     <ProductInfoLabel
                        title="Inventory Count"
                        value={`${result.inventory_count}`}
                     />
                  </div>

                  {isOverStockCount && (
                     <div className="flex space-x-4">
                        <span className="text-sm text-destructive flex items-center">
                           <AlertCircle className="mr-2 h-4 w-4" /> Inventory
                           count for this product is less than the entered units
                           sold
                        </span>
                        <Button
                           className="space-x-2 flex items-center justify-start"
                           variant={'outline'}
                           onClick={() =>
                              // router.push(
                              //    `/${params.storeId}/inventory/products/${
                              //       result.product_id
                              //    }?return_url=${pathName}&query=${query}&${getTransactionAndReportActionInUrl()}`,
                              // )
                              setIsEditInventoryCountModalOpen(true)
                           }
                        >
                           Update inventory
                        </Button>
                     </div>
                  )}
               </div>

               <Form {...transactionItemForm}>
                  <form
                     onSubmit={handleSubmit(onSubmit)}
                     className="flex gap-4"
                  >
                     <FormField
                        control={control}
                        name="unitsSold"
                        render={({ field }) => (
                           <FormItem>
                              <FormControl>
                                 <Input
                                    className="w-[80px]"
                                    type="number"
                                    disabled={addingItemButtonStates[index]}
                                    placeholder="0"
                                    {...field}
                                 />
                              </FormControl>
                              <FormDescription>Units sold</FormDescription>
                              <FormMessage />
                           </FormItem>
                        )}
                     />
                     <LoadingButton
                        variant={'outline'}
                        type="submit"
                        disabled={
                           addingItemButtonStates[index] ||
                           date == undefined ||
                           isPublishingReport
                        }
                        isLoading={addingItemButtonStates[index]}
                     >
                        {!addingItemButtonStates[index] && (
                           <Plus className="mr-2 h-4 w-4" />
                        )}
                        Add
                     </LoadingButton>
                  </form>
               </Form>
            </div>
         </>
      );
   };

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
                  onClick={handleDeleteReport}
                  disabled={isPublishingReport}
               >
                  <Trash className="mr-2 h-4 w-4" /> Delete
               </Button>
            )}

            {fetchedTransaction && isUsingSavedEditedReport && (
               <Button
                  variant={'outline'}
                  onClick={discardSavedEditedReport}
                  disabled={isPublishingReport}
               >
                  <XCircle className="mr-2 h-4 w-4" /> Discard changes
               </Button>
            )}

            <Button
               variant={'outline'}
               onClick={createNewReport}
               disabled={isPublishingReport}
            >
               <PlusCircle className="mr-2 h-4 w-4" />
               New report
            </Button>

            <LoadingButton
               onClick={publishReport}
               disabled={
                  alertMessages.length != 0 ||
                  isPublishingReport ||
                  !transaction ||
                  transactionItems.length == 0
               }
               isLoading={isPublishingReport}
            >
               {!isPublishingReport && <Send className="mr-2 h-4 w-4" />}
               {isPublishingReport ? 'Publishing' : 'Publish'}
            </LoadingButton>
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
                        !enteredReportTitle ||
                        !enteredReportTitle.trim() ||
                        isPublishingReport
                     }
                  >
                     Save
                  </Button>
                  <Button
                     variant={'outline'}
                     disabled={isPublishingReport}
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
      <motion.div
         className="space-y-6"
         variants={widgetVariants}
         initial="hidden"
         animate="visible"
      >
         <ActionModal
            isOpen={isAutoSaveModalOpen}
            title="Draft reports"
            description="Select a draft to continue working on it, or start a new report."
            onClose={() => setIsAutoSaveModalOpen(false)}
         >
            <div className="flex flex-col space-y-4">
               <AutoSavedReports />
            </div>
         </ActionModal>
         <ActionModal
            isOpen={isUseSavedEditModalOpen}
            title="Unpublished changes detected"
            description="You have unsaved changes in this report. Do you want to continue editing or discard them?"
            declineText="Discard"
            onConfirm={() => useSavedEditedTransactionReport()}
            onClose={discardSavedEditedReport}
         />

         <ActionModal
            isOpen={isDeletePublishedReportModalOpen}
            title="Delete report"
            description="Permanently remove this report and all its associated data."
            ctaButtonVariant="destructive"
            onConfirm={deleteReport}
            loading={isDeletingReport || isDeletingReportWithRestock}
            onClose={() => setIsDeletePublishedReportModalOpen(false)}
         >
            <div className="flex items-center justify-end space-x-2">
               <Switch
                  id="restock-inventory"
                  defaultChecked={deleteReportWithRestock}
                  onCheckedChange={(e) => {
                     setDeleteReportWithRestock(e);
                  }}
               />
               <Label htmlFor="restock-inventory">Restock inventory</Label>
            </div>
         </ActionModal>

         <AlertModal
            isOpen={isAlertModalOpen}
            onClose={() => {
               setIsAlertModalOpen(false);
            }}
            onConfirm={allowForceDelete ? forceDeleteReport : deleteReport}
            ctaText={alertModalCTAText}
            title={'Delete report'}
            description={
               'Permanently remove this report and all its associated data.'
            }
            loading={isDeletingReport}
         />

         <div className="flex justify-between">
            <div className="flex flex-col space-y-6">
               <div className="flex space-x-4">
                  <Button
                     variant={'outline'}
                     onClick={onGoBack}
                     disabled={isPublishingReport}
                  >
                     <ArrowLeft className="mr-2 h-4 w-4" />
                  </Button>
                  <Heading
                     title={headerText}
                     description="Track the daily sales operations of your store"
                  />
               </div>
            </div>
            <ReportActionButtons />
         </div>

         <Separator />

         <div>
            <div className="grid lg:grid-cols-3 lg:pt-6 md:grid-cols-1 gap-8">
               <MetricCard
                  title={'Gross sales'}
                  value={fmt.format(grossSales)}
                  icon={<Banknote className="h-4 w-4 text-muted-foreground" />}
                  loading={isLoadingCurrency}
               />

               <MetricCard
                  title={'Net revenue'}
                  value={fmt.format(netSales)}
                  icon={<Banknote className="h-4 w-4 text-muted-foreground" />}
                  loading={isLoadingCurrency}
               />

               <MetricCard
                  title={'Units sold'}
                  value={unitsSold.toString()}
                  icon={
                     <PackageMinus className="h-4 w-4 text-muted-foreground" />
                  }
               />
            </div>
         </div>

         <div className="flex py-4 gap-8">
            <div className="flex flex-col lg:w-[80%] md:w-full gap-16">
               <Form {...searchQueryForm}>
                  <form
                     onSubmit={searchQueryForm.handleSubmit(
                        onSubmitSearchQuery,
                     )}
                     className="flex-col space-y-8 pt-8 lg:w-[85%] md:w-full"
                  >
                     <div className="flex gap-8 justify-center">
                        <div className="w-full">
                           <FormField
                              control={searchQueryForm.control}
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
                                          placeholder="Enter product name or SKU..."
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
                  {(searching || searchResults) && (
                     <Card className="bg-background w-full">
                        <CardHeader>
                           <CardDescription className="flex items-center">
                              <div className="flex justify-between items-center w-full">
                                 {!searching && searchResults
                                    ? 'Search results'
                                    : 'Searching...'}
                                 <Button
                                    variant={'outline'}
                                    onClick={() => {
                                       setIsSearching(false);
                                       setSearchResults(undefined);
                                    }}
                                    disabled={Object.values(
                                       addingItemButtonStates,
                                    ).some((isLoading) => isLoading)}
                                 >
                                    <X className="h-4 w-4" />
                                 </Button>
                              </div>
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
                                       <div
                                          className="flex flex-col w-full gap-8"
                                          style={{
                                             pointerEvents: Object.values(
                                                addingItemButtonStates,
                                             ).some((isLoading) => isLoading)
                                                ? 'none'
                                                : 'auto',
                                             opacity: Object.values(
                                                addingItemButtonStates,
                                             ).some((isLoading) => isLoading)
                                                ? 0.5
                                                : 1,
                                          }}
                                       >
                                          {searchResults.map(
                                             (result, index) => {
                                                return (
                                                   <>
                                                      <IndividualSearchResult
                                                         index={index}
                                                         key={index}
                                                         result={result}
                                                      />
                                                      {index <
                                                         searchResults.length -
                                                            1 && <Separator />}
                                                   </>
                                                );
                                             },
                                          )}
                                       </div>
                                    )}
                                 </>
                              )}
                           </div>

                           {!searching && searchResults?.length == 0 && (
                              <div className="flex flex-col justify-center items-center pb-4 gap-2">
                                 <span className="flex justify-center">
                                    No results found.
                                 </span>
                                 <Button
                                    variant={'outline'}
                                    onClick={() =>
                                       router.push(
                                          `${baseStoreURL}/inventory/products/new?return_url=${pathName}&query=${
                                             searchQueryForm.watch().query
                                          }&${getTransactionAndReportActionInUrl()}`,
                                       )
                                    }
                                 >
                                    <PlusCircle className="mr-2 h-4 w-4" />
                                    {`Add ${
                                       searchQueryForm.watch().query
                                    } as new product`}
                                 </Button>
                              </div>
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
            {/* Toggle Exchange rate */}
            {/* <div className="mt-8 space-x-2 flex">
               <DollarSign className="mt-2 w-4 h-4 text-muted-foreground" />
               <CurrencyToggle
                  currency={reportFormatCurrency}
                  setCurrency={setReportFormatCurrency}
               />
               <div />
               <TooltipProvider>
                  <Tooltip>
                     <TooltipTrigger asChild>
                        <Info className="mt-2 w-4 h-4 text-muted-foreground" />
                     </TooltipTrigger>
                     <TooltipContent>
                        <p className="p-2 w-[320px] text-center">
                           The currency to view this transaction report in.
                           Amounts will be formatted with the applicable exhange
                           rate with respect to your store's currency.
                        </p>
                     </TooltipContent>
                  </Tooltip>
               </TooltipProvider>
            </div> */}
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

                  <div className="flex w-full lg:gap-24 md:gap-16 lg:flex-row md:flex-col-reverse">
                     <div
                        className={`lg:w-[60%] md:w-full space-y-4 ${
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
                           tableKey="transactions-transaction-items"
                           placeholder="Filter transactions..."
                           table={table}
                        />
                        <DataTable
                           table={table}
                           columns={columns}
                           tableKey="transactions-transaction-items"
                        />
                     </div>

                     {Object.keys(categorySales).length > 0 && (
                        <div className="lg:w-[40%] md:w-full space-y-4">
                           <span className="text-muted-foreground">
                              Breakdown by category
                           </span>
                           <CategoriesTable />
                        </div>
                     )}

                     {/* <div
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
                                    {fmt.format(grossSales)}
                                 </div>
                              </CardContent>
                           </Card>

                           <Card>
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
                        </div>

                        <div className="grid grid-cols-2 space-x-8 pt-6">
                           <Card>
                              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                 <CardTitle className="text-sm font-medium">
                                    Units sold
                                 </CardTitle>
                                 <PackageCheck className="h-4 w-4 text-muted-foreground" />
                              </CardHeader>
                              <CardContent>
                                 <div className="text-2xl font-bold">
                                    {unitsSold}
                                 </div>
                              </CardContent>
                           </Card>
                        </div>

                        <CategoriesTable />
                     </div> */}
                  </div>
               </div>
            )}
         </div>
      </motion.div>
   );
};
