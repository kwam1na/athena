'use client';

import * as z from 'zod';
import axios from 'axios';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { captureException } from '@sentry/nextjs';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

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
import { Heading } from '@/components/ui/heading';
import { AlertModal } from '@/components/modals/alert-modal';
import { useOrigin } from '@/hooks/use-origin';
import { useToast } from '@/components/ui/use-toast';
import {
   WrappedUserProfile,
   useWrappedUser,
} from '@/providers/wrapped-user-provider';
import { LoadingButton } from '@/components/ui/loading-button';
import { toast } from 'sonner';
import { Ban, CheckCircle2 } from 'lucide-react';

const formSchema = z.object({
   name: z.string().min(1),
   email: z.string().email(),
});

type ProfileFormValues = {
   name?: string;
   email: string;
};

interface ProfileFormProps {
   initialData: WrappedUserProfile | null;
}

export const ProfileForm: React.FC<ProfileFormProps> = ({ initialData }) => {
   const params = useParams();
   const router = useRouter();
   const origin = useOrigin();

   const { setWrappedUser } = useWrappedUser();

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
         const res = await axios.patch(`/api/v1/users`, data);
         setWrappedUser(res.data);
         router.refresh();
         toast('Profile updated.', {
            icon: <CheckCircle2 className="w-4 h-4" />,
         });
      } catch (error: any) {
         captureException(error);
         toast('Something went wrong. Try again.', {
            icon: <Ban className="w-4 h-4" />,
         });
      } finally {
         setLoading(false);
      }
   };

   // const onDelete = async () => {
   //    try {
   //       setLoading(true);
   //       await axios.delete(`/api/v1/users`);
   //       router.refresh();
   //       toast({
   //          title: 'Profile deleted.',
   //       });
   //    } catch (error: any) {
   //       captureException(error);
   //       toast({
   //          title: 'Make sure you removed all products and categories first and then try again.',
   //       });
   //    } finally {
   //       setLoading(false);
   //       setOpen(false);
   //    }
   // };

   return (
      <>
         {isClient ? (
            <>
               {/* <AlertModal
                  isOpen={open}
                  onClose={() => setOpen(false)}
                  onConfirm={onDelete}
                  loading={loading}
               /> */}
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
            </>
         ) : null}
      </>
   );
};
