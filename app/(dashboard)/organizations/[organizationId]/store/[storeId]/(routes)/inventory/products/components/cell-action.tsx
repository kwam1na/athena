'use client';

import { captureException } from '@sentry/nextjs';
import { Edit, MoreHorizontal, Trash } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import { AlertModal } from '@/components/modals/alert-modal';
import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { ProductColumn } from './columns';
import { useToast } from '@/components/ui/use-toast';
import { apiDeleteProduct } from '@/lib/api/products';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';

interface CellActionProps {
   data: ProductColumn;
}

export const CellAction: React.FC<CellActionProps> = ({ data }) => {
   const [loading, setLoading] = useState(false);
   const [open, setOpen] = useState(false);
   const { toast } = useToast();
   const router = useRouter();
   const params = useParams();
   const baseStoreURL = useGetBaseStoreUrl();

   const onConfirm = async () => {
      try {
         setLoading(true);
         await apiDeleteProduct(data.id, params.storeId);
         toast({
            title: `Product '${data.name} deleted.`,
         });
         router.refresh();
      } catch (error) {
         captureException(error);
         toast({
            title: 'An error occured deleting this product.',
         });
      } finally {
         setLoading(false);
         setOpen(false);
      }
   };

   return (
      <>
         <AlertModal
            title={`Delete ${data.name}?`}
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
                        `${baseStoreURL}/inventory/products/${data.id}`,
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
