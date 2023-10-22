import { redirect } from 'next/navigation';

import { getSession } from '@auth0/nextjs-auth0';
import { findStore } from '@/lib/repositories/storesRepository';
import { ProfileForm } from '../components/profile-form';
import { getUser } from '@/lib/repositories/userRepository';

const SettingsPage = async ({ params }: { params: { storeId: string } }) => {
   const session = await getSession();
   const auth0User = session?.user;

   if (!auth0User) {
      redirect('/api/auth/login');
   }

   const store = await findStore({
      id: params.storeId,
      user_id: auth0User.sub,
   });

   if (!store) {
      redirect('/');
   }

   const user = await getUser(auth0User.sub);

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-4 p-4 pt-6">
            <ProfileForm initialData={user} />
         </div>
      </div>
   );
};

export default SettingsPage;
