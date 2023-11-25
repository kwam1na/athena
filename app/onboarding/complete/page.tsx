'use client';

import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { onboardingContainerVariants } from '@/lib/animation/constants';

export default function OnboardingSuccess() {
   const router = useRouter();

   const navigateToDashboard = () => {
      router.replace(`/`);
      sessionStorage.removeItem('organizationName');
      sessionStorage.removeItem('organizationId');
   };

   const organizationName = sessionStorage.getItem('organizationName');

   return (
      <div className="flex h-full">
         <motion.div
            className="flex flex-col h-full w-[50%] gap-32 px-16"
            variants={onboardingContainerVariants}
            initial="hidden"
            animate="visible"
         >
            <div className="flex flex-col gap-4 pt-32">
               <h1 className="text-3xl">All set!</h1>
               <h2 className="text-lg text-muted-foreground">
                  {organizationName
                     ? `You were added to the ${organizationName} organization.`
                     : 'You were added to an organization.'}
               </h2>
            </div>

            <div>
               <Button onClick={navigateToDashboard}>
                  Go to your dashboard
               </Button>
            </div>
         </motion.div>
         <div className="flex w-[50%] p-32 bg-card"></div>
      </div>
   );
}
