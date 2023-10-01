'use client';

import * as z from 'zod';
import axios from 'axios';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Moon, Sun, Trash } from 'lucide-react';
import { Store } from '@prisma/client';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
   Form,
   FormControl,
   FormField,
   FormItem,
   FormLabel,
   FormMessage,
} from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';
import { Heading } from '@/components/ui/heading';
import { AlertModal } from '@/components/modals/alert-modal';
import { useOrigin } from '@/hooks/use-origin';
import { ActionAlert } from '@/components/ui/action-alert';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { currencies } from '@/lib/constants';
import { useToast } from '@/components/ui/use-toast';
import { useStoreCurrency } from '@/providers/currency-provider';
import { ThemeToggle } from '@/components/theme-toggle';

const formSchema = z.object({
   name: z.string().min(2),
   currency: z.string().min(3),
});

type PreferencesFormValues = z.infer<typeof formSchema>;

interface PreferencesFormProps {
   initialData: Store;
}

export const PreferencesForm: React.FC<PreferencesFormProps> = ({
   initialData,
}) => {
   const params = useParams();
   const router = useRouter();
   const origin = useOrigin();
   const { toast } = useToast();

   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);
   const { setStoreCurrency } = useStoreCurrency();

   const form = useForm<PreferencesFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: initialData ? initialData : { name: '', currency: '' },
   });

   const onSubmit = async (data: PreferencesFormValues) => {
      try {
         setLoading(true);
         await axios.patch(`/api/stores/${params.storeId}`, data);
         router.refresh();
         setStoreCurrency(data.currency);
         toast({
            title: 'Store updated.',
         });
      } catch (error: any) {
         console.log('error:', error);
         toast({
            title: 'Something went wrong. Try again.',
         });
      } finally {
         setLoading(false);
      }
   };

   const onDelete = async () => {
      try {
         setLoading(true);
         await axios.delete(`/api/stores/${params.storeId}`);
         router.refresh();
         router.push('/');
         toast({
            title: 'Store deleted.',
         });
      } catch (error: any) {
         toast({
            title: 'Make sure you removed all products and categories first and then try again.',
         });
      } finally {
         setLoading(false);
         setOpen(false);
      }
   };

   return (
      <>
         <AlertModal
            isOpen={open}
            onClose={() => setOpen(false)}
            onConfirm={onDelete}
            loading={loading}
         />
         <div className="flex items-center justify-between">
            <Heading
               title="Preferences"
               description="Manage your preferences"
            />
         </div>
         <Separator />
         <div className="md:grid md:grid-rows-3">
            {/* <Sun className="mr-2 h-[1rem] w-[1rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" /> */}
            {/* <Moon className="mr-2 absolute h-[1rem] w-[1rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" /> */}
            <span>Appearance</span>
            <div>
               <ThemeToggle />
            </div>
         </div>
      </>
   );
};
