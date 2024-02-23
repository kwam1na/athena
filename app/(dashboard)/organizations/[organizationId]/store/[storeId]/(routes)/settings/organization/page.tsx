import { redirect } from 'next/navigation';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { OrganizationSettingsForm } from './components/organization-settings-form';
import { getOrganization } from '@/lib/repositories/organizationsRepository';

const OrganizationsPage = async ({
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

   const organization = await getOrganization(parseInt(params.organizationId));

   if (!organization) {
      redirect('/');
   }

   return (
      <div className="flex-col">
         <div className="flex-1 space-y-6">
            <OrganizationSettingsForm initialData={organization} />
         </div>
      </div>
   );
};

export default OrganizationsPage;
