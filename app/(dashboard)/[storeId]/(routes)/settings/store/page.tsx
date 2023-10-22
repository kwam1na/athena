import { redirect } from 'next/navigation';

import { SettingsForm } from '../components/settings-form';
import { getSession } from '@auth0/nextjs-auth0';
import { findStore } from '@/lib/repositories/storesRepository';

const SettingsPage = async ({ params }: { params: { storeId: string } }) => {
   const session = await getSession();
   const user = session?.user;

   if (!user) {
      redirect('/api/auth/login');
   }

   const store = await findStore({
      id: params.storeId,
      user_id: user.sub,
   });

   if (!store) {
      redirect('/');
   }

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-4 p-4 pt-6">
            <SettingsForm initialData={store} />
         </div>
      </div>
   );
};

export default SettingsPage;
