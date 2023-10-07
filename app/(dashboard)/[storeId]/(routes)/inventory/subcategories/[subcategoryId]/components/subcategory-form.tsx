'use client';

import * as z from 'zod';
import axios from 'axios';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { AlertCircle, ArrowLeft, Trash } from 'lucide-react';
import { Billboard, Category, Subcategory } from '@prisma/client';
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
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { LoadingButton } from '@/components/ui/loading-button';

const formSchema = z.object({
   name: z.string().min(2),
   category_id: z.string().min(1),
   //    billboardId: z.string().min(1),
});

type SubcategoryFormValues = z.infer<typeof formSchema>;

interface SubcategoryFormProps {
   initialData: Subcategory | null;
   categories: Category[];
   //    billboards: Billboard[];
}

export const SubategoryForm: React.FC<SubcategoryFormProps> = ({
   initialData,
   categories,
   //    billboards,
}) => {
   const params = useParams();
   const router = useRouter();
   const { toast } = useToast();

   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);

   const title = initialData ? 'Edit subcategory' : 'Create subcategory';
   const description = initialData
      ? 'Edit a subcategory.'
      : 'Add a new subcategory';
   const toastMessage = initialData
      ? 'Subcategory updated.'
      : 'Subcategory created.';
   const action = initialData ? 'Save changes' : 'Create';

   const form = useForm<SubcategoryFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: initialData || {
         name: '',
         category_id: '',
      },
   });

   const onSubmit = async (data: SubcategoryFormValues) => {
      const _params = new URLSearchParams(window.location.search);
      const returnUrl =
         _params.get('return_url') ||
         `/${params.storeId}/inventory/subcategories`;

      try {
         setLoading(true);
         if (initialData) {
            await axios.patch(
               `/api/${params.storeId}/subcategories/${params.subcategoryId}`,
               data,
            );
         } else {
            await axios.post(`/api/${params.storeId}/subcategories`, data);
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
         toast({
            title: 'Something went wrong updating this subcategory. Try again.',
         });
      } finally {
         setLoading(false);
      }
   };

   const onDelete = async () => {
      try {
         setLoading(true);
         await axios.delete(
            `/api/${params.storeId}/subcategories/${params.subcategoryId}`,
         );
         router.refresh();
         router.push(`/${params.storeId}/inventory/subcategories`);
         toast({
            title: 'Subcategory deleted.',
         });
      } catch (error: any) {
         toast({
            title: 'An error occurred deleting this subcategory. Make sure all products under this subcategory are deleted and try again.',
         });
      } finally {
         setLoading(false);
         setOpen(false);
      }
   };

   const Alerts = () => {
      return (
         <>
            {categories.length == 0 && (
               <Alert className="flex justify-between">
                  <div className="flex gap-2 pt-4 pb-4">
                     <AlertCircle className="h-4 w-4" />
                     <div className="grid grid-rows-2 gap-2">
                        <AlertTitle>No categories found</AlertTitle>
                        <AlertDescription>
                           You need to add a category to create a product
                        </AlertDescription>
                     </div>
                  </div>
                  <Button
                     className="mt-4"
                     variant={'outline'}
                     onClick={() =>
                        router.push(
                           `/${params.storeId}/inventory/categories/new`,
                        )
                     }
                  >
                     Add category
                  </Button>
               </Alert>
            )}
         </>
      );
   };

   return (
      <>
         <AlertModal
            isOpen={open}
            onClose={() => setOpen(false)}
            onConfirm={onDelete}
            loading={loading}
         />
         <Alerts />
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
                                 placeholder="Subcategory name"
                                 {...field}
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
                              onValueChange={field.onChange}
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
                                       {category.name}
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
                  {action}
               </LoadingButton>
            </form>
         </Form>
      </>
   );
};
