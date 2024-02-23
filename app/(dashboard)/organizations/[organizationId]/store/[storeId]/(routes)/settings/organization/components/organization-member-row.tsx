import { AlertModal } from '@/components/modals/alert-modal';
import { useToast } from '@/components/ui/use-toast';
import { apiDeleteOrganizationMember } from '@/lib/api/organizations';
import { captureException } from '@sentry/nextjs';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { capitalizeWord } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useUser } from '@/providers/user-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';
import { mainContainerVariants } from '@/lib/animation/constants';

export interface OrganizationMember {
   id: number;
   user_id: string;
   user_name: string;
   user_email: string;
   role: string;
   is_onboarded: boolean;
}

export const OrganizationMemberRow: React.FC<OrganizationMember> = ({
   id,
   user_id,
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
   const { user, isLoadingUser } = useUser();

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

   const canRemoveMember =
      role !== 'owner' &&
      user.role &&
      ['admin', 'owner'].includes(user.role) &&
      user_id !== user.id;

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
               {isLoadingUser ? (
                  <motion.div
                     className="flex items-center space-x-4"
                     variants={mainContainerVariants}
                     initial="hidden"
                     animate="visible"
                  >
                     <Skeleton className="w-[40px] h-[40px] rounded-full" />
                     <div className="flex flex-col gap-1">
                        <Skeleton className="w-[64px] h-[16px]" />
                        <Skeleton className="w-[96px] h-[16px]" />
                     </div>
                  </motion.div>
               ) : (
                  <motion.div
                     className="flex items-center space-x-4"
                     variants={mainContainerVariants}
                     initial="hidden"
                     animate={'visible'}
                  >
                     <Avatar className="h-8 w-8">
                        <AvatarImage src={''} alt="user profile image" />
                        <AvatarFallback>
                           {fallback && fallback.toUpperCase()}
                        </AvatarFallback>
                     </Avatar>
                     <div>
                        <div className="flex gap-1 items-center">
                           <p className="text-md">{name}</p>
                           {user_id === user.id && (
                              <p className="text-sm text-muted-foreground">
                                 (you)
                              </p>
                           )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                           {capitalizeWord(role)}
                        </p>
                        {!is_onboarded && (
                           <p className="text-sm text-muted-foreground">
                              Pending account creation
                           </p>
                        )}
                     </div>
                  </motion.div>
               )}
            </div>
            {canRemoveMember && (
               <Button variant={'outline'} onClick={() => setOpen(true)}>
                  Remove member
               </Button>
            )}
         </div>
      </>
   );
};
