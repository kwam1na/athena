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
import AppSkeleton from '@/components/states/loading/app-skeleton';
import DashboardSkeleton from '@/components/states/loading/dashboard-skeleton';
import { getUser } from '@/lib/repositories/userRepository';
import { getStore } from '@/lib/repositories/storesRepository';

export default async function DashboardLayout({
   children,
   params,
}: {
   children: React.ReactNode;
   params: { organizationId: string; storeId: string };
}) {
   console.debug('[DashboardLayout] params:', params);

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
      console.log('[DashboardLayout] no userId, redirecting to /auth');
      redirect('/auth');
   }

   const dbUser = await getUser(user.id);
   const store = await getStore(parseInt(params.storeId));

   if (store) {
      const { organization_id } = store;
      if (organization_id !== parseInt(params.organizationId)) {
         console.log(
            '[DashboardLayout] user is not authorized to access this store.',
         );
         redirect('/unauthorized');
      }
   }

   if (dbUser) {
      const { organization_id } = dbUser;
      if (organization_id !== parseInt(params.organizationId)) {
         console.log(
            '[DashboardLayout] user is not authorized to access this organization.',
         );
         redirect('/unauthorized');
      }
   }

   return (
      <WrappedUserProvider>
         <AuthListener />
         <CurrencyProvider>
            <div className="flex flex-col h-full md:h-[auto]">
               <div className="md:hidden p-4 flex items-center justify-center h-full md:h-[auto]">
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
               <div className="hidden md:flex gap-8 flex-grow h-full">
                  <aside className="sticky top-0 h-screen w-[300px] bg-zinc-200 dark:bg-card px-6">
                     <AppSideBar className="hidden md:block w-full pt-10" />
                  </aside>
                  <div className="flex-grow flex-col px-6 h-full pt-12">
                     <div className="hidden md:block">
                        <Navbar />
                     </div>
                     <main className="flex-grow pt-12 pb-24 h-full">
                        {children}
                     </main>
                  </div>
               </div>
            </div>
         </CurrencyProvider>
      </WrappedUserProvider>
   );
}
