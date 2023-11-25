import { AlertModal } from '@/components/modals/alert-modal';
import { useToast } from '@/components/ui/use-toast';
import { apiDeleteOrganizationMember } from '@/lib/api/organizations';
import { captureException } from '@sentry/nextjs';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { capitalizeWord } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface OrganizationMember {
   id: number;
   user_name: string;
   user_email: string;
   role: string;
   is_onboarded: boolean;
}

export const OrganizationMemberRow: React.FC<OrganizationMember> = ({
   id,
   user_name,
   user_email,
   is_onboarded,
   role,
}) => {
   let fallback;
   const { toast } = useToast();
   const router = useRouter();
   const [open, setOpen] = useState(false);
   const [removingOrganizationMember, setRemovingOrganizationMember] =
      useState(false);

   const name = user_name || user_email;
   const names = name?.split(' ');
   if (names) {
      if (names.length == 1) {
         fallback = names[0].charAt(0);
      } else {
         fallback = names[0].charAt(0) + names[1].charAt(0);
      }
   }

   const removeOrganizationMember = async () => {
      try {
         setRemovingOrganizationMember(true);
         await apiDeleteOrganizationMember(id.toString());
         router.refresh();
         toast({
            title: 'Member removed.',
         });
      } catch (error: any) {
         captureException(error);
         toast({
            title: 'Something went wrong. Try again.',
            description: (error as Error).message,
         });
      } finally {
         setRemovingOrganizationMember(false);
         setOpen(false);
      }
   };

   return (
      <>
         <AlertModal
            isOpen={open}
            onClose={() => setOpen(false)}
            onConfirm={removeOrganizationMember}
            loading={removingOrganizationMember}
         />
         <div className="flex justify-between">
            <div className="flex gap-8 items-center">
               <Avatar className="h-8 w-8">
                  <AvatarImage src={''} alt="user profile image" />
                  <AvatarFallback>
                     {fallback && fallback.toUpperCase()}
                  </AvatarFallback>
               </Avatar>
               <div>
                  <p className="text-md">{name}</p>
                  <p className="text-sm text-muted-foreground">
                     {capitalizeWord(role)}
                  </p>
                  {!is_onboarded && (
                     <p className="text-sm text-muted-foreground">
                        Pending account creation
                     </p>
                  )}
               </div>
            </div>
            {role !== 'owner' && (
               <Button variant={'outline'} onClick={() => setOpen(true)}>
                  Remove member
               </Button>
            )}
         </div>
      </>
   );
};
