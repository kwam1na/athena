import { redirect } from 'next/navigation';

import StoreSwitcher from '@/components/store-switcher';
import { UserNav } from './user-nav';
import { fetchStores } from '@/lib/repositories/storesRepository';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import OrganizationSwitcher from './organization-switcher';
import { fetchOrganizations } from '@/lib/repositories/organizationsRepository';

const Navbar = async () => {
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
      redirect('/auth');
   }

   const stores = await fetchStores(user.id);
   const organizations = await fetchOrganizations(user.id);

   console.log('organizations', organizations);

   return (
      <div>
         <div className="flex w-full items-center">
            <div className="flex gap-4 items-center">
               <OrganizationSwitcher items={organizations} />
               <StoreSwitcher items={stores} />
            </div>
            <div className="ml-auto mr-8">
               <UserNav />
            </div>
         </div>
      </div>
   );
};

export default Navbar;
