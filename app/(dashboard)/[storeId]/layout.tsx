import { redirect } from 'next/navigation';
import Navbar from '@/components/navbar';
import prismadb from '@/lib/prismadb';
import { getSession } from '@auth0/nextjs-auth0';
import { Sidebar } from './(routes)/inventory/components/sidebar';
import { EmptyState } from '@/components/states/empty/empty-state';
import { Monitor } from 'lucide-react';

export default async function DashboardLayout({
   children,
   params,
}: {
   children: React.ReactNode;
   params: { storeId: string };
}) {
   const session = await getSession();
   const user = session?.user;

   if (!user) {
      redirect('/api/auth/login');
   }

   const store = await prismadb.store.findFirst({
      where: {
         id: params.storeId,
         user_id: user.sub,
      },
   });

   if (!store) {
      redirect('/');
   }

   return (
      <>
         <div className="md:hidden p-4 h-full flex items-center justify-center">
            <EmptyState
               icon={
                  <Monitor size={'120px'} color="#5C5C5C" strokeWidth={'1px'} />
               }
               text="athena is currently only available on desktop or larger
            screens."
            />
         </div>
         <>
            <div className="hidden md:block">
               <Navbar />
            </div>
            <div className="h-full px-8 hidden md:block">
               <div className="h-full">
                  <div className="h-full w-full">{children}</div>
               </div>
            </div>
         </>
      </>
   );
}
