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
         <div className="grid lg:grid-cols-5 h-screen">
            <Sidebar className="hidden lg:block" storeId={params.storeId} />
            <div className="col-span-3 lg:col-span-4 lg:border-l">
               <div className="h-full px-4 py-6 lg:px-8">{children}</div>
            </div>
         </div>
      </>
   );
}
