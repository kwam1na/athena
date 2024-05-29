import { CurrencyProvider } from '@/providers/currency-provider';
import { WrappedUserProvider } from '@/providers/wrapped-user-provider';
import { ExchangeRateProvider } from '@/providers/exchange-rate-provider';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { MainHeader } from '@/components/main-header';
import { CalendarCheck, Scissors, Settings } from 'lucide-react';
import { Footer } from '@/components/footer';
import { redirect } from 'next/navigation';
import { SideNav } from '@/components/side-nav';

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

   if (!user) redirect('/auth');

   return (
      <section>
         <WrappedUserProvider>
            <CurrencyProvider>
               <ExchangeRateProvider>
                  <MainHeader />
                  <main>
                     <SideNav
                        className="flex h-screen items-center bg-card rounded-lg backdrop-blur-md bg-opacity-30 justify-between fixed top-20 left-2 z-90"
                        routes={[
                           {
                              href: `/1/services`,
                              icon: <Scissors className="mr-2 h-5 w-5" />,
                           },
                           {
                              href: `/1/appointments`,
                              icon: <CalendarCheck className="mr-2 h-5 w-5" />,
                           },
                           {
                              href: `/1/settings`,
                              icon: <Settings className="mr-2 mr-2 h-5 w-5" />,
                           },
                        ]}
                     />
                     <div className="p-16">{children}</div>
                  </main>
                  {/* <Footer /> */}
               </ExchangeRateProvider>
            </CurrencyProvider>
         </WrappedUserProvider>
      </section>
   );
}
