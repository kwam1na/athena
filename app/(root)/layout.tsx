import { redirect } from 'next/navigation';
import prismadb from '@/lib/prismadb';
import { ErrorPage } from '@/components/states/error';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { findUserOrganization } from '@/lib/repositories/organizationsRepository';
import { ThemeProvider } from '@/providers/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { ModalProvider } from '@/providers/modal-provider';
import { WrappedUserProvider } from '@/providers/wrapped-user-provider';
import { CurrencyProvider } from '@/providers/currency-provider';
import { ExchangeRateProvider } from '@/providers/exchange-rate-provider';
import AuthListener from '@/providers/auth-listener';
import { getUser } from '@/lib/repositories/userRepository';

export default async function SetupLayout({
   children,
}: {
   children: React.ReactNode;
}) {
   console.log('[RootSetupLayout] beginning operations');

   const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
         cookies: {
            get(name: string) {
               return cookies().get(name)?.value;
            },
         },
      },
   );

   const {
      data: { session },
   } = await supabase.auth.getSession();
   const user = session?.user;

   if (!user) {
      console.log('[RootSetupLayout] no userId, redirecting to /sign-in');
      redirect('/auth');
   }

   const dbUser = await getUser(user.id);

   if (!dbUser?.is_onboarded) {
      redirect('/onboarding');
   }

   let organization;
   let store;
   try {
      organization = await findUserOrganization(user.id);

      if (organization)
         store = await prismadb.store.findFirst({
            where: {
               organization_id: organization.id,
            },
         });
   } catch (error) {
      console.error('[RootSetupLayout error]', error);
      return <ErrorPage title="Unable to connect to server" />;
   }

   if (organization && store) {
      console.log(
         '[RootSetupLayout] org and store found. redirecting to /[orgId]/[storeId]',
      );
      redirect(`organizations/${organization.id}/store/${store.id}`);
   }

   return (
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
         <Toaster />
         <ModalProvider />
         <AuthListener />
         {user ? (
            <WrappedUserProvider>
               <CurrencyProvider>
                  <ExchangeRateProvider>{children}</ExchangeRateProvider>
               </CurrencyProvider>
            </WrappedUserProvider>
         ) : (
            children
         )}
      </ThemeProvider>
   );
}
