'use client';

import { useWrappedUser } from '@/providers/wrapped-user-provider';
import { ProfileForm } from '../components/profile-form';

export default async function ProfilePage() {
   const { wrappedUser } = useWrappedUser();

   return (
      <div className="flex-col h-screen bg-background">
         <div className="flex-1 space-y-6 space-y-4 p-8 pt-6">
            <ProfileForm initialData={wrappedUser} />
         </div>
      </div>
   );
}
