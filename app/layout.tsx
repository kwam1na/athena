import { Inter } from 'next/font/google';

import { ModalProvider } from '@/providers/modal-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';
import { CurrencyProvider } from '@/providers/currency-provider';
import { WrappedUserProvider } from '@/providers/wrapped-user-provider';
import { ExchangeRateProvider } from '@/providers/exchange-rate-provider';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import AuthListener from '@/providers/auth-listener';
import { redirect } from 'next/navigation';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
   title: 'athena',
   description: 'Store management',
};

export default async function RootLayout({
   children,
}: {
   children: React.ReactNode;
}) {
   console.debug('[RootLayout] beginning operations');

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

   return (
      <html lang="en">
         <body className={inter.className}>
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
         </body>
      </html>
   );
}
