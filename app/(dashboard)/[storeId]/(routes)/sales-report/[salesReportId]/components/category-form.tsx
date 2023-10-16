'use client';

import * as z from 'zod';
import axios from 'axios';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'react-hot-toast';
import { ArrowLeft, Trash } from 'lucide-react';
import { Billboard, Category } from '@prisma/client';
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

const formSchema = z.object({
   name: z.string().min(2),
});

type CategoryFormValues = z.infer<typeof formSchema>;

interface CategoryFormProps {
   initialData: Category | null;
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

   const form = useForm<CategoryFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: initialData || {
         name: '',
      },
   });

   const onSubmit = async (data: CategoryFormValues) => {
      const searchParams = new URLSearchParams(window.location.search);
      const returnUrl =
         searchParams.get('return_url') ||
         `/${params.storeId}/inventory/categories`;

      try {
         setLoading(true);
         if (initialData) {
            await axios.patch(
               `/api/${params.storeId}/categories/${params.categoryId}`,
               data,
            );
         } else {
            await axios.post(`/api/${params.storeId}/categories`, data);
         }
         toast({
            title: `Category '${data.name}' ${
               initialData ? 'updated' : 'added'
            }.`,
         });
         router.refresh();
         router.push(returnUrl);
      } catch (error: any) {
         toast({
            title: `Something went wrong adding this category. Try again.`,
         });
      } finally {
         setLoading(false);
      }
   };

   const onDelete = async () => {
      try {
         setLoading(true);
         await axios.delete(
            `/api/${params.storeId}/categories/${params.categoryId}`,
         );
         router.refresh();
         router.push(`/${params.storeId}/inventory/categories`);
         toast({
            title: `Category deleted.`,
         });
      } catch (error: any) {
         toast({
            title: `An error occured deleting this category. Make sure you have removed all categories and products under this category first.`,
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
                  size="sm"
                  onClick={() => setOpen(true)}
               >
                  <Trash className="h-4 w-4" />
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
               <Button disabled={loading} className="ml-auto" type="submit">
                  {action}
               </Button>
            </form>
         </Form>
      </>
   );
};
