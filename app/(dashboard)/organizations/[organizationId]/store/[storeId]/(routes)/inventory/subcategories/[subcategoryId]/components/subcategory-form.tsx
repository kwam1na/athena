'use client';

import * as z from 'zod';
import { captureException } from '@sentry/nextjs';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { AlertCircle, ArrowLeft, PlusCircle, Trash } from 'lucide-react';
import { category, subcategory } from '@prisma/client';
import { useParams, usePathname, useRouter } from 'next/navigation';

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
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { LoadingButton } from '@/components/ui/loading-button';
import {
   apiCreateSubcategory,
   apiDeleteSubcategory,
   apiUpdateSubcategory,
} from '@/lib/api/subcategories';
import useReturnUrl from '@/hooks/use-get-return-url';
import { TaskAlert } from '@/components/ui/task-alert';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import { LocalStorageSync } from '@/lib/local-storage-sync';
import { motion } from 'framer-motion';
import { mainContainerVariants, widgetVariants } from '@/lib/constants';
import logger from '@/lib/logger/console-logger';
import { Label } from '@/components/ui/label';

const formSchema = z.object({
   name: z.string().min(2),
   category_id: z.string().min(1),
});

type SubcategoryFormValues = z.infer<typeof formSchema>;

interface SubcategoryFormProps {
   initialData: subcategory | null;
   categories: category[];
}

