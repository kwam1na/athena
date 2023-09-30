import { Inter } from 'next/font/google';

import { ModalProvider } from '@/providers/modal-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import QCProvider from '@/providers/query-client-provider';
import './globals.css';
// import { UserProvider } from '@/providers/user-provider';
import { UserProvider } from '@auth0/nextjs-auth0/client';

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
               <UserProvider>{children}</UserProvider>
            </ThemeProvider>
         </body>
      </html>
   );
}
