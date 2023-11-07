import { redirect } from 'next/navigation';
import Navbar from '@/components/navbar';
import prismadb from '@/lib/prismadb';
import { getSession } from '@auth0/nextjs-auth0';
import { Sidebar } from './(routes)/inventory/components/sidebar';
import { EmptyState } from '@/components/states/empty/empty-state';
import { Monitor } from 'lucide-react';
import { AppSideBar } from '@/components/app-side-bar';
import { Separator } from '@/components/ui/separator';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { CurrencyProvider } from '@/providers/currency-provider';
import { WrappedUserProvider } from '@/providers/wrapped-user-provider';
import AuthListener from '@/providers/auth-listener';

export default async function DashboardLayout({
   children,
   params,
}: {
   children: React.ReactNode;
   params: { organizationId: string; storeId: string };
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

   const {
      data: { session },
   } = await supabase.auth.getSession();

   const user = session?.user;

   if (!user) {
      redirect('/auth');
   }

   const store = await prismadb.store.findFirst({
      where: {
         id: parseInt(params.storeId),
         organization_id: parseInt(params.organizationId),
      },
   });

   if (!store) {
      redirect('/');
   }

   return (
      <WrappedUserProvider>
         <AuthListener />
         <CurrencyProvider>
            <div className="h-screen flex flex-col">
               <div className="md:hidden p-4 flex items-center justify-center">
                  <EmptyState
                     icon={
                        <Monitor
                           size={'120px'}
                           color="#5C5C5C"
                           strokeWidth={'1px'}
                        />
                     }
                     text="athena is currently only available on desktop or larger screens."
                  />
               </div>
               <div className="hidden md:block px-8 py-10">
                  <Navbar />
               </div>
               <div className="flex-grow flex gap-8">
                  <AppSideBar className="hidden md:block p-8 w-[300px]" />
                  {/* <div className="hidden md:block p-2">
                  </div> */}
                  <div className="h-full w-full hidden md:block space-y-8 pl-2 pb-24 pr-8">
                     {/* <Navbar /> */}
                     <div className="h-full w-full pb-8">{children}</div>
                  </div>
               </div>
               <div className="w-full h-[80px] flex items-center justify-center py-8">
                  <p className="text-sm text-muted">
                     &copy; 2023 v26 Design co.
                  </p>
               </div>
            </div>
         </CurrencyProvider>
      </WrappedUserProvider>
   );
}
