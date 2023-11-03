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
   FormLabel,
   FormMessage,
} from '@/components/ui/form';
import { useEffect, useState } from 'react';
import { captureException } from '@sentry/nextjs';
import { useToast } from '@/components/ui/use-toast';
import { LoadingButton } from '@/components/ui/loading-button';
import { createBrowserClient } from '@supabase/ssr';
import Cookies from 'js-cookie';
import { useRouter } from 'next/navigation';
import { apiGetUser } from '@/lib/api/users';
import { Button } from '@/components/ui/button';

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
   const { toast } = useToast();
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
            // captureException(error);
            console.log(error);
            toast({
               title: (error as any).message,
            });
            return;
         }

         const { user, session } = data;
         if (session) {
            // Calculate time left in seconds
            const expires_in =
               (session.expires_at! - Math.floor(Date.now() / 1000)) / 3600;

            console.log('expires in', expires_in);

            // Save the tokens using js-cookie
            Cookies.set('access_token', session.access_token, {
               expires: expires_in / 3600,
            });
            Cookies.set('refresh_token', session.refresh_token, {
               expires: 30,
            }); // Expires in 30 days
         }

         if (user) {
            const data = await apiGetUser();
            console.log(data);

            if (data) {
               if (data.is_onboarded) {
                  router.push('/');
               } else {
                  if (data.name) router.push(`/onboarding?name=${data.name}`);
                  else router.push(`/onboarding`);
               }
            }

            if (error) {
               captureException(error);
               // Handle the error as you see fit
            }
         }
      } catch (error: any) {
         captureException(error);
         toast({
            title: 'Something went wrong. Try again.',
         });
      } finally {
         setLoading(false);
      }
   };

   return (
      <div className="flex flex-col gap-12 w-[40%]">
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
      </div>
   );
};
