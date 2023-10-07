'use client';

import axios from 'axios';
import { Edit, MoreHorizontal, Trash } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { TransactionItemColumn } from './columns';
import { useToast } from '@/components/ui/use-toast';
import {
   getDraftTransactions,
   getLocalStorageKey,
   saveItemInLocalStorage,
} from '../utils';
import { formatter, keysToCamelCase } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';
import { ActionModal } from '@/components/modals/action-modal';
import { Input } from '@/components/ui/input';
import { TransactionItem } from './client';

interface CellActionProps {
   data: TransactionItemColumn;
}

export const CellAction: React.FC<CellActionProps> = ({ data }) => {
   const params = useParams();
   const [isEditUnitsModalOpen, setIsEditUnitsModalOpen] = useState(false);
   const [unitsSold, setUnitsSold] = useState<number | undefined>(
      data.unitsSold,
   );

   const { storeCurrency } = useStoreCurrency();
   const fmt = formatter(storeCurrency);

   const {
      transactionDate,
      productId,
      transactionId,
      setFormattedItems,
      setTransactionItems,
      setAutoSavedTransactions,
   } = data;

   const handleTransactionItems = (action: 'update' | 'remove') => {
      if (!productId || !transactionDate || !transactionId) return;

      const key = getLocalStorageKey(params.storeId);
      let draftTransactions = getDraftTransactions(params.storeId);

      if (action === 'update') {
         if (
            draftTransactions[transactionId] &&
            draftTransactions[transactionId][productId]
         )
            draftTransactions[transactionId][productId].units_sold = unitsSold;
      } else if (action === 'remove') {
         delete draftTransactions[transactionId][productId];
      }

      saveItemInLocalStorage(key, draftTransactions);

      const activeTransaction = draftTransactions[transactionId];
      const transactionItems = Object.keys(activeTransaction).map((key) =>
         keysToCamelCase(activeTransaction[key]),
      );

      setTransactionItems(transactionItems);

      setAutoSavedTransactions((prev) => {
         return prev.map((transaction) => {
            if (transaction.id === transactionId) {
               return { ...transaction, transactionItems };
            }
            return transaction;
         });
      });

      const items = formatTransactionItems(transactionItems);
      setFormattedItems(items);
   };

   const formatTransactionItems = (items: TransactionItem[]) => {
      return items.map((item) => ({
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
            ((parseFloat(item.price || '0') - parseFloat(item.cost || '0')) /
               parseFloat(item.price || '0')) *
            100
         ).toFixed(2),
         setTransactionItems,
         setFormattedItems,
         setAutoSavedTransactions,
      }));
   };

   const updateUnitsSold = () => {
      if (!productId || !transactionDate || !transactionId) return;
      handleTransactionItems('update');
      setIsEditUnitsModalOpen(false);
   };

   const removeTransactionItem = () => {
      if (!productId || !transactionDate || !transactionId) return;
      handleTransactionItems('remove');
   };

   const invalidUnitsSold =
      unitsSold !== undefined && (isNaN(unitsSold) || unitsSold < 1);

   return (
      <>
         <ActionModal
            isOpen={isEditUnitsModalOpen}
            title="Edit units sold"
            description={`Update the units sold for ${data.productName}`}
            onConfirm={updateUnitsSold}
            confirmButtonDisabled={invalidUnitsSold}
            onClose={() => setIsEditUnitsModalOpen(false)}
         >
            <div className="flex flex-col gap-4">
               <Input
                  type="number"
                  placeholder="Enter units sold..."
                  onChange={(e) => setUnitsSold(parseInt(e.target.value))}
                  value={unitsSold}
               />
               {invalidUnitsSold && (
                  <span className="text-destructive text-xs ml-1">
                     Number must be greater than or equal to 1
                  </span>
               )}
            </div>
         </ActionModal>
         <DropdownMenu>
            <DropdownMenuTrigger asChild>
               <Button
                  variant="ghost"
                  className="flex h-8 w-8 p-0 data-[state=open]:bg-muted"
               >
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
               </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[160px]">
               <DropdownMenuItem onClick={() => setIsEditUnitsModalOpen(true)}>
                  <Edit className="mr-2 h-4 w-4" /> Edit units sold
               </DropdownMenuItem>
               <DropdownMenuItem onClick={removeTransactionItem}>
                  <Trash className="mr-2 h-4 w-4" /> Delete
               </DropdownMenuItem>
            </DropdownMenuContent>
         </DropdownMenu>
      </>
   );
};
