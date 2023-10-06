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
import { getDraftTransactions, getLocalStorageKey } from '../utils';
import { formatter, keysToCamelCase } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';

interface CellActionProps {
   data: TransactionItemColumn;
}

export const CellAction: React.FC<CellActionProps> = ({ data }) => {
   const params = useParams();

   const { storeCurrency } = useStoreCurrency();
   const fmt = formatter(storeCurrency);

   const removeTransactionItem = () => {
      const {
         transactionDate,
         productId,
         transactionId,
         setFormattedItems,
         setTransactionItems,
         setAutoSavedTransactions,
      } = data;

      if (!productId || !transactionDate || !transactionId) return;

      const key = getLocalStorageKey(params.storeId);
      const draftTransactions = getDraftTransactions(params.storeId);

      delete draftTransactions[transactionId][productId];
      localStorage.setItem(key, JSON.stringify(draftTransactions));

      const activeTransaction = draftTransactions[transactionId];
      const transactionItems = Object.keys(activeTransaction).map((key) =>
         keysToCamelCase(activeTransaction[key]),
      );

      setTransactionItems(transactionItems);

      // update the autosaved transaction with transactionId to have transactionItems
      setAutoSavedTransactions((prev) => {
         return prev.map((transaction) => {
            if (transaction.id === transactionId) {
               return { ...transaction, transactionItems };
            }
            return transaction;
         });
      });

      const items = transactionItems.map((item) => ({
         categoryId: item.categoryId,
         subcategoryId: item.subcategoryId,
         costPerItem: fmt.format(parseInt(item.cost || '0')),
         price: fmt.format(parseInt(item.price || '0')),
         priceValue: item.price,
         costValue: item.cost,
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

      setFormattedItems(items);
   };

   return (
      <>
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
               <DropdownMenuItem onClick={() => console.log('ayyye')}>
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
