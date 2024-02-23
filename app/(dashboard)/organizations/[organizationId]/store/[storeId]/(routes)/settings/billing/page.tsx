import { redirect } from 'next/navigation';

import { findStore } from '@/lib/repositories/storesRepository';
import { cookies } from 'next/headers';
import { Database } from '@/lib/database.types';
import { createServerClient } from '@supabase/ssr';
import { StoreSettingsForm } from '../store/components/store-settings-form';

const SettingsPage = async ({ params }: { params: { storeId: string } }) => {
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

   const store = await findStore({
      id: params.storeId,
      created_by: user.id,
   });

   if (!store) {
      redirect('/');
   }

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-6">
            <StoreSettingsForm initialData={store} />
         </div>
      </div>
   );
};

export default SettingsPage;
