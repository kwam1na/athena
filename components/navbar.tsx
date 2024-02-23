import { redirect } from 'next/navigation';

import StoreSwitcher from '@/components/store-switcher';
import { UserNav } from './user-nav';
import { fetchStores } from '@/lib/repositories/storesRepository';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import OrganizationSwitcher from './organization-switcher';
import { fetchOrganizations } from '@/lib/repositories/organizationsRepository';

const Navbar = async ({
   params,
}: {
   params: { organizationId: string; storeId: string };
}) => {
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

   let user;
   try {
      const {
         data: { session },
      } = await supabase.auth.getSession();
      user = session?.user;
   } catch (error) {
      redirect('/auth');
   }

   if (!user) {
      redirect('/auth');
   }

   const stores = await fetchStores(parseInt(params.organizationId));
   const organizations = await fetchOrganizations(user.id);

   return (
      <div className="flex w-full items-center justify-between">
         <div className="flex items-center">
            <div className="flex gap-4">
               <OrganizationSwitcher items={organizations} />
               <StoreSwitcher items={stores} />
            </div>
         </div>
         <div className="ml-auto">
            <UserNav />
         </div>
      </div>
   );
};

export default Navbar;
