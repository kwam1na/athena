'use client';

import axios from 'axios';
import { useState } from 'react';
import { Copy, Edit, MoreHorizontal, Trash } from 'lucide-react';
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
import { useToast } from '@/components/ui/use-toast';

import { CategoryColumn } from './columns';

interface CellActionProps {
   data: CategoryColumn;
}

export const CellAction: React.FC<CellActionProps> = ({ data }) => {
   const router = useRouter();
   const params = useParams();
   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);
   const { toast } = useToast();

   const onConfirm = async () => {
      try {
         setLoading(true);
         await axios.delete(`/api/${params.storeId}/categories/${data.id}`);
         toast({
            title: `Category '${data.name}' deleted`,
         });
         router.refresh();
      } catch (error) {
         toast({
            title: 'An error occurred deleting this category. Make sure you removed all categories and products using this category first.',
         });
      } finally {
         setOpen(false);
         setLoading(false);
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
                        `/${params.storeId}/inventory/categories/${data.id}`,
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
