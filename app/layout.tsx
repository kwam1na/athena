import { ModalProvider } from '@/providers/modal-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import './globals.css';
import { CurrencyProvider } from '@/providers/currency-provider';
import { WrappedUserProvider } from '@/providers/wrapped-user-provider';
import { ExchangeRateProvider } from '@/providers/exchange-rate-provider';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import AuthListener from '@/providers/auth-listener';
import { Toaster } from '@/components/ui/sonner';
import { MainHeader } from '@/components/main-header';
import { Sidebar } from '@/components/sidebar';
import { CalendarCheck, Scissors, Settings } from 'lucide-react';
import { Footer } from '@/components/footer';
import { ReactQueryClientProvider } from '@/providers/query-client-provider';

export const metadata = {
   title: 'athena',
   description: 'Store management',
};

export default async function RootLayout({
   children,
}: {
   children: React.ReactNode;
}) {
   const cookieStore = cookies();
   const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
         cookies: {
            get(name: string) {
               return cookieStore.get(name)?.value;
            },
         },
      },
   );

   let user;

   try {
      const {
         data: { session },
      } = await supabase.auth.getSession();
      user = session?.user;
   } catch (error) {
      console.log('error', error);
   }

   const Authenticated = () => {
      return (
         <WrappedUserProvider>
            <CurrencyProvider>
               <ExchangeRateProvider>
                  <MainHeader />
                  <main>
                     <Sidebar
                        collapsible
                        withAnimation
                        defaultCollapsed
                        routes={[
                           {
                              href: `/services`,
                              label: 'Services',
                              icon: <Scissors className="mr-2 h-5 w-5" />,
                           },
                           {
                              href: `/appointments`,
                              label: 'Appointments',
                              icon: <CalendarCheck className="mr-2 h-5 w-5" />,
                           },
                           {
                              href: `/settings`,
                              label: 'Settings',
                              icon: <Settings className="mr-2 mr-2 h-5 w-5" />,
                           },
                        ]}
                     >
                        {children}
                     </Sidebar>
                  </main>
                  <Footer />
               </ExchangeRateProvider>
            </CurrencyProvider>
         </WrappedUserProvider>
      );
   };

   return (
      <html lang="en">
         <body>
            <ReactQueryClientProvider>
               <ThemeProvider
                  attribute="class"
                  defaultTheme="system"
                  enableSystem
               >
                  <Toaster />
                  <ModalProvider />
                  <AuthListener />
                  {user ? (
                     <Authenticated />
                  ) : (
                     <main className="h-screen">{children}</main>
                  )}
               </ThemeProvider>
            </ReactQueryClientProvider>
         </body>
      </html>
   );
}