export const SubategoryForm: React.FC<SubcategoryFormProps> = ({
   initialData,
   categories,
}) => {
   const params = useParams();
   const baseStoreURL = useGetBaseStoreUrl();
   const router = useRouter();
   const pathName = usePathname();
   const { toast } = useToast();

   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);

   const title = initialData ? 'Edit subcategory' : 'Create subcategory';
   const description = initialData
      ? 'Edit a subcategory.'
      : 'Add a new subcategory';
   const action = initialData ? 'Save changes' : 'Create';
   const loadingAction = loading ? (initialData ? 'Saving' : 'Creating') : '';
   const buttonText = loading ? loadingAction : action;

   const autosavingKey = initialData
      ? `subcategory-editing-${params.storeId}`
      : `subcategory-${params.storeId}`;
   const autosaver = new LocalStorageSync(autosavingKey);

   const form = useForm<SubcategoryFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: initialData || {
         name: '',
         category_id: '',
      },
   });

   const autosaveCategory = () => {
      autosaver.save(form.getValues());
   };

   const saveReturnUrlToLocalStorage = () => {
      const url = window.location.href;
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      let return_url = urlObj.searchParams.get('return_url');

      // If return_url exists, append the remaining query params to it
      if (return_url) {
         urlObj.searchParams.delete('return_url');

         const remainingQueryParams = urlObj.searchParams.toString();
         return_url +=
            (return_url.includes('?') ? '&' : '?') + remainingQueryParams;
      }

      localStorage.setItem(pathname, JSON.stringify({ return_url }));
      autosaveCategory();
   };

   const useAutosavedCategory = () => {
      const autosavedCategory = autosaver.getAll();
      form.reset(autosavedCategory);
   };

   const updateReturnURL = () => {
      const draftProduct = autosaver.getAll();

      if (Object.keys(draftProduct).length > 0) {
         return `&repopulate=true`;
      }
      return '';
   };

   useEffect(() => {
      if (!localStorage.getItem(pathName)) saveReturnUrlToLocalStorage();
   }, []);

   useEffect(() => {
      const searchParams = new URLSearchParams(window.location.search);
      const repopulate = searchParams.get('repopulate');

      if (initialData && !repopulate) {
         autosaver.save(form.getValues());
      }
   }, []);

   useEffect(() => {
      const autosavedCategory = autosaver.getAll();

      const searchParams = new URLSearchParams(window.location.search);
      const repopulate = searchParams.get('repopulate');

      searchParams.delete('repopulate');

      if (initialData && !repopulate) {
         autosaver.save(form.getValues());
      }

      if (Object.keys(autosavedCategory).length > 0) {
         const urlWithoutParams = window.location.pathname;
         if (searchParams.toString()) {
            window.history.replaceState(
               null,
               '',
               `?${searchParams.toString()}`,
            );
         } else {
            window.history.replaceState(null, '', urlWithoutParams);
         }

         if (repopulate) {
            useAutosavedCategory();
         }
      }
   }, []);

   const getReturnUrl = useReturnUrl(`/inventory/subcategories`);

   const onSubmit = async (data: SubcategoryFormValues) => {
      let returnUrl = getReturnUrl();
      const { return_url } = JSON.parse(localStorage.getItem(pathName) || '{}');

      if (return_url && returnUrl != return_url) {
         returnUrl = return_url;
      }

      try {
         logger.info('action: began create/updateSubcategory', {
            subcategoryId: params.subcategoryId,
            storeId: params.storeId,
         });
         setLoading(true);
         if (initialData) {
            await apiUpdateSubcategory(
               params.subcategoryId,
               params.storeId,
               data,
            );
         } else {
            await apiCreateSubcategory(params.storeId, data);
         }
         toast({
            title: `Category '${data.name}' ${
               initialData ? 'updated' : 'added'
            }.`,
         });
         toast({
            title: `Subcategory '${data.name}' ${
               initialData ? 'updated' : 'added'
            }.`,
         });
         router.refresh();
         router.push(returnUrl);
      } catch (error: any) {
         logger.error('action: create/updateSubcategory', {
            subcategoryId: params.subcategoryId,
            storeId: params.storeId,
            error: (error as Error).message,
         });
         captureException(error);
         toast({
            title: 'Something went wrong updating this subcategory. Try again.',
         });
      } finally {
         setLoading(false);
         autosaver.clearAll();
         localStorage.removeItem(pathName);
         logger.info('action: create/updateSubcategory', {
            subcategoryId: params.subcategoryId,
            storeId: params.storeId,
         });
      }
   };

   const onDelete = async () => {
      try {
         setLoading(true);
         await apiDeleteSubcategory(params.subcategoryId, params.storeId);
         router.refresh();
         router.push(`${baseStoreURL}/inventory/subcategories`);
         toast({
            title: 'Subcategory deleted.',
         });
      } catch (error: any) {
         logger.error('action: deleteSubcategory', {
            subcategoryId: params.subcategoryId,
            storeId: params.storeId,
            error: (error as Error).message,
         });
         captureException(error);
         toast({
            title: 'An error occurred deleting this subcategory. Make sure all products under this subcategory are deleted and try again.',
         });
      } finally {
         setLoading(false);
         setOpen(false);
         logger.info('action: deleteSubcategory', {
            subcategoryId: params.subcategoryId,
            storeId: params.storeId,
         });
      }
   };

   const Alerts = () => {
      const returnURL = `${baseStoreURL}/inventory/subcategories/new`;
      const hasAddedCategory = !(
         categories.length == 1 && categories[0].id == 'add-new-category'
      );
      return (
         <>
            {!hasAddedCategory && (
               <TaskAlert
                  title="No categories found"
                  description="To proceed, please add a category."
                  action={{
                     type: 'navigate',
                     ctaText: 'Add category',
                     route: `${baseStoreURL}/inventory/categories/new?return_url=${returnURL}${updateReturnURL()}`,
                  }}
               />
            )}
         </>
      );
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
                                    placeholder="Subcategory name"
                                    {...field}
                                    onChange={(e) => {
                                       field.onChange(e);
                                       autosaveCategory();
                                    }}
                                 />
                              </FormControl>
                              <FormMessage />
                           </FormItem>
                        )}
                     />
                     <FormField
                        control={form.control}
                        name="category_id"
                        render={({ field }) => (
                           <FormItem>
                              <FormLabel>Category</FormLabel>
                              <Select
                                 disabled={loading}
                                 onValueChange={(value: string) => {
                                    if (value == 'add-new-category') {
                                       router.push(
                                          `${baseStoreURL}/inventory/categories/new?return_url=${pathName}${updateReturnURL()}`,
                                       );
                                    } else {
                                       field.onChange(value);
                                    }
                                 }}
                                 value={field.value}
                                 defaultValue={field.value}
                              >
                                 <FormControl>
                                    <SelectTrigger>
                                       <SelectValue
                                          defaultValue={field.value}
                                          placeholder="Select a category"
                                       />
                                    </SelectTrigger>
                                 </FormControl>
                                 <SelectContent>
                                    {categories.map((category) => (
                                       <SelectItem
                                          key={category.id}
                                          value={category.id}
                                       >
                                          {category.id.includes('add-new') ? (
                                             <div className="flex items-center">
                                                <PlusCircle className="mr-2 h-4 w-4" />
                                                <p className="text-primary">
                                                   Add new category
                                                </p>
                                             </div>
                                          ) : (
                                             category.name
                                          )}
                                       </SelectItem>
                                    ))}
                                 </SelectContent>
                              </Select>
                              <FormMessage />
                           </FormItem>
                        )}
                     />
                     {/* <FormField
                     control={form.control}
                     name="billboardId"
                     render={({ field }) => (
                        <FormItem>
                           <FormLabel>Billboard</FormLabel>
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
                                       placeholder="Select a billboard"
                                    />
                                 </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                 {billboards.map((billboard) => (
                                    <SelectItem
                                       key={billboard.id}
                                       value={billboard.id}
                                    >
                                       {billboard.label}
                                    </SelectItem>
                                 ))}
                              </SelectContent>
                           </Select>
                           <FormMessage />
                        </FormItem>
                     )}
                  /> */}
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
