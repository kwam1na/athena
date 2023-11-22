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
   FormMessage,
} from '@/components/ui/form';
import { useEffect, useState } from 'react';
import { LoadingButton } from '@/components/ui/loading-button';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { set } from 'date-fns';
import { LocalStorageSync } from '@/lib/local-storage-sync';
import { apiCreateCategory, apiUpdateCategory } from '@/lib/api/categories';
import { on } from 'events';
import { useToast } from '@/components/ui/use-toast';
import logger from '@/lib/logger/console-logger';
import { ServiceError } from '@/lib/error';
import { useOnboardingData } from '@/providers/onboarding-data-provider';
import { containerVariants } from '../constants';

const formSchema = z.object({
   name: z.string().min(3),
});

type CategoryFormValues = {
   name: string;
};

export default function CreateCategory() {
   const [loading, setLoading] = useState(false);
   const { categoryId, setCategoryId, storeId, categoryName, setCategoryName } =
      useOnboardingData();
   const router = useRouter();
   const { toast } = useToast();

   const form = useForm<CategoryFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: { name: categoryName || '' },
   });

   const onSubmit = async (data: CategoryFormValues) => {
      setLoading(true);
      try {
         if (categoryId && storeId) {
            await apiUpdateCategory(categoryId, storeId.toString(), data);
            setCategoryName(data.name);
            router.push('/onboarding/create/subcategory');
         } else {
            if (storeId) {
               const response = await apiCreateCategory(
                  storeId.toString(),
                  data,
               );
               setCategoryId(response.id);
               setCategoryName(response.name);
               router.push('/onboarding/create/subcategory');
            } else {
               logger.error('No storeId found in onboarding data');
               toast({
                  title: 'Missing data to create a category. Navigating home.',
               });
               router.replace('/');
            }
         }
      } catch (error) {
         logger.error('error creating category in onboarding', {
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
            <div className="flex flex-col gap-4 pt-32">
               <h1 className="text-3xl">First, let's create a category.</h1>
               <h2 className="text-lg text-muted-foreground">
                  These are like the genres in a library. Each category
                  encompasses a broad area of your inventory.
               </h2>
            </div>

            <div className="flex flex-col gap-8">
               <h2 className="text-lg text-muted-foreground leading-relaxed">
                  Think of a broad area of your inventory. Following our library
                  model, this would be a genre like Fiction or History.
               </h2>
               <Form {...form}>
                  <form
                     onSubmit={form.handleSubmit(onSubmit)}
                     className="space-y-8 w-[50%]"
                  >
                     <div className="space-y-4">
                        <FormField
                           control={form.control}
                           name="name"
                           render={({ field }) => (
                              <FormItem>
                                 <FormControl>
                                    <Input
                                       type="text"
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
                        type="submit"
                     >
                        Create category
                     </LoadingButton>
                  </form>
               </Form>
            </div>
         </motion.div>
         <div className="flex w-[50%] p-32 bg-card"></div>
      </div>
   );
}
