'use client';

import { startTransaction, captureException } from '@sentry/nextjs';
import * as z from 'zod';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { ArrowLeft, Trash } from 'lucide-react';
import { category } from '@prisma/client';
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
import { LoadingButton } from '@/components/ui/loading-button';
import {
   apiCreateCategory,
   apiDeleteCategory,
   apiUpdateCategory,
} from '@/lib/api/categories';
import useReturnUrl from '@/hooks/use-get-return-url';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import { motion } from 'framer-motion';
import { mainContainerVariants, widgetVariants } from '@/lib/constants';
import logger from '@/lib/logger/console-logger';
import { wrap } from 'module';
import { Label } from '@/components/ui/label';

const formSchema = z.object({
   name: z.string().min(2),
});

type CategoryFormValues = z.infer<typeof formSchema>;

interface CategoryFormProps {
   initialData: category | null;
}

export const CategoryForm: React.FC<CategoryFormProps> = ({ initialData }) => {
   const params = useParams();
   const router = useRouter();
   const baseStoreURL = useGetBaseStoreUrl();

   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);

   const { toast } = useToast();

   const title = initialData ? 'Edit category' : 'Create category';
   const description = initialData ? 'Edit a category.' : 'Add a new category';
   const action = initialData ? 'Save changes' : 'Create';
   const loadingAction = loading ? (initialData ? 'Saving' : 'Creating') : '';
   const buttonText = loading ? loadingAction : action;

   const form = useForm<CategoryFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: initialData || {
         name: '',
      },
   });

   const transaction = startTransaction({ name: 'Create Category' });

   const getReturnUrl = useReturnUrl(`/inventory/categories`);

   const onDelete = async () => {
      try {
         logger.info('action: began deleteCategory', {
            categoryId: params.categoryId,
            storeId: params.storeId,
         });
         setLoading(true);
         await apiDeleteCategory(params.categoryId, params.storeId);
         router.refresh();
         router.push(`${baseStoreURL}/inventory/categories`);
         toast({
            title: `Category deleted.`,
         });
      } catch (error: any) {
         captureException(error);
         logger.error('action: deleteCategory', {
            categoryId: params.categoryId,
            storeId: params.storeId,
            error: (error as Error).message,
         });
         toast({
            title: `An error occured deleting this category. Make sure you have removed all categories and products under this category first.`,
         });
      } finally {
         setLoading(false);
         setOpen(false);
         logger.info('action: deleteCategory', {
            categoryId: params.categoryId,
            storeId: params.storeId,
         });
         transaction.finish();
      }
   };

   const onSubmit = async (data: CategoryFormValues) => {
      const returnUrl = getReturnUrl();

      try {
         logger.info('action: began create/updateCategory', {
            categoryId: params.categoryId,
            storeId: params.storeId,
         });
         setLoading(true);
         if (initialData) {
            await apiUpdateCategory(params.categoryId, params.storeId, data);
         } else {
            await apiCreateCategory(params.storeId, data);
         }
         toast({
            title: `Category '${data.name}' ${
               initialData ? 'updated' : 'added'
            }.`,
         });
         router.refresh();
         router.push(returnUrl);
      } catch (error: any) {
         captureException(error);
         logger.error('action: create/updateCategory', {
            categoryId: params.categoryId,
            storeId: params.storeId,
            error: (error as Error).message,
         });
         toast({
            title: `Something went wrong adding this category. Try again.`,
         });
      } finally {
         setLoading(false);
         logger.info('action: create/updateCategory', {
            categoryId: params.categoryId,
            storeId: params.storeId,
         });
         transaction.finish();
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
                                    placeholder="Category name"
                                    {...field}
                                 />
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
