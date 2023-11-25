import { redirect } from 'next/navigation';

import { StoreSettingsForm } from '../components/store-settings-form';
import { findStore } from '@/lib/repositories/storesRepository';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

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
      id: parseInt(params.storeId),
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
