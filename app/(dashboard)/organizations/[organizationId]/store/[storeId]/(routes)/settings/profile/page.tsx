import { redirect } from 'next/navigation';

import { findStore } from '@/lib/repositories/storesRepository';
import { ProfileForm } from './components/profile-form';
import { getUser } from '@/lib/repositories/userRepository';
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

   let u;
   try {
      const {
         data: { session },
      } = await supabase.auth.getSession();
      u = session?.user;
   } catch (error) {
      redirect('/auth');
   }

   if (!u) {
      redirect('/auth');
   }

   const store = await findStore({
      id: parseInt(params.storeId),
   });

   if (!store) {
      redirect('/');
   }

   const user = await getUser(u.id);

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-6">
            <ProfileForm initialData={user} />
         </div>
      </div>
   );
};

export default SettingsPage;
