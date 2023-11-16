'use client';
import { captureException } from '@sentry/nextjs';
import { useState } from 'react';
import { Edit, MoreHorizontal, Trash } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AlertModal } from '@/components/modals/alert-modal';

import { SizeColumn } from './columns';
import { useToast } from '@/components/ui/use-toast';
import { apiDeleteSize } from '@/lib/api/sizes';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import logger from '@/lib/logger/console-logger';

interface CellActionProps {
   data: SizeColumn;
}

export const CellAction: React.FC<CellActionProps> = ({ data }) => {
   const router = useRouter();
   const params = useParams();
   const baseStoreURL = useGetBaseStoreUrl();
   const { toast } = useToast();
   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);

   const onConfirm = async () => {
      try {
         logger.info('action: began deleteSize (cell action)', {
            sizeId: data.id,
            storeId: params.storeId,
         });
         setLoading(true);
         await apiDeleteSize(data.id, params.storeId);
         toast({
            title: `Size '${data.name} deleted.`,
         });
         router.refresh();
      } catch (error) {
         logger.error('action: deleteSize (cell action)', {
            sizeId: data.id,
            storeId: params.storeId,
            error: (error as Error).message,
         });
         captureException(error);
         toast({
            title: 'An error occurred deleting this size. Make sure you removed all products using this size first.',
         });
      } finally {
         setOpen(false);
         setLoading(false);
         logger.info('action: deleteSize (cell action)', {
            sizeId: data.id,
            storeId: params.storeId,
         });
      }
   };

   return (
      <>
         <AlertModal
            isOpen={open}
            onClose={() => setOpen(false)}
            onConfirm={onConfirm}
            loading={loading}
         />
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
                     router.push(`${baseStoreURL}/inventory/sizes/${data.id}`)
                  }
               >
                  <Edit className="mr-2 h-4 w-4" /> Edit
               </DropdownMenuItem>
               <DropdownMenuItem onClick={() => setOpen(true)}>
                  <Trash className="mr-2 h-4 w-4" /> Delete
               </DropdownMenuItem>
            </DropdownMenuContent>
         </DropdownMenu>
      </>
   );
};
