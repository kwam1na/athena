import { redirect } from 'next/navigation';

import StoreSwitcher from '@/components/store-switcher';
import { MainNav } from '@/components/main-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import prismadb from '@/lib/prismadb';
import { UserNav } from './user-nav';
import { getSession } from '@auth0/nextjs-auth0';

const Navbar = async () => {
   const session = await getSession();
   const user = session?.user;

   if (!user) {
      redirect('/api/auth/login');
   }

   // console.log('user:', user);

   const stores = await prismadb.store.findMany({
      where: {
         user_id: user.sub,
      },
   });

   return (
      <div className="border-b h-16">
         <div className="flex flex-col mt-8 ml-8 gap-6">
            <div className="flex">
               <div className="flex gap-4 items-center">
                  <p className="border-r w-16">athena</p>
                  <StoreSwitcher items={stores} />
               </div>
               <div className="ml-auto mr-8">
                  <UserNav />
               </div>
            </div>
         </div>
      </div>
   );
};

export default Navbar;
