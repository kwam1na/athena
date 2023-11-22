import { format } from 'date-fns';

import { UsersClient } from './components/client';
import { UserColumn } from './components/columns';
import { getUsers } from '@/lib/repositories/userRepository';

const UsersPage = async ({
   params,
}: {
   params: { storeId: string; organizationId: string };
}) => {
   const users = await getUsers();

   const formattedUsers: UserColumn[] = users.map((user) => ({
      id: user.id,
      name: user.name || 'N/A',
      email: user.email,
      createdAt: format(user.created_at, 'MMM d, yyyy'),
      updatedAt: format(user.updated_at, 'MMM d, yyyy'),
   }));

   return (
      <div className="flex-col p-16">
         <div className="flex-1 space-y-6">
            {formattedUsers.length > 0 && <UsersClient data={formattedUsers} />}
         </div>
      </div>
   );
};

export default UsersPage;
