import { Inter } from 'next/font/google';

import { ModalProvider } from '@/providers/modal-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';
import { UserProvider } from '@auth0/nextjs-auth0/client';
import { CurrencyProvider } from '@/providers/currency-provider';
import { WrappedUserProvider } from '@/providers/wrapped-user-provider';
import { ExchangeRateProvider } from '@/providers/exchange-rate-provider';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
   title: 'Dashboard',
   description: 'E-Commerce Dashboard',
};

export default async function RootLayout({
   children,
}: {
   children: React.ReactNode;
}) {
   console.debug('[RootLayout] beginning operations');
   return (
      <html lang="en">
         <body className={inter.className}>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
               <Toaster />
               <ModalProvider />
               <UserProvider>
                  <WrappedUserProvider>
                     <CurrencyProvider>
                        <ExchangeRateProvider>{children}</ExchangeRateProvider>
                     </CurrencyProvider>
                  </WrappedUserProvider>
               </UserProvider>
            </ThemeProvider>
         </body>
      </html>
   );
}
