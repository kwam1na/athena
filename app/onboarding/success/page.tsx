'use client';

import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { LocalStorageSync } from '@/lib/local-storage-sync';
import { useRouter } from 'next/navigation';
import { useOnboardingData } from '@/providers/onboarding-data-provider';
import { onboardingContainerVariants } from '@/lib/animation/constants';
import { useEffect, useState } from 'react';

export default function OnboardingSuccess() {
   const router = useRouter();
   const [navigated, setNavigated] = useState(false);
   const { organizationId, storeId } = useOnboardingData();

   const navigateToDashboard = () => {
      router.replace(`/organizations/${organizationId}/store/${storeId}`);
      setNavigated(true);
   };

   useEffect(() => {
      if (navigated) {
         const onboardingAutoSaver = new LocalStorageSync('onboarding');
         onboardingAutoSaver.clearAll();
      }
   }, [navigated]);

   return (
      <div className="flex h-full">
         <motion.div
            className="flex flex-col h-full w-[50%] gap-32 px-16"
            variants={onboardingContainerVariants}
            initial="hidden"
            animate="visible"
         >
            <div className="flex flex-col gap-4 pt-32">
               <h1 className="text-3xl">
                  Congratulations! You've successfully added your first store.
               </h1>
               <h2 className="text-lg text-muted-foreground">
                  Keep the momentum going! Add products to your store and manage
                  your operations.
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
