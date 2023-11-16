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
import { useCategoryModal } from '@/hooks/use-category-modal';
import { AlertModal } from '@/components/modals/alert-modal';

import { SubcategoryColumn } from './columns';
import { useToast } from '@/components/ui/use-toast';
import { apiDeleteSubcategory } from '@/lib/api/subcategories';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import logger from '@/lib/logger/console-logger';

interface CellActionProps {
   data: SubcategoryColumn;
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
         logger.info('action: began deleteSubcategory (cell action)', {
            subcategoryId: data.id,
            storeId: params.storeId,
         });
         setLoading(true);
         await apiDeleteSubcategory(data.id, params.storeId);
         toast({
            title: `Category '${data.name} deleted.`,
         });
         router.refresh();
      } catch (error) {
         captureException(error);
         logger.error('action: deleteSubcategory (cell action)', {
            subcategoryId: data.id,
            storeId: params.storeId,
            error: (error as Error).message,
         });
         toast({
            title: 'Am error occurred deleting this subcategory. Make sure you removed all products using this category first.',
         });
      } finally {
         setOpen(false);
         setLoading(false);
         logger.info('action: deleteSubcategory (cell action)', {
            subcategoryId: data.id,
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
                     router.push(
                        `${baseStoreURL}/inventory/subcategories/${data.id}`,
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
