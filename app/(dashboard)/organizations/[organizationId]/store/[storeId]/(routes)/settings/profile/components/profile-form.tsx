'use client';

import * as z from 'zod';
import axios from 'axios';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { captureException } from '@sentry/nextjs';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

import { Input } from '@/components/ui/input';
import {
   Form,
   FormControl,
   FormField,
   FormItem,
   FormLabel,
   FormMessage,
} from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';
import { AlertModal } from '@/components/modals/alert-modal';
import { useOrigin } from '@/hooks/use-origin';
import { useToast } from '@/components/ui/use-toast';
import { useUser } from '@/providers/user-provider';
import { LoadingButton } from '@/components/ui/loading-button';
import { Label } from '@/components/ui/label';
import {
   mainContainerVariants,
   widgetVariants,
} from '@/lib/animation/constants';
import { apiUpdateUser } from '@/lib/api/users';

const formSchema = z.object({
   name: z.string().min(1),
   email: z.string().email(),
});

type ProfileFormValues = {
   name?: string;
   email: string;
};

interface ProfileFormProps {
   initialData: {
      id?: string;
      name?: string | null;
      email?: string;
      store_id?: number | null;
      created_at?: Date;
      updated_at?: Date;
   } | null;
}

export const ProfileForm: React.FC<ProfileFormProps> = ({ initialData }) => {
   const params = useParams();
   const router = useRouter();
   const origin = useOrigin();
   const { toast } = useToast();

   const { setUser } = useUser();

   const [isClient, setIsClient] = useState(false);

   useEffect(() => {
      setIsClient(true);
   }, []);

   const cleanedUp = { ...initialData, name: initialData?.name || '' };

   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);

   const form = useForm<ProfileFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: cleanedUp ? cleanedUp : { name: '', email: '' },
   });

   const onSubmit = async (data: ProfileFormValues) => {
      try {
         setLoading(true);
         const response = await apiUpdateUser(data);
         setUser(response);
         router.refresh();
         toast({
            title: 'Profile updated.',
         });
      } catch (error: any) {
         captureException(error);
         toast({
            title: 'Something went wrong. Try again.',
         });
      } finally {
         setLoading(false);
      }
   };

   const onDelete = async () => {
      try {
         setLoading(true);
         await axios.delete(`/api/v1/users`);
         router.refresh();
         router.push('/');
         toast({
            title: 'Profile deleted.',
         });
      } catch (error: any) {
         captureException(error);
         toast({
            title: 'Make sure you removed all products and categories first and then try again.',
         });
      } finally {
         setLoading(false);
         setOpen(false);
      }
   };

   return (
      <>
         {isClient ? (
            <>
               <AlertModal
                  isOpen={open}
                  onClose={() => setOpen(false)}
                  onConfirm={onDelete}
                  loading={loading}
               />
               <motion.div
                  className="space-y-4"
                  variants={widgetVariants}
                  initial="hidden"
                  animate="visible"
               >
                  <Label className="text-lg">Profile settings</Label>
                  <Separator />
               </motion.div>

               <motion.div
                  className="space-y-8"
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
                                          placeholder="Name"
                                          {...field}
                                       />
                                    </FormControl>
                                    <FormMessage />
                                 </FormItem>
                              )}
                           />

                           <FormField
                              control={form.control}
                              name="email"
                              render={({ field }) => (
                                 <FormItem>
                                    <FormLabel>Email</FormLabel>
                                    <FormControl>
                                       <Input
                                          type="email"
                                          disabled={loading}
                                          placeholder="Email"
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
                           {loading ? 'Saving' : 'Save changes'}
                        </LoadingButton>
                     </form>
                  </Form>
               </motion.div>
            </>
         ) : null}
      </>
   );
};
