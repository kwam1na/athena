import * as z from 'zod';
import { ActionModal } from '@/components/modals/action-modal';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { apiAddOrganizationMember } from '@/lib/api/organizations';
import { captureException } from '@sentry/nextjs';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useUser } from '@/providers/user-provider';

const addMemberSchema = z.object({
   email: z.string().email(),
});

interface AddOrganizationMemberModalProps {
   organizationName: string;
   isModalOpen: boolean;
   setIsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export const AddOrganizationMemberModal: React.FC<
   AddOrganizationMemberModalProps
> = ({ organizationName, isModalOpen, setIsModalOpen }) => {
   const params = useParams();
   const router = useRouter();
   const { user, isLoadingUser } = useUser();
   const { toast } = useToast();

   const [newMemberEmail, setNewMemberEmail] = useState('');
   const [memberRole, setMemberRole] = useState('member');
   const [invalidEmail, setInvalidEmail] = useState(false);
   const [isAddingOrganizationMember, setIsAddingOrganizationMember] =
      useState(false);

   const addOrganizationMember = async () => {
      setIsAddingOrganizationMember(true);
      console.log(user);

      const body = {
         email: newMemberEmail,
         role: memberRole,
         organization_id: parseInt(params.organizationId),
         added_by: user.id,
      };
      try {
         await apiAddOrganizationMember(body);
         router.refresh();
         toast({
            title: 'Member added.',
         });
      } catch (error: any) {
         captureException(error);
         toast({
            title: 'Something went wrong. Try again.',
            description: (error as Error).message,
         });
      } finally {
         setIsAddingOrganizationMember(false);
         onCloseAddOrganizationMemberModal();
         setNewMemberEmail('');
      }
   };

   const handleEnteredMemberEmail = (e: any) => {
      setNewMemberEmail(e.currentTarget.value);
      const parsedResult = addMemberSchema.safeParse({
         email: e.currentTarget.value,
      });
      setInvalidEmail(!parsedResult.success);
   };

   const onCloseAddOrganizationMemberModal = () => {
      setIsModalOpen(false);
   };

   return (
      <ActionModal
         isOpen={isModalOpen}
         title={`Add a member to ${organizationName}`}
         description=" "
         confirmText="Add member"
         onConfirm={addOrganizationMember}
         confirmButtonDisabled={invalidEmail || !newMemberEmail}
         shimmerButtons={isLoadingUser}
         loading={isAddingOrganizationMember}
         onClose={onCloseAddOrganizationMemberModal}
      >
         <div className="flex flex-col gap-4">
            <div className="flex gap-4">
               <div className="flex flex-col gap-4 w-[60%]">
                  <Input
                     type="email"
                     placeholder="Member's email address"
                     onChange={handleEnteredMemberEmail}
                     value={newMemberEmail}
                  />
                  {invalidEmail && (
                     <p className="text-sm text-destructive">
                        Invalid email entered
                     </p>
                  )}
               </div>
               <div className="w-[40%]">
                  <Select
                     onValueChange={(role) => {
                        setMemberRole(role);
                     }}
                     defaultValue={memberRole}
                  >
                     <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                     </SelectTrigger>
                     <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                     </SelectContent>
                  </Select>
               </div>
            </div>
            <div className="space-y-2">
               <Label className="text-sm">Roles</Label>
               <p className="text-sm">
                  Admin: Can manage all aspects of the organization
               </p>
               <p className="text-sm">
                  Member: Can manage only the store(s) they are assigned
               </p>
            </div>
         </div>
      </ActionModal>
   );
};
