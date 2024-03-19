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
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { apiGetUser } from '@/lib/api/users';
import { Button } from '@/components/ui/button';
import axios from 'axios';
import { mainContainerVariants } from '@/lib/constants';
import { toast } from 'sonner';

const formSchema = z.object({
   email: z.string().email(),
   password: z.string(),
});

type SignInFormValues = {
   email: string;
   password: string;
};

interface SignInProps {
   setIsSignUp: (isSignUp: boolean) => void;
}

export const SignIn: React.FC<SignInProps> = ({ setIsSignUp }) => {
   const [loading, setLoading] = useState(false);
   const [isMounted, setIsMounted] = useState(false);
   const router = useRouter();
   const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
   );

   const form = useForm<SignInFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: { email: '' },
   });

   useEffect(() => {
      setIsMounted(true);
   }, []);

   if (!isMounted) {
      return null;
   }

   const onSubmit = async (formData: SignInFormValues) => {
      try {
         setLoading(true);
         const { data, error } = await supabase.auth.signInWithPassword({
            email: formData.email,
            password: formData.password,
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
            const data = await apiGetUser();

            if (data) {
               router.push('/');
               // if (data.is_onboarded) {
               //    router.push('/');
               // } else {
               //    if (data.name) router.push(`/onboarding?name=${data.name}`);
               //    else router.push(`/onboarding`);
               // }
            }

            if (error) {
               captureException(error);
            }
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
            <h1 className="text-3xl">Welcome back.</h1>
            <p className="text-sm text-muted-foreground">
               Enter your details to continue.
            </p>
         </div>
         <div className="flex-1 space-y-4">
            <Form {...form}>
               <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-8 w-full"
               >
                  <div className="space-y-4">
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
                     {loading ? 'Signing in..' : 'Sign in'}
                  </LoadingButton>

                  <Button
                     className="w-full"
                     variant={'ghost'}
                     onClick={() => setIsSignUp(true)}
                  >
                     New user? Create an account
                  </Button>
               </form>
            </Form>
         </div>
      </motion.div>
   );
};
