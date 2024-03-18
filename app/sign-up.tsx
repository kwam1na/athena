'use client';

import * as z from 'zod';
import { Input } from '@/components/ui/input';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
   Form,
   FormControl,
   FormField,
   FormItem,
   FormMessage,
} from '@/components/ui/form';
import { useEffect, useState } from 'react';
import { captureException } from '@sentry/nextjs';
import { LoadingButton } from '@/components/ui/loading-button';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import axios from 'axios';
import { mainContainerVariants } from '@/lib/constants';
import { toast } from 'sonner';

const formSchema = z.object({
   email: z.string().email(),
   password: z.string().min(6),
});

type SignUpFormValues = {
   email: string;
   password: string;
};

export const SignUp = () => {
   const [loading, setLoading] = useState(false);
   const [isMounted, setIsMounted] = useState(false);
   const router = useRouter();
   const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
   );

   const form = useForm<SignUpFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: { email: '' },
   });

   useEffect(() => {
      setIsMounted(true);
   }, []);

   if (!isMounted) {
      return null;
   }

   const onSubmit = async (formData: SignUpFormValues) => {
      try {
         setLoading(true);
         const { data, error } = await supabase.auth.signUp({
            email: formData.email,
            password: formData.password,
            options: {
               emailRedirectTo: `${process.env.NEXT_PUBLIC_BASE_URL}}/`,
            },
         });

         if (error) {
            captureException(error);
            toast((error as any).message);
            return;
         }

         const { user, session } = data;

         if (session) {
            try {
               const { access_token, refresh_token } = session;
               await axios.post('/api/v1/update-tokens', {
                  access_token,
                  refresh_token,
               });
            } catch (error) {
               console.error((error as Error).message);
            }
         }

         if (user) {
            if (sessionStorage.getItem('organizationId')) {
               sessionStorage.removeItem('organizationId');
            }
            // router.push(`/onboarding`);
            router.push(`/services`);
         }
      } catch (error: any) {
         captureException(error);
         toast('Something went wrong. Try again.');
      } finally {
         setLoading(false);
      }
   };

   return (
      <motion.div
         className="flex flex-col gap-12 w-[40%]"
         variants={mainContainerVariants}
         initial="hidden"
         animate="visible"
      >
         <div className="flex flex-col items-center space-y-4">
            <h1 className="text-3xl">Hello.</h1>
            <p className="text-sm text-muted-foreground">
               Set up your account.
            </p>
         </div>
         <div className="flex-1 space-y-4">
            <Form {...form}>
               <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-8 w-full"
               >
                  <div className="space-y-4">
                     {/* <div className="md:grid md:grid-cols-2 gap-4">
                        <FormField
                           control={form.control}
                           name="firstName"
                           render={({ field }) => (
                              <FormItem>
                                 <FormControl>
                                    <Input
                                       disabled={loading}
                                       placeholder="First name"
                                       {...field}
                                    />
                                 </FormControl>
                                 <FormMessage />
                              </FormItem>
                           )}
                        />

                        <FormField
                           control={form.control}
                           name="lastName"
                           render={({ field }) => (
                              <FormItem>
                                 <FormControl>
                                    <Input
                                       disabled={loading}
                                       placeholder="Last name"
                                       {...field}
                                    />
                                 </FormControl>
                                 <FormMessage />
                              </FormItem>
                           )}
                        />
                     </div> */}

                     <div className="space-y-4">
                        <FormField
                           control={form.control}
                           name="email"
                           render={({ field }) => (
                              <FormItem>
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

                        <FormField
                           control={form.control}
                           name="password"
                           render={({ field }) => (
                              <FormItem>
                                 <FormControl>
                                    <Input
                                       type="password"
                                       disabled={loading}
                                       placeholder="Password"
                                       {...field}
                                    />
                                 </FormControl>
                                 <FormMessage />
                              </FormItem>
                           )}
                        />
                     </div>
                  </div>

                  <LoadingButton
                     isLoading={loading}
                     disabled={loading}
                     className="w-full"
                     type="submit"
                  >
                     {loading ? 'Signing up..' : 'Sign up'}
                  </LoadingButton>
               </form>
            </Form>
         </div>
      </motion.div>
   );
};
