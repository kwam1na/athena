'use client';

import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { zodResolver } from '@hookform/resolvers/zod';
import {
   Form,
   FormControl,
   FormField,
   FormItem,
   FormLabel,
   FormMessage,
} from '@/components/ui/form';
import { useState } from 'react';
import { LoadingButton } from '@/components/ui/loading-button';
import { Input } from '@/components/ui/input';
import { LocalStorageSync } from '@/lib/local-storage-sync';
import logger from '@/lib/logger/console-logger';
import { useToast } from '@/components/ui/use-toast';
import { apiCreateProduct } from '@/lib/api/products';
import { useRouter } from 'next/navigation';
import { ServiceError } from '@/lib/error';
import { ArrowLeft } from 'lucide-react';
import { useOnboardingData } from '@/providers/onboarding-data-provider';
import { containerVariants } from '../constants';

const formSchema = z.object({
   name: z.string().min(1),
   price: z.coerce.number().min(1),
   cost_per_item: z.coerce.number().min(1),
   inventory_count: z.coerce.number().min(1),
});

type ProductFormValues = z.infer<typeof formSchema>;

export default function CreateProduct() {
   const [loading, setLoading] = useState(false);
   const { organizationId, subcategoryId, categoryId, storeId } =
      useOnboardingData();
   const router = useRouter();
   const { toast } = useToast();

   const form = useForm<ProductFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: {
         name: '',
         price: Number('a'),
         cost_per_item: Number('a'),
         inventory_count: Number('a'),
      },
   });

   const onSubmit = async (data: ProductFormValues) => {
      setLoading(true);

      const body = {
         ...data,
         category_id: categoryId,
         subcategory_id: subcategoryId,
         organization_id: organizationId,
      };

      try {
         if (storeId) {
            await apiCreateProduct(storeId.toString(), body);
            router.push('/onboarding/create/success');
         } else {
            logger.error('No store_id found in onboarding data');
            toast({
               title: 'Missing data to create a subcategory. Navigating home.',
            });
            router.replace('/');
         }
      } catch (error) {
         logger.error('error creating subcategory in onboarding', {
            error: (error as Error).message,
         });
         const serviceError = error as ServiceError;
         let message = serviceError.message;
         if (serviceError.status === 401 || serviceError.status === 403) {
            message = 'Unauthenticated. Please sign in again.';
         }

         toast({
            title: message,
         });

         if (serviceError.status === 401 || serviceError.status === 403) {
            setTimeout(() => {
               router.replace('/auth');
            }, 2000);
         }
      } finally {
         setLoading(false);
      }
   };

   return (
      <div className="flex h-full">
         <motion.div
            className="flex flex-col h-full w-[50%] gap-32 px-16"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
         >
            <div className="flex flex-col gap-4 pt-24">
               <div>
                  <Button
                     variant={'outline'}
                     disabled={loading}
                     type="button"
                     onClick={() => router.back()}
                  >
                     <ArrowLeft className="h-4 w-4" />
                  </Button>
               </div>
               <h1 className="text-3xl">Finally, let's add a product.</h1>
               <h2 className="text-lg text-muted-foreground">
                  These are your individual books. Each product has its unique
                  details, just like a book with a title, author, and story.
               </h2>
            </div>

            <div className="flex flex-col w-[50%]">
               <Form {...form}>
                  <form
                     onSubmit={form.handleSubmit(onSubmit)}
                     className="space-y-8 w-full"
                  >
                     <div className="space-y-4">
                        <FormField
                           control={form.control}
                           name="name"
                           render={({ field }) => (
                              <FormItem>
                                 <FormLabel>Product name</FormLabel>
                                 <FormControl>
                                    <Input
                                       type="text"
                                       disabled={loading}
                                       placeholder="Enter product name"
                                       {...field}
                                    />
                                 </FormControl>
                                 <FormMessage />
                              </FormItem>
                           )}
                        />

                        <div className="grid grid-cols-2 space-x-4">
                           <FormField
                              control={form.control}
                              name="price"
                              render={({ field }) => (
                                 <FormItem>
                                    <FormLabel>List price</FormLabel>
                                    <FormControl>
                                       <Input
                                          type="number"
                                          disabled={loading}
                                          placeholder="0.00"
                                          {...field}
                                       />
                                    </FormControl>
                                    <FormMessage />
                                 </FormItem>
                              )}
                           />

                           <FormField
                              control={form.control}
                              name="cost_per_item"
                              render={({ field }) => (
                                 <FormItem>
                                    <FormLabel>Cost</FormLabel>
                                    <FormControl>
                                       <Input
                                          type="number"
                                          disabled={loading}
                                          placeholder="0.00"
                                          {...field}
                                       />
                                    </FormControl>
                                    <FormMessage />
                                 </FormItem>
                              )}
                           />
                        </div>
                     </div>

                     <FormField
                        control={form.control}
                        name="inventory_count"
                        render={({ field }) => (
                           <FormItem>
                              <FormLabel>Stock count</FormLabel>
                              <FormControl>
                                 <Input
                                    type="number"
                                    disabled={loading}
                                    placeholder="0"
                                    {...field}
                                 />
                              </FormControl>
                              <FormMessage />
                           </FormItem>
                        )}
                     />

                     <LoadingButton
                        isLoading={loading}
                        disabled={loading}
                        type="submit"
                     >
                        Create product
                     </LoadingButton>
                  </form>
               </Form>
            </div>
         </motion.div>
         <div className="flex w-[50%] p-32 bg-card"></div>
      </div>
   );
}
