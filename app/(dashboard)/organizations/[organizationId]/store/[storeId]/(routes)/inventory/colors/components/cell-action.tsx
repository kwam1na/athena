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

import { ColorColumn } from './columns';
import { useToast } from '@/components/ui/use-toast';
import { apiDeleteColor } from '@/lib/api/colors';
import { ca } from 'date-fns/locale';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';

interface CellActionProps {
   data: ColorColumn;
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
         setLoading(true);
         await apiDeleteColor(data.id, params.storeId);
         toast({
            title: `Color '${data.name} deleted.`,
         });
         router.refresh();
      } catch (error) {
         captureException(error);
         toast({
            title: 'An error occured deleting this color. Make sure all products using this color are deleted and try again.',
         });
      } finally {
         setOpen(false);
         setLoading(false);
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
                     router.push(`${baseStoreURL}/inventory/colors/${data.id}`)
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
