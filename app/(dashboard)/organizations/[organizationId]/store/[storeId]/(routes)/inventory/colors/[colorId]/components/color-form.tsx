'use client';

import * as z from 'zod';
import { captureException } from '@sentry/nextjs';
import { ChangeEvent, FocusEvent, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { ArrowLeft, Trash } from 'lucide-react';
import { color } from '@prisma/client';
import { useParams, useRouter } from 'next/navigation';

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
import { useToast } from '@/components/ui/use-toast';
import { ColorPicker } from '@/components/ui/color-picker';
import { LoadingButton } from '@/components/ui/loading-button';
import {
   apiCreateColor,
   apiDeleteColor,
   apiUpdateColor,
} from '@/lib/api/colors';
import useReturnUrl from '@/hooks/use-get-return-url';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import { motion } from 'framer-motion';
import { mainContainerVariants, widgetVariants } from '@/lib/constants';
import logger from '@/lib/logger/console-logger';
import { Label } from '@/components/ui/label';

const formSchema = z.object({
   name: z.string().min(2),
   value: z.string().min(4).max(9).regex(/^#/, {
      message: 'String must be a valid hex code',
   }),
});

type ColorFormValues = z.infer<typeof formSchema>;

interface ColorFormProps {
   initialData: color | null;
}

export const ColorForm: React.FC<ColorFormProps> = ({ initialData }) => {
   const params = useParams();
   const router = useRouter();
   const baseStoreURL = useGetBaseStoreUrl();
   const { toast } = useToast();

   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);

   const title = initialData ? 'Edit color' : 'Create color';
   const description = initialData ? 'Edit a color.' : 'Add a new color';
   const action = initialData ? 'Save changes' : 'Create';
   const loadingAction = loading ? (initialData ? 'Saving' : 'Creating') : '';
   const buttonText = loading ? loadingAction : action;

   const form = useForm<ColorFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: initialData || {
         name: '',
      },
   });

   const getReturnUrl = useReturnUrl(`/inventory/colors`);

   const onSubmit = async (data: ColorFormValues) => {
      const returnUrl = getReturnUrl();

      try {
         logger.info('action: began create/updateColor', {
            colorId: params.colorId,
            storeId: params.storeId,
         });
         setLoading(true);
         if (initialData) {
            await apiUpdateColor(params.colorId, params.storeId, data);
         } else {
            await apiCreateColor(params.storeId, data);
         }
         toast({
            title: `Color '${data.name}' ${initialData ? 'updated' : 'added'}.`,
         });
         router.refresh();
         router.push(returnUrl);
         toast({
            title: `Color '${data.name}' ${initialData ? 'updated' : 'added'}.`,
         });
      } catch (error: any) {
         captureException(error);
         logger.error('action: create/updateColor', {
            colorId: params.colorId,
            storeId: params.storeId,
            error: (error as Error).message,
         });
         toast({
            title: 'Something went wrong adding this color. Try again.',
         });
      } finally {
         logger.info('action: create/updateColor', {
            colorId: params.colorId,
            storeId: params.storeId,
         });
         setLoading(false);
      }
   };

   const onDelete = async () => {
      try {
         logger.info('action: began deleteColor', {
            colorId: params.colorId,
            storeId: params.storeId,
         });
         setLoading(true);
         await apiDeleteColor(params.colorId, params.storeId);
         router.refresh();
         router.push(`${baseStoreURL}/inventory/colors`);
         toast({
            title: 'Color deleted.',
         });
      } catch (error: any) {
         captureException(error);
         logger.error('action: deleteColor', {
            colorId: params.colorId,
            storeId: params.storeId,
            error: (error as Error).message,
         });
         toast({
            title: 'Something went wrong deleting this product. Make sure all products using this color are deleted and try again.',
         });
      } finally {
         logger.info('action: deleteColor', {
            colorId: params.colorId,
            storeId: params.storeId,
         });
         setLoading(false);
         setOpen(false);
      }
   };

   return (
      <div className="space-y-6">
         <AlertModal
            isOpen={open}
            onClose={() => setOpen(false)}
            onConfirm={onDelete}
            loading={loading}
         />
         <motion.div
            className="flex justify-between"
            variants={widgetVariants}
            initial="hidden"
            animate="visible"
         >
            <div className="flex flex-col space-y-6">
               <div className="flex space-x-4 items-center">
                  <Button variant={'outline'} onClick={() => router.back()}>
                     <ArrowLeft className="mr-2 h-4 w-4" />
                  </Button>
                  <Label className="text-lg">{title}</Label>
               </div>
            </div>
            <div className="flex items-center">
               {initialData && (
                  <Button
                     disabled={loading}
                     variant="destructive"
                     onClick={() => setOpen(true)}
                  >
                     <Trash className="mr-2 h-4 w-4" /> Delete
                  </Button>
               )}
            </div>
         </motion.div>

         <Separator />

         <motion.div
            variants={mainContainerVariants}
            initial="hidden"
            animate="visible"
         >
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
                                    placeholder="Color name"
                                    {...field}
                                 />
                              </FormControl>
                              <FormMessage />
                           </FormItem>
                        )}
                     />
                     <FormField
                        control={form.control}
                        name="value"
                        render={({ field }) => (
                           <FormItem>
                              <FormLabel>Value</FormLabel>
                              <FormControl>
                                 <div className="flex items-center gap-x-4">
                                    <Input
                                       disabled={loading}
                                       placeholder="Color value"
                                       {...field}
                                    />
                                    <ColorPicker
                                       field={{ ...field }}
                                       disabled={loading}
                                    />
                                    {/* <div
                                    className="border p-4 rounded-full"
                                    style={{
                                       backgroundColor: field.value,
                                    }}
                                 /> */}
                                 </div>
                              </FormControl>
                              <FormMessage />
                           </FormItem>
                        )}
                     />
                  </div>
                  <LoadingButton
                     isLoading={loading}
                     disabled={loading}
                     className="ml-auto"
                     type="submit"
                  >
                     {buttonText}
                  </LoadingButton>
               </form>
            </Form>
         </motion.div>
      </div>
   );
};
