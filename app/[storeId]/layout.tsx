import { CurrencyProvider } from '@/providers/currency-provider';
import { WrappedUserProvider } from '@/providers/wrapped-user-provider';
import { ExchangeRateProvider } from '@/providers/exchange-rate-provider';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { MainHeader } from '@/components/main-header';
import { Sidebar } from '@/components/sidebar';
import { CalendarCheck, Scissors, Settings } from 'lucide-react';
import { Footer } from '@/components/footer';
import { redirect } from 'next/navigation';

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
                     <Sidebar
                        collapsible
                        withAnimation
                        defaultCollapsed
                        routes={[
                           {
                              href: `/1/services`,
                              label: 'Services',
                              icon: <Scissors className="mr-2 h-5 w-5" />,
                           },
                           {
                              href: `/1/appointments`,
                              label: 'Appointments',
                              icon: <CalendarCheck className="mr-2 h-5 w-5" />,
                           },
                           {
                              href: `/1/settings`,
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
      </section>
   );
}
