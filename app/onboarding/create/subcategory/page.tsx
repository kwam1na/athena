'use client';

import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import { zodResolver } from '@hookform/resolvers/zod';
import {
   Form,
   FormControl,
   FormField,
   FormItem,
   FormMessage,
} from '@/components/ui/form';
import { useState } from 'react';
import { LoadingButton } from '@/components/ui/loading-button';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import logger from '@/lib/logger/console-logger';
import {
   apiCreateSubcategory,
   apiUpdateSubcategory,
} from '@/lib/api/subcategories';
import { useToast } from '@/components/ui/use-toast';
import { ServiceError } from '@/lib/error';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useOnboardingData } from '@/providers/onboarding-data-provider';
import { containerVariants } from '../constants';

const formSchema = z.object({
   name: z.string().min(3),
});

type SubcategoryFormValues = {
   name: string;
};

export default function CreateSubcategory() {
   const [loading, setLoading] = useState(false);
   const {
      subcategoryId,
      categoryId,
      setSubcategoryId,
      storeId,
      subcategoryName,
      setSubcategoryName,
   } = useOnboardingData();
   const router = useRouter();
   const { toast } = useToast();

   const form = useForm<SubcategoryFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: { name: subcategoryName || '' },
   });

   const onSubmit = async (data: SubcategoryFormValues) => {
      const body = { ...data, category_id: categoryId };
      setLoading(true);
      try {
         if (subcategoryId && storeId) {
            await apiUpdateSubcategory(subcategoryId, storeId.toString(), body);
            setSubcategoryName(data.name);
            router.push('/onboarding/create/product');
         } else {
            if (storeId) {
               const response = await apiCreateSubcategory(
                  storeId.toString(),
                  body,
               );
               setSubcategoryId(response.id);
               setSubcategoryName(response.name);
               router.push('/onboarding/create/product');
            } else {
               logger.error('No store_id found in onboarding data');
               toast({
                  title: 'Missing data to create a subcategory. Navigating home.',
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
               <h1 className="text-3xl">
                  Now, within each category, we have subcategories.
               </h1>
               <h2 className="text-lg text-muted-foreground">
                  These are like the aisles in a library section. They help you
                  organize your items more specifically.
               </h2>
            </div>

            <div className="flex flex-col gap-8">
               <h2 className="text-lg text-muted-foreground leading-relaxed">
                  For instance, under the category "History", you might have
                  Wars of the 20th Century.
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
                                       placeholder="Subcategory name"
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
                        Create subcategory
                     </LoadingButton>
                  </form>
               </Form>
            </div>
         </motion.div>
         <div className="flex w-[50%] p-32 bg-card"></div>
      </div>
   );
}
