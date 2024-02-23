'use client';

import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { store } from '@prisma/client';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { captureException } from '@sentry/nextjs';
import { motion } from 'framer-motion';

import { Input } from '@/components/ui/input';
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
import { LoadingButton } from '@/components/ui/loading-button';
import { apiDeleteStore, apiUpdateStore } from '@/lib/api/stores';
import { Label } from '@/components/ui/label';
import {
   mainContainerVariants,
   widgetVariants,
} from '@/lib/animation/constants';

const formSchema = z.object({
   name: z.string().min(2),
   currency: z.string().min(3),
   low_stock_threshold: z.coerce.number().min(0),
});

type SettingsFormValues = z.infer<typeof formSchema>;

interface SettingsFormProps {
   initialData: store;
}

export const StoreSettingsForm: React.FC<SettingsFormProps> = ({
   initialData,
}) => {
   const params = useParams();
   const router = useRouter();
   const origin = useOrigin();
   const { toast } = useToast();

   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);
   const { setStoreCurrency } = useStoreCurrency();

   const getInitialFormValues = (data: any) => {
      if (!data) return { name: '', currency: '', low_stock_threshold: 0 };

      const { settings, ...rest } = data;
      const low_stock_threshold =
         settings &&
         typeof settings === 'object' &&
         'low_stock_threshold' in settings
            ? settings.low_stock_threshold
            : 0;

      return { ...rest, low_stock_threshold };
   };

   const form = useForm<SettingsFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: getInitialFormValues(initialData),
   });

   const onSubmit = async (data: SettingsFormValues) => {
      try {
         setLoading(true);
         await apiUpdateStore(params.storeId, data);
         router.refresh();
         setStoreCurrency(data.currency);
         toast({
            title: 'Store updated.',
         });
      } catch (error: any) {
         captureException(error);
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
         await apiDeleteStore(params.storeId);
         router.refresh();
         router.push('/');
         toast({
            title: 'Store deleted.',
         });
      } catch (error: any) {
         captureException(error);
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
         <motion.div
            className="space-y-4"
            variants={widgetVariants}
            initial="hidden"
            animate="visible"
         >
            <Label className="text-lg">Store settings</Label>
            <Separator />
         </motion.div>

         <motion.div
            className="space-y-8"
            variants={mainContainerVariants}
            initial="hidden"
            animate="visible"
         >
            <Form {...form}>
               <div className="space-y-4">
                  <form
                     onSubmit={form.handleSubmit(onSubmit)}
                     className="space-y-8 w-full"
                  >
                     <div className="space-y-4">
                        <span className="text-md">Store details</span>
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
                     </div>

                     <div className="space-y-4">
                        <span className="text-md">Inventory settings</span>
                        <div className="md:grid md:grid-cols-3 gap-8">
                           <FormField
                              control={form.control}
                              name="low_stock_threshold"
                              render={({ field }) => (
                                 <FormItem>
                                    <FormLabel>Low stock threshold</FormLabel>
                                    <FormControl>
                                       <Input
                                          disabled={loading}
                                          type="number"
                                          placeholder="Low stock threshold"
                                          {...field}
                                       />
                                    </FormControl>
                                    <FormMessage />
                                 </FormItem>
                              )}
                           />
                        </div>
                     </div>

                     <LoadingButton
                        isLoading={loading}
                        disabled={loading}
                        className="ml-auto"
                        type="submit"
                     >
                        {loading ? 'Saving' : 'Save changes'}
                     </LoadingButton>
                  </form>
               </div>
            </Form>
            <Separator />
            <ActionAlert
               title={'Delete this store'}
               description={
                  'This will delete this store and all associated data.'
               }
               variant={'danger'}
               buttonText={'Delete'}
               onClick={() => setOpen(true)}
            />
         </motion.div>
      </>
   );
};
