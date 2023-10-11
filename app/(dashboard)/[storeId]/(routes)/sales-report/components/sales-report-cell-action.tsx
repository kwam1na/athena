'use client';

import axios from 'axios';
import { Edit, Eye, MoreHorizontal, Trash } from 'lucide-react';
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
   getLocallySavedTransactions,
   getDraftsLocalStorageKey,
   saveItemInLocalStorage,
} from '../utils';
import { formatter, keysToCamelCase } from '@/lib/utils';
import { useStoreCurrency } from '@/providers/currency-provider';
import { ActionModal } from '@/components/modals/action-modal';
import { Input } from '@/components/ui/input';
import { TransactionItem } from './client';
import { SalesReportColumn } from './sales-reports-columns';

interface SalesReportCellActionProps {
   data: SalesReportColumn;
}

export const SalesReportCellAction: React.FC<SalesReportCellActionProps> = ({
   data,
}) => {
   const params = useParams();
   const router = useRouter();
   const [isEditUnitsModalOpen, setIsEditUnitsModalOpen] = useState(false);
   const [unitsSold, setUnitsSold] = useState<number | undefined>(undefined);

   const { storeCurrency } = useStoreCurrency();
   const fmt = formatter(storeCurrency);

   const { transactionDate, id } = data;

   return (
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
               <Eye className="mr-2 h-4 w-4" /> View
            </DropdownMenuItem>
            <DropdownMenuItem
               onClick={() =>
                  router.push(`/${params.storeId}/sales-report/${data.id}`)
               }
            >
               <Edit className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
         </DropdownMenuContent>
      </DropdownMenu>
   );
};
