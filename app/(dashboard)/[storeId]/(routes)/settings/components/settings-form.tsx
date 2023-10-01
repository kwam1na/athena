'use client';

import * as z from 'zod';
import axios from 'axios';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Trash } from 'lucide-react';
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
import { revalidatePath } from 'next/cache';
import { useStoreCurrency } from '@/providers/currency-provider';

const formSchema = z.object({
   name: z.string().min(2),
   currency: z.string().min(3),
});

type SettingsFormValues = z.infer<typeof formSchema>;

interface SettingsFormProps {
   initialData: Store;
}

export const SettingsForm: React.FC<SettingsFormProps> = ({ initialData }) => {
   const params = useParams();
   const router = useRouter();
   const origin = useOrigin();
   const { toast } = useToast();

   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);
   const { setStoreCurrency } = useStoreCurrency();

   const form = useForm<SettingsFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: initialData ? initialData : { name: '', currency: '' },
   });

   const onSubmit = async (data: SettingsFormValues) => {
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
               title="Store settings"
               description="Manage store preferences"
            />
         </div>
         <Separator />
         <Form {...form}>
            <form
               onSubmit={form.handleSubmit(onSubmit)}
               className="space-y-8 w-full"
            >
               <div className="md:grid md:grid-cols-3 gap-8">
                  <FormField
                     control={form.control}
                     name="name"
                     render={({ field }) => (
                        <FormItem>
                           <FormLabel>Name</FormLabel>
                           <FormControl>
                              <Input
                                 disabled={loading}
                                 placeholder="Store name"
                                 {...field}
                              />
                           </FormControl>
                           <FormMessage />
                        </FormItem>
                     )}
                  />

                  <FormField
                     control={form.control}
                     name="currency"
                     render={({ field }) => (
                        <FormItem>
                           <FormLabel>Currency</FormLabel>
                           <Select
                              disabled={loading}
                              onValueChange={field.onChange}
                              value={field.value}
                              defaultValue={field.value}
                           >
                              <FormControl>
                                 <SelectTrigger>
                                    <SelectValue
                                       defaultValue={field.value}
                                       placeholder="Select a currency"
                                    />
                                 </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                 {currencies.map((currency) => (
                                    <SelectItem
                                       key={currency.value}
                                       value={currency.value}
                                    >
                                       {currency.label}
                                    </SelectItem>
                                 ))}
                              </SelectContent>
                           </Select>
                           <FormMessage />
                        </FormItem>
                     )}
                  />
               </div>
               <Button disabled={loading} className="ml-auto" type="submit">
                  Save changes
               </Button>
            </form>
         </Form>
         <Separator />
         <ActionAlert
            title={'Delete this store'}
            description={'This will delete this store and all associated data.'}
            variant={'danger'}
            buttonText={'Delete'}
            onClick={() => setOpen(true)}
         />
      </>
   );
};
