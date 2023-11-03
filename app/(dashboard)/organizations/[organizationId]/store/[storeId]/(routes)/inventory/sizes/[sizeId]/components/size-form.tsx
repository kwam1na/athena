'use client';

import * as z from 'zod';
import { captureException } from '@sentry/nextjs';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { ArrowLeft, Trash } from 'lucide-react';
import { size } from '@prisma/client';
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
import { apiCreateSize, apiDeleteSize, apiUpdateSize } from '@/lib/api/sizes';
import useReturnUrl from '@/hooks/use-get-return-url';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';

const formSchema = z.object({
   name: z.string().min(1),
   value: z.string().min(1),
});

type SizeFormValues = z.infer<typeof formSchema>;

interface SizeFormProps {
   initialData: size | null;
}

export const SizeForm: React.FC<SizeFormProps> = ({ initialData }) => {
   const params = useParams();
   const router = useRouter();
   const baseStoreURL = useGetBaseStoreUrl();
   const { toast } = useToast();

   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);

   const title = initialData ? 'Edit size' : 'Create size';
   const description = initialData ? 'Edit a size.' : 'Add a new size';
   const action = initialData ? 'Save changes' : 'Create';
   const loadingAction = loading ? (initialData ? 'Saving' : 'Creating') : '';
   const buttonText = loading ? loadingAction : action;

   const form = useForm<SizeFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: initialData || {
         name: '',
      },
   });

   const getReturnUrl = useReturnUrl(`/inventory/sizes`);

   const onSubmit = async (data: SizeFormValues) => {
      const returnUrl = getReturnUrl();

      try {
         setLoading(true);
         if (initialData) {
            await apiUpdateSize(params.sizeId, params.storeId, data);
         } else {
            await apiCreateSize(params.storeId, data);
         }
         router.refresh();
         router.push(returnUrl);
         toast({
            title: `Size '${data.name}' ${initialData ? 'updated' : 'added'}.`,
         });
      } catch (error: any) {
         captureException(error);
         toast({
            title: 'Something went wrong adding this size. Try again.',
         });
      } finally {
         setLoading(false);
      }
   };

   const onDelete = async () => {
      try {
         setLoading(true);
         await apiDeleteSize(params.sizeId, params.storeId);
         router.refresh();
         router.push(`${baseStoreURL}/inventory/sizes`);
         toast({
            title: 'Size deleted.',
         });
      } catch (error: any) {
         captureException(error);
         toast({
            title: 'An error occured deleting this size. Make sure you removed all products using this size first and try again.',
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
                                 placeholder="Size name"
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
                              <Input
                                 disabled={loading}
                                 placeholder="Size value"
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
