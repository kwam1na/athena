'use client';

import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';

import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { useStoreModal } from '@/hooks/use-store-modal';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '../ui/loading-button';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { currencies } from '@/lib/constants';
import {
   Form,
   FormControl,
   FormField,
   FormItem,
   FormLabel,
   FormMessage,
} from '@/components/ui/form';
import { apiCreateStore } from '@/lib/api/stores';

const formSchema = z.object({
   name: z.string().min(1),
   currency: z.string().min(1),
});

export const StoreModal = () => {
   const storeModal = useStoreModal();
   const params = useParams();
   const { toast } = useToast();

   const [loading, setLoading] = useState(false);

   const form = useForm<z.infer<typeof formSchema>>({
      resolver: zodResolver(formSchema),
      defaultValues: {
         name: '',
         currency: '',
      },
   });

   const onSubmit = async (values: z.infer<typeof formSchema>) => {
      try {
         setLoading(true);
         const body = { ...values, organization_id: params.organizationId };
         const response = await apiCreateStore(body);
         window.location.assign(
            `/organizations/${params.organizationId}/store/${response.id}`,
         );
      } catch (error) {
         toast({
            title: 'Something went wrong',
         });
      } finally {
         setLoading(false);
      }
   };

   return (
      <Modal
         title="Create store"
         description="Add a new store to manage your inventory and operations"
         isOpen={storeModal.isOpen}
         onClose={storeModal.onClose}
      >
         <div>
            <div className="space-y-4 py-2 pb-4">
               <div className="space-y-2">
                  <Form {...form}>
                     <form onSubmit={form.handleSubmit(onSubmit)}>
                        <div className="flex w-full gap-8">
                           <div className="w-[60%]">
                              <FormField
                                 control={form.control}
                                 name="name"
                                 render={({ field }) => (
                                    <FormItem>
                                       <FormLabel>Name</FormLabel>
                                       <FormControl>
                                          <Input
                                             disabled={loading}
                                             placeholder="Acme Inc."
                                             {...field}
                                          />
                                       </FormControl>
                                       <FormMessage />
                                    </FormItem>
                                 )}
                              />
                           </div>

                           <div className="w-[60%]">
                              <FormField
                                 control={form.control}
                                 name="currency"
                                 render={({ field }) => (
                                    <FormItem>
                                       <FormLabel>Currency</FormLabel>
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
                                                   placeholder="Select a currency"
                                                />
                                             </SelectTrigger>
                                          </FormControl>
                                          <SelectContent>
                                             {currencies.map((currency) => (
                                                <SelectItem
                                                   key={currency.value}
                                                   value={currency.value}
                                                >
                                                   {currency.label}
                                                </SelectItem>
                                             ))}
                                          </SelectContent>
                                       </Select>
                                       <FormMessage />
                                    </FormItem>
                                 )}
                              />
                           </div>
                        </div>

                        <div className="pt-6 space-x-2 flex items-center justify-end w-full">
                           <Button
                              disabled={loading}
                              variant="outline"
                              onClick={storeModal.onClose}
                           >
                              Cancel
                           </Button>
                           <LoadingButton
                              isLoading={loading}
                              disabled={loading}
                              type="submit"
                           >
                              Continue
                           </LoadingButton>
                        </div>
                     </form>
                  </Form>
               </div>
            </div>
         </div>
      </Modal>
   );
};
