import { redirect } from 'next/navigation';
import Navbar from '@/components/navbar';
import prismadb from '@/lib/prismadb';
import { getSession } from '@auth0/nextjs-auth0';
import { Sidebar } from './components/sidebar';
import { InventoryNav } from './components/inventory-nav';

export default async function StoreLayout({
   children,
   params,
}: {
   children: React.ReactNode;
   params: { storeId: string };
}) {
   return (
      <>
         <div className="pl-8 pt-4 pb-8 border-b">
            <InventoryNav />
         </div>
         <div className="h-full">{children}</div>
      </>
   );
}
