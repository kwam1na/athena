'use client';

import { Edit, Eye, MoreHorizontal, Trash } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { TransactionsReportColumn } from './transactions-reports-columns';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';

interface SalesReportCellActionProps {
   data: TransactionsReportColumn;
}

export const SalesReportCellAction: React.FC<SalesReportCellActionProps> = ({
   data,
}) => {
   const params = useParams();
   const baseStoreURL = useGetBaseStoreUrl();
   const router = useRouter();

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
            <DropdownMenuItem
               onClick={() =>
                  router.push(`${baseStoreURL}/transactions/${data.id}`)
               }
            >
               <Eye className="mr-2 h-4 w-4" /> View
            </DropdownMenuItem>
            <DropdownMenuItem
               onClick={() =>
                  router.push(`${baseStoreURL}/transactions/${data.id}/edit`)
               }
            >
               <Edit className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
         </DropdownMenuContent>
      </DropdownMenu>
   );
};
