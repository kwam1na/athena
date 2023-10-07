'use client';

import * as z from 'zod';
import axios from 'axios';
import { ChangeEvent, FocusEvent, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { ArrowLeft, Trash } from 'lucide-react';
import { Color } from '@prisma/client';
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

const formSchema = z.object({
   name: z.string().min(2),
   value: z.string().min(4).max(9).regex(/^#/, {
      message: 'String must be a valid hex code',
   }),
});

type ColorFormValues = z.infer<typeof formSchema>;

interface ColorFormProps {
   initialData: Color | null;
}

export const ColorForm: React.FC<ColorFormProps> = ({ initialData }) => {
   const params = useParams();
   const router = useRouter();
   const { toast } = useToast();

   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);

   const title = initialData ? 'Edit color' : 'Create color';
   const description = initialData ? 'Edit a color.' : 'Add a new color';
   const toastMessage = initialData ? 'Color updated.' : 'Color created.';
   const action = initialData ? 'Save changes' : 'Create';

   const form = useForm<ColorFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: initialData || {
         name: '',
      },
   });

   const onSubmit = async (data: ColorFormValues) => {
      try {
         setLoading(true);
         if (initialData) {
            await axios.patch(
               `/api/${params.storeId}/colors/${params.colorId}`,
               data,
            );
         } else {
            await axios.post(`/api/${params.storeId}/colors`, data);
         }
         toast({
            title: `Category '${data.name}' ${
               initialData ? 'updated' : 'added'
            }.`,
         });
         router.refresh();
         router.push(`/${params.storeId}/inventory/colors`);
         toast({
            title: `Color '${data.name}' ${initialData ? 'updated' : 'added'}.`,
         });
      } catch (error: any) {
         toast({
            title: 'Something went wrong adding this color. Try again.',
         });
      } finally {
         setLoading(false);
      }
   };

   const onDelete = async () => {
      try {
         setLoading(true);
         await axios.delete(`/api/${params.storeId}/colors/${params.colorId}`);
         router.refresh();
         router.push(`/${params.storeId}/inventory/colors`);
         toast({
            title: 'Color deleted.',
         });
      } catch (error: any) {
         toast({
            title: 'Something went wrong deleting this product. Make sure all products using this color are deleted and try again.',
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
                  {action}
               </LoadingButton>
            </form>
         </Form>
      </>
   );
};
