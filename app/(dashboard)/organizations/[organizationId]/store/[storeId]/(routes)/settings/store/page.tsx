import { redirect } from 'next/navigation';

import { SettingsForm } from '../components/settings-form';
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

   const {
      data: { session },
   } = await supabase.auth.getSession();
   const user = session?.user;

   if (!user) {
      redirect('/auth');
   }

   const store = await findStore({
      id: parseInt(params.storeId),
      created_by: user.id,
   });

   if (!store) {
      redirect('/');
   }

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-6">
            <SettingsForm initialData={store} />
         </div>
      </div>
   );
};

export default SettingsPage;
