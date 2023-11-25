import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import {
   OrganizationMember,
   OrganizationMemberRow,
} from './organization-member-row';
import { useState } from 'react';
import { AddOrganizationMemberModal } from './add-organization-member-modal';

export const OrganizationMembers = ({
   organizationName,
   members,
}: {
   organizationName: string;
   members: OrganizationMember[];
}) => {
   const [
      isAddOrganizationMemberModalOpen,
      setIsAddOrganizationMemberModalOpen,
   ] = useState(false);

   return (
      <>
         <AddOrganizationMemberModal
            organizationName={organizationName}
            isModalOpen={isAddOrganizationMemberModalOpen}
            setIsModalOpen={setIsAddOrganizationMemberModalOpen}
         />
         <div className="flex flex-col gap-8">
            <div className="flex items-center justify-between">
               <span className="text-md">Organization members</span>
               <Button
                  variant={'outline'}
                  onClick={() => setIsAddOrganizationMemberModalOpen(true)}
               >
                  <Plus className="h-4 w-4 mr-2" /> Add member
               </Button>
            </div>
            <div className="flex flex-col gap-8 border rounded-lg p-8">
               {members.map((member: OrganizationMember) => (
                  <OrganizationMemberRow
                     id={member.id}
                     user_name={member.user_name}
                     user_email={member.user_email}
                     role={member.role}
                     is_onboarded={member.is_onboarded}
                  />
               ))}
            </div>
         </div>
      </>
   );
};
