'use client';

import { startTransaction, captureException } from '@sentry/nextjs';
import * as z from 'zod';
import axios from 'axios';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'react-hot-toast';
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

   const getReturnUrl = useReturnUrl('/inventory/categories');

   const onSubmit = async (data: CategoryFormValues) => {
      const returnUrl = getReturnUrl();

      try {
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
         toast({
            title: `Something went wrong adding this category. Try again.`,
         });
      } finally {
         setLoading(false);
         transaction.finish();
      }
   };

   const onDelete = async () => {
      try {
         setLoading(true);
         await apiDeleteCategory(params.categoryId, params.storeId);
         router.refresh();
         router.push(`/${params.storeId}/inventory/categories`);
         toast({
            title: `Category deleted.`,
         });
      } catch (error: any) {
         captureException(error);
         toast({
            title: `An error occured deleting this category. Make sure you have removed all categories and products under this category first.`,
         });
      } finally {
         setLoading(false);
         setOpen(false);
         transaction.finish();
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
         <div className="flex">
            <Button variant={'outline'} onClick={() => router.back()}>
               <ArrowLeft className="mr-2 h-4 w-4" />
            </Button>
         </div>
         <div className="flex items-center justify-between">
            <Heading title={title} description={description} />
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
      </>
   );
};
