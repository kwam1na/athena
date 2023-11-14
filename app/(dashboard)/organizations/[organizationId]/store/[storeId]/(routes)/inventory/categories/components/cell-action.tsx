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
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AlertModal } from '@/components/modals/alert-modal';
import { useToast } from '@/components/ui/use-toast';

import { CategoryColumn } from './columns';
import { apiDeleteCategory } from '@/lib/api/categories';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import logger from '@/lib/logger/console-logger';

interface CellActionProps {
   data: CategoryColumn;
}

export const CellAction: React.FC<CellActionProps> = ({ data }) => {
   const router = useRouter();
   const params = useParams();
   const baseStoreURL = useGetBaseStoreUrl();
   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);
   const { toast } = useToast();

   const onConfirm = async () => {
      try {
         logger.info('action: began deleteCategoryId (cell action)', {
            categoryId: data.id,
            storeId: params.storeId,
         });
         setLoading(true);
         await apiDeleteCategory(data.id, params.storeId);
         toast({
            title: `Category '${data.name}' deleted`,
         });
         router.refresh();
      } catch (error) {
         captureException(error);
         toast({
            title: 'An error occurred deleting this category. Make sure you removed all subcategories and products using this category first.',
         });
         logger.error('action: deleteCategoryId (cell action)', {
            categoryId: data.id,
            storeId: params.storeId,
            error: (error as Error).message,
         });
      } finally {
         setOpen(false);
         setLoading(false);
         logger.info('action: deleteCategoryId (cell action)', {
            categoryId: data.id,
            storeId: params.storeId,
         });
      }
   };

   const onCopy = (id: string) => {
      navigator.clipboard.writeText(id);
      toast({
         title: 'Category ID copied to clipboard.',
      });
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
                     router.push(
                        `${baseStoreURL}/inventory/categories/${data.id}`,
                     )
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
