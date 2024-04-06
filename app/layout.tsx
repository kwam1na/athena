import { ModalProvider } from '@/providers/modal-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import './globals.css';
import AuthListener from '@/providers/auth-listener';
import { Toaster } from '@/components/ui/sonner';
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
                  <main>{children}</main>
               </ThemeProvider>
            </ReactQueryClientProvider>
         </body>
      </html>
   );
}
