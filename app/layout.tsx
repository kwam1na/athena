import { Inter } from 'next/font/google';

import { ModalProvider } from '@/providers/modal-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';
import { CurrencyProvider } from '@/providers/currency-provider';
import { WrappedUserProvider } from '@/providers/wrapped-user-provider';
import { ExchangeRateProvider } from '@/providers/exchange-rate-provider';
import { createSupabaseServerClient } from './api/utils';

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
   const supabase = createSupabaseServerClient();
   const {
      data: { session },
   } = await supabase.auth.getSession();
   const user = session?.user;
   return (
      <html lang="en">
         <body className={inter.className}>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
               <Toaster />
               <ModalProvider />
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
