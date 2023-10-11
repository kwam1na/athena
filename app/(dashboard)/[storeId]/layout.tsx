import { redirect } from 'next/navigation';
import Navbar from '@/components/navbar';
import prismadb from '@/lib/prismadb';
import { getSession } from '@auth0/nextjs-auth0';
import { Sidebar } from './(routes)/inventory/components/sidebar';

export default async function DashboardLayout({
   children,
   params,
}: {
   children: React.ReactNode;
   params: { storeId: string };
}) {
   const session = await getSession();
   const user = session?.user;

   // console.debug('[DashboardLayout] Setting up layout for user:', user);

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
         <Navbar />
         <div className="h-full px-8">
            <div className="h-full">
               <div className="h-full w-full">{children}</div>
            </div>
         </div>
      </>
   );
}
